import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, RTVStatus, StockStatus } from '@prisma/client';
import { nanoid } from 'nanoid';
import { ScopePrincipal, assertWarehouseAccess, warehouseFilter } from '../common/warehouse-scope';
import { SystemSettingsService } from '../settings/system-settings.service';
import { transitionStock } from '../common/stock-state';
import { ReceivingService } from '../receiving/receiving.service';

/** RTV cases that are finished and no longer age. */
export const RTV_CLOSED: RTVStatus[] = [RTVStatus.COMPLETED, RTVStatus.REJECTED_BY_VENDOR, RTVStatus.CANCELLED];

/** Stock that can be sent back to the vendor. */
export const RTV_ELIGIBLE: StockStatus[] = [StockStatus.DOA, StockStatus.DAMAGED, StockStatus.QUARANTINE, StockStatus.RTV_PENDING];

/** A replacement can be received once the vendor has the unit. */
const REPLACEABLE: RTVStatus[] = [RTVStatus.VENDOR_RECEIVED, RTVStatus.REPLACEMENT_PENDING];

const REPLACEMENT_SELECT = { select: { id: true, serialNumber: true, status: true } } as const;

/**
 * Opens an RTV case for a unit — at most one open case per unit. The unit row
 * is locked first so two concurrent submits cannot both pass the check, and
 * the unit moves to RTV_PENDING with the case.
 */
export async function openRtvCase(
  tx: Prisma.TransactionClient,
  data: { stockItemId: string; reason: string; description?: string; vendorId?: string; officerId: string },
) {
  await tx.$queryRaw`SELECT "id" FROM "StockItem" WHERE "id" = ${data.stockItemId} FOR UPDATE`;
  const open = await tx.rTVCase.findFirst({
    where: { stockItemId: data.stockItemId, status: { notIn: RTV_CLOSED } },
    select: { refNumber: true },
  });
  if (open) throw new ConflictException(`Stock item already has an open RTV case: ${open.refNumber}`);
  await transitionStock(tx, data.stockItemId, RTV_ELIGIBLE, StockStatus.RTV_PENDING);
  return tx.rTVCase.create({
    data: {
      refNumber: `RTV-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`,
      stockItemId: data.stockItemId,
      reason: data.reason,
      description: data.description,
      status: RTVStatus.RTV_REQUIRED,
      vendorId: data.vendorId,
      rtvOfficerId: data.officerId,
    },
  });
}

/**
 * Aging against the `rtv.agingSla` setting: elapsed whole 24-hour days since
 * the case was created (timezone-independent). No SLA in force → overdue is null.
 */
export function rtvAging(c: { createdAt: Date; status: RTVStatus }, slaDays: number | null, now = new Date()) {
  const ageMs = now.getTime() - c.createdAt.getTime();
  const ageDays = Math.floor(ageMs / 86_400_000);
  const open = !RTV_CLOSED.includes(c.status);
  // Same rule as the dashboard count: older than the SLA by any amount = overdue.
  return { ageDays, slaDays, overdue: slaDays === null || !open ? null : ageMs > slaDays * 86_400_000 };
}

@Injectable()
export class RtvService {
  constructor(private prisma: PrismaService, private settings: SystemSettingsService, private receiving: ReceivingService) {}

  private async stockWarehouse(stockItemId: string) {
    const stock = await this.prisma.stockItem.findUnique({ where: { id: stockItemId }, select: { warehouseId: true } });
    if (!stock) throw new NotFoundException('Stock item not found');
    return stock.warehouseId;
  }

