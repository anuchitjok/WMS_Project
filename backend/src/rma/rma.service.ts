import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RequestStatus, RTVStatus, StockStatus } from '@prisma/client';
import { nanoid } from 'nanoid';
import { resolveShippedUnits } from '../common/shipped-unit-resolver';

type Usage = 'USED' | 'DOA' | 'DEFECTIVE' | 'WRONG_ITEM' | 'UNUSED';

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

  async confirmUsage(requestId: string, usage: Usage, notes: string | undefined, userId: string) {
    const req = await this.prisma.withdrawalRequest.findUnique({
      where: { id: requestId },
      include: { items: true },
    });
    if (!req) throw new NotFoundException('Request not found');

    let newStatus: RequestStatus = req.status;
    if (usage === 'USED') newStatus = RequestStatus.COMPLETED;
    else newStatus = RequestStatus.ISSUED_TO_RMA;

    // C2: resolve the unit that was actually shipped/picked for each line.
    const shipped = await resolveShippedUnits(this.prisma, requestId, req.items);

    // All stock changes + RTV creation + status update are atomic
    const updated = await this.prisma.$transaction(async (tx) => {
      if (usage === 'USED') {
        for (const it of req.items) {
          const sid = shipped.get(it.id);
          if (sid) {
            await tx.stockItem.update({ where: { id: sid }, data: { status: StockStatus.CONSUMED } });
          }
        }
      } else if (usage === 'DOA' || usage === 'DEFECTIVE') {
        for (const it of req.items) {
          const sid = shipped.get(it.id);
          if (sid) {
            await tx.stockItem.update({ where: { id: sid }, data: { status: StockStatus.RTV_PENDING } });
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
      }

      await tx.withdrawalRequestItem.updateMany({
        where: { requestId },
        data: { usageStatus: usage, usageNotes: notes },
      });
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
