import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CycleCountStatus, Prisma, StockStatus } from '@prisma/client';
import { assertNotSelfApproval } from '../common/separation-of-duties';
import { ScopePrincipal, assertWarehouseAccess, warehouseFilter } from '../common/warehouse-scope';
import { ACTIVE_COUNT_STATUSES } from '../common/count-lock';
import { SystemSettingsService } from '../settings/system-settings.service';
import { nanoid } from 'nanoid';

const ACTIVE = ACTIVE_COUNT_STATUSES as unknown as CycleCountStatus[];
const PERIOD_DAYS = { weekly: 7, monthly: 30, quarterly: 91 } as const;

interface LineConflict { lineId: string; stockItemId: string | null; reason: string }

/**
 * Cycle counting with a count-line stock lock (see common/count-lock.ts).
 *
 * - One active count per warehouse; creating it locks the AVAILABLE rows it
 *   counts (FOR UPDATE while the lines are written, then by session status).
 * - Approval re-checks every counted row inside one transaction. If any row
 *   changed since it was counted (status, quantity or warehouse), nothing is
 *   applied: the lines are flagged with a conflict reason and the approval is
 *   refused (409). `recountConflicts` refreshes those lines for a recount.
 * - Approving or cancelling releases the lock.
 */
@Injectable()
export class CycleCountService {
  constructor(private prisma: PrismaService, private settings: SystemSettingsService) {}

  private async sessionScope(id: string, scope?: ScopePrincipal) {
    const s = await this.prisma.cycleCountSession.findUnique({ where: { id }, select: { id: true, warehouseId: true, status: true } });
    if (!s) throw new NotFoundException('CycleCountSession not found');
    assertWarehouseAccess(scope, s.warehouseId, 'this count session');
    return s;
  }

