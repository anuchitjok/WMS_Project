import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, RackType, SlotType } from '@prisma/client';
import { ScopePrincipal, warehouseFilter, scopedWarehouseIds, assertWarehouseAccess } from '../common/warehouse-scope';
import {
  RackCategory, addSlots, buildSpaceSummary, effectiveRackSize, emptySlotCounts, legacyRackType,
  planCapacity, planSlotCodes, rackCategory, simulate, slotSize, SlotCounts, WarehouseSpaceSummary,
  rackSpaceRow, RackSpaceRow, STORAGE_BUCKETS, StorageSlots, addStorageSlot, emptyStorageSlots,
  SimLineInput, SimulationResult, CapacityPlan, PlannedSlot,
} from './space-math';
import type {
  CreateWarehouseDto, UpdateWarehouseDto, CreateRackTypeDto, UpdateRackTypeDto, CreateRackDto, UpdateRackDto,
  CreateSlotDto, UpdateSlotDto, BulkSlotChangesDto, SpaceSimulateDto, SetupRacksDto,
} from './warehouse-master.dto';
import { IN_LOCATION_COUNT, NOT_IN_LOCATION } from '../common/stock-presence';

// Stock statuses that count as "active inventory" occupying a location.
const ACTIVE_STOCK = ['AVAILABLE', 'RESERVED', 'PICKED', 'QUARANTINE', 'PENDING_INSPECTION', 'RTV_PENDING'] as const;

/** Stock in a location now (same rule as occupancy: common/stock-presence). */
const STOCK_NOW = { status: { notIn: NOT_IN_LOCATION } } satisfies Prisma.StockItemWhereInput;
/** A live slot with nothing in it now - the guard on every slot delete write. */
const DELETABLE = { isDeleted: false, stockItems: { none: STOCK_NOW } } satisfies Prisma.SlotWhereInput;
const slotDeleted = (userId: string) => ({ isActive: false, isDeleted: true, deletedAt: new Date(), deletedBy: userId });

/** Racks the setup wizard creates in one go (zones × racks, slots from the Rack Type grid). */
export interface SetupRacksResult {
  warehouseId: string;
  rackType: { id: string; code: string; name: string; category: string; lengthCm: number; widthCm: number; heightCm: number; levels: number; columns: number };
  racks: { code: string; zone: string }[];
  slotsPerRack: number;
  totalRacks: number;
  totalSlots: number;
  /** Floor taken by the new racks (m²). */
  newFootprintM2: number;
  /** Floor already taken by the warehouse's racks (m², racks with a known size). */
  usedFootprintM2: number;
  /** Usable floor (m²) = length × width × usable %; null when the size is not entered. */
  usableAreaM2: number | null;
  /** NO_WAREHOUSE_SIZE | OVER_AREA (warn only, G4). */
  warnings: string[];
  preview: boolean;
  created: number;
}

/** Most racks one setup call may create (keeps the transaction short). */
const SETUP_MAX_RACKS = 500;
const pad2 = (n: number) => String(n).padStart(2, '0');
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface BulkDeleteSlotsResult {
  /** Deleted (in preview: would be deleted). */
  deleted: { id: string; code: string }[];
  /** Not deleted: stock is in the slot now. */
  blocked: { id: string; code: string; stock: number }[];
  /** Unknown or already deleted ids. */
  notFound: string[];
  preview: boolean;
}

const SIZE_KEYS = ['lengthCm', 'widthCm', 'heightCm'] as const;
const trimOrNull = (v: string | null | undefined) => (v == null ? null : v.trim() || null);

/** Copies only the keys present in `dto` (undefined = untouched, null = clear). */
function pick<T extends object, K extends keyof T>(dto: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (dto[k] !== undefined) out[k] = dto[k];
  return out;
}

export interface SpaceSummaryResponse {
  generatedAt: string;
  warehouses: WarehouseSpaceSummary[];
  totals: {
    warehouses: number;
    withSize: number;
    totalAreaM2: number;
    usableAreaM2: number;
    rackFootprintM2: number;
    freeAreaM2: number;
    volumeM3: number;
    racksWithoutSize: number;
    slots: SlotCounts;
    stockQty: number;
    capacityUsedPct: number | null;
    /** Layer 1 over warehouses that have a size (racks of unsized warehouses are not compared with any area). */
    floor: { totalAreaM2: number; rackFootprintM2: number; availableM2: number; utilPct: number | null; overCapacityWarehouses: number; warehousesWithoutSize: number };
    /** Layer 2 over every counted rack. */
    storage: { totalRackAreaM2: number; areaM2: Record<string, number>; slots: Record<string, number>; utilPct: number | null; racksCounted: number; racksExcluded: number };
  };
}

// Totals are added in whole cents so they match the per-warehouse figures exactly.
const cents = (n: number) => Math.round(n * 100);
const pct1 = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

export function floorTotals(rows: WarehouseSpaceSummary[]): SpaceSummaryResponse['totals']['floor'] {
  let total = 0, fp = 0, over = 0, noSize = 0;
  for (const w of rows) {
    if (w.floor.totalAreaM2 == null) { noSize++; continue; }
    total += cents(w.floor.totalAreaM2);
    fp += cents(w.floor.rackFootprintM2);
    if (w.floor.overCapacity) over++;
  }
  return { totalAreaM2: total / 100, rackFootprintM2: fp / 100, availableM2: (total - fp) / 100, utilPct: pct1(fp, total), overCapacityWarehouses: over, warehousesWithoutSize: noSize };
}

