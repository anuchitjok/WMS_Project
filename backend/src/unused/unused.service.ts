import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RequestStatus, StockStatus, RTVStatus } from '@prisma/client';
import { nanoid } from 'nanoid';
import { resolveIssuedUnits } from '../common/shipped-unit-resolver';
import { transitionStock } from '../common/stock-state';

const RETURNABLE_USAGE = ['UNUSED', 'WRONG_ITEM'];
/** Issued units — PICKED/RESERVED cover requests handed over before goods issue was enforced. */
const ISSUED_UNIT_STATUSES: StockStatus[] = [StockStatus.SHIPPED, StockStatus.ISSUED_TO_RMA, StockStatus.PICKED, StockStatus.RESERVED];

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

  /** A request whose issued goods were flagged UNUSED / WRONG_ITEM and are awaiting verification. */
  private async loadReturnable(requestId: string) {
    const req = await this.prisma.withdrawalRequest.findUnique({
      where: { id: requestId },
      include: { items: true },
    });
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== RequestStatus.ISSUED_TO_RMA) {
      throw new BadRequestException(`Request is ${req.status}; only issued requests can be returned`);
    }
    const lines = req.items.filter((i) => i.usageStatus && RETURNABLE_USAGE.includes(i.usageStatus));
    if (lines.length === 0) throw new BadRequestException('No items on this request are flagged as unused or wrong item');
    return { req, lines };
  }

  /** Claims the request (ISSUED_TO_RMA → COMPLETED) so a return can only be processed once. */
  private async claim(tx: any, requestId: string, notes: string) {
    const claimed = await tx.withdrawalRequest.updateMany({
      where: { id: requestId, status: RequestStatus.ISSUED_TO_RMA },
      data: { status: RequestStatus.COMPLETED, notes, version: { increment: 1 } },
    });
    if (claimed.count === 0) throw new ConflictException('This return has already been processed');
  }

  // Verify returned goods and put them back to available stock
  async returnToStock(requestId: string, userId: string) {
    const { req, lines } = await this.loadReturnable(requestId);
    const units = await resolveIssuedUnits(this.prisma, requestId, lines);

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.claim(tx, requestId, 'Unused goods returned to stock');
      // Only units that actually left the warehouse can come back.
      for (const sid of units) {
        await transitionStock(tx, sid, ISSUED_UNIT_STATUSES, StockStatus.AVAILABLE);
      }
      await tx.auditLog.create({
        data: { userId, action: 'UNUSED_RETURNED_TO_STOCK', entityType: 'WithdrawalRequest', entityId: requestId, detail: `${req.refNumber} (${units.length} unit(s))` },
      });
      return tx.withdrawalRequest.findUniqueOrThrow({ where: { id: requestId } });
    });
    this.realtime.emitInventoryUpdate({ action: 'unused_returned', requestId });
    return updated;
  }

  // Returned goods found defective -> route to RTV instead
  async markDoa(requestId: string, userId: string) {
    const { req, lines } = await this.loadReturnable(requestId);
    const units = await resolveIssuedUnits(this.prisma, requestId, lines);

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.claim(tx, requestId, 'Unused return found defective — routed to RTV');
      for (const sid of units) {
        await transitionStock(tx, sid, ISSUED_UNIT_STATUSES, StockStatus.RTV_PENDING);
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
      await tx.auditLog.create({
        data: { userId, action: 'UNUSED_MARKED_DOA', entityType: 'WithdrawalRequest', entityId: requestId, detail: req.refNumber },
      });
      return tx.withdrawalRequest.findUniqueOrThrow({ where: { id: requestId } });
    });
    this.realtime.emitInventoryUpdate({ action: 'unused_doa', requestId });
    return updated;
  }
}
