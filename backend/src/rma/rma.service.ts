import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RequestStatus, RTVStatus, StockStatus } from '@prisma/client';
import { nanoid } from 'nanoid';
import { resolveIssuedUnits } from '../common/shipped-unit-resolver';
import { transitionStock } from '../common/stock-state';
import { ACCESS, AccessPrincipal, hasAccess } from '../auth/access';

type Usage = 'USED' | 'DOA' | 'DEFECTIVE' | 'WRONG_ITEM' | 'UNUSED';

const USAGE_PENDING_STATUSES: RequestStatus[] = [RequestStatus.ISSUED_TO_RMA, RequestStatus.SHIPPED, RequestStatus.READY_FOR_PICKUP];
/** Issued units — PICKED/RESERVED cover requests handed over before goods issue was enforced. */
const ISSUED_UNIT_STATUSES: StockStatus[] = [StockStatus.SHIPPED, StockStatus.ISSUED_TO_RMA, StockStatus.PICKED, StockStatus.RESERVED];

@Injectable()
export class RmaService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
  ) {}

  // Requests awaiting usage confirmation (issued to RMA)
  pendingUsage() {
    return this.prisma.withdrawalRequest.findMany({
      where: {
        status: { in: [RequestStatus.ISSUED_TO_RMA, RequestStatus.SHIPPED, RequestStatus.READY_FOR_PICKUP] },
      },
      include: {
        requester: { select: { fullName: true } },
        items: { include: { product: true, stockItem: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async confirmUsage(requestId: string, usage: Usage, notes: string | undefined, user: AccessPrincipal & { id: string }) {
    const userId = user.id;
    const req = await this.prisma.withdrawalRequest.findUnique({
      where: { id: requestId },
      include: { items: true },
    });
    if (!req) throw new NotFoundException('Request not found');
    if (req.requesterId !== userId && !hasAccess(user, ACCESS.rmaUsageOnBehalf)) {
      throw new ForbiddenException('You can only confirm usage for your own requests');
    }
    if (!USAGE_PENDING_STATUSES.includes(req.status)) {
      throw new ConflictException(`Usage can only be confirmed for issued goods (current: ${req.status})`);
    }

    let newStatus: RequestStatus = req.status;
    if (usage === 'USED') newStatus = RequestStatus.COMPLETED;
    else newStatus = RequestStatus.ISSUED_TO_RMA;

    // C2: every unit actually issued for this request (a line may hold several).
    const units = await resolveIssuedUnits(this.prisma, requestId, req.items);

    // All stock changes + RTV creation + status update are atomic
    const updated = await this.prisma.$transaction(async (tx) => {
      // Claim the lines: usage is recorded once. A repeat would re-route consumed
      // units and open duplicate RTV cases.
      const claimed = await tx.withdrawalRequestItem.updateMany({
        where: { requestId, usageStatus: null },
        data: { usageStatus: usage, usageNotes: notes },
      });
      if (claimed.count !== req.items.length) throw new ConflictException('Usage has already been confirmed for this request');

      if (usage === 'USED') {
        for (const sid of units) {
          await transitionStock(tx, sid, ISSUED_UNIT_STATUSES, StockStatus.CONSUMED);
        }
      } else if (usage === 'DOA' || usage === 'DEFECTIVE') {
        for (const sid of units) {
          await transitionStock(tx, sid, ISSUED_UNIT_STATUSES, StockStatus.RTV_PENDING);
          await tx.rTVCase.create({
            data: {
              refNumber: `RTV-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`,
              stockItemId: sid,
              reason: usage === 'DOA' ? 'doa' : 'defective',
              description: notes ?? `${usage} reported during RMA usage (${req.refNumber})`,
              status: RTVStatus.RTV_REQUIRED,
              rtvOfficerId: userId,
            },
          });
        }
      }

      const result = await tx.withdrawalRequest.update({
        where: { id: requestId },
        data: { status: newStatus },
      });
      await tx.auditLog.create({
        data: { userId, action: 'RMA_USAGE_CONFIRMED', entityType: 'WithdrawalRequest', entityId: requestId, detail: `Usage: ${usage}` },
      });
      return result;
    });

    this.realtime.emitRequestUpdate({ action: 'rma_usage', requestId, usage });
    return updated;
  }
}