  async createSession(dto: { warehouseId: string; type?: string; assignedTo?: string; notes?: string }, userId: string, scope?: ScopePrincipal) {
    if (!dto?.warehouseId || typeof dto.warehouseId !== 'string') throw new BadRequestException('warehouseId is required');
    assertWarehouseAccess(scope, dto.warehouseId, 'this warehouse');
    const wh = await this.prisma.warehouse.findUnique({ where: { id: dto.warehouseId }, select: { id: true } });
    if (!wh) throw new NotFoundException('Warehouse not found');
    const ref = `CC-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;

    const session = await this.prisma.$transaction(async (tx) => {
      // Serialise count creation per warehouse, then refuse a second active count.
      await tx.$queryRaw`SELECT "id" FROM "Warehouse" WHERE "id" = ${dto.warehouseId} FOR UPDATE`;
      const active = await tx.cycleCountSession.findFirst({
        where: { warehouseId: dto.warehouseId, status: { in: ACTIVE } },
        select: { refNumber: true },
      });
      if (active) throw new ConflictException(`Warehouse already has an active count: ${active.refNumber}`);

      // Lock the rows being counted while the lines are written, so a concurrent
      // reservation either finishes first (row no longer AVAILABLE → not counted)
      // or skips them (SKIP LOCKED) and then sees the count lock.
      const stockItems = await tx.$queryRaw<{ id: string; productId: string; quantity: number; rackCode: string | null; slotCode: string | null }[]>`
        SELECT s."id", s."productId", s."quantity", r."code" AS "rackCode", sl."code" AS "slotCode"
        FROM "StockItem" s
        LEFT JOIN "Rack" r ON r."id" = s."rackId"
        LEFT JOIN "Slot" sl ON sl."id" = s."slotId"
        WHERE s."warehouseId" = ${dto.warehouseId} AND s."status" = 'AVAILABLE'
        ORDER BY s."id"
        FOR UPDATE OF s`;

      const s = await tx.cycleCountSession.create({
        data: {
          refNumber: ref,
          warehouseId: dto.warehouseId,
          type: dto.type ?? 'BLIND',
          assignedTo: dto.assignedTo,
          startedById: userId,
          notes: dto.notes,
          frozenAt: new Date(), // counted rows are locked from here until approval / cancel
        },
      });

      await tx.cycleCountLine.createMany({
        data: stockItems.map((item) => ({
          sessionId: s.id,
          productId: item.productId,
          stockItemId: item.id,
          locationKey: [item.rackCode, item.slotCode].filter(Boolean).join('|'),
          expectedQty: Number(item.quantity),
          countedQty: null, // null = not yet counted
        })),
      });

      await tx.auditLog.create({
        data: { userId, action: 'CYCLE_COUNT_CREATED', entityType: 'CycleCountSession', entityId: s.id, detail: `${stockItems.length} lines locked` },
      });
      return s;
    });
    return this.findOne(session.id);
  }

  findAll(warehouseId?: string, status?: CycleCountStatus, scope?: ScopePrincipal) {
    const wh = warehouseFilter(scope, warehouseId);
    return this.prisma.cycleCountSession.findMany({
      where: { ...(wh ? { warehouseId: wh } : {}), ...(status ? { status } : {}) },
      include: { _count: { select: { lines: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, scope?: ScopePrincipal) {
    const s = await this.prisma.cycleCountSession.findUnique({
      where: { id },
      include: { lines: { orderBy: { createdAt: 'asc' } } },
    });
    if (!s) throw new NotFoundException('CycleCountSession not found');
    assertWarehouseAccess(scope, s.warehouseId, 'this count session');

    // CycleCountLine has no product relation — resolve product code/name in one query and merge,
    // so the UI can show a readable product instead of a raw id slice.
    const productIds = [...new Set(s.lines.map((l) => l.productId))];
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, code: true, name: true } })
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));
    const lines = s.lines.map((l) => ({
      ...l,
      productCode: productById.get(l.productId)?.code ?? null,
      productName: productById.get(l.productId)?.name ?? null,
    }));

    // Summary stats (excluded lines are out of the count)
    const live = lines.filter((l) => !l.excludedAt);
    const total = live.length;
    const counted = live.filter((l) => l.countedQty !== null).length;
    const variances = live.filter((l) => l.countedQty !== null && l.variance !== 0);
    const conflicts = live.filter((l) => l.conflictReason).length;
    return {
      ...s,
      lines,
      summary: { total, counted, remaining: total - counted, varianceCount: variances.length, conflictCount: conflicts, excluded: lines.length - total },
    };
  }

  // Submit a count for one line (idempotent — can recount)
  async countLine(sessionId: string, lineId: string, countedQty: number, userId: string, scope?: ScopePrincipal) {
    const session = await this.sessionScope(sessionId, scope);
    if (!['OPEN', 'IN_PROGRESS'].includes(session.status)) throw new BadRequestException('Session is not open for counting');
    if (typeof countedQty !== 'number' || !Number.isFinite(countedQty)) throw new BadRequestException('countedQty must be a number');
    if (countedQty < 0) throw new BadRequestException('Counted quantity cannot be negative');

    const line = await this.prisma.cycleCountLine.findUnique({ where: { id: lineId } });
    if (!line || line.sessionId !== sessionId) throw new NotFoundException('Line not found in this session');
    if (line.excludedAt) throw new BadRequestException('This line was removed from the count');

    const variance = countedQty - line.expectedQty;
    await this.prisma.$transaction(async (tx) => {
      await tx.cycleCountLine.update({
        where: { id: lineId },
        data: { countedQty, variance, countedById: userId, countedAt: new Date(), conflictReason: null },
      });
      // Advance session to IN_PROGRESS on first count
      if (session.status === 'OPEN') {
        await tx.cycleCountSession.updateMany({ where: { id: sessionId, status: CycleCountStatus.OPEN }, data: { status: CycleCountStatus.IN_PROGRESS } });
      }
    });
    return this.findOne(sessionId);
  }

  // Submit session for review (all lines must be counted)
  async submitForReview(sessionId: string, userId: string, scope?: ScopePrincipal) {
    await this.sessionScope(sessionId, scope);
    const s = await this.findOne(sessionId);
    const uncounted = s.lines.filter((l: any) => !l.excludedAt && l.countedQty === null);
    if (uncounted.length > 0) throw new BadRequestException(`${uncounted.length} lines not yet counted`);

    const claimed = await this.prisma.cycleCountSession.updateMany({
      where: { id: sessionId, status: { in: [CycleCountStatus.OPEN, CycleCountStatus.IN_PROGRESS] } },
      data: { status: CycleCountStatus.REVIEW },
    });
    if (claimed.count === 0) throw new ConflictException(`Session is ${s.status}; only an open count can be submitted`);
    await this.prisma.auditLog.create({ data: { userId, action: 'CYCLE_COUNT_REVIEW', entityType: 'CycleCountSession', entityId: sessionId } });
    return this.findOne(sessionId);
  }

  /** Re-checks every counted row against the stock (inside `tx`, rows locked). */
  private async findConflicts(tx: Prisma.TransactionClient, warehouseId: string, lines: Array<{ id: string; stockItemId: string | null; expectedQty: number; excludedAt: Date | null }>) {
    const live = lines.filter((l) => !l.excludedAt && l.stockItemId);
    const ids = live.map((l) => l.stockItemId as string);
    const rows = ids.length
      ? await tx.$queryRaw<{ id: string; status: StockStatus; quantity: number; warehouseId: string | null }[]>`
          SELECT "id", "status", "quantity", "warehouseId" FROM "StockItem" WHERE "id" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const conflicts: LineConflict[] = [];
    for (const l of live) {
      const row = byId.get(l.stockItemId as string);
      let reason: string | null = null;
      if (!row) reason = 'stock row no longer exists';
      else if (row.status !== StockStatus.AVAILABLE) reason = `stock is now ${row.status}`;
      else if (row.warehouseId !== warehouseId) reason = 'stock moved to another warehouse';
      else if (Number(row.quantity) !== l.expectedQty) reason = `quantity changed from ${l.expectedQty} to ${Number(row.quantity)} after counting`;
      if (reason) conflicts.push({ lineId: l.id, stockItemId: l.stockItemId, reason });
    }
    return conflicts;
  }

