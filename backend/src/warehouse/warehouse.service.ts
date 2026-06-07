import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RackType, SlotStatus, SlotType } from '@prisma/client';

@Injectable()
export class WarehouseService {
  constructor(private prisma: PrismaService) {}

  // ─── Warehouse ────────────────────────────────────────────────────────────

  private slotInclude = {
    where: { isActive: true },
    include: { _count: { select: { stockItems: true } } },
    orderBy: [{ level: 'asc' as const }, { column: 'asc' as const }],
  };

  findAll() {
    return this.prisma.warehouse.findMany({
      where: { isActive: true },
      include: {
        racks: {
          where: { isActive: true },
          include: {
            slots: this.slotInclude,
            _count: { select: { slots: true, stockItems: true } },
          },
          orderBy: { code: 'asc' },
        },
        _count: { select: { racks: true, stockItems: true } },
      },
      orderBy: { code: 'asc' },
    });
  }

  async findOne(id: string) {
    const wh = await this.prisma.warehouse.findUnique({
      where: { id },
      include: {
        racks: {
          where: { isActive: true },
          include: {
            slots: this.slotInclude,
            _count: { select: { slots: true, stockItems: true } },
          },
          orderBy: { code: 'asc' },
        },
      },
    });
    if (!wh) throw new NotFoundException('Warehouse not found');
    return wh;
  }

  async getSlotDetail(id: string) {
    const slot = await this.prisma.slot.findUnique({
      where: { id },
      include: {
        rack: {
          include: { warehouse: { select: { code: true, name: true } } },
        },
        stockItems: {
          where: { status: { notIn: ['SHIPPED', 'CLOSED', 'CANCELLED'] } },
          include: { product: { select: { code: true, name: true, unit: true } } },
          orderBy: { updatedAt: 'desc' },
          take: 10,
        },
        _count: { select: { stockItems: true } },
      },
    });
    if (!slot) throw new NotFoundException('Slot not found');
    return slot;
  }

  async getStats(warehouseId?: string) {
    const where = warehouseId
      ? { rack: { warehouseId } }
      : {};

    const [totalRacks, totalSlots, slotsByStatus] = await Promise.all([
      this.prisma.rack.count({ where: warehouseId ? { warehouseId, isActive: true } : { isActive: true } }),
      this.prisma.slot.count({ where: { isActive: true, ...where } }),
      this.prisma.slot.groupBy({
        by: ['status'],
        where: { isActive: true, ...where },
        _count: true,
      }),
    ]);

    const statusMap = Object.fromEntries(slotsByStatus.map((s) => [s.status, s._count]));
    const occupied = statusMap['OCCUPIED'] ?? 0;

    return {
      totalRacks,
      totalSlots,
      empty: statusMap['EMPTY'] ?? 0,
      occupied,
      reserved: statusMap['RESERVED'] ?? 0,
      quarantine: statusMap['QUARANTINE'] ?? 0,
      rtv: statusMap['RTV'] ?? 0,
      blocked: statusMap['BLOCKED'] ?? 0,
      utilizationPct: totalSlots > 0 ? Math.round((occupied / totalSlots) * 100) : 0,
    };
  }

  // ─── Rack CRUD ────────────────────────────────────────────────────────────

  async createRack(dto: {
    warehouseId: string;
    code: string;
    name?: string;
    zone?: string;
    rackType?: RackType;
    capacity?: number;
    levels?: number;
    columns?: number;
    description?: string;
  }) {
    const exists = await this.prisma.rack.findUnique({
      where: { warehouseId_code: { warehouseId: dto.warehouseId, code: dto.code } },
    });
    if (exists) throw new ConflictException(`Rack code "${dto.code}" already exists in this warehouse`);
    return this.prisma.rack.create({ data: { ...dto } });
  }

