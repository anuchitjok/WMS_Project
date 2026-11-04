import { assertSerialsFree } from '../common/serial-guard';
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ScopePrincipal, assertWarehouseAccess, scopedWarehouseIds } from '../common/warehouse-scope';
import { Prisma, StockStatus, OwnershipType, ReceivingStatus } from '@prisma/client';
import { nanoid } from 'nanoid';
import { InspectReceivingDto } from './dto/inspect-receiving.dto';
import { transitionStock } from '../common/stock-state';
import { assertNotSelfApproval } from '../common/separation-of-duties';

/** Units of a receipt that have not moved on yet (still at the dock / in QC). */
const REVERSIBLE: StockStatus[] = [StockStatus.PENDING_RECEIVING, StockStatus.PENDING_INSPECTION, StockStatus.QUARANTINE, StockStatus.RTV_PENDING];

interface CreateReceivingDto {
  sourceType: string;
  sourceRef?: string;
  awbNumber?: string;
  invoiceNumber?: string;
  poNumber?: string;
  supplierId?: string;
  expectedDate?: string;
  notes?: string;
  items: {
    productId: string;
    serialNumber?: string;
    batchNumber?: string;
    expiryDate?: string;
    manufactureDate?: string;
    quantity: number;
    condition?: string;
    ownershipType?: OwnershipType;
    warehouseId?: string;
    rackId?: string;
    slotId?: string;
  }[];
}

function parseDate(d?: string): Date | undefined {
  if (!d) return undefined;
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? undefined : dt;
}

const DISCREPANCY_OUTCOMES = new Set(['short_qty', 'wrong_item', 'missing_accessories']);