  // Approve and apply variances to stock — all lines or none.
  async approve(sessionId: string, userId: string, scope?: ScopePrincipal) {
    await this.sessionScope(sessionId, scope);
    const s = await this.findOne(sessionId);
    if (s.status !== CycleCountStatus.REVIEW) throw new BadRequestException('Session must be in REVIEW status');
    // Whoever counted any line may not approve the variances.
    assertNotSelfApproval(userId, (s.lines as any[]).map((l) => l.countedById), 'cycle-count variances');

    const outcome = await this.prisma.$transaction(async (tx) => {
      const conflicts = await this.findConflicts(tx, s.warehouseId, s.lines as any[]);
      if (conflicts.length) return { conflicts, applied: 0 };

      const claimed = await tx.cycleCountSession.updateMany({
        where: { id: sessionId, status: CycleCountStatus.REVIEW },
        data: { status: CycleCountStatus.APPROVED, closedById: userId, closedAt: new Date() },
      });
      if (claimed.count === 0) throw new ConflictException('Session has already been approved');

      let applied = 0;
      for (const line of s.lines as any[]) {
        if (line.excludedAt || !line.stockItemId || line.countedQty === null || line.variance === 0) continue;
        // Rows were verified and locked above; the guarded write is a final safety net.
        const res = await tx.stockItem.updateMany({
          where: { id: line.stockItemId, status: StockStatus.AVAILABLE, quantity: line.expectedQty },
          data: { quantity: line.countedQty },
        });
        if (res.count === 0) throw new ConflictException(`Stock for line ${line.id} changed during approval — retry`);
        applied += 1;
        // Create adjustment record for traceability
        await tx.stockAdjustment.create({
          data: {
            refNumber: `ADJ-CC-${nanoid(6).toUpperCase()}`,
            stockItemId: line.stockItemId,
            productLabel: `Cycle Count: ${s.refNumber}`,
            reason: 'cycle_count_variance',
            reasonCode: 'CYCLE_COUNT',
            quantityBefore: line.expectedQty,
            quantityAfter: line.countedQty,
            status: 'COMPLETED',
            requestedById: line.countedById ?? userId,
            approvedById: userId,
            approvedAt: new Date(),
          },
        });
      }
      await tx.auditLog.create({
        data: { userId, action: 'CYCLE_COUNT_APPROVED', entityType: 'CycleCountSession', entityId: sessionId, detail: `${applied} variances applied` },
      });
      return { conflicts: [] as LineConflict[], applied };
    });

    if (outcome.conflicts.length) {
      // Record the conflicts (outside the read transaction) so the UI can show them and offer a recount.
      await this.prisma.$transaction(async (tx) => {
        for (const c of outcome.conflicts) {
          await tx.cycleCountLine.update({ where: { id: c.lineId }, data: { conflictReason: c.reason } });
        }
        await tx.auditLog.create({
          data: { userId, action: 'CYCLE_COUNT_CONFLICT', entityType: 'CycleCountSession', entityId: sessionId, detail: `${outcome.conflicts.length} line(s) changed since counting — nothing applied` },
        });
      });
      throw new ConflictException({
        message: `${outcome.conflicts.length} counted line(s) changed since they were counted. Nothing was applied — recount the flagged lines, then submit again.`,
        conflicts: outcome.conflicts,
      });
    }
    // `skippedLineIds` kept for API compatibility: with all-or-nothing approval it is always empty.
    return { ...(await this.findOne(sessionId)), skippedLineIds: [] as string[] };
  }