  async updateRack(id: string, dto: Partial<{ name: string; zone: string; rackType: RackType; capacity: number; levels: number; columns: number; description: string; isActive: boolean }>) {
    const rack = await this.prisma.rack.findUnique({ where: { id } });
    if (!rack) throw new NotFoundException('Rack not found');
    return this.prisma.rack.update({ where: { id }, data: dto });
  }

  async deleteRack(id: string) {
    const rack = await this.prisma.rack.findUnique({ where: { id }, include: { _count: { select: { stockItems: true } } } });
    if (!rack) throw new NotFoundException('Rack not found');
    if (rack._count.stockItems > 0) throw new ConflictException('Cannot delete rack with stock items');
    return this.prisma.rack.update({ where: { id }, data: { isActive: false } });
  }

  // ─── Slot CRUD ────────────────────────────────────────────────────────────

  async createSlot(rackId: string, dto: {
    code: string;
    name?: string;
    level?: number;
    column?: number;
    slotType?: SlotType;
    capacity?: number;
    maxWeight?: number;
  }) {
    const exists = await this.prisma.slot.findUnique({
      where: { rackId_code: { rackId, code: dto.code } },
    });
    if (exists) throw new ConflictException(`Slot code "${dto.code}" already exists in this rack`);
    return this.prisma.slot.create({ data: { rackId, ...dto } });
  }

  async bulkGenerateSlots(rackId: string, dto: {
    levels: number;
    columns: number;
    slotType?: SlotType;
    capacity?: number;
    maxWeight?: number;
    prefix?: string;
  }) {
    const rack = await this.prisma.rack.findUnique({ where: { id: rackId } });
    if (!rack) throw new NotFoundException('Rack not found');

    const prefix = dto.prefix ?? rack.code;
    const slots: any[] = [];

    for (let l = 1; l <= dto.levels; l++) {
      for (let c = 1; c <= dto.columns; c++) {
        const lvlCode = String.fromCharCode(64 + l); // A, B, C...
        const colCode = String(c).padStart(2, '0');
        const code = `${prefix}-${lvlCode}${colCode}`;
        slots.push({
          rackId,
          code,
          name: `Level ${lvlCode} Col ${colCode}`,
          level: l,
          column: c,
          slotType: dto.slotType ?? 'STANDARD',
          capacity: dto.capacity ?? 1,
          maxWeight: dto.maxWeight ?? null,
          status: 'EMPTY' as SlotStatus,
        });
      }
    }

    // skip existing codes
    const existing = await this.prisma.slot.findMany({
      where: { rackId, code: { in: slots.map((s) => s.code) } },
      select: { code: true },
    });
    const existingCodes = new Set(existing.map((s) => s.code));
    const newSlots = slots.filter((s) => !existingCodes.has(s.code));

    if (newSlots.length === 0) return { created: 0, skipped: slots.length };

    await this.prisma.slot.createMany({ data: newSlots });
    return { created: newSlots.length, skipped: existingCodes.size };
  }

  async updateSlot(id: string, dto: Partial<{ name: string; slotType: SlotType; status: SlotStatus; capacity: number; maxWeight: number; isActive: boolean }>) {
    const slot = await this.prisma.slot.findUnique({ where: { id } });
    if (!slot) throw new NotFoundException('Slot not found');
    return this.prisma.slot.update({ where: { id }, data: dto });
  }

  async deleteSlot(id: string) {
    const slot = await this.prisma.slot.findUnique({ where: { id }, include: { _count: { select: { stockItems: true } } } });
    if (!slot) throw new NotFoundException('Slot not found');
    if (slot._count.stockItems > 0) throw new ConflictException('Cannot delete slot with stock items');
    return this.prisma.slot.update({ where: { id }, data: { isActive: false } });
  }

  // ─── Legacy ───────────────────────────────────────────────────────────────

  findProducts() {
    return this.prisma.product.findMany({
      where: { isActive: true },
      include: { brand: true },
      orderBy: { name: 'asc' },
    });
  }

  findBrands() {
    return this.prisma.brand.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }

  findVendors() {
    return this.prisma.vendor.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }
}
