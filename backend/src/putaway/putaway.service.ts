import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StockStatus } from '@prisma/client';
import { boxFitsSlot } from './putaway-fit.util';
import { suggestSlots, type SlotCandidate } from './putaway-suggest';
import { LocationInput, resolveLocation, transitionStock } from '../common/stock-state';
import { NOT_IN_LOCATION } from '../common/stock-presence';
import { ScopePrincipal, assertWarehouseAccess, scopedWarehouseIds } from '../common/warehouse-scope';

@Injectable()
export class PutawayService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
  ) {}

  // Box-vs-slot fit check — read-only, no side effects. Called by the frontend
  // before confirm() so staff see a fits/doesn't-fit verdict without committing.
  async checkFit(slotId: string, box: { length: number; width: number; height: number }) {
    const slot = await this.prisma.slot.findUnique({
      where: { id: slotId },
      include: { _count: { select: { stockItems: true } } },
    });
    if (!slot) throw new NotFoundException('Slot not found');

    const hasSlotDimensions = slot.lengthCm != null && slot.widthCm != null && slot.heightCm != null;
    const fits = hasSlotDimensions
      ? boxFitsSlot(
          [box.length, box.width, box.height],
          [slot.lengthCm as number, slot.widthCm as number, slot.heightCm as number],
        )
      : null; // null = no verdict possible, not "doesn't fit"

    return {
      hasSlotDimensions,
      fits,
      box,
      slot: { id: slot.id, code: slot.code, lengthCm: slot.lengthCm, widthCm: slot.widthCm, heightCm: slot.heightCm },
      occupied: slot._count.stockItems,
      capacity: slot.capacity,
    };
  }

  /**
   * RQ15 — what this quantity needs, and where it could go.
   *
   * Read-only. It ranks slots the person may use and says plainly when a size
   * is missing instead of guessing one: a product with no dimensions still gets
   * suggestions, ordered by free space alone, with `hasProductSize: false`.
   *
   * Scope: only warehouses the caller may use. By default the search stays in
   * the item's own warehouse (or the one passed in) — a putaway is a walk
   * across one building, not a transfer.
   */
  async suggestions(stockItemId: string, opts: { warehouseId?: string; limit?: number } = {}, scope?: ScopePrincipal) {
    const item = await this.prisma.stockItem.findFirst({
      where: { id: stockItemId },
      include: { product: { select: { id: true, code: true, name: true, lengthCm: true, widthCm: true, heightCm: true } } },
    });
    if (!item) throw new NotFoundException('Stock item not found');

    const warehouseId = opts.warehouseId || item.warehouseId || undefined;
    if (warehouseId) assertWarehouseAccess(scope, warehouseId, 'warehouse');
    const allowed = scopedWarehouseIds(scope);

    const slots = await this.prisma.slot.findMany({
      where: {
        isDeleted: false,
        isActive: true,
        rack: {
          isDeleted: false,
          isActive: true,
          ...(warehouseId ? { warehouseId } : allowed ? { warehouseId: { in: allowed } } : {}),
          warehouse: { isDeleted: false, isActive: true },
        },
      },
      select: {
        id: true, code: true, status: true, capacity: true,
        lengthCm: true, widthCm: true, heightCm: true,
        rack: { select: { id: true, code: true, zone: true, warehouseId: true, warehouse: { select: { code: true } } } },
        stockItems: { where: { status: { notIn: NOT_IN_LOCATION } }, select: { productId: true } },
      },
      take: 500, // a putaway screen never needs more; the ranking keeps the best
    });

    const candidates: SlotCandidate[] = slots.map((s) => ({
      slotId: s.id,
      slotCode: s.code,
      rackId: s.rack.id,
      rackCode: s.rack.code,
      zone: s.rack.zone,
      warehouseId: s.rack.warehouseId,
      warehouseCode: s.rack.warehouse.code,
      status: s.status,
      capacity: s.capacity,
      used: s.stockItems.length,
      lengthCm: s.lengthCm,
      widthCm: s.widthCm,
      heightCm: s.heightCm,
      holdsSameProduct: s.stockItems.some((x) => x.productId === item.productId),
    }));

    const result = suggestSlots(
      item.quantity,
      { lengthCm: item.product?.lengthCm ?? null, widthCm: item.product?.widthCm ?? null, heightCm: item.product?.heightCm ?? null },
      candidates,
      opts.limit ?? 8,
    );

    return {
      item: {
        id: item.id,
        quantity: item.quantity,
        productCode: item.product?.code ?? null,
        productName: item.product?.name ?? null,
        box: { lengthCm: item.product?.lengthCm ?? null, widthCm: item.product?.widthCm ?? null, heightCm: item.product?.heightCm ?? null },
      },
      warehouseId: warehouseId ?? null,
      slotsConsidered: candidates.length,
      ...result,
    };
  }

  // Items awaiting putaway = PENDING_INSPECTION
  // Scoped users see items already assigned to their warehouses plus unassigned
  // ones (still at the dock), which they may put away into their own warehouses.
  pending(scope?: ScopePrincipal) {
    const ids = scopedWarehouseIds(scope);
    return this.prisma.stockItem.findMany({
      where: { status: StockStatus.PENDING_INSPECTION, ...(ids ? { OR: [{ warehouseId: { in: ids } }, { warehouseId: null }] } : {}) },
      include: { product: { include: { brand: true } }, warehouse: true, rack: true, slot: true },
      orderBy: { receivedDate: 'asc' },
    });
  }

  // Confirm putaway: assign location and set AVAILABLE.
  // Only stock waiting in the putaway queue (PENDING_INSPECTION) can be put away,
  // and only into an active slot of the Warehouse → Rack → Slot hierarchy: stock
  // never becomes AVAILABLE without a bin.
  async confirm(stockItemId: string, location: LocationInput, userId: string, scope?: ScopePrincipal) {
    if (!location?.slotId) {
      throw new BadRequestException('Choose a destination slot (Warehouse → Rack → Slot) before confirming putaway');
    }
    // Stock already assigned to a warehouse must be in scope; unassigned (dock) stock may be put away by anyone in scope.
    const current = await this.prisma.stockItem.findUnique({ where: { id: stockItemId }, select: { warehouseId: true } });
    if (current?.warehouseId) assertWarehouseAccess(scope, current.warehouseId, 'this stock item');
    const updated = await this.prisma.$transaction(async (tx) => {
      const loc = await resolveLocation(tx, location);
      if (scopedWarehouseIds(scope)) assertWarehouseAccess(scope, loc.warehouseId, 'the destination warehouse');
      await transitionStock(tx, stockItemId, [StockStatus.PENDING_INSPECTION], StockStatus.AVAILABLE, loc);
      await tx.auditLog.create({
        data: {
          userId,
          action: 'PUTAWAY_CONFIRMED',
          entityType: 'StockItem',
          entityId: stockItemId,
          detail: `Stored & made available`,
        },
      });
      return tx.stockItem.findUniqueOrThrow({
        where: { id: stockItemId },
        include: { product: true, warehouse: true, rack: true, slot: true },
      });
    });
    this.realtime.emitInventoryUpdate({ action: 'putaway', item: updated });
    return updated;
  }
}