export function storageTotals(rows: WarehouseSpaceSummary[]): SpaceSummaryResponse['totals']['storage'] {
  let total = 0, counted = 0, excluded = 0;
  const area: Record<string, number> = {};
  const slots: Record<string, number> = { total: 0 };
  for (const k of STORAGE_BUCKETS) { area[k] = 0; slots[k] = 0; }
  for (const w of rows) {
    const s = w.storage;
    total += cents(s.totalRackAreaM2);
    counted += s.racksCounted;
    excluded += s.racksWithoutSizeCodes.length + s.racksWithoutSlotsCodes.length;
    for (const k of STORAGE_BUCKETS) { area[k] += cents(s.areaM2[k]); slots[k] += s.slots[k]; }
    slots.total += s.slots.total;
  }
  for (const k of STORAGE_BUCKETS) area[k] /= 100;
  return { totalRackAreaM2: total / 100, areaM2: area, slots, utilPct: pct1(cents(area.occupied + area.reserved), total), racksCounted: counted, racksExcluded: excluded };
}

@Injectable()
export class WarehouseMasterService {
  constructor(private prisma: PrismaService) {}

  // ── Audit helper (reuses existing AuditLog framework; detail carries before/after) ──
  private audit(userId: string, action: string, entityType: string, entityId: string, before: any, after: any, db: { auditLog: PrismaService['auditLog'] } = this.prisma) {
    return db.auditLog.create({
      data: { userId, action, entityType, entityId, detail: JSON.stringify({ before, after }) },
    });
  }

  // ── Reads ───────────────────────────────────────────────────────────────────
  // Full master tree — includes INACTIVE warehouses (so they can be re-activated)
  // but excludes soft-deleted records. Each rack also carries its display
  // category, effective size and computed slot size (from space-math).
  async getTree() {
    const tree = await this.prisma.warehouse.findMany({
      where: { isDeleted: false },
      include: {
        racks: {
          where: { isDeleted: false },
          include: {
            rackTypeMaster: true,
            // Slot stock = stock in the slot now (shipped / consumed history does not count).
            slots: { where: { isDeleted: false }, include: { _count: { select: { stockItems: IN_LOCATION_COUNT } } }, orderBy: [{ level: 'asc' }, { column: 'asc' }] },
            _count: { select: { slots: { where: { isDeleted: false } }, stockItems: true } },
          },
          orderBy: { code: 'asc' },
        },
        _count: { select: { racks: true, stockItems: true } },
      },
      orderBy: { code: 'asc' },
    });
    return tree.map((w) => ({
      ...w,
      racks: w.racks.map((r) => {
        const size = effectiveRackSize(r);
        return { ...r, category: rackCategory(r), effectiveSize: size, slotSize: slotSize(size, r.levels, r.columns) };
      }),
    }));
  }

  async getSummary() {
    const [totalWarehouses, activeWarehouses, totalRacks, totalSlots] = await Promise.all([
      this.prisma.warehouse.count({ where: { isDeleted: false } }),
      this.prisma.warehouse.count({ where: { isDeleted: false, isActive: true } }),
      this.prisma.rack.count({ where: { isDeleted: false } }),
      this.prisma.slot.count({ where: { isDeleted: false } }),
    ]);
    return { totalWarehouses, activeWarehouses, totalRacks, totalSlots };
  }

  // Dependency / impact check for delete & deactivate confirmation dialogs.
  async getImpact(entity: 'warehouse' | 'rack' | 'slot', id: string) {
    if (entity === 'warehouse') {
      const wh = await this.prisma.warehouse.findFirst({ where: { id, isDeleted: false } });
      if (!wh) throw new NotFoundException('Warehouse not found');
      const [racks, slots, stock, activeStock] = await Promise.all([
        this.prisma.rack.count({ where: { warehouseId: id, isDeleted: false } }),
        this.prisma.slot.count({ where: { rack: { warehouseId: id }, isDeleted: false } }),
        this.prisma.stockItem.count({ where: { warehouseId: id } }),
        this.prisma.stockItem.count({ where: { warehouseId: id, status: { in: ACTIVE_STOCK as any } } }),
      ]);
      return { entity, id, racks, slots, stock, activeStock, canDeactivate: racks === 0 && slots === 0 && activeStock === 0 };
    }
    if (entity === 'rack') {
      const rack = await this.prisma.rack.findFirst({ where: { id, isDeleted: false } });
      if (!rack) throw new NotFoundException('Rack not found');
      const [slots, stock] = await Promise.all([
        this.prisma.slot.count({ where: { rackId: id, isDeleted: false } }),
        this.prisma.stockItem.count({ where: { rackId: id } }),
      ]);
      return { entity, id, slots, stock, canDelete: slots === 0 && stock === 0 };
    }
    const slot = await this.prisma.slot.findFirst({ where: { id, isDeleted: false } });
    if (!slot) throw new NotFoundException('Slot not found');
    // G3: a slot can be deleted when nothing is in it now, even with past stock.
    const [stock, history] = await Promise.all([
      this.prisma.stockItem.count({ where: { slotId: id, ...STOCK_NOW } }),
      this.prisma.stockItem.count({ where: { slotId: id } }),
    ]);
    return { entity, id, stock, history, canDelete: stock === 0 };
  }

