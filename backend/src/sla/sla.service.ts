import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RequestStatus } from '@prisma/client';

@Injectable()
export class SlaService {
  private readonly logger = new Logger('SLA');

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // ── Run every 30 minutes ──────────────────────────────────────────────────
  @Cron(CronExpression.EVERY_30_MINUTES)
  async checkSlaOverdue() {
    this.logger.log('Running SLA overdue check…');
    await Promise.all([
      this.checkPendingApprovals(),
      this.checkPickingOverdue(),
      this.checkReadyForPickupOverdue(),
      this.checkUsageConfirmationOverdue(),
      this.checkRtvOverdue(),
    ]);
  }

  // ── Low stock check — every hour ─────────────────────────────────────────
  @Cron(CronExpression.EVERY_HOUR)
  async checkLowStock() {
    const products = await this.prisma.product.findMany({
      where: { isActive: true, minStock: { gt: 0 } },
      include: { _count: { select: { stockItems: true } } },
    });
    for (const p of products) {
      if (p._count.stockItems <= p.minStock) {
        await this.notifications.notifyLowStock(p.code, p.name, p._count.stockItems, p.minStock);
      }
    }
  }

  private async checkPendingApprovals() {
    const slaHours = 4; // SOP §13: 4 working hours for normal request
    const cutoff = new Date(Date.now() - slaHours * 60 * 60 * 1000);
    const overdue = await this.prisma.withdrawalRequest.findMany({
      where: { status: { in: [RequestStatus.SUBMITTED, RequestStatus.PENDING_APPROVAL] }, updatedAt: { lt: cutoff } },
    });
    for (const r of overdue) {
      const hours = (Date.now() - r.updatedAt.getTime()) / 3600000;
      await this.notifications.notifySlaOverdue('WithdrawalRequest', r.id, r.refNumber, hours);
    }
    if (overdue.length) this.logger.warn(`${overdue.length} requests pending approval overdue`);
  }

  private async checkPickingOverdue() {
    const slaHours = 8; // 1 working day
    const cutoff = new Date(Date.now() - slaHours * 60 * 60 * 1000);
    const overdue = await this.prisma.withdrawalRequest.findMany({
      where: { status: RequestStatus.APPROVED, updatedAt: { lt: cutoff } },
    });
    for (const r of overdue) {
      const hours = (Date.now() - r.updatedAt.getTime()) / 3600000;
      await this.notifications.notifySlaOverdue('Picking', r.id, r.refNumber, hours);
    }
  }

  private async checkReadyForPickupOverdue() {
    const slaHours = 16; // 2 working days
    const cutoff = new Date(Date.now() - slaHours * 60 * 60 * 1000);
    const overdue = await this.prisma.withdrawalRequest.findMany({
      where: { status: RequestStatus.READY_FOR_PICKUP, updatedAt: { lt: cutoff } },
      select: { id: true, refNumber: true, updatedAt: true, requesterId: true },
    });
    for (const r of overdue) {
      await this.notifications.notifyReadyForPickup(r.requesterId, r.refNumber);
    }
  }

  private async checkUsageConfirmationOverdue() {
    const slaHours = 16; // 2 working days
    const cutoff = new Date(Date.now() - slaHours * 60 * 60 * 1000);
    const overdue = await this.prisma.withdrawalRequest.findMany({
      where: { status: RequestStatus.ISSUED_TO_RMA, updatedAt: { lt: cutoff } },
      select: { id: true, refNumber: true, requesterId: true, updatedAt: true },
    });
    for (const r of overdue) {
      await this.notifications.notifyUsageRequired(r.requesterId, r.refNumber);
    }
  }

  private async checkRtvOverdue() {
    const slaHours = 48; // SOP §13: RTV review within 2 working days
    const cutoff = new Date(Date.now() - slaHours * 60 * 60 * 1000);
    const overdue = await this.prisma.rTVCase.findMany({
      where: { status: { in: ['RTV_REQUIRED', 'PENDING_REVIEW'] as any }, updatedAt: { lt: cutoff } },
    });
    for (const c of overdue) {
      const hours = (Date.now() - c.updatedAt.getTime()) / 3600000;
      await this.notifications.notifySlaOverdue('RTVCase', c.id, c.refNumber, hours);
    }
    if (overdue.length) this.logger.warn(`${overdue.length} RTV cases overdue`);
  }

  // Manual trigger (for testing / admin action)
  async runNow() {
    await this.checkSlaOverdue();
    await this.checkLowStock();
    return { message: 'SLA check completed' };
  }
}
