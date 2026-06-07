import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RequestStatus, StockStatus, RTVStatus } from '@prisma/client';
import { nanoid } from 'nanoid';
import { resolveShippedUnits } from '../common/shipped-unit-resolver';

@Injectable()
export class UnusedService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
  ) {}

  // Requests with items flagged UNUSED / WRONG_ITEM awaiting warehouse verification
  pending() {
    return this.prisma.withdrawalRequest.findMany({
      where: {
        status: RequestStatus.ISSUED_TO_RMA,
        items: { some: { usageStatus: { in: ['UNUSED', 'WRONG_ITEM'] } } },
      },
      include: {
        requester: { select: { fullName: true } },
        items: { include: { product: true, stockItem: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  // Verify returned goods and put them back to available stock
  async returnToStock(requestId: string, userId: string) {
    const req = await this.prisma.withdrawalRequest.findUnique({
      where: { id: requestId },
      include: { items: true },
    });
    if (!req) throw new NotFoundException('Request not found');

    // C2: target the actually-shipped unit, not the approval-time link.
    const shipped = await resolveShippedUnits(this.prisma, requestId, req.items);

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const it of req.items) {
        const sid = shipped.get(it.id);
        if (sid) {
          await tx.stockItem.update({ where: { id: sid }, data: { status: StockStatus.AVAILABLE } });
        }
      }
      const result = await tx.withdrawalRequest.update({
        where: { id: requestId },
        data: { status: RequestStatus.COMPLETED, notes: 'Unused goods returned to stock', version: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: { userId, action: 'UNUSED_RETURNED_TO_STOCK', entityType: 'WithdrawalRequest', entityId: requestId, detail: req.refNumber },
      });
      return result;
    });
    this.realtime.emitInventoryUpdate({ action: 'unused_returned', requestId });
    return updated;
  }

  // Returned goods found defective -> route to RTV instead
  async markDoa(requestId: string, userId: string) {
    const req = await this.prisma.withdrawalRequest.findUnique({
      where: { id: requestId },
      include: { items: true },
    });
    if (!req) throw new NotFoundException('Request not found');

    // C2: target the actually-shipped unit, not the approval-time link.
    const shipped = await resolveShippedUnits(this.prisma, requestId, req.items);

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const it of req.items) {
        const sid = shipped.get(it.id);
        if (sid) {
          await tx.stockItem.update({ where: { id: sid }, data: { status: StockStatus.RTV_PENDING } });
          await tx.rTVCase.create({
            data: {
              refNumber: `RTV-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`,
              stockItemId: sid,
              reason: 'doa',
              description: `DOA found during unused return verification (${req.refNumber})`,
              status: RTVStatus.RTV_REQUIRED,
              rtvOfficerId: userId,
            },
          });
        }
      }
      const result = await tx.withdrawalRequest.update({
        where: { id: requestId },
        data: { status: RequestStatus.COMPLETED, notes: 'Unused return found defective — routed to RTV', version: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: { userId, action: 'UNUSED_MARKED_DOA', entityType: 'WithdrawalRequest', entityId: requestId, detail: req.refNumber },
      });
      return result;
    });
    this.realtime.emitInventoryUpdate({ action: 'unused_doa', requestId });
    return updated;
  }
}