  // ── Space summary (plan 1.5) — scoped to the caller's warehouses ─────────────
  private async computeSpace(
    scope: ScopePrincipal | null | undefined,
    warehouseId?: string,
  ): Promise<{ summary: WarehouseSpaceSummary; rows: RackSpaceRow[] }[]> {
    const filter = warehouseFilter(scope, warehouseId);
    const where: Prisma.WarehouseWhereInput = { isDeleted: false, ...(filter ? { id: filter } : {}) };
    const warehouses = await this.prisma.warehouse.findMany({ where, orderBy: { code: 'asc' } });
    if (warehouseId && !warehouses.length) throw new NotFoundException('Warehouse not found');
    const ids = warehouses.map((w) => w.id);
    if (!ids.length) return [];

    const [racks, slotGroups, stockGroups, slotStock] = await Promise.all([
      this.prisma.rack.findMany({ where: { warehouseId: { in: ids }, isDeleted: false }, include: { rackTypeMaster: true } }),
      this.prisma.slot.groupBy({
        by: ['rackId', 'status'],
        where: { isDeleted: false, rack: { warehouseId: { in: ids }, isDeleted: false } },
        _count: { _all: true },
        _sum: { capacity: true },
      }),
      this.prisma.stockItem.groupBy({
        by: ['warehouseId'],
        where: { warehouseId: { in: ids }, slotId: { not: null }, status: { in: ACTIVE_STOCK as any } },
        _sum: { quantity: true },
      }),
      // Per-slot in-location stock: Layer 2 "occupied" = slots that really hold stock.
      this.prisma.slot.findMany({
        where: { isDeleted: false, rack: { warehouseId: { in: ids }, isDeleted: false } },
        select: { rackId: true, status: true, _count: { select: { stockItems: IN_LOCATION_COUNT } } },
      }),
    ]);

    const rackWh = new Map(racks.map((r) => [r.id, r.warehouseId]));
    const slotsByWh = new Map<string, SlotCounts>();
    for (const g of slotGroups) {
      const wh = rackWh.get(g.rackId);
      if (!wh) continue;
      if (!slotsByWh.has(wh)) slotsByWh.set(wh, emptySlotCounts());
      addSlots(slotsByWh.get(wh)!, g.status, g._count._all, g._sum.capacity ?? 0);
    }
    const storageByRack = new Map<string, StorageSlots>();
    for (const sl of slotStock) {
      let st = storageByRack.get(sl.rackId);
      if (!st) storageByRack.set(sl.rackId, (st = emptyStorageSlots()));
      addStorageSlot(st, sl.status, sl._count.stockItems > 0);
    }
    const stockByWh = new Map(stockGroups.map((g) => [g.warehouseId, g._sum.quantity ?? 0]));

    const racksByWh = new Map<string, typeof racks>();
    for (const r of racks) {
      const list = racksByWh.get(r.warehouseId);
      if (list) list.push(r); else racksByWh.set(r.warehouseId, [r]);
    }

    return warehouses.map((w) => {
      const whRacks = racksByWh.get(w.id) ?? [];
      const rows = whRacks
        .map((r) => rackSpaceRow(r, storageByRack.get(r.id) ?? emptyStorageSlots()))
        .sort((a, b) => a.rackCode.localeCompare(b.rackCode));
      return { summary: buildSpaceSummary(w, whRacks, slotsByWh.get(w.id) ?? emptySlotCounts(), stockByWh.get(w.id) ?? 0, rows), rows };
    });
  }

  async getSpaceSummaries(scope: ScopePrincipal | null | undefined, warehouseId?: string): Promise<WarehouseSpaceSummary[]> {
    return (await this.computeSpace(scope, warehouseId)).map((x) => x.summary);
  }

  /** Drill-down: one row per rack of one warehouse (Layer 2 per rack + slot counts). */
  async getRackSpace(scope: ScopePrincipal | null | undefined, warehouseId: string): Promise<{ generatedAt: string; warehouse: WarehouseSpaceSummary; racks: RackSpaceRow[] }> {
    if (!warehouseId) throw new BadRequestException('warehouseId is required');
    const [hit] = await this.computeSpace(scope, warehouseId);
    if (!hit) throw new NotFoundException('Warehouse not found');
    return { generatedAt: new Date().toISOString(), warehouse: hit.summary, racks: hit.rows };
  }

  async getSpaceSummary(scope: ScopePrincipal | null | undefined, warehouseId?: string): Promise<SpaceSummaryResponse> {
    const warehouses = await this.getSpaceSummaries(scope, warehouseId);
    const sum = (f: (s: WarehouseSpaceSummary) => number | null) => Math.round(warehouses.reduce((a, s) => a + (f(s) ?? 0), 0) * 100) / 100;
    const slots = warehouses.reduce((acc, s) => {
      for (const k of Object.keys(acc) as (keyof SlotCounts)[]) acc[k] += s.slots[k];
      return acc;
    }, emptySlotCounts());
    const stockQty = sum((s) => s.stockQty);
    return {
      generatedAt: new Date().toISOString(),
      warehouses,
      totals: {
        warehouses: warehouses.length,
        withSize: warehouses.filter((s) => s.hasSize).length,
        totalAreaM2: sum((s) => s.totalAreaM2),
        usableAreaM2: sum((s) => s.usableAreaM2),
        rackFootprintM2: sum((s) => s.rackFootprintM2),
        freeAreaM2: sum((s) => s.freeAreaM2),
        volumeM3: sum((s) => s.volumeM3),
        racksWithoutSize: warehouses.reduce((a, s) => a + s.racks.withoutSize, 0),
        slots,
        stockQty,
        capacityUsedPct: slots.capacity > 0 ? Math.round((stockQty / slots.capacity) * 1000) / 10 : null,
        floor: floorTotals(warehouses),
        storage: storageTotals(warehouses),
      },
    };
  }