@Injectable()
export class ReceivingService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
  ) {}

  private ref() {
    return `GR-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;
  }

  // A receipt is in a scoped user's view unless one of its lines sits in a warehouse
  // outside their scope (lines not yet located do not restrict it).
  private scopeWhere(scope?: ScopePrincipal) {
    const ids = scopedWarehouseIds(scope);
    return ids ? { items: { none: { stockItem: { warehouseId: { notIn: ids } } } } } : {};
  }

  findAll(status?: string, scope?: ScopePrincipal) {
    return this.prisma.goodsReceiving.findMany({
      where: { ...(status ? { status } : {}), ...this.scopeWhere(scope) },
      include: {
        receivedBy: { select: { fullName: true } },
        items: { include: { product: true, stockItem: true } },
        discrepancies: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Phase 6 — controlled correction of a mistaken receipt. Allowed only while
   * every unit is still at the dock (not put away, reserved, issued or in an
   * RTV / scrap case). The receipt and its lines are kept unchanged and marked
   * CANCELLED; its units become CANCELLED (their serials are free again for a
   * corrected receipt). Needs a reason and a second person (maker ≠ checker).
   */
  async reverse(id: string, reason: string, actorId: string, scope?: ScopePrincipal) {
    const why = reason?.trim() ?? '';
    if (why.length < 5) throw new BadRequestException('A reason (at least 5 characters) is required to reverse a receipt');
    const gr = await this.prisma.goodsReceiving.findUnique({ where: { id }, include: { items: { include: { stockItem: true } } } });
    if (!gr) throw new NotFoundException('Receiving record not found');
    for (const item of gr.items) {
      if (item.stockItem?.warehouseId) assertWarehouseAccess(scope, item.stockItem.warehouseId, 'this receiving record');
    }
    if (gr.statusEnum === ReceivingStatus.CANCELLED) throw new ConflictException(`${gr.refNumber} is already reversed`);
    assertNotSelfApproval(actorId, [gr.receivedById], 'the reversal of a receipt');
    const unitIds = gr.items.map((i) => i.stockItemId).filter((x): x is string => !!x);

    const result = await this.prisma.$transaction(async (tx) => {
      if (unitIds.length) await tx.$queryRaw`SELECT "id" FROM "StockItem" WHERE "id" = ANY(${unitIds}::text[]) ORDER BY "id" FOR UPDATE`;
      const units = await tx.stockItem.findMany({ where: { id: { in: unitIds } }, select: { id: true, serialNumber: true, status: true } });
      const [rtvOpen, scrapOpen] = await Promise.all([
        tx.rTVCase.findMany({ where: { stockItemId: { in: unitIds }, status: { notIn: ['COMPLETED', 'CANCELLED', 'REJECTED_BY_VENDOR'] } }, select: { stockItemId: true, refNumber: true } }),
        tx.scrapCase.findMany({ where: { stockItemId: { in: unitIds }, status: { in: ['PENDING_REVIEW', 'APPROVED'] } }, select: { stockItemId: true, refNumber: true } }),
      ]);
      const blocked = units.filter((u) => !REVERSIBLE.includes(u.status) || rtvOpen.some((r) => r.stockItemId === u.id) || scrapOpen.some((s) => s.stockItemId === u.id));
      if (blocked.length) {
        const list = blocked.map((u) => `${u.serialNumber ?? u.id} (${[u.status, ...rtvOpen.filter((r) => r.stockItemId === u.id).map((r) => r.refNumber), ...scrapOpen.filter((s) => s.stockItemId === u.id).map((s) => s.refNumber)].join(', ')})`).join('; ');
        throw new ConflictException(`${gr.refNumber} cannot be reversed — these units have already moved on: ${list}. Correct them through the document that moved them.`);
      }

      // Claim the receipt: a second reversal (or a concurrent one) matches nothing.
      const claimed = await tx.goodsReceiving.updateMany({
        where: { id, statusEnum: gr.statusEnum },
        data: { statusEnum: ReceivingStatus.CANCELLED, status: 'cancelled' },
      });
      if (claimed.count === 0) throw new ConflictException(`${gr.refNumber} was changed by someone else — reload and retry`);

      for (const u of units) {
        await transitionStock(tx, u.id, REVERSIBLE, StockStatus.CANCELLED, { notes: `Receipt ${gr.refNumber} reversed: ${why}` });
        await tx.auditLog.create({
          data: { userId: actorId, action: 'STOCK_RECEIPT_REVERSED', entityType: 'StockItem', entityId: u.id, detail: `${gr.refNumber}: ${why}`, changes: { status: { from: u.status, to: StockStatus.CANCELLED } } },
        });
      }

      // A reversed RTV replacement: the case waits for its replacement again.
      const replacedCases = await tx.rTVCase.findMany({ where: { replacementStockId: { in: unitIds } }, select: { id: true, refNumber: true, status: true } });
      for (const rc of replacedCases) {
        await tx.rTVCase.update({ where: { id: rc.id }, data: { replacementStockId: null, status: 'REPLACEMENT_PENDING', resolution: null, closedAt: null } });
        await tx.auditLog.create({
          data: { userId: actorId, action: 'RTV_REPLACEMENT_REVERSED', entityType: 'RTVCase', entityId: rc.id, detail: `${rc.refNumber}: replacement receipt ${gr.refNumber} reversed — ${why}`, changes: { status: { from: rc.status, to: 'REPLACEMENT_PENDING' } } },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: actorId, action: 'RECEIVING_REVERSED', entityType: 'GoodsReceiving', entityId: id,
          detail: `${gr.refNumber} reversed (${units.length} unit(s)): ${why}`,
          changes: { status: { from: gr.statusEnum, to: ReceivingStatus.CANCELLED }, reason: why, units: units.map((u) => u.serialNumber ?? u.id) },
        },
      });
      return { refNumber: gr.refNumber, reversedUnits: units.length };
    });
    this.realtime.emitInventoryUpdate({ action: 'receipt_reversed', refNumber: gr.refNumber });
    return result;
  }

  async findOne(id: string, scope?: ScopePrincipal) {
    const gr = await this.prisma.goodsReceiving.findUnique({
      where: { id },
      include: {
        receivedBy: { select: { fullName: true } },
        items: { include: { product: { include: { brand: true } }, stockItem: true } },
        discrepancies: true,
      },
    });
    if (!gr) throw new NotFoundException('Receiving record not found');
    for (const item of gr.items) {
      if (item.stockItem?.warehouseId) assertWarehouseAccess(scope, item.stockItem.warehouseId, 'this receiving record');
    }
    return gr;
  }

  /**
   * `inTx` runs inside the receipt's transaction with the new unit ids, so a
   * caller can link the receipt (e.g. an RTV replacement) atomically: if the
   * link fails, nothing is received.
   */
  async create(
    dto: CreateReceivingDto,
    userId: string,
    scope?: ScopePrincipal,
    inTx?: (tx: Prisma.TransactionClient, gr: { id: string; refNumber: string }, stockItemIds: string[]) => Promise<void>,
  ) {
    for (const item of dto.items ?? []) {
      if (item.warehouseId) assertWarehouseAccess(scope, item.warehouseId, 'the destination warehouse');
    }
    // Serial uniqueness validation (before any write)
    const serials = dto.items.map((i) => i.serialNumber).filter((s): s is string => !!s && s !== 'N/A');
    if (serials.length > 0) {
      const dupInPayload = serials.find((s, idx) => serials.indexOf(s) !== idx);
      if (dupInPayload) throw new ConflictException(`Duplicate serial number in request: ${dupInPayload}`);
      const existing = await this.prisma.stockItem.findFirst({
        where: {
          serialNumber: { in: serials },
          status: { notIn: [StockStatus.CONSUMED, StockStatus.SHIPPED, StockStatus.CLOSED, StockStatus.CANCELLED] },
        },
        select: { serialNumber: true },
      });
      if (existing) throw new ConflictException(`Serial number already exists in active stock: ${existing.serialNumber}`);
    }

    // Serial/batch control enforcement
    for (const item of dto.items) {
      const product = await this.prisma.product.findUnique({ where: { id: item.productId }, select: { serialControlled: true, batchControlled: true, code: true, isActive: true, productStatus: true } });
      // Phase 4: an incomplete or invalid line is refused before anything is written.
      if (!product) throw new BadRequestException(`Product ${item.productId} does not exist — pick it from Product Master`);
      if (!product.isActive) throw new BadRequestException(`Product ${product.code} is ${String(product.productStatus).toLowerCase()} and cannot be received`);
      if (product.serialControlled && !item.serialNumber) throw new BadRequestException(`Product ${product.code} is serial-controlled — serial number is required`);
      if (product.batchControlled && !item.batchNumber) throw new BadRequestException(`Product ${product.code} is batch-controlled — batch/lot number is required`);
      if (item.serialNumber && item.serialNumber !== 'N/A' && item.quantity !== 1) {
        throw new BadRequestException(`Serial ${item.serialNumber} identifies one unit — quantity must be 1 (add one line per serial)`);
      }
    }

    // A vendor reference must point at a real vendor (the form now sends it for Vendor receipts).
    if (dto.supplierId) {
      const vendor = await this.prisma.vendor.findUnique({ where: { id: dto.supplierId }, select: { id: true } });
      if (!vendor) throw new BadRequestException('Vendor not found — pick it from Business Partners');
    }

    const refNumber = this.ref();

    const gr = await this.prisma.$transaction(async (tx) => {
      // Re-checked under per-serial locks: the pre-check above can race a concurrent receipt.
      await assertSerialsFree(tx, dto.items.map((i) => i.serialNumber));
      const created = await tx.goodsReceiving.create({
        data: {
          refNumber,
          sourceType: dto.sourceType,
          sourceRef: dto.sourceRef,
          awbNumber: dto.awbNumber,
          invoiceNumber: dto.invoiceNumber,
          poNumber: dto.poNumber,
          supplierId: dto.supplierId,
          expectedDate: parseDate(dto.expectedDate),
          notes: dto.notes,
          receivedById: userId,
          status: 'pending_inspection',
          statusEnum: ReceivingStatus.QC_PENDING,
        },
      });

      const stockItemIds: string[] = [];
      for (const item of dto.items) {
        const stock = await tx.stockItem.create({
          data: {
            productId: item.productId,
            serialNumber: item.serialNumber,
            batchNumber: item.batchNumber,
            quantity: item.quantity,
            status: StockStatus.PENDING_RECEIVING,
            ownershipType: item.ownershipType ?? OwnershipType.OWN,
            warehouseId: item.warehouseId,
            rackId: item.rackId,
            slotId: item.slotId,
            expiryDate: parseDate(item.expiryDate),
            createdById: userId,
          },
        });

        await tx.goodsReceivingItem.create({
          data: {
            receivingId: created.id,
            productId: item.productId,
            serialNumber: item.serialNumber,
            batchNumber: item.batchNumber,
            expiryDate: parseDate(item.expiryDate),
            manufactureDate: parseDate(item.manufactureDate),
            quantity: item.quantity,
            condition: item.condition ?? 'good',
            stockItemId: stock.id,
          },
        });
        stockItemIds.push(stock.id);
      }

      await tx.auditLog.create({
        data: { userId, action: 'GOODS_RECEIVED', entityType: 'GoodsReceiving', entityId: created.id, detail: refNumber },
      });
      if (inTx) await inTx(tx, created, stockItemIds);
      return created;
    });

    this.realtime.emitInventoryUpdate({ action: 'received', refNumber });
    return this.findOne(gr.id);
  }

  // ─── Inspection ──────────────────────────────────────────────────────────────
  // Per-item inspection outcomes drive final stock routing. This replaces the
  // old single-click verify() for new records; verify() is kept for backward compat.
  async inspect(id: string, dto: InspectReceivingDto, userId: string, scope?: ScopePrincipal) {
    const gr = await this.findOne(id, scope);
    if (gr.statusEnum === ReceivingStatus.CANCELLED) throw new ConflictException('Receiving record is cancelled');

    // Validate every line before writing anything.
    for (const inspectItem of dto.items) {
      const grItem = gr.items.find((i) => i.id === inspectItem.itemId);
      if (!grItem) throw new NotFoundException(`Item ${inspectItem.itemId} not found in GR ${id}`);
      if (grItem.inspectionOutcome) throw new ConflictException(`Item ${inspectItem.itemId} has already been inspected`);
      if (inspectItem.inspectedQty > grItem.quantity) {
        throw new BadRequestException(
          `Inspected quantity ${inspectItem.inspectedQty} exceeds received quantity ${grItem.quantity} for item ${inspectItem.itemId}`,
        );
      }
      const correctedSerial = inspectItem.serialNumber && inspectItem.serialNumber !== grItem.stockItem?.serialNumber
        ? inspectItem.serialNumber
        : null;
      if (correctedSerial && correctedSerial !== 'N/A') {
        const dup = await this.prisma.stockItem.findFirst({
          where: {
            serialNumber: correctedSerial,
            id: { not: grItem.stockItemId ?? undefined },
            status: { notIn: [StockStatus.CONSUMED, StockStatus.SHIPPED, StockStatus.CLOSED, StockStatus.CANCELLED] },
          },
          select: { id: true },
        });
        if (dup) throw new ConflictException(`Serial number already exists in active stock: ${correctedSerial}`);
      }
    }

    const allGood        = dto.items.every((i) => i.inspectionOutcome === 'good');
    const allRejected    = dto.items.every((i) => i.inspectionOutcome === 'wrong_item');
    const hasDiscrepancy = dto.items.some((i) => DISCREPANCY_OUTCOMES.has(i.inspectionOutcome));

    await this.prisma.$transaction(async (tx) => {
      // Corrected serials re-checked under per-serial locks (excluding the units being corrected).
      const corrections = dto.items
        .map((ii) => ({ ii, gi: gr.items.find((i) => i.id === ii.itemId)! }))
        .filter(({ ii, gi }) => ii.serialNumber && ii.serialNumber !== gi.stockItem?.serialNumber);
      await assertSerialsFree(tx, corrections.map(({ ii }) => ii.serialNumber), corrections.map(({ gi }) => gi.stockItemId).filter((x): x is string => !!x));
      for (const inspectItem of dto.items) {
        const grItem = gr.items.find((i) => i.id === inspectItem.itemId)!;

        // Claim the line: a concurrent or repeated inspection matches zero rows.
        const claimed = await tx.goodsReceivingItem.updateMany({
          where: { id: grItem.id, inspectionOutcome: null },
          data: {
            inspectedQty: inspectItem.inspectedQty,
            inspectionOutcome: inspectItem.inspectionOutcome,
            inspectorNotes: inspectItem.inspectorNotes,
            ...(inspectItem.serialNumber && { serialNumber: inspectItem.serialNumber }),
            ...(inspectItem.batchNumber  && { batchNumber:  inspectItem.batchNumber }),
          },
        });
        if (claimed.count === 0) throw new ConflictException(`Item ${grItem.id} has already been inspected`);

        // Route stock based on inspection outcome
        if (grItem.stockItem) {
          let newStatus: StockStatus;
          const finalQty = inspectItem.inspectedQty ?? grItem.quantity;

          switch (inspectItem.inspectionOutcome) {
            case 'good':
              newStatus = StockStatus.PENDING_INSPECTION; // enters putaway queue
              break;
            case 'doa':
              newStatus = StockStatus.RTV_PENDING;
              break;
            case 'damaged':
              newStatus = StockStatus.QUARANTINE;
              break;
            case 'short_qty':
              newStatus = StockStatus.PENDING_INSPECTION; // partial qty available after putaway
              break;
            case 'wrong_item':
            case 'missing_accessories':
              newStatus = StockStatus.QUARANTINE;
              break;
            default:
              newStatus = StockStatus.PENDING_INSPECTION;
          }

          // Only stock still awaiting inspection may be routed — never stock that
          // was already put away, reserved or issued.
          await transitionStock(tx, grItem.stockItem.id, [StockStatus.PENDING_RECEIVING], newStatus, {
            quantity: finalQty,
            // A serial/batch corrected at inspection must reach the stock record too.
            ...(inspectItem.serialNumber && { serialNumber: inspectItem.serialNumber }),
            ...(inspectItem.batchNumber  && { batchNumber:  inspectItem.batchNumber }),
          });

          // Create discrepancy record for flagged outcomes
          if (DISCREPANCY_OUTCOMES.has(inspectItem.inspectionOutcome)) {
            await tx.receivingDiscrepancy.create({
              data: {
                receivingId: id,
                itemId: grItem.id,
                type: inspectItem.inspectionOutcome,
                orderedQty: grItem.quantity,
                receivedQty: grItem.quantity,
                inspectedQty: finalQty,
                notes: inspectItem.inspectorNotes,
              },
            });
          }
        }
      }

      // Determine overall GR status from outcomes
      let newStatusEnum: ReceivingStatus;
      if (allRejected)         newStatusEnum = ReceivingStatus.REJECTED;
      else if (hasDiscrepancy) newStatusEnum = ReceivingStatus.PARTIAL;
      else if (allGood)        newStatusEnum = ReceivingStatus.PUTAWAY_PENDING;
      else                     newStatusEnum = ReceivingStatus.PUTAWAY_PENDING;

      await tx.goodsReceiving.update({
        where: { id },
        data: {
          status: 'completed',
          statusEnum: newStatusEnum,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'RECEIVING_INSPECTED',
          entityType: 'GoodsReceiving',
          entityId: id,
          detail: `${gr.refNumber} — ${dto.items.map((i) => i.inspectionOutcome).join(', ')}`,
        },
      });
    });

    this.realtime.emitInventoryUpdate({ action: 'inspected', id });
    return this.findOne(id);
  }

  // Legacy single-click verify — kept for backward compat; routes by stored condition.
  async verify(id: string, userId: string, scope?: ScopePrincipal) {
    const gr = await this.findOne(id, scope);
    await this.prisma.$transaction(async (tx) => {
      // Claim the receipt: a verified (or inspected) receipt cannot be verified again.
      const claimed = await tx.goodsReceiving.updateMany({
        where: { id, status: { notIn: ['completed', 'cancelled'] } }, // a reversed receipt stays reversed
        data: { status: 'completed', statusEnum: ReceivingStatus.COMPLETED },
      });
      if (claimed.count === 0) throw new ConflictException('Receiving record has already been verified, inspected or reversed');

      for (const item of gr.items) {
        if (!item.stockItem || item.inspectionOutcome) continue;
        let newStatus: StockStatus;
        if (item.condition === 'doa') newStatus = StockStatus.RTV_PENDING;
        else if (item.condition === 'damaged') newStatus = StockStatus.QUARANTINE;
        else newStatus = StockStatus.PENDING_INSPECTION;
        await transitionStock(tx, item.stockItem.id, [StockStatus.PENDING_RECEIVING], newStatus);
      }
      await tx.auditLog.create({
        data: { userId, action: 'RECEIVING_VERIFIED', entityType: 'GoodsReceiving', entityId: id, detail: gr.refNumber },
      });
    });
    this.realtime.emitInventoryUpdate({ action: 'verified', id });
    return this.findOne(id);
  }
}
