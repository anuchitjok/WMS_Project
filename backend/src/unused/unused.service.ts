import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { Prisma, RequestStatus, StockStatus, RTVStatus } from '@prisma/client';
import { nanoid } from 'nanoid';
import { resolveIssuedUnits } from '../common/shipped-unit-resolver';
import { transitionStock } from '../common/stock-state';
import { RETURNABLE_USAGES, issuedUnitsOf } from '../common/issued-units';

/** Issued units — PICKED/RESERVED cover requests handed over before goods issue was enforced. */
const ISSUED_UNIT_STATUSES: StockStatus[] = [StockStatus.SHIPPED, StockStatus.ISSUED_TO_RMA, StockStatus.PICKED, StockStatus.RESERVED];

/**
 * A returned unit is back on the dock: it waits in the putaway queue
 * (PENDING_INSPECTION, no slot) and only becomes Available once put away.
 */
const BACK_ON_DOCK: Prisma.StockItemUncheckedUpdateManyInput = { rackId: null, slotId: null };

type Outcome = 'RECEIVED' | 'DOA';

@Injectable()
export class UnusedService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
  ) {}

  /**
   * Requests with goods flagged UNUSED / WRONG_ITEM that the warehouse has not
   * received back yet — per unit (`pendingUnits`) or, for requests confirmed
   * before per-unit usage, the whole request.
   */
  async pending(requesterId?: string) {
    const requests = await this.prisma.withdrawalRequest.findMany({
      where: {
        ...(requesterId ? { requesterId } : {}),
        OR: [
          { unitUsages: { some: { returnStatus: 'PENDING' } } },
          { status: RequestStatus.ISSUED_TO_RMA, unitUsages: { none: {} }, items: { some: { usageStatus: { in: RETURNABLE_USAGES } } } },
        ],
      },
      include: {
        requester: { select: { fullName: true } },
        items: { include: { product: true, stockItem: true } },
        unitUsages: { where: { returnStatus: 'PENDING' } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const ids = requests.flatMap((r) => r.unitUsages.map((u) => u.stockItemId));
    const stock = ids.length
      ? await this.prisma.stockItem.findMany({ where: { id: { in: ids } }, select: { id: true, serialNumber: true, quantity: true, product: { select: { code: true, name: true, unit: true } } } })
      : [];
    const byId = new Map(stock.map((s) => [s.id, s]));
    return requests.map((r) => ({
      ...r,
      pendingUnits: r.unitUsages.map((u) => ({ ...u, stock: byId.get(u.stockItemId) ?? null })),
    }));
  }

  /** Physically received back and passed inspection → putaway queue (not Available yet). */
  returnToStock(requestId: string, userId: string, stockItemIds?: string[]) {
    return this.process(requestId, userId, 'RECEIVED', stockItemIds);
  }

  /** Received back but found defective → RTV. */
  markDoa(requestId: string, userId: string, stockItemIds?: string[]) {
    return this.process(requestId, userId, 'DOA', stockItemIds);
  }

  private async process(requestId: string, userId: string, outcome: Outcome, stockItemIds?: string[]) {
    const req = await this.prisma.withdrawalRequest.findUnique({ where: { id: requestId }, include: { items: true } });
    if (!req) throw new NotFoundException('Request not found');
    const hasRows = (await this.prisma.issuedUnitUsage.count({ where: { requestId } })) > 0;

    const updated = hasRows
      ? await this.processUnits(req, userId, outcome, stockItemIds)
      : await this.processLegacy(req, userId, outcome, stockItemIds);
    this.realtime.emitInventoryUpdate({ action: outcome === 'RECEIVED' ? 'unused_returned' : 'unused_doa', requestId });
    return updated;
  }

  /** Per-unit returns: only the listed (or all pending) units, each processed once. */
  private async processUnits(req: { id: string; refNumber: string; items: any[] }, userId: string, outcome: Outcome, stockItemIds?: string[]) {
    const pending = await this.prisma.issuedUnitUsage.findMany({ where: { requestId: req.id, returnStatus: 'PENDING' } });
    let targets = pending;
    if (stockItemIds?.length) {
      const unknown = stockItemIds.filter((id) => !pending.some((p) => p.stockItemId === id));
      if (unknown.length) {
        const already = await this.prisma.issuedUnitUsage.count({ where: { requestId: req.id, stockItemId: { in: unknown } } });
        if (already === unknown.length) throw new ConflictException('This return has already been processed');
        throw new BadRequestException(`Unit(s) not awaiting return on ${req.refNumber}: ${unknown.join(', ')}`);
      }
      targets = pending.filter((p) => stockItemIds.includes(p.stockItemId));
    }
    if (!targets.length) throw new ConflictException('This return has already been processed');
    const issued = await issuedUnitsOf(this.prisma, req.id, req.items);

    return this.prisma.$transaction(async (tx) => {
      // Claim the units: a second click matches no PENDING rows.
      const claimed = await tx.issuedUnitUsage.updateMany({
        where: { id: { in: targets.map((t) => t.id) }, returnStatus: 'PENDING' },
        data: { returnStatus: outcome, returnedAt: new Date(), returnedById: userId },
      });
      if (claimed.count !== targets.length) throw new ConflictException('This return has already been processed');

      for (const t of targets) await this.moveUnit(tx, t.stockItemId, outcome, req.refNumber, userId);

      // The request is finished once every issued unit is recorded and nothing waits to come back.
      const rows = await tx.issuedUnitUsage.findMany({ where: { requestId: req.id }, select: { stockItemId: true, returnStatus: true } });
      const allRecorded = issued.every((u) => rows.some((r) => r.stockItemId === u.stockItemId));
      const open = rows.some((r) => r.returnStatus === 'PENDING');
      if (allRecorded && !open) {
        await tx.withdrawalRequest.updateMany({
          where: { id: req.id, status: RequestStatus.ISSUED_TO_RMA },
          data: { status: RequestStatus.COMPLETED, notes: 'Issued goods settled (used / returned)', version: { increment: 1 } },
        });
      }
      await this.audit(tx, userId, req, outcome, targets.length, open);
      return tx.withdrawalRequest.findUniqueOrThrow({ where: { id: req.id } });
    });
  }

  /** Requests confirmed before per-unit usage: the whole return at once, as before. */
  private async processLegacy(req: { id: string; refNumber: string; status: RequestStatus; items: any[] }, userId: string, outcome: Outcome, stockItemIds?: string[]) {
    if (req.status !== RequestStatus.ISSUED_TO_RMA) {
      throw new BadRequestException(`Request is ${req.status}; only issued requests can be returned`);
    }
    if (stockItemIds?.length) throw new BadRequestException('This request was confirmed as a whole; return it as a whole');
    const lines = req.items.filter((i) => i.usageStatus && RETURNABLE_USAGES.includes(i.usageStatus));
    if (lines.length === 0) throw new BadRequestException('No items on this request are flagged as unused or wrong item');
    const units = await resolveIssuedUnits(this.prisma, req.id, lines);

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.withdrawalRequest.updateMany({
        where: { id: req.id, status: RequestStatus.ISSUED_TO_RMA },
        data: {
          status: RequestStatus.COMPLETED, version: { increment: 1 },
          notes: outcome === 'RECEIVED' ? 'Unused goods received back — awaiting putaway' : 'Unused return found defective — routed to RTV',
        },
      });
      if (claimed.count === 0) throw new ConflictException('This return has already been processed');
      for (const sid of units) await this.moveUnit(tx, sid, outcome, req.refNumber, userId);
      await this.audit(tx, userId, req, outcome, units.length, false);
      return tx.withdrawalRequest.findUniqueOrThrow({ where: { id: req.id } });
    });
  }

  private async moveUnit(tx: Prisma.TransactionClient, stockItemId: string, outcome: Outcome, ref: string, userId: string) {
    if (outcome === 'RECEIVED') {
      // Only units that actually left the warehouse can come back, and they come
      // back to the putaway queue — Available only after putaway (U03).
      await transitionStock(tx, stockItemId, ISSUED_UNIT_STATUSES, StockStatus.PENDING_INSPECTION, BACK_ON_DOCK);
      return;
    }
    await transitionStock(tx, stockItemId, ISSUED_UNIT_STATUSES, StockStatus.RTV_PENDING, BACK_ON_DOCK);
    await tx.rTVCase.create({
      data: {
        refNumber: `RTV-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`,
        stockItemId,
        reason: 'doa',
        description: `DOA found during unused return verification (${ref})`,
        status: RTVStatus.RTV_REQUIRED,
        rtvOfficerId: userId,
      },
    });
  }

  private audit(tx: Prisma.TransactionClient, userId: string, req: { id: string; refNumber: string }, outcome: Outcome, n: number, stillOpen: boolean) {
    return tx.auditLog.create({
      data: {
        userId, entityType: 'WithdrawalRequest', entityId: req.id,
        // Action names are unchanged: material planning dates returns by them.
        action: outcome === 'RECEIVED' ? 'UNUSED_RETURNED_TO_STOCK' : 'UNUSED_MARKED_DOA',
        detail: outcome === 'RECEIVED'
          ? `${req.refNumber} (${n} unit(s) received back — awaiting putaway)${stillOpen ? ' · more units still to return' : ''}`
          : `${req.refNumber} (${n} unit(s) defective — routed to RTV)${stillOpen ? ' · more units still to return' : ''}`,
      },
    });
  }
}
