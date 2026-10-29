import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InboundSupplyStatus, Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS, hasAccess } from '../auth/access';
import { assertNotSelfApproval } from '../common/separation-of-duties';
import { assertWarehouseAccess, scopedWarehouseIds } from '../common/warehouse-scope';
import { MrpDataService } from './mrp-data.service';
import { MrpConfigShape, mergeConfig, validateConfig } from './engine/config';
import { validateParams } from './engine/params';
import { periodStart } from './engine/periods';
import { round } from './engine/usage';
import { ForecastOverrideDto, PlanningParamDto, SupplierDto, UpdatePlanningParamDto, UpdateSupplierDto } from './dto';
import { MrpService, Principal } from './mrp.service';

const DATE_FIELDS = ['effectiveFrom', 'effectiveTo', 'priceValidFrom', 'priceValidTo'] as const;
const COST_FIELDS = ['unitCost', 'unitPrice', 'currency', 'costBasis', 'priceSource', 'priceValidFrom', 'priceValidTo'] as const;

/** Copies a DTO without undefined keys (DTO instances carry every declared property) and parses date strings. */
function toDates<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  for (const k of DATE_FIELDS) if (typeof out[k] === 'string') out[k] = new Date(out[k] as string);
  return out as T;
}

export const SUPPLY_COLUMNS = [
  'poNumber', 'lineNumber', 'sku', 'vendorCode', 'warehouseCode', 'orderedQty', 'receivedQty', 'cancelledQty', 'uom',
  'unitCost', 'currency', 'orderDate', 'expectedDate', 'confirmed', 'status', 'lastReceiptDate', 'notes',
] as const;

@Injectable()
export class MrpMasterService {
  constructor(
    private prisma: PrismaService,
    private data: MrpDataService,
    private mrp: MrpService,
  ) {}

