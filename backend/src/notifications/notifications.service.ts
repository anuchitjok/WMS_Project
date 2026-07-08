import { Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationChannel } from '@prisma/client';

export type NotificationType =
  | 'REQUEST_SUBMITTED' | 'REQUEST_APPROVED' | 'REQUEST_REJECTED'
  | 'PICKING_TASK' | 'READY_FOR_PICKUP' | 'USAGE_REQUIRED'
  | 'DOA_DECLARED' | 'RTV_OVERDUE' | 'UNUSED_RETURN'
  | 'LOW_STOCK' | 'SLA_OVERDUE' | 'GENERAL';

export interface NotifyPayload {
  type: NotificationType;
  userIds: string[];        // target users (empty = skip)
  roleKeys?: string[];      // target by role instead (or in addition)
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  channel?: NotificationChannel;
}

const DEFAULT_TEMPLATES: Record<NotificationType, { title: string; emailSubject: string }> = {
  REQUEST_SUBMITTED:  { title: '📋 New Withdrawal Request', emailSubject: '[WMS] Request submitted — action required' },
  REQUEST_APPROVED:   { title: '✅ Request Approved', emailSubject: '[WMS] Your request has been approved' },
  REQUEST_REJECTED:   { title: '❌ Request Rejected', emailSubject: '[WMS] Your request was rejected' },
  PICKING_TASK:       { title: '📦 Picking Task Assigned', emailSubject: '[WMS] New picking task for you' },
  READY_FOR_PICKUP:   { title: '🚚 Ready for Pickup', emailSubject: '[WMS] Your goods are ready for pickup' },
  USAGE_REQUIRED:     { title: '🔔 Usage Confirmation Required', emailSubject: '[WMS] Please confirm RMA usage result' },
  DOA_DECLARED:       { title: '⚠️ DOA Item Declared', emailSubject: '[WMS] DOA item requires RTV review' },
  RTV_OVERDUE:        { title: '⏱ RTV Case Overdue', emailSubject: '[WMS] RTV case SLA exceeded' },
  UNUSED_RETURN:      { title: '🔁 Unused Return Submitted', emailSubject: '[WMS] Unused goods return pending verification' },
  LOW_STOCK:          { title: '↓ Low Stock Alert', emailSubject: '[WMS] Stock below minimum threshold' },
  SLA_OVERDUE:        { title: '⏰ SLA Overdue', emailSubject: '[WMS] Workflow SLA has been exceeded' },
  GENERAL:            { title: '💬 System Notification', emailSubject: '[WMS] Notification' },
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');
  private mailer: Transporter | null = null;

  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
    private config: ConfigService,
  ) {
    this.initMailer();
  }

  private initMailer() {
    const host = this.config.get('SMTP_HOST');
    if (!host) { this.logger.warn('SMTP not configured — email notifications disabled'); return; }
    this.mailer = createTransport({
      host,
      port: Number(this.config.get('SMTP_PORT') ?? 587),
      secure: this.config.get('SMTP_SECURE') === 'true',
      auth: { user: this.config.get('SMTP_USER'), pass: this.config.get('SMTP_PASS') },
    });
  }

  // ── Core send method ────────────────────────────────────────────────────────
  async send(payload: NotifyPayload): Promise<void> {
    const tpl = DEFAULT_TEMPLATES[payload.type];
    const channel = payload.channel ?? NotificationChannel.IN_APP;
    let targetIds = [...payload.userIds];

    // Resolve role-based targets
    if (payload.roleKeys?.length) {
      const byRole = await this.prisma.user.findMany({
        where: { isActive: true, deletedAt: null, rbacRole: { key: { in: payload.roleKeys } } },
        select: { id: true },
      });
      targetIds = [...new Set([...targetIds, ...byRole.map((u) => u.id)])];
    }

    if (!targetIds.length) { this.logger.warn(`Notification ${payload.type} has no targets`); return; }

    // Create in-app records in bulk
    await this.prisma.notification.createMany({
      data: targetIds.map((userId) => ({
        userId,
        type: payload.type,
        title: payload.title || tpl.title,
        message: payload.message,
        channel,
        entityType: payload.entityType,
        entityId: payload.entityId,
        metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
      })),
    });

    // Push realtime to each connected user
    targetIds.forEach((userId) => {
      (this.realtime.server as any)?.to?.(`user:${userId}`)?.emit('notification:new', {
        type: payload.type,
        title: payload.title || tpl.title,
        message: payload.message,
        entityType: payload.entityType,
        entityId: payload.entityId,
      });
    });
    // Also broadcast to a general notifications room for dashboard refresh
    (this.realtime.server as any)?.emit?.('notification:broadcast', { type: payload.type });

    // Send email if configured
    if (channel !== NotificationChannel.IN_APP && this.mailer) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: targetIds }, email: { not: null } },
        select: { id: true, email: true, fullName: true },
      });
      for (const user of users) {
        if (!user.email) continue;
        try {
          await this.mailer.sendMail({
            from: this.config.get('SMTP_FROM') ?? 'noreply@hsnt-wms.com',
            to: user.email,
            subject: tpl.emailSubject,
            html: this.renderEmail(user.fullName, payload.title || tpl.title, payload.message, payload.metadata),
          });
          await this.prisma.notification.updateMany({
            where: { userId: user.id, type: payload.type, emailSent: false },
            data: { emailSent: true, emailSentAt: new Date() },
          });
        } catch (err: any) {
          this.logger.error(`Email failed for ${user.email}: ${err.message}`);
        }
      }
    }

    await this.prisma.auditLog.create({
      data: {
        action: 'NOTIFICATION_SENT',
        entityType: payload.entityType,
        entityId: payload.entityId,
        detail: `${payload.type} → ${targetIds.length} users`,
      },
    });
  }

  private renderEmail(name: string, title: string, message: string, meta?: Record<string, unknown>): string {
    const extras = meta ? Object.entries(meta).map(([k, v]) => `<tr><td style="color:#888">${k}</td><td><b>${v}</b></td></tr>`).join('') : '';
    return `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;background:#f8fafc">
        <div style="background:#0f766e;color:#fff;padding:18px 24px;border-radius:8px 8px 0 0">
          <h2 style="margin:0">HSNT WMS</h2>
        </div>
        <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
          <h3 style="color:#0f172a">${title}</h3>
          <p style="color:#475569">${message}</p>
          ${extras ? `<table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:13px">${extras}</table>` : ''}
          <hr style="margin:20px 0;border:none;border-top:1px solid #e2e8f0">
          <p style="color:#94a3b8;font-size:12px">HSNT WMS — Do not reply to this email.</p>
        </div>
      </div>`;
  }

  // ── Convenience methods (domain-specific) ─────────────────────────────────

  async notifyRequestSubmitted(requestId: string, refNumber: string, department: string) {
    const approvers = await this.prisma.user.findMany({
      where: { isActive: true, deletedAt: null, role: { in: ['DEPT_APPROVER', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR', 'SYSTEM_ADMIN'] as any } },
      select: { id: true },
    });
    await this.send({ type: 'REQUEST_SUBMITTED', userIds: approvers.map((u) => u.id), title: `New Request from ${department}`, message: `Withdrawal request ${refNumber} submitted and awaiting approval.`, entityType: 'WithdrawalRequest', entityId: requestId, metadata: { refNumber, department }, channel: NotificationChannel.BOTH });
  }

  async notifyRequestDecision(requestId: string, requesterId: string, approved: boolean, reason?: string) {
    await this.send({ type: approved ? 'REQUEST_APPROVED' : 'REQUEST_REJECTED', userIds: [requesterId], title: approved ? 'Request Approved' : 'Request Rejected', message: approved ? 'Your withdrawal request has been approved and will be processed.' : `Your request was rejected. Reason: ${reason ?? 'See system'}`, entityType: 'WithdrawalRequest', entityId: requestId, channel: NotificationChannel.BOTH });
  }

  async notifyPickingTask(requestId: string, refNumber: string) {
    await this.send({ type: 'PICKING_TASK', userIds: [], roleKeys: ['SUPER_ADMIN', 'ADMIN', 'WAREHOUSE_MANAGER', 'PICKER'], title: 'Picking Task Ready', message: `Request ${refNumber} is approved and ready for allocation.`, entityType: 'WithdrawalRequest', entityId: requestId, metadata: { refNumber }, channel: NotificationChannel.IN_APP });
  }

  async notifyReadyForPickup(requesterId: string, refNumber: string) {
    await this.send({ type: 'READY_FOR_PICKUP', userIds: [requesterId], title: 'Goods Ready for Pickup', message: `Your request ${refNumber} is packed and ready for collection.`, channel: NotificationChannel.BOTH });
  }

  async notifyUsageRequired(requesterId: string, refNumber: string) {
    await this.send({ type: 'USAGE_REQUIRED', userIds: [requesterId], title: 'Usage Confirmation Required', message: `Please confirm the RMA usage result for request ${refNumber}.`, channel: NotificationChannel.BOTH });
  }

  async notifyDoaDeclared(stockItemId: string, productName: string) {
    await this.send({ type: 'DOA_DECLARED', userIds: [], roleKeys: ['RTV_OFFICER', 'WAREHOUSE_MANAGER'], title: 'DOA Item Declared', message: `Item ${productName} has been declared DOA and requires RTV review.`, entityType: 'StockItem', entityId: stockItemId, channel: NotificationChannel.BOTH });
  }

  async notifyLowStock(productCode: string, productName: string, onHand: number, minStock: number) {
    await this.send({ type: 'LOW_STOCK', userIds: [], roleKeys: ['WAREHOUSE_MANAGER', 'INVENTORY_CONTROL'], title: `Low Stock: ${productCode}`, message: `${productName} has ${onHand} units (minimum: ${minStock}).`, metadata: { productCode, onHand, minStock }, channel: NotificationChannel.IN_APP });
  }

  async notifySlaOverdue(entityType: string, entityId: string, refNumber: string, hoursPast: number) {
    await this.send({ type: 'SLA_OVERDUE', userIds: [], roleKeys: ['WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR'], title: `SLA Overdue: ${refNumber}`, message: `${entityType} ${refNumber} is ${Math.round(hoursPast)} hours overdue.`, entityType, entityId, channel: NotificationChannel.BOTH });
  }

  // ── Read operations ───────────────────────────────────────────────────────

  async getUserNotifications(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);
    return { data, total, unread, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async markRead(notificationId: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }
}
