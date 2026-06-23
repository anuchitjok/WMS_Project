import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CreateStockItemDto } from './dto/create-stock-item.dto';
import { StockFilterDto } from './dto/stock-filter.dto';
import { StockStatus } from '@prisma/client';

@Injectable()
export class InventoryService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
  ) {}

  async findAll(filter: StockFilterDto, scope?: { roleKey?: string; warehouseIds?: string[] }) {
    const { search, status, warehouseId, productId, category, page = 1, limit = 20 } = filter;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;
    if (warehouseId) where.warehouseId = warehouseId;
    if (productId) where.productId = productId;

    // Warehouse scope: non-super-admins with assigned warehouses see only those
    if (scope && scope.roleKey !== 'SUPER_ADMIN' && (scope.warehouseIds?.length ?? 0) > 0) {
      where.warehouseId = warehouseId && scope.warehouseIds!.includes(warehouseId)
        ? warehouseId
        : { in: scope.warehouseIds };
    }
    if (search) {
      where.OR = [
        { serialNumber: { contains: search, mode: 'insensitive' } },
        { batchNumber: { contains: search, mode: 'insensitive' } },
        { product: { name: { contains: search, mode: 'insensitive' } } },
        { product: { code: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (category) where.product = { ...where.product, category };

    const [data, total] = await Promise.all([
      this.prisma.stockItem.findMany({
        where,
        include: {
          product: { include: { brand: true } },
          warehouse: true,
          rack: true,
          slot: true,
        },
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.stockItem.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const item = await this.prisma.stockItem.findUnique({
      where: { id },
      include: {
        product: { include: { brand: true } },
        warehouse: true,
        rack: true,
        slot: true,
        createdBy: { select: { id: true, fullName: true } },
      },
    });
    if (!item) throw new NotFoundException(`Stock item ${id} not found`);
    return item;
  }

  async findByBarcode(barcode: string) {
    const item = await this.prisma.stockItem.findFirst({
      where: {
        OR: [
          { serialNumber: barcode },
          { batchNumber: barcode },
          { product: { code: barcode } },
        ],
      },
      include: {
        product: { include: { brand: true } },
        warehouse: true,
        rack: true,
        slot: true,
      },
    });
    if (!item) throw new NotFoundException(`No stock item found for barcode: ${barcode}`);
    return item;
  }

  async create(dto: CreateStockItemDto, userId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('Product not found');

    if (product.serialControlled && !dto.serialNumber) {
      throw new BadRequestException('Serial number required for serial-controlled products');
    }

    // Enforce serial uniqueness against active stock (consistent with receiving)
    if (dto.serialNumber && dto.serialNumber !== 'N/A') {
      const existing = await this.prisma.stockItem.findFirst({
        where: {
          serialNumber: dto.serialNumber,
          status: { notIn: [StockStatus.CONSUMED, StockStatus.SHIPPED, StockStatus.CLOSED, StockStatus.CANCELLED] },
        },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(`Serial number already exists in active stock: ${dto.serialNumber}`);
      }
    }

    const item = await this.prisma.stockItem.create({
      data: {
        ...dto,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
        createdById: userId,
      },
      include: { product: true, warehouse: true },
    });

    this.realtime.emitInventoryUpdate({ action: 'created', item });
    return item;
  }

  async updateStatus(id: string, status: StockStatus, userId: string) {
    const item = await this.findOne(id);
    const updated = await this.prisma.stockItem.update({
      where: { id },
      data: { status },
      include: { product: true, warehouse: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'STOCK_STATUS_CHANGE',
        entityType: 'StockItem',
        entityId: id,
        detail: `Status changed from ${item.status} to ${status}`,
      },
    });

    this.realtime.emitInventoryUpdate({ action: 'status_changed', item: updated });
    return updated;
  }

  async updateLocation(
    id: string,
    location: { warehouseId?: string; rackId?: string; slotId?: string },
    userId: string,
  ) {
    const updated = await this.prisma.stockItem.update({
      where: { id },
      data: location,
      include: { product: true, warehouse: true, rack: true, slot: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'STOCK_RELOCATED',
        entityType: 'StockItem',
        entityId: id,
        detail: JSON.stringify(location),
      },
    });

    return updated;
  }

  async getSummary() {
    const [totalByStatus, lowStock] = await Promise.all([
      this.prisma.stockItem.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.product.findMany({
        where: { stockItems: { every: { status: { in: [StockStatus.AVAILABLE] } } } },
        include: { _count: { select: { stockItems: true } } },
        take: 10,
      }),
    ]);
    return { totalByStatus, lowStock };
  }

  // ─── Enterprise KPI ───────────────────────────────────────────────────────

  async getKpi(warehouseId?: string) {
    const AGING_90_DAYS = 90;
    const AGING_365_DAYS = 365;
    const aging90Cutoff = new Date(Date.now() - AGING_90_DAYS * 86_400_000);
    const aging365Cutoff = new Date(Date.now() - AGING_365_DAYS * 86_400_000);
    const whWhere: any = warehouseId ? { warehouseId } : {};

    const [statusGroups, aging90Group, aging365Group, lowStockProds, totalValue, totalSku] = await Promise.all([
      this.prisma.stockItem.groupBy({ by: ['status'], _count: { _all: true }, _sum: { quantity: true }, where: whWhere }),
      this.prisma.stockItem.aggregate({
        where: { ...whWhere, receivedDate: { lt: aging90Cutoff }, status: { in: ['AVAILABLE', 'RESERVED'] } },
        _count: { _all: true }, _sum: { quantity: true },
      }),
      this.prisma.stockItem.aggregate({
        where: { ...whWhere, receivedDate: { lt: aging365Cutoff }, status: { in: ['AVAILABLE', 'RESERVED'] } },
        _count: { _all: true }, _sum: { quantity: true },
      }),
      this.prisma.product.findMany({
        where: { isActive: true, minStock: { gt: 0 } },
        select: { id: true, minStock: true, unitCost: true, _count: { select: { stockItems: true } } },
      }),
      this.prisma.stockItem.findMany({
        where: { ...whWhere, status: { notIn: ['SHIPPED', 'CLOSED', 'CANCELLED'] } },
        select: { quantity: true, product: { select: { unitCost: true } } },
      }),
      this.prisma.stockItem.findMany({ where: whWhere, select: { productId: true }, distinct: ['productId'] }),
    ]);

    const byStatus = Object.fromEntries(statusGroups.map((g) => [g.status, { count: g._count._all, qty: g._sum.quantity ?? 0 }]));
    const totalItems = statusGroups.reduce((a, g) => a + g._count._all, 0);
    const totalQty = statusGroups.reduce((a, g) => a + (g._sum.quantity ?? 0), 0);
    const lowStockCount = lowStockProds.filter((p) => p._count.stockItems < p.minStock).length;
    const inventoryValue = totalValue.reduce((a, i) => a + i.quantity * (i.product?.unitCost ?? 0), 0);

    return {
      totalItems,
      available:  byStatus['AVAILABLE']?.count ?? 0,
      reserved:   byStatus['RESERVED']?.count ?? 0,
      picking:    byStatus['PICKING']?.count ?? 0,
      quarantine: byStatus['QUARANTINE']?.count ?? 0,
      rtv:        byStatus['RTV_PENDING']?.count ?? 0,
      doa:        byStatus['DOA']?.count ?? 0,
      damaged:    byStatus['DAMAGED']?.count ?? 0,
      agingCount: aging90Group._count._all,
      lowStockCount,
      inventoryValue: Math.round(inventoryValue),
      // ─── Additive fields for Inventory Dashboard Enhancement (CR-INV-001) ───
      totalSku: totalSku.length,
      totalQty,
      availableQty: byStatus['AVAILABLE']?.qty ?? 0,
      reservedQty: byStatus['RESERVED']?.qty ?? 0,
      rtvQty: byStatus['RTV_PENDING']?.qty ?? 0,
      aging90Count: aging90Group._count._all,
      aging90Qty: aging90Group._sum.quantity ?? 0,
      aging365Count: aging365Group._count._all,
      aging365Qty: aging365Group._sum.quantity ?? 0,
      bottleneck: {
        available: byStatus['AVAILABLE']?.qty ?? 0,
        reserved: byStatus['RESERVED']?.qty ?? 0,
        rtvPending: byStatus['RTV_PENDING']?.qty ?? 0,
      },
    };
  }

  // ─── Enhanced list for enterprise grid ───────────────────────────────────

  async findEnterpriseList(filter: StockFilterDto & { condition?: string; sourceType?: string; brandId?: string; itemType?: string; serialOnly?: boolean; aging?: boolean; aging365?: boolean }) {
    const { search, status, warehouseId, page = 1, limit = 50 } = filter;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;
    if (warehouseId) where.warehouseId = warehouseId;
    if (filter.serialOnly) where.serialNumber = { not: null };
    if (filter.aging365) {
      const cut365 = new Date(Date.now() - 365 * 86_400_000);
      where.receivedDate = { lt: cut365 };
    } else if (filter.aging) {
      const cut = new Date(Date.now() - 90 * 86_400_000);
      where.receivedDate = { lt: cut };
    }
    if (filter.brandId) where.product = { ...where.product, brandId: filter.brandId };
    if (filter.itemType) where.product = { ...where.product, productType: filter.itemType };
    if (search) {
      where.OR = [
        { serialNumber: { contains: search, mode: 'insensitive' } },
        { batchNumber: { contains: search, mode: 'insensitive' } },
        { product: { name: { contains: search, mode: 'insensitive' } } },
        { product: { code: { contains: search, mode: 'insensitive' } } },
        { product: { partNumber: { contains: search, mode: 'insensitive' } } },
        { product: { brand: { name: { contains: search, mode: 'insensitive' } } } },
        { goodsReceivingItems: { some: { receiving: { awbNumber: { contains: search, mode: 'insensitive' } } } } },
        { goodsReceivingItems: { some: { receiving: { invoiceNumber: { contains: search, mode: 'insensitive' } } } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.stockItem.findMany({
        where,
        include: {
          product: { include: { brand: true } },
          warehouse: { select: { code: true, name: true } },
          rack: { select: { code: true, zone: true } },
          slot: { select: { code: true } },
          createdBy: { select: { fullName: true } },
          goodsReceivingItems: {
            include: {
              receiving: { select: { refNumber: true, receivedDate: true, awbNumber: true, invoiceNumber: true, gswNumber: true, sourceType: true, receivedById: true, receivedBy: { select: { fullName: true } } } },
            },
            take: 1,
          },
          withdrawalRequestItems: {
            include: { request: { select: { rmaCaseNumber: true, refNumber: true } } },
            where: { request: { rmaCaseNumber: { not: null } } },
            take: 1,
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.stockItem.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ─── Full detail for drawer ───────────────────────────────────────────────

  async getItemDetailFull(id: string) {
    const [item, auditLogs] = await Promise.all([
      this.prisma.stockItem.findUnique({
        where: { id },
        include: {
          product: { include: { brand: true } },
          warehouse: true, rack: true, slot: true,
          createdBy: { select: { fullName: true } },
          goodsReceivingItems: {
            include: { receiving: { include: { receivedBy: { select: { fullName: true } } } } },
          },
          withdrawalRequestItems: {
            include: { request: { select: { refNumber: true, rmaCaseNumber: true, status: true, department: true, createdAt: true } } },
            take: 10,
          },
          rtvCases: {
            include: { vendor: { select: { name: true } } },
            take: 5,
          },
          scrapCases: { take: 5 },
        },
      }),
      this.prisma.auditLog.findMany({
        where: { entityType: 'StockItem', entityId: id },
        include: { user: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);
    if (!item) throw new NotFoundException(`Stock item ${id} not found`);
    return { ...item, auditLogs };
  }
}
