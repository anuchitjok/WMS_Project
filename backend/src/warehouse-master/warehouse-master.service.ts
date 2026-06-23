import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RackType, SlotType } from '@prisma/client';

// Stock statuses that count as "active inventory" occupying a location.
const ACTIVE_STOCK = ['AVAILABLE', 'RESERVED', 'PICKED', 'QUARANTINE', 'PENDING_INSPECTION', 'RTV_PENDING'] as const;

@Injectable()
export class WarehouseMasterService {
  constructor(private prisma: PrismaService) {}

  // ── Audit helper (reuses existing AuditLog framework; detail carries before/after) ──
  private audit(userId: string, action: string, entityType: string, entityId: string, before: any, after: any) {
    return this.prisma.auditLog.create({
      data: { userId, action, entityType, entityId, detail: JSON.stringify({ before, after }) },
    });
  }

  // ── Reads ───────────────────────────────────────────────────────────────────
  // Full master tree — includes INACTIVE warehouses (so they can be re-activated)
  // but excludes soft-deleted records.
  getTree() {
    return this.prisma.warehouse.findMany({
      where: { isDeleted: false },
      include: {
        racks: {
          where: { isDeleted: false },
          include: {
            slots: { where: { isDeleted: false }, include: { _count: { select: { stockItems: true } } }, orderBy: [{ level: 'asc' }, { column: 'asc' }] },
            _count: { select: { slots: true, stockItems: true } },
          },
          orderBy: { code: 'asc' },
        },
        _count: { select: { racks: true, stockItems: true } },
      },
      orderBy: { code: 'asc' },
    });
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
    const stock = await this.prisma.stockItem.count({ where: { slotId: id } });
    return { entity, id, stock, canDelete: stock === 0 };
  }

  // ── Warehouse ─────────────────────────────────────────────────────────────────
  async createWarehouse(dto: { code: string; name: string; location?: string }, userId: string) {
    if (!dto.code?.trim()) throw new ConflictException('Warehouse code is required');
    if (!dto.name?.trim()) throw new ConflictException('Warehouse name is required');
    const exists = await this.prisma.warehouse.findUnique({ where: { code: dto.code } });
    if (exists) throw new ConflictException(`Warehouse code "${dto.code}" already exists`);
    const wh = await this.prisma.warehouse.create({ data: { code: dto.code.trim(), name: dto.name.trim(), location: dto.location?.trim() || null } });
    await this.audit(userId, 'WAREHOUSE_CREATED', 'Warehouse', wh.id, null, wh);
    return wh;
  }

  async updateWarehouse(id: string, dto: { name?: string; location?: string }, userId: string) {
    const before = await this.prisma.warehouse.findFirst({ where: { id, isDeleted: false } });
    if (!before) throw new NotFoundException('Warehouse not found');
    const data: any = {};
    if (dto.name !== undefined) { if (!dto.name.trim()) throw new ConflictException('Warehouse name cannot be empty'); data.name = dto.name.trim(); }
    if (dto.location !== undefined) data.location = dto.location?.trim() || null;
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

  // ── Rack ────────────────────────────────────────────────────────────────────
  async createRack(dto: { warehouseId: string; code: string; name?: string; zone?: string; rackType?: RackType; capacity?: number; levels?: number; columns?: number; description?: string }, userId: string) {
    if (!dto.code?.trim()) throw new ConflictException('Rack code is required');
    const wh = await this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, isDeleted: false } });
    if (!wh) throw new NotFoundException('Warehouse not found');
    const exists = await this.prisma.rack.findUnique({ where: { warehouseId_code: { warehouseId: dto.warehouseId, code: dto.code } } });
    if (exists) throw new ConflictException(`Rack code "${dto.code}" already exists in this warehouse`);
    const rack = await this.prisma.rack.create({ data: { ...dto, code: dto.code.trim() } });
    await this.audit(userId, 'RACK_CREATED', 'Rack', rack.id, null, rack);
    return rack;
  }

  async updateRack(id: string, dto: Partial<{ name: string; zone: string; rackType: RackType; capacity: number; levels: number; columns: number; description: string }>, userId: string) {
    const before = await this.prisma.rack.findFirst({ where: { id, isDeleted: false } });
    if (!before) throw new NotFoundException('Rack not found');
    const after = await this.prisma.rack.update({ where: { id }, data: dto });
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

  // ── Slot ────────────────────────────────────────────────────────────────────
  async createSlot(dto: { rackId: string; code: string; name?: string; level?: number; column?: number; slotType?: SlotType; capacity?: number; maxWeight?: number }, userId: string) {
    if (!dto.code?.trim()) throw new ConflictException('Slot code is required');
    const rack = await this.prisma.rack.findFirst({ where: { id: dto.rackId, isDeleted: false } });
    if (!rack) throw new NotFoundException('Rack not found');
    const exists = await this.prisma.slot.findUnique({ where: { rackId_code: { rackId: dto.rackId, code: dto.code } } });
    if (exists) throw new ConflictException(`Slot code "${dto.code}" already exists in this rack`);
    const slot = await this.prisma.slot.create({ data: { ...dto, code: dto.code.trim() } });
    await this.audit(userId, 'SLOT_CREATED', 'Slot', slot.id, null, slot);
    return slot;
  }

  async updateSlot(id: string, dto: Partial<{ name: string; slotType: SlotType; capacity: number; maxWeight: number }>, userId: string) {
    const before = await this.prisma.slot.findFirst({ where: { id, isDeleted: false } });
    if (!before) throw new NotFoundException('Slot not found');
    const after = await this.prisma.slot.update({ where: { id }, data: dto });
    await this.audit(userId, 'SLOT_UPDATED', 'Slot', id, before, after);
    return after;
  }

  async deleteSlot(id: string, userId: string) {
    const before = await this.prisma.slot.findFirst({ where: { id, isDeleted: false } });
    if (!before) throw new NotFoundException('Slot not found');
    const stock = await this.prisma.stockItem.count({ where: { slotId: id } });
    if (stock > 0) throw new ConflictException(`Cannot delete: ${stock} stock item(s) occupy this slot`);
    const after = await this.prisma.slot.update({ where: { id }, data: { isActive: false, isDeleted: true, deletedAt: new Date(), deletedBy: userId } });
    await this.audit(userId, 'SLOT_DELETED', 'Slot', id, before, after);
    return { success: true, id };
  }
}
