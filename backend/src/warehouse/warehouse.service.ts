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
      where: { productStatus: 'ACTIVE' },
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

  // ─── Brand Master (CR-MASTER: Business Partners) ────────────────────────────

  // Includes product counts so the UI can show usage and warn before deactivation.
  listBrandsManaged() {
    return this.prisma.brand.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
  }

  // Auto-generates the next BR-#### code when no code is supplied.
  private async nextBrandCode(): Promise<string> {
    const existing = await this.prisma.brand.findMany({
      where: { code: { startsWith: 'BR-' } },
      select: { code: true },
    });
    const maxNum = existing.reduce((max, b) => {
      const n = parseInt(b.code.slice(3), 10);
      return Number.isNaN(n) ? max : Math.max(max, n);
    }, 0);
    return `BR-${String(maxNum + 1).padStart(4, '0')}`;
  }

  async createBrand(dto: { code?: string; name: string; contact?: string }) {
    const name = dto.name?.trim();
    if (!name) throw new ConflictException('Brand name is required');

    let code = dto.code?.trim();
    if (!code) {
      // Retry a few times in case of a concurrent insert grabbing the same number.
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = await this.nextBrandCode();
        const clash = await this.prisma.brand.findUnique({ where: { code: candidate } });
        if (!clash) { code = candidate; break; }
      }
      if (!code) throw new ConflictException('Could not generate a unique brand code, please retry');
    } else {
      const existing = await this.prisma.brand.findUnique({ where: { code } });
      if (existing) throw new ConflictException(`Brand code already exists: ${code}`);
    }

    return this.prisma.brand.create({ data: { code, name, contact: dto.contact?.trim() || null } });
  }

  async updateBrand(id: string, dto: { name?: string; contact?: string; isActive?: boolean }) {
    const brand = await this.prisma.brand.findUnique({ where: { id } });
    if (!brand) throw new NotFoundException('Brand not found');
    return this.prisma.brand.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.contact !== undefined ? { contact: dto.contact.trim() || null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  // Soft delete: deactivate. Block if active products still reference this brand.
  async deleteBrand(id: string) {
    const brand = await this.prisma.brand.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!brand) throw new NotFoundException('Brand not found');
    if (brand._count.products > 0) {
      throw new ConflictException(`Cannot deactivate brand — ${brand._count.products} product(s) still reference it`);
    }
    return this.prisma.brand.update({ where: { id }, data: { isActive: false } });
  }

  // ─── Vendor Master (CR-MASTER: Business Partners) ───────────────────────────

  listVendorsManaged() {
    return this.prisma.vendor.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { rtvCases: true } } },
    });
  }

  async createVendor(dto: { code: string; name: string; contact?: string; email?: string }) {
    const code = dto.code?.trim();
    const name = dto.name?.trim();
    if (!code || !name) throw new ConflictException('Vendor code and name are required');
    const existing = await this.prisma.vendor.findUnique({ where: { code } });
    if (existing) throw new ConflictException(`Vendor code already exists: ${code}`);
    return this.prisma.vendor.create({
      data: { code, name, contact: dto.contact?.trim() || null, email: dto.email?.trim() || null },
    });
  }

  async updateVendor(id: string, dto: { name?: string; contact?: string; email?: string; isActive?: boolean }) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return this.prisma.vendor.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.contact !== undefined ? { contact: dto.contact.trim() || null } : {}),
        ...(dto.email !== undefined ? { email: dto.email.trim() || null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  // Soft delete: deactivate. Block if RTV cases still reference this vendor.
  async deleteVendor(id: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id },
      include: { _count: { select: { rtvCases: true } } },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
    if (vendor._count.rtvCases > 0) {
      throw new ConflictException(`Cannot deactivate vendor — ${vendor._count.rtvCases} RTV case(s) still reference it`);
    }
    return this.prisma.vendor.update({ where: { id }, data: { isActive: false } });
  }

  // ─── Phase 2: Per-brand inventory rollup ────────────────────────────────────
  // Derives ownership from the existing StockItem → Product → Brand relation.
  // No schema change: every stock item already resolves to a brand via its product.

  async inventoryByBrand() {
    const ACTIVE = ['SHIPPED', 'CLOSED', 'CANCELLED', 'CONSUMED'];
    const [brands, stock] = await Promise.all([
      this.prisma.brand.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.stockItem.findMany({
        where: { status: { notIn: ACTIVE as any } },
        select: {
          quantity: true, status: true, productId: true,
          product: { select: { brandId: true, unitCost: true } },
        },
      }),
    ]);

    const byBrand = new Map<string, { skus: Set<string>; totalQty: number; available: number; reserved: number; rtvPending: number; value: number }>();
    const ensure = (key: string) => {
      if (!byBrand.has(key)) byBrand.set(key, { skus: new Set(), totalQty: 0, available: 0, reserved: 0, rtvPending: 0, value: 0 });
      return byBrand.get(key)!;
    };

    for (const s of stock) {
      const key = s.product?.brandId ?? '__none__';
      const acc = ensure(key);
      acc.skus.add(s.productId);
      acc.totalQty += s.quantity;
      acc.value += s.quantity * (s.product?.unitCost ?? 0);
      if (s.status === 'AVAILABLE') acc.available += s.quantity;
      else if (s.status === 'RESERVED') acc.reserved += s.quantity;
      else if (s.status === 'RTV_PENDING') acc.rtvPending += s.quantity;
    }

    const rows = brands.map((b) => {
      const acc = byBrand.get(b.id);
      return {
        brandId: b.id, code: b.code, name: b.name, isActive: b.isActive,
        skuCount: acc?.skus.size ?? 0,
        totalQty: acc?.totalQty ?? 0,
        available: acc?.available ?? 0,
        reserved: acc?.reserved ?? 0,
        rtvPending: acc?.rtvPending ?? 0,
        inventoryValue: Math.round(acc?.value ?? 0),
      };
    });

    const unbranded = byBrand.get('__none__');
    if (unbranded) {
      rows.push({
        brandId: '', code: '—', name: 'Unbranded', isActive: true,
        skuCount: unbranded.skus.size, totalQty: unbranded.totalQty,
        available: unbranded.available, reserved: unbranded.reserved,
        rtvPending: unbranded.rtvPending, inventoryValue: Math.round(unbranded.value),
      });
    }
    return rows;
  }
}