  private audit(userId: string, action: string, entityType: string, entityId: string, detail: unknown) {
    return this.prisma.auditLog.create({ data: { userId, action, entityType, entityId, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) } });
  }

  // ── Configuration ──────────────────────────────────────────────────────
  async getConfig() {
    const { config, version, stored } = await this.data.loadConfig();
    const row = await this.prisma.mrpConfig.findUnique({ where: { key: 'default' } });
    return { config, version, stored, updatedAt: row?.updatedAt ?? null, updatedById: row?.updatedById ?? null };
  }

  async updateConfig(u: Principal, partial: Record<string, unknown>) {
    const current = await this.data.loadConfig();
    const next = mergeConfig({ ...current.config, ...partial, methods: { ...current.config.methods, ...((partial.methods as object) ?? {}) }, classification: { ...current.config.classification, ...((partial.classification as object) ?? {}) }, pattern: { ...current.config.pattern, ...((partial.pattern as object) ?? {}) }, accuracy: { ...current.config.accuracy, ...((partial.accuracy as object) ?? {}) } });
    const errors = validateConfig(next);
    if (errors.length) throw new BadRequestException(errors);
    const row = await this.prisma.mrpConfig.upsert({
      where: { key: 'default' },
      update: { config: next as unknown as Prisma.InputJsonValue, version: { increment: 1 }, updatedById: u.id },
      create: { key: 'default', config: next as unknown as Prisma.InputJsonValue, version: 1, updatedById: u.id },
    });
    await this.audit(u.id, 'MRP_CONFIG_UPDATED', 'MrpConfig', row.id, { version: row.version, before: current.config, after: next });
    return { config: next as MrpConfigShape, version: row.version, stored: true };
  }

  // ── Planning parameters ────────────────────────────────────────────────
  private assertParamScope(u: Principal, warehouseId: string | null | undefined) {
    if (warehouseId) assertWarehouseAccess(u, warehouseId, 'this warehouse');
    else if (scopedWarehouseIds(u)) throw new ForbiddenException('All-warehouse planning parameters can only be set by a planner without warehouse restrictions');
  }

  private stripCost<T extends Record<string, unknown>>(u: Principal, o: T): T {
    if (this.mrp.canSeeCost(u)) return o;
    const out: Record<string, unknown> = { ...o };
    for (const k of COST_FIELDS) if (k in out) out[k] = null;
    return out as T;
  }

  private assertCostWrite(u: Principal, dto: Record<string, unknown>) {
    if (COST_FIELDS.some((k) => dto[k] !== undefined && dto[k] !== null) && !this.mrp.canSeeCost(u)) {
      throw new ForbiddenException('Changing cost or price fields needs the mrp.cost permission');
    }
  }

  /** Every product with its current all-warehouse parameters and what is missing. */
  async listParams(u: Principal, q: { search?: string; missing?: string; page?: string; pageSize?: string }) {
    const now = new Date();
    const where: Prisma.ProductWhereInput = q.search ? { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }] } : {};
    const products = await this.prisma.product.findMany({ where, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, category: true, unit: true, productStatus: true, unitCost: true, minStock: true } });
    const ids = products.map((p) => p.id);
    const [params, suppliers] = await Promise.all([
      this.prisma.materialPlanningParam.findMany({ where: { productId: { in: ids }, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, orderBy: { effectiveFrom: 'desc' } }),
      this.prisma.materialSupplier.findMany({ where: { productId: { in: ids }, isActive: true } }),
    ]);
    const scope = scopedWarehouseIds(u);
    let rows = products.map((p) => {
      const mine = params.filter((x) => x.productId === p.id && (!x.warehouseId || !scope || scope.includes(x.warehouseId)));
      const current = mine.find((x) => !x.warehouseId) ?? null;
      const sup = suppliers.filter((s) => s.productId === p.id);
      const preferred = sup.find((s) => s.isPreferred) ?? null;
      const missing: string[] = [];
      if (!current) missing.push('parameters');
      else {
        if (current.leadTimeDays === null && preferred?.leadTimeDays == null) missing.push('lead time');
        if (current.safetyStock === null) missing.push('safety stock');
        if (current.unitCost === null && preferred?.unitPrice == null) missing.push('cost');
      }
      if (!preferred && current?.replenishmentMethod !== 'NONE') missing.push('preferred supplier');
      const check = current ? validateParams(current as never) : { errors: [], warnings: [] };
      return {
        product: this.stripCost(u, p as unknown as Record<string, unknown>),
        current: current ? this.stripCost(u, current as unknown as Record<string, unknown>) : null,
        warehouseOverrides: mine.filter((x) => x.warehouseId).length,
        suppliers: sup.length,
        preferredVendorId: preferred?.vendorId ?? null,
        missing,
        issues: [...check.errors, ...check.warnings],
      };
    });
    if (q.missing === 'true') rows = rows.filter((r) => r.missing.length || r.issues.length);
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));
    return {
      total: rows.length,
      summary: { products: products.length, withParameters: rows.filter((r) => r.current).length, withIssues: rows.filter((r) => r.missing.length || r.issues.length).length },
      page, pageSize,
      data: rows.slice((page - 1) * pageSize, page * pageSize),
    };
  }

  async paramHistory(u: Principal, productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    const scope = scopedWarehouseIds(u);
    const rows = await this.prisma.materialPlanningParam.findMany({ where: { productId }, orderBy: [{ warehouseId: 'asc' }, { effectiveFrom: 'desc' }] });
    return {
      canSeeCost: this.mrp.canSeeCost(u),
      product: this.stripCost(u, product as unknown as Record<string, unknown>),
      rows: rows.filter((r) => !r.warehouseId || !scope || scope.includes(r.warehouseId)).map((r) => this.stripCost(u, r as unknown as Record<string, unknown>)),
    };
  }

  /**
   * Adds a parameter version. A version that starts after the current open one
   * ends it (effectiveTo = new effectiveFrom), so history is kept and windows
   * never overlap. Starting on or before the current version's start is refused.
   */
  async createParam(u: Principal, dto: PlanningParamDto) {
    this.assertParamScope(u, dto.warehouseId);
    this.assertCostWrite(u, dto as unknown as Record<string, unknown>);
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId }, select: { id: true, code: true } });
    if (!product) throw new NotFoundException('Product not found');
    const input = toDates({ ...dto }) as unknown as Record<string, unknown>;
    const effectiveFrom = (input.effectiveFrom as Date | undefined) ?? new Date();
    const check = validateParams({ ...input, effectiveFrom } as never);
    if (check.errors.length) throw new BadRequestException(check.errors);
    const warehouseId = dto.warehouseId ?? null;
    return this.prisma.$transaction(async (tx) => {
      const open = await tx.materialPlanningParam.findMany({ where: { productId: dto.productId, warehouseId, OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }] } });
      for (const o of open) {
        if (o.effectiveFrom.getTime() >= effectiveFrom.getTime()) {
          throw new ConflictException(`A parameter version already starts on ${o.effectiveFrom.toISOString().slice(0, 10)}; edit it or start the new version later`);
        }
        await tx.materialPlanningParam.update({ where: { id: o.id }, data: { effectiveTo: effectiveFrom } });
      }
      const { productId: _p, warehouseId: _w, effectiveFrom: _f, ...rest } = input;
      void _p; void _w; void _f;
      // Users without cost rights cannot see or set cost, so the new version keeps the cost of the one it replaces.
      if (!this.mrp.canSeeCost(u)) {
        const prev = [...open].sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
        for (const k of ['unitCost', 'currency', 'costBasis'] as const) rest[k] = prev ? prev[k] : null;
      }
      const row = await tx.materialPlanningParam.create({
        data: { ...(rest as Prisma.MaterialPlanningParamUncheckedCreateInput), productId: dto.productId, warehouseId, effectiveFrom, updatedById: u.id },
      });
      await tx.auditLog.create({ data: { userId: u.id, action: 'MRP_PARAMETERS_CREATED', entityType: 'MaterialPlanningParam', entityId: row.id, detail: JSON.stringify({ sku: product.code, warehouseId, closed: open.map((o) => o.id), values: dto }) } });
      return { row: this.stripCost(u, row as unknown as Record<string, unknown>), warnings: check.warnings };
    });
  }

  async updateParam(u: Principal, id: string, dto: UpdatePlanningParamDto) {
    const before = await this.prisma.materialPlanningParam.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Planning parameters not found');
    this.assertParamScope(u, before.warehouseId);
    this.assertCostWrite(u, dto as unknown as Record<string, unknown>);
    const patch = toDates({ ...dto }) as unknown as Record<string, unknown>;
    const merged = { ...before, ...patch };
    const check = validateParams(merged as never);
    if (check.errors.length) throw new BadRequestException(check.errors);
    const row = await this.prisma.materialPlanningParam.update({ where: { id }, data: { ...(patch as Prisma.MaterialPlanningParamUncheckedUpdateInput), updatedById: u.id } });
    const changed = Object.keys(patch).filter((k) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify(patch[k]));
    await this.audit(u.id, 'MRP_PARAMETERS_UPDATED', 'MaterialPlanningParam', id, { productId: before.productId, changes: Object.fromEntries(changed.map((k) => [k, { from: (before as Record<string, unknown>)[k], to: patch[k] }])) });
    return { row: this.stripCost(u, row as unknown as Record<string, unknown>), warnings: check.warnings };
  }

  // ── Approved suppliers ─────────────────────────────────────────────────
  async listSuppliers(u: Principal, productId: string) {
    const rows = await this.prisma.materialSupplier.findMany({ where: { productId }, orderBy: [{ isPreferred: 'desc' }, { createdAt: 'asc' }] });
    const vendors = await this.prisma.vendor.findMany({ where: { id: { in: rows.map((r) => r.vendorId) } }, select: { id: true, code: true, name: true } });
    const v = new Map(vendors.map((x) => [x.id, x]));
    return rows.map((r) => ({ ...this.stripCost(u, r as unknown as Record<string, unknown>), vendor: v.get(r.vendorId) ?? null }));
  }

  async createSupplier(u: Principal, dto: SupplierDto) {
    this.assertCostWrite(u, dto as unknown as Record<string, unknown>);
    if (dto.unitPrice != null && !dto.currency) throw new BadRequestException('A price needs its currency');
    const [p, v] = await Promise.all([
      this.prisma.product.findUnique({ where: { id: dto.productId }, select: { id: true } }),
      this.prisma.vendor.findUnique({ where: { id: dto.vendorId }, select: { id: true, code: true } }),
    ]);
    if (!p) throw new NotFoundException('Product not found');
    if (!v) throw new NotFoundException('Vendor not found');
    const dup = await this.prisma.materialSupplier.findUnique({ where: { productId_vendorId: { productId: dto.productId, vendorId: dto.vendorId } } });
    if (dup) throw new ConflictException('This vendor is already listed for the product');
    return this.prisma.$transaction(async (tx) => {
      if (dto.isPreferred) await tx.materialSupplier.updateMany({ where: { productId: dto.productId }, data: { isPreferred: false } });
      const row = await tx.materialSupplier.create({ data: { ...(toDates({ ...dto }) as unknown as Prisma.MaterialSupplierUncheckedCreateInput), updatedById: u.id } });
      await tx.auditLog.create({ data: { userId: u.id, action: 'MRP_SUPPLIER_CREATED', entityType: 'MaterialSupplier', entityId: row.id, detail: JSON.stringify({ productId: dto.productId, vendor: v.code, values: dto }) } });
      return this.stripCost(u, row as unknown as Record<string, unknown>);
    });
  }

  async updateSupplier(u: Principal, id: string, dto: UpdateSupplierDto) {
    this.assertCostWrite(u, dto as unknown as Record<string, unknown>);
    const before = await this.prisma.materialSupplier.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Supplier entry not found');
    const merged = { ...before, ...toDates({ ...dto }) };
    if (merged.unitPrice != null && !merged.currency) throw new BadRequestException('A price needs its currency');
    return this.prisma.$transaction(async (tx) => {
      if (dto.isPreferred) await tx.materialSupplier.updateMany({ where: { productId: before.productId, id: { not: id } }, data: { isPreferred: false } });
      const row = await tx.materialSupplier.update({ where: { id }, data: { ...(toDates({ ...dto }) as unknown as Prisma.MaterialSupplierUncheckedUpdateInput), updatedById: u.id } });
      await tx.auditLog.create({ data: { userId: u.id, action: 'MRP_SUPPLIER_UPDATED', entityType: 'MaterialSupplier', entityId: id, detail: JSON.stringify({ productId: before.productId, changes: dto }) } });
      return this.stripCost(u, row as unknown as Record<string, unknown>);
    });
  }

  // ── Inbound supply (PO lines — controlled import, read-only otherwise) ──
  async listSupply(u: Principal, q: { status?: string; productId?: string; overdue?: string; search?: string; page?: string; pageSize?: string }) {
    const scope = scopedWarehouseIds(u);
    const where: Prisma.InboundSupplyLineWhereInput = {};
    if (scope) where.warehouseId = { in: scope };
    if (q.status) where.status = q.status as InboundSupplyStatus;
    if (q.productId) where.productId = q.productId;
    if (q.overdue === 'true') Object.assign(where, { status: { in: ['OPEN', 'PARTIAL'] }, expectedDate: { lt: new Date() } });
    if (q.search) where.OR = [{ poNumber: { contains: q.search, mode: 'insensitive' } }, { vendorName: { contains: q.search, mode: 'insensitive' } }];
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));
    const [total, rows] = await Promise.all([
      this.prisma.inboundSupplyLine.count({ where }),
      this.prisma.inboundSupplyLine.findMany({ where, orderBy: [{ expectedDate: { sort: 'asc', nulls: 'last' } }, { poNumber: 'asc' }, { lineNumber: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const received = await this.wmsReceived(rows);
    const products = await this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, code: true, name: true, unit: true } });
    const pm = new Map(products.map((p) => [p.id, p]));
    const today = new Date();
    return {
      total, page, pageSize, canSeeCost: this.mrp.canSeeCost(u),
      data: rows.map((r) => {
        const wms = received.get(`${r.poNumber}|${r.productId}`) ?? 0;
        const outstanding = Math.max(0, round(r.orderedQty - r.cancelledQty - Math.max(r.receivedQty, wms)));
        return {
          ...this.stripCost(u, r as unknown as Record<string, unknown>),
          product: pm.get(r.productId) ?? null,
          wmsReceivedQty: wms,
          outstandingQty: ['CLOSED', 'CANCELLED'].includes(r.status) ? 0 : outstanding,
          overdue: ['OPEN', 'PARTIAL'].includes(r.status) && outstanding > 0 && !!r.expectedDate && r.expectedDate < today,
        };
      }),
    };
  }

  /** Quantity booked in WMS Goods Receiving against each PO number + product. */
  private async wmsReceived(rows: Array<{ poNumber: string; productId: string }>) {
    const pos = [...new Set(rows.map((r) => r.poNumber))];
    const out = new Map<string, number>();
    if (!pos.length) return out;
    const items = await this.prisma.goodsReceivingItem.findMany({
      where: { receiving: { poNumber: { in: pos }, OR: [{ statusEnum: null }, { statusEnum: { notIn: ['CANCELLED', 'REJECTED'] } }] } },
      select: { productId: true, quantity: true, receiving: { select: { poNumber: true, receivedDate: true } } },
    });
    for (const i of items) {
      const k = `${i.receiving.poNumber}|${i.productId}`;
      out.set(k, round((out.get(k) ?? 0) + i.quantity));
    }
    return out;
  }

  /** Supplier delivery performance from PO lines that have been received. */
  async leadTimePerformance(u: Principal) {
    const scope = scopedWarehouseIds(u);
    const lines = await this.prisma.inboundSupplyLine.findMany({ where: { expectedDate: { not: null }, ...(scope ? { warehouseId: { in: scope } } : {}) } });
    const pos = [...new Set(lines.map((l) => l.poNumber))];
    const receipts = pos.length
      ? await this.prisma.goodsReceivingItem.findMany({
          where: { receiving: { poNumber: { in: pos }, OR: [{ statusEnum: null }, { statusEnum: { notIn: ['CANCELLED', 'REJECTED'] } }] } },
          select: { productId: true, receiving: { select: { poNumber: true, receivedDate: true } } },
        })
      : [];
    const lastWms = new Map<string, Date>();
    for (const r of receipts) {
      const k = `${r.receiving.poNumber}|${r.productId}`;
      const d = r.receiving.receivedDate;
      if (!lastWms.has(k) || lastWms.get(k)! < d) lastWms.set(k, d);
    }
    const byVendor = new Map<string, { vendor: string; lines: number; received: number; onTime: number; delays: number[]; leadTimes: number[] }>();
    const day = 86_400_000;
    for (const l of lines) {
      const k = l.vendorId ?? l.vendorName ?? 'UNKNOWN';
      const v = byVendor.get(k) ?? { vendor: l.vendorName ?? l.vendorId ?? 'Unknown vendor', lines: 0, received: 0, onTime: 0, delays: [], leadTimes: [] };
      v.lines += 1;
      const receivedAt = l.lastReceiptDate ?? lastWms.get(`${l.poNumber}|${l.productId}`) ?? null;
      if (receivedAt && l.expectedDate) {
        v.received += 1;
        const delay = Math.round((receivedAt.getTime() - l.expectedDate.getTime()) / day);
        v.delays.push(delay);
        if (delay <= 0) v.onTime += 1;
        if (l.orderDate) v.leadTimes.push(Math.round((receivedAt.getTime() - l.orderDate.getTime()) / day));
      }
      byVendor.set(k, v);
    }
    const avg = (a: number[]) => (a.length ? round(a.reduce((x, y) => x + y, 0) / a.length, 1) : null);
    return [...byVendor.values()].map((v) => ({
      vendor: v.vendor, poLines: v.lines, receivedLines: v.received,
      onTimePct: v.received ? round((v.onTime / v.received) * 100, 1) : null,
      avgDelayDays: avg(v.delays), maxDelayDays: v.delays.length ? Math.max(...v.delays) : null,
      avgActualLeadTimeDays: avg(v.leadTimes), leadTimeSamples: v.leadTimes.length,
      note: v.received < 3 ? 'Fewer than 3 received lines — not a reliable measure' : null,
    }));
  }

  async previewSupplyImport(u: Principal, rows: Record<string, unknown>[]) {
    const checked = await this.checkSupplyRows(u, rows);
    return { total: checked.length, valid: checked.filter((r) => !r.errors.length).length, invalid: checked.filter((r) => r.errors.length).length, rows: checked };
  }

  async commitSupplyImport(u: Principal, rows: Record<string, unknown>[]) {
    const checked = await this.checkSupplyRows(u, rows);
    const valid = checked.filter((r) => !r.errors.length);
    const batch = `IMP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${nanoid(5).toUpperCase()}`;
    let created = 0;
    let updated = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const r of valid) {
        const data = { ...r.data!, importBatchId: batch, updatedById: u.id, source: 'IMPORT' };
        const existing = await tx.inboundSupplyLine.findUnique({ where: { poNumber_lineNumber: { poNumber: data.poNumber, lineNumber: data.lineNumber } }, select: { id: true } });
        if (existing) { await tx.inboundSupplyLine.update({ where: { id: existing.id }, data }); updated += 1; }
        else { await tx.inboundSupplyLine.create({ data }); created += 1; }
      }
      await tx.auditLog.create({ data: { userId: u.id, action: 'MRP_SUPPLY_IMPORTED', entityType: 'InboundSupplyLine', entityId: batch, detail: JSON.stringify({ created, updated, skipped: checked.length - valid.length }) } });
    });
    return { batch, created, updated, skipped: checked.length - valid.length, errors: checked.filter((r) => r.errors.length) };
  }

  private async checkSupplyRows(u: Principal, rows: Record<string, unknown>[]) {
    const str = (v: unknown) => (v === null || v === undefined ? '' : String(v instanceof Date ? v.toISOString() : v).trim());
    const num = (v: unknown) => (str(v) === '' ? null : Number(str(v)));
    const date = (v: unknown) => {
      // Spreadsheet readers return a calendar date as midnight UTC (xlsx) or midnight server-local
      // time (csv); keep the calendar date the file shows, stored as midnight UTC.
      if (v instanceof Date) {
        if (Number.isNaN(v.getTime())) return undefined;
        const utc = v.getUTCHours() === 0 && v.getUTCMinutes() === 0;
        return utc ? v : new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
      }
      const s = str(v);
      if (!s) return null;
      const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00.000Z` : s);
      return Number.isNaN(d.getTime()) ? undefined : d;
    };
    const skus = [...new Set(rows.map((r) => str(r.sku)).filter(Boolean))];
    const vcodes = [...new Set(rows.map((r) => str(r.vendorCode)).filter(Boolean))];
    const whcodes = [...new Set(rows.map((r) => str(r.warehouseCode)).filter(Boolean))];
    const [products, vendors, warehouses] = await Promise.all([
      this.prisma.product.findMany({ where: { code: { in: skus } }, select: { id: true, code: true, unit: true } }),
      this.prisma.vendor.findMany({ where: { code: { in: vcodes } }, select: { id: true, code: true, name: true } }),
      this.prisma.warehouse.findMany({ where: { code: { in: whcodes } }, select: { id: true, code: true } }),
    ]);
    const pm = new Map(products.map((p) => [p.code, p]));
    const vm = new Map(vendors.map((v) => [v.code, v]));
    const wm = new Map(warehouses.map((w) => [w.code, w]));
    const scope = scopedWarehouseIds(u);
    const seen = new Set<string>();
    const cost = this.mrp.canSeeCost(u);
    return rows.map((r, i) => {
      const errors: string[] = [];
      const row = Number(r.__row ?? i + 2);
      const poNumber = str(r.poNumber);
      const lineNumber = str(r.lineNumber);
      if (!poNumber) errors.push('poNumber is required');
      if (!lineNumber) errors.push('lineNumber is required');
      const key = `${poNumber}|${lineNumber}`;
      if (poNumber && lineNumber && seen.has(key)) errors.push('Duplicate PO line in the file');
      seen.add(key);
      const product = pm.get(str(r.sku));
      if (!product) errors.push(`Unknown SKU "${str(r.sku)}"`);
      const vendor = str(r.vendorCode) ? vm.get(str(r.vendorCode)) : null;
      if (str(r.vendorCode) && !vendor) errors.push(`Unknown vendor code "${str(r.vendorCode)}"`);
      const wh = str(r.warehouseCode) ? wm.get(str(r.warehouseCode)) : null;
      if (str(r.warehouseCode) && !wh) errors.push(`Unknown warehouse code "${str(r.warehouseCode)}"`);
      if (scope && (!wh || !scope.includes(wh.id))) errors.push('Warehouse is required and must be one you have access to');
      const orderedQty = num(r.orderedQty);
      const receivedQty = num(r.receivedQty) ?? 0;
      const cancelledQty = num(r.cancelledQty) ?? 0;
      if (orderedQty === null || !Number.isFinite(orderedQty) || orderedQty <= 0) errors.push('orderedQty must be > 0');
      if (!Number.isFinite(receivedQty) || receivedQty < 0) errors.push('receivedQty must be ≥ 0');
      if (!Number.isFinite(cancelledQty) || cancelledQty < 0) errors.push('cancelledQty must be ≥ 0');
      if (orderedQty && receivedQty + cancelledQty > orderedQty) errors.push('receivedQty + cancelledQty exceed orderedQty');
      const unitCost = num(r.unitCost);
      const currency = str(r.currency).toUpperCase() || null;
      if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) errors.push('unitCost must be ≥ 0');
      if (unitCost !== null && !currency) errors.push('unitCost needs a currency');
      if (currency && !/^[A-Z]{3}$/.test(currency)) errors.push('currency must be a 3-letter code');
      if (unitCost !== null && !cost) errors.push('You do not have permission to import prices (mrp.cost)');
      const orderDate = date(r.orderDate);
      const expectedDate = date(r.expectedDate);
      const lastReceiptDate = date(r.lastReceiptDate);
      if (orderDate === undefined) errors.push('orderDate is not a date');
      if (expectedDate === undefined) errors.push('expectedDate is not a date');
      if (lastReceiptDate === undefined) errors.push('lastReceiptDate is not a date');
      let status = str(r.status).toUpperCase() || null;
      if (status && !['OPEN', 'PARTIAL', 'CLOSED', 'CANCELLED'].includes(status)) errors.push('status must be OPEN, PARTIAL, CLOSED or CANCELLED');
      if (!status && orderedQty) status = receivedQty + cancelledQty >= orderedQty ? 'CLOSED' : receivedQty > 0 ? 'PARTIAL' : 'OPEN';
      const uom = str(r.uom) || null;
      const warnings: string[] = [];
      if (product && uom && uom.toLowerCase() !== product.unit.toLowerCase()) warnings.push(`Unit ${uom} differs from the product unit ${product.unit}; the line is only planned if the supplier entry has a conversion`);
      if (!expectedDate && status !== 'CLOSED' && status !== 'CANCELLED') warnings.push('No expected date — the line cannot be time-phased and is left out of MRP');
      const confirmed = ['Y', 'YES', 'TRUE', '1'].includes(str(r.confirmed).toUpperCase());
      return {
        row, poNumber, lineNumber, sku: str(r.sku), errors, warnings,
        data: errors.length ? null : {
          poNumber, lineNumber, productId: product!.id, vendorId: vendor?.id ?? null, vendorName: vendor?.name ?? (str(r.vendorName) || null),
          warehouseId: wh?.id ?? null, orderedQty: orderedQty!, receivedQty, cancelledQty, uom, unitCost, currency,
          orderDate: orderDate ?? null, expectedDate: expectedDate ?? null, lastReceiptDate: lastReceiptDate ?? null,
          isConfirmed: confirmed, status: status as InboundSupplyStatus, notes: str(r.notes) || null,
        },
      };
    });
  }

  // ── Forecast overrides ─────────────────────────────────────────────────
  async listOverrides(u: Principal, q: { status?: string; productId?: string }) {
    const scope = scopedWarehouseIds(u);
    const rows = await this.prisma.forecastOverride.findMany({
      where: {
        ...(q.status ? { status: q.status as never } : {}),
        ...(q.productId ? { productId: q.productId } : {}),
        ...(scope ? { warehouseId: { in: scope } } : {}),
      },
      orderBy: { createdAt: 'desc' }, take: 300,
    });
    const [products, users] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, code: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: rows.flatMap((r) => [r.createdById, r.decidedById]).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } }),
    ]);
    const pm = new Map(products.map((p) => [p.id, p]));
    const um = new Map(users.map((x) => [x.id, x.fullName]));
    return rows.map((r) => ({ ...r, product: pm.get(r.productId) ?? null, createdBy: r.createdById ? um.get(r.createdById) ?? null : null, decidedBy: r.decidedById ? um.get(r.decidedById) ?? null : null }));
  }

  async createOverride(u: Principal, dto: ForecastOverrideDto) {
    if (dto.warehouseId) assertWarehouseAccess(u, dto.warehouseId, 'this warehouse');
    else if (scopedWarehouseIds(u)) throw new ForbiddenException('All-warehouse forecasts can only be adjusted by a planner without warehouse restrictions');
    if (dto.mode === 'REPLACE' && dto.quantity < 0) throw new BadRequestException('A replacement forecast cannot be negative');
    const { config } = await this.data.loadConfig();
    const start = new Date(`${dto.periodStart.slice(0, 10)}T00:00:00.000Z`);
    if (periodStart(start, config.granularity).getTime() !== start.getTime()) {
      throw new BadRequestException(`periodStart must be the first day of a ${config.granularity.toLowerCase()} period`);
    }
    if (start.getTime() < periodStart(new Date(), config.granularity).getTime()) throw new BadRequestException('Past periods cannot be adjusted');
    // Keep the statistical value the planner adjusted, for traceability.
    const wb = await this.mrp.forecastWorkbench(u, dto.productId, dto.warehouseId ?? undefined);
    const bucket = wb.buckets.find((b, i) => (i === 0 ? periodStart(new Date(b.start), config.granularity) : new Date(b.start)).getTime() === start.getTime());
    const autoApprove = !config.overrideRequiresApproval;
    const row = await this.prisma.forecastOverride.create({
      data: {
        productId: dto.productId, warehouseId: dto.warehouseId ?? null, periodType: config.granularity, periodStart: start,
        mode: dto.mode, quantity: dto.quantity, reason: dto.reason, category: dto.category ?? null,
        statisticalQty: bucket ? bucket.statistical : null, statisticalMethod: wb.chosenMethod,
        status: autoApprove ? 'APPROVED' : 'PENDING', createdById: u.id,
        ...(autoApprove ? { decidedAt: new Date(), decisionNote: 'Approval not required by configuration' } : {}),
      },
    });
    await this.audit(u.id, 'MRP_FORECAST_OVERRIDE_CREATED', 'ForecastOverride', row.id, { productId: dto.productId, period: dto.periodStart, mode: dto.mode, quantity: dto.quantity, statisticalQty: row.statisticalQty, reason: dto.reason, status: row.status });
    return row;
  }

  async decideOverride(u: Principal, id: string, approve: boolean, note?: string) {
    const o = await this.prisma.forecastOverride.findUnique({ where: { id } });
    if (!o) throw new NotFoundException('Forecast adjustment not found');
    if (o.warehouseId) assertWarehouseAccess(u, o.warehouseId, 'this warehouse');
    assertNotSelfApproval(u.id, [o.createdById], 'a forecast adjustment');
    const claimed = await this.prisma.forecastOverride.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: u.id, decidedAt: new Date(), decisionNote: note ?? null },
    });
    if (!claimed.count) throw new ConflictException(`Forecast adjustment is already ${o.status}`);
    await this.audit(u.id, approve ? 'MRP_FORECAST_OVERRIDE_APPROVED' : 'MRP_FORECAST_OVERRIDE_REJECTED', 'ForecastOverride', id, note ?? '');
    return this.prisma.forecastOverride.findUniqueOrThrow({ where: { id } });
  }

  async cancelOverride(u: Principal, id: string) {
    const o = await this.prisma.forecastOverride.findUnique({ where: { id } });
    if (!o) throw new NotFoundException('Forecast adjustment not found');
    if (o.createdById !== u.id && !hasAccess(u, ACCESS.mrpForecastApprove)) throw new ForbiddenException('Only the author or an approver can cancel this adjustment');
    const claimed = await this.prisma.forecastOverride.updateMany({ where: { id, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'CANCELLED', decidedById: u.id, decidedAt: new Date() } });
    if (!claimed.count) throw new ConflictException(`Forecast adjustment is already ${o.status}`);
    await this.audit(u.id, 'MRP_FORECAST_OVERRIDE_CANCELLED', 'ForecastOverride', id, '');
    return this.prisma.forecastOverride.findUniqueOrThrow({ where: { id } });
  }

  // ── Cost history (needs mrp.cost) ──────────────────────────────────────
  async costHistory(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true, code: true, name: true, unitCost: true } });
    if (!product) throw new NotFoundException('Product not found');
    const [po, suppliers, params] = await Promise.all([
      this.prisma.inboundSupplyLine.findMany({ where: { productId, unitCost: { not: null } }, orderBy: { orderDate: 'asc' } }),
      this.prisma.materialSupplier.findMany({ where: { productId } }),
      this.prisma.materialPlanningParam.findMany({ where: { productId, unitCost: { not: null } }, orderBy: { effectiveFrom: 'asc' } }),
    ]);
    const byCurrency: Record<string, Array<{ date: string | null; poNumber: string; unitCost: number; status: string }>> = {};
    for (const l of po) (byCurrency[l.currency ?? 'UNSPECIFIED'] ??= []).push({ date: l.orderDate?.toISOString().slice(0, 10) ?? null, poNumber: `${l.poNumber}/${l.lineNumber}`, unitCost: l.unitCost!, status: l.status });
    return {
      product,
      productMasterCost: { unitCost: product.unitCost, currency: null, note: 'Product master cost has no recorded currency.' },
      poPriceHistory: byCurrency,
      supplierPrices: suppliers.map((s) => ({ vendorId: s.vendorId, unitPrice: s.unitPrice, currency: s.currency, priceSource: s.priceSource, validFrom: s.priceValidFrom, validTo: s.priceValidTo, isPreferred: s.isPreferred })),
      planningCosts: params.map((p) => ({ effectiveFrom: p.effectiveFrom, unitCost: p.unitCost, currency: p.currency, costBasis: p.costBasis })),
      note: 'Historical PO prices are confirmed past prices, not current quotations. Prices in different currencies are listed separately and never converted.',
    };
  }
}