  async findAll(filter: { status?: RTVStatus; page?: number; limit?: number; overdue?: boolean }, scope?: ScopePrincipal) {
    const { status, page = 1, limit = 20 } = filter;
    const skip = (page - 1) * limit;
    const wh = warehouseFilter(scope);
    const slaDays = await this.settings.rtvAgingSlaDays();
    const rows = await this.prisma.rTVCase.findMany({
      where: { ...(status ? { status } : {}), ...(wh ? { stockItem: { warehouseId: wh } } : {}) },
      include: {
        stockItem: { include: { product: true } },
        vendor: true,
        rtvOfficer: { select: { fullName: true } },
        replacementStock: REPLACEMENT_SELECT,
      },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const withAging = rows.map((r) => ({ ...r, ...rtvAging(r, slaDays) }));
    return filter.overdue ? withAging.filter((r) => r.overdue) : withAging;
  }

  async findOne(id: string, scope?: ScopePrincipal) {
    const c = await this.prisma.rTVCase.findUnique({
      where: { id },
      include: {
        stockItem: { include: { product: { include: { brand: true } } } },
        vendor: true,
        rtvOfficer: { select: { fullName: true } },
        replacementStock: REPLACEMENT_SELECT,
      },
    });
    if (!c) throw new NotFoundException('RTV case not found');
    assertWarehouseAccess(scope, c.stockItem?.warehouseId, 'this RTV case');
    return { ...c, ...rtvAging(c, await this.settings.rtvAgingSlaDays()) };
  }

  async create(data: { stockItemId: string; reason: string; description?: string; vendorId?: string }, officerId: string, scope?: ScopePrincipal) {
    assertWarehouseAccess(scope, await this.stockWarehouse(data.stockItemId), 'this stock item');
    if (!data.reason?.trim()) throw new BadRequestException('A reason is required');
    // Phase 5: same rule as DOA management — one open case per unit, unit moves to RTV_PENDING.
    return this.prisma.$transaction(async (tx) => {
      const rtv = await openRtvCase(tx, { ...data, officerId });
      await tx.auditLog.create({
        data: { userId: officerId, action: 'RTV_CASE_CREATED', entityType: 'RTVCase', entityId: rtv.id, detail: `${rtv.refNumber} · ${data.reason}` },
      });
      return rtv;
    });
  }

  async updateStatus(id: string, status: RTVStatus, actorId: string, scope?: ScopePrincipal, opts: { creditNoteRef?: string } = {}) {
    const existing = await this.prisma.rTVCase.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('RTV case not found');
    assertWarehouseAccess(scope, await this.stockWarehouse(existing.stockItemId), 'this RTV case');
    if (!Object.values(RTVStatus).includes(status)) throw new BadRequestException(`Unknown RTV status ${status}`);
    if (status === existing.status) throw new ConflictException(`RTV case is already ${status}`);
    if (RTV_CLOSED.includes(existing.status)) throw new ConflictException(`RTV case is ${existing.status} and closed`);
    // U04: a replacement case closes only by receiving the replacement, which links it.
    if (status === RTVStatus.COMPLETED && existing.status === RTVStatus.REPLACEMENT_PENDING) {
      throw new BadRequestException('Receive the replacement unit to complete this case (RTV → Receive replacement)');
    }
    const extra: Prisma.RTVCaseUncheckedUpdateManyInput = {};
    if (opts.creditNoteRef !== undefined) extra.creditNoteRef = opts.creditNoteRef || null;
    if (status === RTVStatus.SHIPPED_TO_VENDOR) extra.shippedDate = new Date();
    if (RTV_CLOSED.includes(status)) extra.closedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      // Claim the transition: a double click cannot apply it (or its stock move) twice.
      const claimed = await tx.rTVCase.updateMany({ where: { id, status: existing.status }, data: { status, ...extra } });
      if (claimed.count === 0) throw new ConflictException('RTV case was changed by someone else — reload and retry');

      // The unit leaves on-hand stock when it is shipped to the vendor, and goes
      // back to the DOA list if the case is cancelled before shipping.
      const unit = await tx.stockItem.findUnique({ where: { id: existing.stockItemId }, select: { status: true } });
      if (status === RTVStatus.SHIPPED_TO_VENDOR && unit?.status === StockStatus.RTV_PENDING) {
        await transitionStock(tx, existing.stockItemId, [StockStatus.RTV_PENDING], StockStatus.RTV_SHIPPED);
      }
      if (status === RTVStatus.CANCELLED && unit?.status === StockStatus.RTV_PENDING) {
        await transitionStock(tx, existing.stockItemId, [StockStatus.RTV_PENDING], StockStatus.DOA);
      }
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'RTV_STATUS_CHANGED',
          entityType: 'RTVCase',
          entityId: id,
          detail: `${existing.refNumber}: ${existing.status} → ${status}${opts.creditNoteRef ? ` · credit note ${opts.creditNoteRef}` : ''}`,
          changes: { status: { from: existing.status, to: status } },
        },
      });
      return tx.rTVCase.findUniqueOrThrow({ where: { id } });
    });
  }

  /**
   * U04 — receives the vendor's replacement through Goods Receiving (so it is
   * inspected and put away like any receipt), linked to this case and the
   * original serial. One replacement per case: a second receipt is refused and
   * nothing is received.
   */
  async receiveReplacement(
    id: string,
    input: { serialNumber?: string; batchNumber?: string; warehouseId?: string; notes?: string },
    actorId: string,
    scope?: ScopePrincipal,
  ) {
    const c = await this.prisma.rTVCase.findUnique({
      where: { id },
      include: { stockItem: { select: { id: true, productId: true, serialNumber: true, warehouseId: true, quantity: true } } },
    });
    if (!c) throw new NotFoundException('RTV case not found');
    assertWarehouseAccess(scope, c.stockItem.warehouseId, 'this RTV case');
    if (c.replacementStockId) throw new ConflictException(`${c.refNumber} already has a replacement received`);
    if (!REPLACEABLE.includes(c.status)) {
      throw new BadRequestException(`${c.refNumber} is ${c.status}; a replacement can be received once the vendor has received the unit`);
    }
    const serial = input.serialNumber?.trim() || undefined;
    const old = c.stockItem.serialNumber ? `serial ${c.stockItem.serialNumber}` : `unit ${c.stockItem.id}`;
    const gr = await this.receiving.create(
      {
        sourceType: 'RTV Replacement',
        sourceRef: c.refNumber,
        supplierId: c.vendorId ?? undefined,
        notes: `Replacement for ${old} (${c.refNumber})${input.notes ? ` — ${input.notes}` : ''}`,
        items: [{
          productId: c.stockItem.productId,
          serialNumber: serial,
          batchNumber: input.batchNumber?.trim() || undefined,
          quantity: c.stockItem.serialNumber || serial ? 1 : c.stockItem.quantity,
          warehouseId: input.warehouseId ?? c.stockItem.warehouseId ?? undefined,
        }],
      },
      actorId,
      scope,
      async (tx, receipt, [newUnit]) => {
        const linked = await tx.rTVCase.updateMany({
          where: { id, replacementStockId: null, status: { in: REPLACEABLE } },
          data: { replacementStockId: newUnit, status: RTVStatus.COMPLETED, resolution: 'REPLACED', closedAt: new Date() },
        });
        if (linked.count === 0) throw new ConflictException(`${c.refNumber} already has a replacement received`);
        await tx.auditLog.create({
          data: {
            userId: actorId, action: 'RTV_REPLACEMENT_RECEIVED', entityType: 'RTVCase', entityId: id,
            detail: `${c.refNumber}: replacement ${serial ? `serial ${serial}` : 'unit'} received on ${receipt.refNumber} for ${old}`,
            changes: { replacementStockId: { from: null, to: newUnit }, status: { from: c.status, to: RTVStatus.COMPLETED } },
          },
        });
      },
    );
    const updated = await this.prisma.rTVCase.findUniqueOrThrow({ where: { id }, include: { replacementStock: REPLACEMENT_SELECT } });
    return { ...updated, receiving: { id: gr.id, refNumber: gr.refNumber } };
  }
}