  /**
   * Recovery after a conflict: flagged lines get their expected quantity
   * refreshed from the stock and must be recounted; lines whose stock is no
   * longer AVAILABLE in this warehouse are excluded (and release their lock).
   * The session returns to IN_PROGRESS.
   */
  async recountConflicts(sessionId: string, userId: string, scope?: ScopePrincipal) {
    const s = await this.sessionScope(sessionId, scope);
    if (s.status !== CycleCountStatus.REVIEW && s.status !== CycleCountStatus.IN_PROGRESS) {
      throw new BadRequestException('Only an active count can be recounted');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const lines = await tx.cycleCountLine.findMany({ where: { sessionId, excludedAt: null, conflictReason: { not: null } } });
      if (!lines.length) throw new BadRequestException('No conflicting lines to recount');
      const ids = lines.map((l) => l.stockItemId).filter((x): x is string => !!x);
      const rows = await tx.stockItem.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, quantity: true, warehouseId: true } });
      const byId = new Map(rows.map((r) => [r.id, r]));
      let recount = 0, excluded = 0;
      for (const l of lines) {
        const row = l.stockItemId ? byId.get(l.stockItemId) : undefined;
        if (row && row.status === StockStatus.AVAILABLE && row.warehouseId === s.warehouseId) {
          await tx.cycleCountLine.update({
            where: { id: l.id },
            data: { expectedQty: row.quantity, countedQty: null, variance: null, countedById: null, countedAt: null, isRecounted: true, conflictReason: null },
          });
          recount += 1;
        } else {
          await tx.cycleCountLine.update({
            where: { id: l.id },
            data: { excludedAt: new Date(), notes: `Excluded: ${l.conflictReason}`, conflictReason: null },
          });
          excluded += 1;
        }
      }
      await tx.cycleCountSession.update({ where: { id: sessionId }, data: { status: CycleCountStatus.IN_PROGRESS } });
      await tx.auditLog.create({
        data: { userId, action: 'CYCLE_COUNT_RECOUNT', entityType: 'CycleCountSession', entityId: sessionId, detail: `${recount} to recount, ${excluded} excluded` },
      });
      return { recount, excluded };
    });
    return { ...(await this.findOne(sessionId)), ...result };
  }

  async cancel(sessionId: string, userId: string, scope?: ScopePrincipal) {
    await this.sessionScope(sessionId, scope);
    const claimed = await this.prisma.cycleCountSession.updateMany({
      where: { id: sessionId, status: { in: ACTIVE } },
      data: { status: CycleCountStatus.CANCELLED, closedById: userId, closedAt: new Date() },
    });
    if (claimed.count === 0) {
      const exists = await this.prisma.cycleCountSession.findUnique({ where: { id: sessionId }, select: { status: true } });
      if (!exists) throw new NotFoundException('CycleCountSession not found');
      throw new ConflictException(`Session is ${exists.status} and cannot be cancelled`);
    }
    await this.prisma.auditLog.create({ data: { userId, action: 'CYCLE_COUNT_CANCELLED', entityType: 'CycleCountSession', entityId: sessionId, detail: 'stock lock released' } });
    return { cancelled: true };
  }

  /**
   * Cycle-count compliance per warehouse from the `cycleCount.frequency`
   * setting: due date = last approved count + period; never counted = due now.
   * Computed on read — no jobs or sessions are created, so nothing can duplicate.
   */
  async schedule(scope?: ScopePrincipal, now = new Date()) {
    const frequency = await this.settings.cycleCountFrequency();
    const wh = warehouseFilter(scope);
    const warehouses = await this.prisma.warehouse.findMany({
      where: { isDeleted: false, isActive: true, ...(wh ? { id: wh } : {}) },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
    const ids = warehouses.map((w) => w.id);
    const [last, active] = await Promise.all([
      this.prisma.cycleCountSession.groupBy({ by: ['warehouseId'], where: { warehouseId: { in: ids }, status: CycleCountStatus.APPROVED }, _max: { closedAt: true } }),
      this.prisma.cycleCountSession.findMany({ where: { warehouseId: { in: ids }, status: { in: ACTIVE } }, select: { warehouseId: true, refNumber: true } }),
    ]);
    const lastBy = new Map(last.map((l) => [l.warehouseId, l._max.closedAt]));
    const activeBy = new Map(active.map((a) => [a.warehouseId, a.refNumber]));
    const period = frequency ? PERIOD_DAYS[frequency] : null;
    return {
      frequency,
      periodDays: period,
      warehouses: warehouses.map((w) => {
        const lastAt = lastBy.get(w.id) ?? null;
        const dueAt = period ? (lastAt ? new Date(lastAt.getTime() + period * 86_400_000) : now) : null;
        const status = !period ? 'not_scheduled'
          : activeBy.has(w.id) ? 'in_progress'
          : dueAt! <= now ? (lastAt ? 'overdue' : 'due')
          : 'ok';
        return { ...w, lastApprovedAt: lastAt, dueAt, status, activeCount: activeBy.get(w.id) ?? null };
      }),
    };
  }
}
