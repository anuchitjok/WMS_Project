import { Injectable, NotFoundException, ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { Prisma, RequestStatus, RTVStatus, StockStatus } from '@prisma/client';
import { nanoid } from 'nanoid';
import { transitionStock } from '../common/stock-state';
import { IssuedUnit, RETURNABLE_USAGES, issuedUnitsOf } from '../common/issued-units';
import { ACCESS, AccessPrincipal, hasAccess } from '../auth/access';
import type { UsageValue } from './dto/confirm-usage.dto';

const USAGE_PENDING_STATUSES: RequestStatus[] = [RequestStatus.ISSUED_TO_RMA, RequestStatus.SHIPPED, RequestStatus.READY_FOR_PICKUP];
/** Issued units — PICKED/RESERVED cover requests handed over before goods issue was enforced. */
const ISSUED_UNIT_STATUSES: StockStatus[] = [StockStatus.SHIPPED, StockStatus.ISSUED_TO_RMA, StockStatus.PICKED, StockStatus.RESERVED];

type Principal = AccessPrincipal & { id: string };

@Injectable()
export class RmaService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
  ) {}

  /**
   * Requests awaiting usage confirmation. A requester sees their own requests;
   * people who may confirm on behalf of others see all of them.
   */
  pendingUsage(user?: Principal) {
    const own = user && !hasAccess(user, ACCESS.rmaUsageOnBehalf) ? { requesterId: user.id } : {};
    return this.prisma.withdrawalRequest.findMany({
      where: { status: { in: USAGE_PENDING_STATUSES }, ...own },
      include: {
        requester: { select: { fullName: true } },
        items: { include: { product: true, stockItem: true } },
        unitUsages: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** Every unit issued on the request and what has been recorded for it so far. */
  async issuedUnits(requestId: string, user: Principal) {
    const req = await this.loadForUsage(requestId, user, false);
    const units = await issuedUnitsOf(this.prisma, requestId, req.items);
    const [stock, rows] = await Promise.all([
      this.prisma.stockItem.findMany({ where: { id: { in: units.map((u) => u.stockItemId) } }, select: { id: true, serialNumber: true, batchNumber: true, status: true, product: { select: { code: true, name: true, unit: true } } } }),
      this.prisma.issuedUnitUsage.findMany({ where: { requestId } }),
    ]);
    const byId = new Map(stock.map((s) => [s.id, s]));
    const recorded = new Map(rows.map((r) => [r.stockItemId, r]));
    const legacyUsage = rows.length === 0 ? req.items.find((i) => i.usageStatus)?.usageStatus ?? null : null;
    return {
      refNumber: req.refNumber,
      status: req.status,
      units: units.map((u) => {
        const s = byId.get(u.stockItemId);
        const r = recorded.get(u.stockItemId);
        return {
          ...u,
          serialNumber: s?.serialNumber ?? null, batchNumber: s?.batchNumber ?? null, stockStatus: s?.status ?? null,
          productCode: s?.product.code ?? null, productName: s?.product.name ?? null, unit: s?.product.unit ?? null,
          usage: r?.usage ?? legacyUsage, returnStatus: r?.returnStatus ?? null, recordedAt: r?.recordedAt ?? null,
        };
      }),
    };
  }

  private async loadForUsage(requestId: string, user: Principal, mustBePending = true) {
    const req = await this.prisma.withdrawalRequest.findUnique({ where: { id: requestId }, include: { items: true } });
    if (!req) throw new NotFoundException('Request not found');
    if (req.requesterId !== user.id && !hasAccess(user, ACCESS.rmaUsageOnBehalf)) {
      throw new ForbiddenException('You can only confirm usage for your own requests');
    }
    if (mustBePending && !USAGE_PENDING_STATUSES.includes(req.status)) {
      throw new ConflictException(`Usage can only be confirmed for issued goods (current: ${req.status})`);
    }
    return req;
  }

  /**
   * Records what happened to issued goods. `usage` alone covers every unit not
   * yet recorded (whole request); `units` records the listed units only, so a
   * request can be partly used and partly returned. Each unit is recorded once.
   *
   * USED → stock CONSUMED. DOA / DEFECTIVE → stock RTV_PENDING + an RTV case.
   * UNUSED / WRONG_ITEM → stock stays issued; the warehouse must physically
   * receive it back (Returns) before it goes through putaway to Available.
   */
  async confirmUsage(
    requestId: string,
    input: { usage?: UsageValue; units?: { stockItemId: string; usage: UsageValue; notes?: string }[]; notes?: string },
    user: Principal,
  ) {
    const userId = user.id;
    const req = await this.loadForUsage(requestId, user);
    if (!input.usage && !input.units?.length) throw new BadRequestException('Give a usage for the request or for each unit');
    if (input.usage && input.units?.length) throw new BadRequestException('Give either a usage for the whole request or per-unit usages, not both');

    const issued = await issuedUnitsOf(this.prisma, requestId, req.items);
    if (!issued.length) throw new ConflictException('No issued units were found for this request');
    const issuedById = new Map(issued.map((u) => [u.stockItemId, u]));

    const updated = await this.prisma.$transaction(async (tx) => {
      // Requests confirmed before per-unit usage existed keep their single answer.
      const existing = await tx.issuedUnitUsage.findMany({ where: { requestId }, select: { stockItemId: true, usage: true } });
      if (!existing.length && req.items.some((i) => i.usageStatus)) {
        throw new ConflictException('Usage has already been confirmed for this request');
      }
      const done = new Set(existing.map((e) => e.stockItemId));

      let targets: { unit: IssuedUnit; usage: UsageValue; notes?: string }[];
      if (input.units?.length) {
        const seen = new Set<string>();
        targets = input.units.map((u) => {
          const unit = issuedById.get(u.stockItemId);
          if (!unit) throw new BadRequestException(`Unit ${u.stockItemId} was not issued on ${req.refNumber}`);
          if (seen.has(u.stockItemId)) throw new BadRequestException(`Unit ${u.stockItemId} is listed twice`);
          seen.add(u.stockItemId);
          if (done.has(u.stockItemId)) throw new ConflictException(`Usage has already been recorded for unit ${u.stockItemId}`);
          return { unit, usage: u.usage, notes: u.notes ?? input.notes };
        });
      } else {
        const open = issued.filter((u) => !done.has(u.stockItemId));
        if (!open.length) throw new ConflictException('Usage has already been confirmed for this request');
        targets = open.map((unit) => ({ unit, usage: input.usage!, notes: input.notes }));
      }

      for (const t of targets) {
        try {
          await tx.issuedUnitUsage.create({
            data: {
              requestId, requestItemId: t.unit.requestItemId, stockItemId: t.unit.stockItemId, quantity: t.unit.quantity,
              usage: t.usage, notes: t.notes, recordedById: userId,
              returnStatus: RETURNABLE_USAGES.includes(t.usage) ? 'PENDING' : null,
            },
          });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            throw new ConflictException(`Usage has already been recorded for unit ${t.unit.stockItemId}`);
          }
          throw e;
        }
        if (t.usage === 'USED') {
          await transitionStock(tx, t.unit.stockItemId, ISSUED_UNIT_STATUSES, StockStatus.CONSUMED);
        } else if (t.usage === 'DOA' || t.usage === 'DEFECTIVE') {
          await transitionStock(tx, t.unit.stockItemId, ISSUED_UNIT_STATUSES, StockStatus.RTV_PENDING);
          await tx.rTVCase.create({
            data: {
              refNumber: `RTV-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`,
              stockItemId: t.unit.stockItemId,
              reason: t.usage === 'DOA' ? 'doa' : 'defective',
              description: t.notes ?? `${t.usage} reported during RMA usage (${req.refNumber})`,
              status: RTVStatus.RTV_REQUIRED,
              rtvOfficerId: userId,
            },
          });
        }
      }

      // Line summary: one usage when all its units agree, MIXED when they differ.
      const rows = await tx.issuedUnitUsage.findMany({ where: { requestId } });
      for (const line of req.items) {
        const lineUnits = issued.filter((u) => u.requestItemId === line.id);
        if (!lineUnits.length) continue;
        const usages = lineUnits.map((u) => rows.find((r) => r.stockItemId === u.stockItemId)?.usage);
        if (usages.some((u) => !u)) continue;
        const summary = new Set(usages).size === 1 ? usages[0]! : 'MIXED';
        await tx.withdrawalRequestItem.update({ where: { id: line.id }, data: { usageStatus: summary, usageNotes: input.notes ?? line.usageNotes } });
      }

      // All units recorded and all used → COMPLETED; anything else still needs follow-up.
      const allRecorded = issued.every((u) => rows.some((r) => r.stockItemId === u.stockItemId));
      const allUsed = rows.every((r) => r.usage === 'USED');
      const newStatus = allRecorded && allUsed ? RequestStatus.COMPLETED : RequestStatus.ISSUED_TO_RMA;
      const result = await tx.withdrawalRequest.update({ where: { id: requestId }, data: { status: newStatus } });

      const counts = new Map<string, number>();
      targets.forEach((t) => counts.set(t.usage, (counts.get(t.usage) ?? 0) + 1));
      const wholeRequest = !existing.length && allRecorded && counts.size === 1;
      await tx.auditLog.create({
        data: {
          userId, action: 'RMA_USAGE_CONFIRMED', entityType: 'WithdrawalRequest', entityId: requestId,
          // Keep the original "Usage: X" text when one answer covers the whole request.
          detail: wholeRequest ? `Usage: ${targets[0].usage}` : `Usage per unit — ${[...counts].map(([u, n]) => `${u} ${n}`).join(', ')}${allRecorded ? '' : ` (${issued.length - rows.length} unit(s) still open)`}`,
        },
      });
      return result;
    });

    this.realtime.emitRequestUpdate({ action: 'rma_usage', requestId, usage: input.usage ?? 'PER_UNIT' });
    return updated;
  }
}
