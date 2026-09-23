import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CreateStockItemDto } from './dto/create-stock-item.dto';
import { StockFilterDto } from './dto/stock-filter.dto';
import { FulfillmentStatus, RequestStatus, StockStatus } from '@prisma/client';
import { FINAL_STATUSES, ISSUED_STATUSES, LocationInput, MANUAL_STATUSES, resolveLocation, transitionStock } from '../common/stock-state';
import { CANCELLABLE_TASK_STATUSES } from '../fulfillment/services/task-state';
import { InventoryOrchestrationService } from './inventory-orchestration.service';

const CREATABLE_STATUSES: StockStatus[] = [...MANUAL_STATUSES, StockStatus.PENDING_INSPECTION];
const NOT_RELOCATABLE: StockStatus[] = [
  StockStatus.PICKING, StockStatus.PICKED, StockStatus.PACKED, StockStatus.READY_FOR_PICKUP,
  ...ISSUED_STATUSES, ...FINAL_STATUSES,
];
/** A request in one of these can still reach its stock through the normal flow. */
const LIVE_REQUEST_STATUSES: RequestStatus[] = [
  RequestStatus.DRAFT, RequestStatus.SUBMITTED, RequestStatus.PENDING_APPROVAL, RequestStatus.APPROVED,
];
/** A request in one of these is already closed and needs no further status write. */
const TERMINAL_REQUEST_STATUSES: RequestStatus[] = [
  RequestStatus.CANCELLED, RequestStatus.REJECTED, RequestStatus.COMPLETED,
  RequestStatus.SHIPPED, RequestStatus.ISSUED_TO_RMA,
];