  // ── Capacity planner (plan 1.3) ─────────────────────────────────────────────
  async planCapacity(scope: ScopePrincipal | null | undefined, warehouseId: string, rackTypeId: string): Promise<CapacityPlan> {
    if (!warehouseId) throw new BadRequestException('warehouseId is required');
    if (!rackTypeId) throw new BadRequestException('rackTypeId is required');
    const [summary] = await this.getSpaceSummaries(scope, warehouseId);
    const template = await this.prisma.rackTypeMaster.findUnique({ where: { id: rackTypeId } });
    if (!template) throw new NotFoundException('Rack type not found');
    return planCapacity(summary, template);
  }

  // ── Space simulator (plan 1.6) — read only, nothing is saved ────────────────
  async simulate(scope: ScopePrincipal | null | undefined, dto: SpaceSimulateDto): Promise<SimulationResult> {
    let summaries = await this.getSpaceSummaries(scope);
    summaries = summaries.filter((s) => s.isActive);
    if (dto.warehouseIds?.length) {
      const allowed = scopedWarehouseIds(scope);
      const wanted = allowed ? dto.warehouseIds.filter((id) => allowed.includes(id)) : dto.warehouseIds;
      summaries = summaries.filter((s) => wanted.includes(s.warehouseId));
    }

    const lines = dto.lines ?? [];
    const productIds = [...new Set(lines.map((l) => l.productId).filter((x): x is string => !!x))];
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, code: true, name: true, lengthCm: true, widthCm: true, heightCm: true } })
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    const resolved: SimLineInput[] = lines.map((l, i) => {
      const p = l.productId ? byId.get(l.productId) : undefined;
      return {
        label: l.label?.trim() || (p ? `${p.code} · ${p.name}` : `#${i + 1}`),
        productId: l.productId ?? null,
        lengthCm: l.lengthCm ?? p?.lengthCm ?? null,
        widthCm: l.widthCm ?? p?.widthCm ?? null,
        heightCm: l.heightCm ?? p?.heightCm ?? null,
        quantity: l.quantity,
        stackLayers: l.stackLayers ?? 1,
      };
    });

    return simulate(
      { mode: dto.mode, areaM2: dto.areaM2, slots: dto.slots, pallet: { lengthCm: dto.palletLengthCm, widthCm: dto.palletWidthCm }, lines: resolved },
      summaries,
    );
  }

  // ── Warehouse ─────────────────────────────────────────────────────────────────
  async createWarehouse(dto: CreateWarehouseDto, userId: string) {
    if (!dto.code?.trim()) throw new ConflictException('Warehouse code is required');
    if (!dto.name?.trim()) throw new ConflictException('Warehouse name is required');
    const code = dto.code.trim();
    const exists = await this.prisma.warehouse.findUnique({ where: { code } });
    if (exists) throw new ConflictException(`Warehouse code "${code}" already exists`);
    const wh = await this.prisma.warehouse.create({
      data: {
        code, name: dto.name.trim(), location: trimOrNull(dto.location),
        ...pick(dto, [...SIZE_KEYS, 'usableAreaPct'] as const),
      },
    });
    await this.audit(userId, 'WAREHOUSE_CREATED', 'Warehouse', wh.id, null, wh);
    return wh;
  }

  async updateWarehouse(id: string, dto: UpdateWarehouseDto, userId: string) {
    const before = await this.prisma.warehouse.findFirst({ where: { id, isDeleted: false } });
    if (!before) throw new NotFoundException('Warehouse not found');
    const data: Prisma.WarehouseUpdateInput = { ...pick(dto, [...SIZE_KEYS, 'usableAreaPct'] as const) };
    if (dto.name !== undefined) { if (!dto.name.trim()) throw new ConflictException('Warehouse name cannot be empty'); data.name = dto.name.trim(); }
    if (dto.location !== undefined) data.location = trimOrNull(dto.location);
    const after = await this.prisma.warehouse.update({ where: { id }, data });
    await this.audit(userId, 'WAREHOUSE_UPDATED', 'Warehouse', id, before, after);
    return after;
  }

  async activateWarehouse(id: string, userId: string) {
    const before = await this.prisma.warehouse.findFirst({ where: { id, isDeleted: false } });
    if (!before) throw new NotFoundException('Warehouse not found');
    if (before.isActive) return before;
    const after = await this.prisma.warehouse.update({ where: { id }, data: { isActive: true } });
    await this.audit(userId, 'WAREHOUSE_ACTIVATED', 'Warehouse', id, before, after);
    return after;
  }

  async deactivateWarehouse(id: string, userId: string) {
    const before = await this.prisma.warehouse.findFirst({ where: { id, isDeleted: false } });
    if (!before) throw new NotFoundException('Warehouse not found');
    // Validation: cannot deactivate with active stock / active rack / active slot.
    const [activeStock, activeRacks, activeSlots] = await Promise.all([
      this.prisma.stockItem.count({ where: { warehouseId: id, status: { in: ACTIVE_STOCK as any } } }),
      this.prisma.rack.count({ where: { warehouseId: id, isDeleted: false, isActive: true } }),
      this.prisma.slot.count({ where: { rack: { warehouseId: id }, isDeleted: false, isActive: true } }),
    ]);
    if (activeStock > 0) throw new ConflictException(`Cannot deactivate: ${activeStock} active stock item(s) present`);
    if (activeRacks > 0) throw new ConflictException(`Cannot deactivate: ${activeRacks} active rack(s) present`);
    if (activeSlots > 0) throw new ConflictException(`Cannot deactivate: ${activeSlots} active slot(s) present`);
    const after = await this.prisma.warehouse.update({ where: { id }, data: { isActive: false } });
    await this.audit(userId, 'WAREHOUSE_DEACTIVATED', 'Warehouse', id, before, after);
    return after;
  }

  // ── Rack Type Master (plan 1.2) ─────────────────────────────────────────────
  listRackTypes(includeInactive = false) {
    return this.prisma.rackTypeMaster.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: { _count: { select: { racks: { where: { isDeleted: false } } } } },
      orderBy: [{ category: 'desc' }, { code: 'asc' }],
    });
  }

  async createRackType(dto: CreateRackTypeDto, userId: string) {
    const code = dto.code.trim();
    if (!code) throw new ConflictException('Rack type code is required');
    const exists = await this.prisma.rackTypeMaster.findUnique({ where: { code } });
    if (exists) throw new ConflictException(`Rack type code "${code}" already exists`);
    const pallet = dto.category === 'PALLET_ON_FLOOR';
    const rt = await this.prisma.rackTypeMaster.create({
      data: {
        code, name: dto.name.trim(), category: dto.category,
        lengthCm: dto.lengthCm, widthCm: dto.widthCm, heightCm: dto.heightCm,
        levels: pallet ? 1 : dto.levels ?? 1, columns: dto.columns ?? 1, slotCapacity: dto.slotCapacity ?? 1,
        maxStackHeightCm: dto.maxStackHeightCm ?? null, description: trimOrNull(dto.description),
      },
    });
    await this.audit(userId, 'RACK_TYPE_CREATED', 'RackTypeMaster', rt.id, null, rt);
    return rt;
  }

  async updateRackType(id: string, dto: UpdateRackTypeDto, userId: string) {
    const before = await this.prisma.rackTypeMaster.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Rack type not found');
    const data: Prisma.RackTypeMasterUpdateInput = pick(dto, ['category', 'lengthCm', 'widthCm', 'heightCm', 'levels', 'columns', 'slotCapacity', 'maxStackHeightCm', 'isActive'] as const);
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) data.description = trimOrNull(dto.description);
    if ((dto.category ?? before.category) === 'PALLET_ON_FLOOR') data.levels = 1;
    const after = await this.prisma.rackTypeMaster.update({ where: { id }, data });
    await this.audit(userId, 'RACK_TYPE_UPDATED', 'RackTypeMaster', id, before, after);
    return after;
  }

  // ── Rack ────────────────────────────────────────────────────────────────────
  /** Resolves template + category and the legacy enum value to store (STANDARD or PALLET only). */
  private async rackTypeFields(dto: CreateRackDto | UpdateRackDto, current?: { rackTypeId: string | null; rackType: RackType }) {
    const data: { rackTypeId?: string | null; rackType?: RackType } = {};
    let category: RackCategory | undefined = dto.category;
    if (dto.rackTypeId !== undefined) {
      data.rackTypeId = dto.rackTypeId || null;
      if (data.rackTypeId) {
        const t = await this.prisma.rackTypeMaster.findUnique({ where: { id: data.rackTypeId } });
        if (!t) throw new NotFoundException('Rack type not found');
        category ??= t.category === 'PALLET_ON_FLOOR' ? 'PALLET_ON_FLOOR' : 'STANDARD_RACK';
      }
    }
    if (!category && dto.rackType) category = dto.rackType === RackType.PALLET ? 'PALLET_ON_FLOOR' : 'STANDARD_RACK';
    if (category) data.rackType = legacyRackType(category) as RackType;
    else if (!current) data.rackType = RackType.STANDARD;
    return data;
  }

  async createRack(dto: CreateRackDto, userId: string) {
    if (!dto.code?.trim()) throw new ConflictException('Rack code is required');
    const code = dto.code.trim();
    const wh = await this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, isDeleted: false } });
    if (!wh) throw new NotFoundException('Warehouse not found');
    const exists = await this.prisma.rack.findUnique({ where: { warehouseId_code: { warehouseId: dto.warehouseId, code } } });
    if (exists) throw new ConflictException(`Rack code "${code}" already exists in this warehouse`);
    const typeFields = await this.rackTypeFields(dto);
    const rack = await this.prisma.rack.create({
      data: {
        warehouseId: dto.warehouseId, code,
        name: trimOrNull(dto.name), zone: trimOrNull(dto.zone), description: trimOrNull(dto.description),
        ...pick(dto, ['capacity', 'levels', 'columns', ...SIZE_KEYS] as const),
        ...typeFields,
      } as Prisma.RackUncheckedCreateInput,
    });
    await this.audit(userId, 'RACK_CREATED', 'Rack', rack.id, null, rack);
    return rack;
  }

  async updateRack(id: string, dto: UpdateRackDto, userId: string) {
    const before = await this.prisma.rack.findFirst({ where: { id, isDeleted: false } });
    if (!before) throw new NotFoundException('Rack not found');
    const data: Prisma.RackUncheckedUpdateInput = {
      ...pick(dto, ['capacity', 'levels', 'columns', ...SIZE_KEYS] as const),
      ...(await this.rackTypeFields(dto, before)),
    };
    if (dto.name !== undefined) data.name = trimOrNull(dto.name);
    if (dto.zone !== undefined) data.zone = trimOrNull(dto.zone);
    if (dto.description !== undefined) data.description = trimOrNull(dto.description);
    const after = await this.prisma.rack.update({ where: { id }, data });
    await this.audit(userId, 'RACK_UPDATED', 'Rack', id, before, after);
    return after;
  }

  async deleteRack(id: string, userId: string) {
    const before = await this.prisma.rack.findFirst({ where: { id, isDeleted: false } });
    if (!before) throw new NotFoundException('Rack not found');
    const [slots, stock] = await Promise.all([
      this.prisma.slot.count({ where: { rackId: id, isDeleted: false } }),
      this.prisma.stockItem.count({ where: { rackId: id } }),
    ]);
    if (slots > 0) throw new ConflictException(`Cannot delete: ${slots} slot(s) still exist in this rack`);
    if (stock > 0) throw new ConflictException(`Cannot delete: ${stock} stock item(s) reference this rack`);
    const after = await this.prisma.rack.update({ where: { id }, data: { isActive: false, isDeleted: true, deletedAt: new Date(), deletedBy: userId } });
    await this.audit(userId, 'RACK_DELETED', 'Rack', id, before, after);
    return { success: true, id };
  }

  // ── Generate slots (plan 1.4) ───────────────────────────────────────────────
  // Preview lists every code and which already exist. Commit creates only the
  // missing ones in ONE transaction with one audit entry. Existing slots are
  // never modified or deleted.
  async generateSlots(rackId: string, dto: { levels: number; columns: number; preview?: boolean }, userId: string) {
    const rack = await this.prisma.rack.findFirst({ where: { id: rackId, isDeleted: false }, include: { rackTypeMaster: true } });
    if (!rack) throw new NotFoundException('Rack not found');
    // Soft-deleted slots still hold their code in the unique key → treat as existing.
    const existing = await this.prisma.slot.findMany({ where: { rackId }, select: { code: true } });
    let planned: PlannedSlot[];
    try { planned = planSlotCodes(rack.code, dto.levels, dto.columns, existing.map((s) => s.code)); }
    catch (e) { throw new BadRequestException((e as Error).message); }
    const missing = planned.filter((p) => !p.exists);
    const size = slotSize(effectiveRackSize(rack), dto.levels, dto.columns);
    const slotType = rackCategory(rack) === 'PALLET_ON_FLOOR' ? SlotType.PALLET : SlotType.STANDARD;
    const capacity = rack.rackTypeMaster?.slotCapacity ?? 1;
    const result = {
      rackId, rackCode: rack.code, levels: dto.levels, columns: dto.columns,
      total: planned.length, existing: planned.length - missing.length, toCreate: missing.length,
      slotType, capacity, slotSize: size, slots: planned, created: 0, preview: !!dto.preview,
    };
    if (dto.preview || missing.length === 0) return result;

    const created = await this.prisma.$transaction(async (tx) => {
      const res = await tx.slot.createMany({
        data: missing.map((p) => ({
          rackId, code: p.code, level: p.level, column: p.column, slotType, capacity,
          lengthCm: size.lengthCm, widthCm: size.widthCm, heightCm: size.heightCm,
        })),
        skipDuplicates: true,
      });
      await this.audit(userId, 'SLOTS_GENERATED', 'Rack', rackId, null,
        { levels: dto.levels, columns: dto.columns, created: res.count, codes: missing.map((p) => p.code) }, tx);
      return res.count;
    });
    return { ...result, created };
  }

  // ── Setup wizard ────────────────────────────────────────────────────────────
  /**
   * Plans (preview) or creates racks for whole zones in one transaction: rack
   * codes `<Zone>-R<nn>` continue after the zone's highest existing number, each
   * rack takes the Rack Type (size, levels × columns) and gets its slots right
   * away. Nothing is half-created: any failure rolls everything back.
   */
  async setupRacks(warehouseId: string, dto: SetupRacksDto, userId: string, scope?: ScopePrincipal): Promise<SetupRacksResult> {
    assertWarehouseAccess(scope, warehouseId, 'this warehouse');
    const wh = await this.prisma.warehouse.findFirst({ where: { id: warehouseId, isDeleted: false } });
    if (!wh) throw new NotFoundException('Warehouse not found');
    const type = await this.prisma.rackTypeMaster.findUnique({ where: { id: dto.rackTypeId } });
    if (!type || !type.isActive) throw new NotFoundException('Rack type not found or inactive');

    const zones = dto.zones.map((z) => ({ name: z.name.trim(), racks: z.racks }));
    const seen = new Set<string>();
    for (const z of zones) {
      const k = z.name.toUpperCase();
      if (seen.has(k)) throw new BadRequestException(`Zone "${z.name}" is listed twice`);
      seen.add(k);
    }
    const totalRacks = zones.reduce((a, z) => a + z.racks, 0);
    if (totalRacks > SETUP_MAX_RACKS) throw new BadRequestException(`At most ${SETUP_MAX_RACKS} racks at a time`);

    // Rack codes: continue after the highest <Zone>-R<nn> already in this warehouse
    // (deleted racks too — their code still holds the unique key).
    const existing = await this.prisma.rack.findMany({
      where: { warehouseId },
      select: { code: true, isDeleted: true, lengthCm: true, widthCm: true, heightCm: true, rackType: true, rackTypeMaster: { select: { category: true, lengthCm: true, widthCm: true, heightCm: true } } },
    });
    const taken = new Set(existing.map((r) => r.code.toUpperCase()));
    const racks: { code: string; zone: string }[] = [];
    for (const z of zones) {
      const re = new RegExp(`^${z.name.replace(/[-]/g, '\\-')}-R(\\d+)$`, 'i');
      let n = existing.reduce((mx, r) => { const m = re.exec(r.code); return m ? Math.max(mx, Number(m[1])) : mx; }, 0);
      for (let i = 0; i < z.racks; i++) {
        let code: string;
        do { n += 1; code = `${z.name}-R${pad2(n)}`; } while (taken.has(code.toUpperCase()));
        taken.add(code.toUpperCase());
        racks.push({ code, zone: z.name });
      }
    }

    const levels = Math.max(1, type.levels), columns = Math.max(1, type.columns);
    const planned = planSlotCodes('X', levels, columns, []); // same grid for every rack
    const size = { lengthCm: type.lengthCm, widthCm: type.widthCm, heightCm: type.heightCm };
    const slot = slotSize(size, levels, columns);
    const category = type.category === 'PALLET_ON_FLOOR' ? 'PALLET_ON_FLOOR' : 'STANDARD_RACK';
    const slotType = category === 'PALLET_ON_FLOOR' ? SlotType.PALLET : SlotType.STANDARD;

    const m2 = (l: number | null, w: number | null) => (l && w ? (l * w) / 10_000 : 0);
    const newFootprintM2 = round2(racks.length * m2(type.lengthCm, type.widthCm));
    const usedFootprintM2 = round2(existing.filter((r) => !r.isDeleted).reduce((a, r) => {
      const s = effectiveRackSize(r as any); return a + m2(s.lengthCm, s.widthCm);
    }, 0));
    const usableAreaM2 = wh.lengthCm && wh.widthCm ? round2(m2(wh.lengthCm, wh.widthCm) * ((wh.usableAreaPct ?? 100) / 100)) : null;
    const warnings: string[] = [];
    if (usableAreaM2 == null) warnings.push('NO_WAREHOUSE_SIZE');
    else if (usedFootprintM2 + newFootprintM2 > usableAreaM2) warnings.push('OVER_AREA');

    const result: SetupRacksResult = {
      warehouseId,
      rackType: { id: type.id, code: type.code, name: type.name, category, lengthCm: type.lengthCm, widthCm: type.widthCm, heightCm: type.heightCm, levels, columns },
      racks, slotsPerRack: planned.length, totalRacks: racks.length, totalSlots: racks.length * planned.length,
      newFootprintM2, usedFootprintM2, usableAreaM2, warnings, preview: !!dto.preview, created: 0,
    };
    if (dto.preview) return result;

    const created = await this.prisma.$transaction(async (tx) => {
      const ids: string[] = [];
      for (const r of racks) {
        // Rack own size stays empty: it follows the Rack Type (one size rule, G5).
        const rack = await tx.rack.create({
          data: {
            warehouseId, code: r.code, zone: r.zone, levels, columns,
            rackTypeId: type.id, rackType: legacyRackType(category) as RackType,
            capacity: planned.length * Math.max(1, type.slotCapacity),
          },
          select: { id: true, code: true },
        });
        ids.push(rack.id);
        await tx.slot.createMany({
          data: planSlotCodes(rack.code, levels, columns, []).map((p) => ({
            rackId: rack.id, code: p.code, level: p.level, column: p.column, slotType, capacity: type.slotCapacity,
            lengthCm: slot.lengthCm, widthCm: slot.widthCm, heightCm: slot.heightCm,
          })),
        });
      }
      await this.audit(userId, 'RACKS_SETUP', 'Warehouse', warehouseId, null, {
        rackTypeId: type.id, rackType: type.code, zones, rackIds: ids, codes: racks.map((r) => r.code), slots: racks.length * planned.length,
      }, tx);
      return ids.length;
    }, { timeout: 60_000 });
    return { ...result, created };
  }

  // ── Slot ────────────────────────────────────────────────────────────────────
  async createSlot(dto: CreateSlotDto, userId: string) {
    if (!dto.code?.trim()) throw new ConflictException('Slot code is required');
    const code = dto.code.trim();
    const rack = await this.prisma.rack.findFirst({ where: { id: dto.rackId, isDeleted: false } });
    if (!rack) throw new NotFoundException('Rack not found');
    const exists = await this.prisma.slot.findUnique({ where: { rackId_code: { rackId: dto.rackId, code } } });
    if (exists) throw new ConflictException(`Slot code "${code}" already exists in this rack`);
    const slot = await this.prisma.slot.create({
      data: {
        rackId: dto.rackId, code, name: trimOrNull(dto.name),
        ...pick(dto, ['level', 'column', 'slotType', 'capacity', 'maxWeight', ...SIZE_KEYS] as const),
      } as Prisma.SlotUncheckedCreateInput,
    });
    await this.audit(userId, 'SLOT_CREATED', 'Slot', slot.id, null, slot);
    return slot;
  }

  async updateSlot(id: string, dto: UpdateSlotDto, userId: string) {
    const before = await this.prisma.slot.findFirst({ where: { id, isDeleted: false } });
    if (!before) throw new NotFoundException('Slot not found');
    const data: Prisma.SlotUpdateInput = pick(dto, ['slotType', 'capacity', 'maxWeight', ...SIZE_KEYS] as const);
    if (dto.name !== undefined) data.name = trimOrNull(dto.name);
    const after = await this.prisma.slot.update({ where: { id }, data });
    await this.audit(userId, 'SLOT_UPDATED', 'Slot', id, before, after);
    return after;
  }

  /** Same change on many slots — one transaction, one audit entry. Deleted slots are skipped. */
  async bulkUpdateSlots(ids: string[], changes: BulkSlotChangesDto, userId: string) {
    const data = pick(changes, ['slotType', 'capacity', 'maxWeight', ...SIZE_KEYS] as const);
    if (!Object.keys(data).length) throw new BadRequestException('No changes given');
    const unique = [...new Set(ids)];
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.slot.updateMany({ where: { id: { in: unique }, isDeleted: false }, data });
      await this.audit(userId, 'SLOTS_BULK_UPDATED', 'Slot', unique[0], null, { ids: unique, changes: data, updated: res.count }, tx);
      return { updated: res.count };
    });
  }

  /**
   * Soft delete (G3): allowed when no stock is in the slot now, even if stock
   * passed through it before. The row stays, so stock history and reports keep
   * the slot code; receiving / putaway refuse deleted slots (resolveLocation).
   */
  async deleteSlot(id: string, userId: string, scope?: ScopePrincipal) {
    const found = await this.prisma.slot.findFirst({ where: { id, isDeleted: false }, include: { rack: { select: { warehouseId: true } } } });
    if (!found) throw new NotFoundException('Slot not found');
    assertWarehouseAccess(scope, found.rack.warehouseId, 'this location');
    const { rack: _rack, ...before } = found;
    const stock = await this.prisma.stockItem.count({ where: { slotId: id, ...STOCK_NOW } });
    if (stock > 0) throw new ConflictException(`Cannot delete: ${stock} stock item(s) are in this slot now`);
    return this.prisma.$transaction(async (tx) => {
      // Guarded write: stock that arrived after the check above makes it a no-op.
      const data = slotDeleted(userId);
      const res = await tx.slot.updateMany({ where: { id, ...DELETABLE }, data });
      if (res.count !== 1) throw new ConflictException('Stock was put in this slot meanwhile - nothing deleted');
      await this.audit(userId, 'SLOT_DELETED', 'Slot', id, before, { ...before, ...data }, tx);
      return { success: true, id };
    });
  }

  /**
   * Delete many slots at once (G3). Slots with stock in them now are skipped and
   * listed with the reason; the rest are soft deleted in one transaction with
   * one audit entry. `preview` only reports what would happen.
   */
  async bulkDeleteSlots(ids: string[], userId: string, preview = false, scope?: ScopePrincipal): Promise<BulkDeleteSlotsResult> {
    const unique = [...new Set(ids)];
    const run = async (db: Prisma.TransactionClient): Promise<BulkDeleteSlotsResult> => {
      const slots = await db.slot.findMany({
        where: { id: { in: unique }, isDeleted: false },
        select: { id: true, code: true, rackId: true, rack: { select: { warehouseId: true } }, _count: { select: { stockItems: IN_LOCATION_COUNT } } },
      });
      // One slot outside the caller's warehouses refuses the whole request.
      for (const s of slots) assertWarehouseAccess(scope, s.rack.warehouseId, `location ${s.code}`);
      const found = new Set(slots.map((s) => s.id));
      const notFound = unique.filter((id) => !found.has(id));
      const blocked = slots.filter((s) => s._count.stockItems > 0).map((s) => ({ id: s.id, code: s.code, stock: s._count.stockItems }));
      const deletable = slots.filter((s) => s._count.stockItems === 0).map((s) => ({ id: s.id, code: s.code }));
      if (preview || !deletable.length) return { deleted: preview ? deletable : [], blocked, notFound, preview };
      const res = await db.slot.updateMany({ where: { id: { in: deletable.map((d) => d.id) }, ...DELETABLE }, data: slotDeleted(userId) });
      // Stock put away between the read and the write: undo everything (rollback).
      if (res.count !== deletable.length) throw new ConflictException('Stock was put in some of these slots meanwhile - nothing deleted, please try again');
      await this.audit(userId, 'SLOTS_BULK_DELETED', 'Slot', deletable[0].id, null, {
        ids: deletable.map((d) => d.id), codes: deletable.map((d) => d.code),
        rackIds: [...new Set(slots.map((s) => s.rackId))], blocked, notFound,
      }, db);
      return { deleted: deletable, blocked, notFound, preview };
    };
    return preview ? run(this.prisma as unknown as Prisma.TransactionClient) : this.prisma.$transaction(run);
  }
}