@Injectable()
export class InventoryService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
    private orchestration: InventoryOrchestrationService,
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

    // Workflow statuses (reserved, picked, shipped, …) can only be reached through
    // their workflows; a directly created stock item starts on hand.
    if (dto.status && !CREATABLE_STATUSES.includes(dto.status)) {
      throw new BadRequestException(`Stock cannot be created in status ${dto.status}`);
    }
    await resolveLocation(this.prisma, { warehouseId: dto.warehouseId, rackId: dto.rackId, slotId: dto.slotId });

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
    // Manual changes are limited to on-hand holds (e.g. AVAILABLE ↔ QUARANTINE).
    // Reserved, picked, issued or consumed stock only moves through its workflow.
    if (!MANUAL_STATUSES.includes(status) || !MANUAL_STATUSES.includes(item.status)) {
      throw new BadRequestException(
        `Status cannot be changed manually from ${item.status} to ${status}; allowed: ${MANUAL_STATUSES.join(', ')}`,
      );
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await transitionStock(tx, id, [item.status], status);
      await tx.auditLog.create({
        data: {
          userId,
          action: 'STOCK_STATUS_CHANGE',
          entityType: 'StockItem',
          entityId: id,
          detail: `Status changed from ${item.status} to ${status}`,
        },
      });
      return tx.stockItem.findUniqueOrThrow({ where: { id }, include: { product: true, warehouse: true } });
    });

    this.realtime.emitInventoryUpdate({ action: 'status_changed', item: updated });
    return updated;
  }

  /**
   * Releases a reservation that nothing can consume any more: the request that
   * reserved the unit is finished (or never existed) and no goods were ever
   * issued against it. This is data repair, not a workflow step — the workflow
   * path is cancelling the request, which only works while its task is live.
   * Everything still in play is refused here and pointed back at that path.
   */
  async releaseStuckReservation(id: string, userId: string) {
    const item = await this.findOne(id);
    if (item.status !== StockStatus.RESERVED) {
      throw new BadRequestException(
        `Only RESERVED stock can be released here; stock item ${id} is ${item.status}`,
      );
    }

    const links = await this.prisma.withdrawalRequestItem.findMany({
      where: { stockItemId: id },
      include: { request: { select: { id: true, refNumber: true, status: true } } },
    });

    for (const link of links) {
      if (link.quantityIssued > 0 || link.shippedStockItemId) {
        throw new ConflictException(
          `${link.request.refNumber} already issued this unit — it is not a stuck reservation`,
        );
      }
      // FulfillmentTask.requestId has no FK, so the task is looked up by value.
      const task = await this.prisma.fulfillmentTask.findFirst({
        where: { requestId: link.requestId, status: { not: FulfillmentStatus.CANCELLED } },
        orderBy: { createdAt: 'desc' },
        include: { shipment: { select: { shippedAt: true } }, items: { where: { stockItemId: id } } },
      });
      if (task?.shipment?.shippedAt || task?.items.some((i) => i.qtyPicked > 0)) {
        throw new ConflictException(
          `Goods left the warehouse on ${task!.refNumber} — this reservation is not stuck`,
        );
      }
      if (task && CANCELLABLE_TASK_STATUSES.includes(task.status)) {
        throw new ConflictException(
          `${task.refNumber} is still ${task.status} — cancel the request instead of releasing the unit`,
        );
      }
      if (!task && LIVE_REQUEST_STATUSES.includes(link.request.status)) {
        throw new ConflictException(
          `${link.request.refNumber} is ${link.request.status} and still holds this unit — cancel the request instead`,
        );
      }
    }

    const refs = links.map((l) => l.request.refNumber).join(', ') || 'no request';
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.orchestration.releaseReservation(tx, [{ stockItemId: id }], `stuck reservation on ${refs}`, userId);
      if (links.length > 0) {
        await tx.withdrawalRequestItem.updateMany({
          where: { id: { in: links.map((l) => l.id) } },
          data: { stockItemId: null },
        });
      }
      for (const link of links) {
        if (TERMINAL_REQUEST_STATUSES.includes(link.request.status)) continue;
        // A request left mid-flight can never finish now. Close it only once its
        // last held unit is gone, so releasing one of several does not strand the rest.
        const stillHeld = await tx.withdrawalRequestItem.count({
          where: { requestId: link.requestId, stockItemId: { not: null } },
        });
        if (stillHeld > 0) continue;
        await tx.withdrawalRequest.update({
          where: { id: link.requestId },
          data: {
            status: RequestStatus.CANCELLED,
            rejectReason: `Cancelled on stuck reservation release (${item.id})`,
            version: { increment: 1 },
          },
        });
        await tx.auditLog.create({
          data: {
            userId,
            action: 'REQUEST_CANCELLED',
            entityType: 'WithdrawalRequest',
            entityId: link.requestId,
            detail: `Closed with the release of stuck reservation ${item.id}`,
          },
        });
      }
      return tx.stockItem.findUniqueOrThrow({ where: { id }, include: { product: true, warehouse: true } });
    });

    this.realtime.emitInventoryUpdate({ action: 'reservation_released', item: updated });
    for (const link of links) this.realtime.emitRequestUpdate({ action: 'reservation_released', requestId: link.requestId });
    return updated;
  }

  async updateLocation(
    id: string,
    location: LocationInput,
    userId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const loc = await resolveLocation(tx, location);
      // Picked or issued stock is no longer on its shelf — it cannot be relocated.
      const moved = await tx.stockItem.updateMany({
        where: { id, status: { notIn: NOT_RELOCATABLE } },
        data: loc,
      });
      if (moved.count === 0) {
        const stock = await tx.stockItem.findUnique({ where: { id }, select: { status: true } });
        if (!stock) throw new NotFoundException(`Stock item ${id} not found`);
        throw new ConflictException(`Stock item cannot be relocated (status ${stock.status})`);
      }
      await tx.auditLog.create({
        data: {
          userId,
          action: 'STOCK_RELOCATED',
          entityType: 'StockItem',
          entityId: id,
          detail: JSON.stringify(loc),
        },
      });
      return tx.stockItem.findUniqueOrThrow({
        where: { id },
        include: { product: true, warehouse: true, rack: true, slot: true },
      });
    });
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
