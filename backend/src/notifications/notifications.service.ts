import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationChannel } from '@prisma/client';
import {
  DEFAULT_TEMPLATES, NOTIFICATION_TYPES, TEMPLATE_VARIABLES, TemplateInput,
  escapeHtml, missingSmtpSettings, renderTemplate, validateTemplate,
} from './notification-templates';

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

// Built-in templates and variables live in notification-templates.ts; admin
// overrides are rows in NotificationTemplate (see listTemplates/saveTemplate).

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
  /** Active admin override for a type, else the built-in default. */
  private async templateFor(type: NotificationType) {
    const row = await this.prisma.notificationTemplate.findUnique({ where: { type } }).catch(() => null);
    const def = DEFAULT_TEMPLATES[type];
    if (row && row.isActive) {
      return { title: row.title, body: row.body, emailSubject: row.emailSubject || def.emailSubject, emailBody: row.emailBody, custom: true };
    }
    return { ...def, emailBody: null as string | null, custom: false };
  }

  async send(payload: NotifyPayload): Promise<void> {
    const t = await this.templateFor(payload.type);
    const baseVars: Record<string, unknown> = { ...(payload.metadata ?? {}), title: payload.title, message: payload.message, name: '' };
    // A custom template defines the wording; otherwise the caller's title/message are used as before.
    const tpl = {
      title: t.custom ? renderTemplate(t.title, baseVars) : (payload.title || t.title),
      message: t.custom ? renderTemplate(t.body, baseVars) : payload.message,
      emailSubject: renderTemplate(t.emailSubject, baseVars),
    };
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
        title: tpl.title,
        message: tpl.message,
        channel,
        entityType: payload.entityType,
        entityId: payload.entityId,
        metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
      })),
    });

    // Push realtime to each connected user
    targetIds.forEach((userId) => {
      this.realtime.emitToUser(userId, 'notification:new', {
        type: payload.type,
        title: tpl.title,
        message: tpl.message,
        entityType: payload.entityType,
        entityId: payload.entityId,
      });
    });
    // Also broadcast to a general notifications room for dashboard refresh
    this.realtime.emitToAuthenticated('notification:broadcast', { type: payload.type });

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
            html: t.emailBody
              ? this.wrapEmail(escapeHtml(renderTemplate(t.emailBody, { ...baseVars, name: user.fullName })).split('\n').join('<br>'))
              : this.renderEmail(user.fullName, tpl.title, tpl.message, payload.metadata),
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

  // Every interpolated value is HTML-escaped: titles, messages and metadata can carry user input.
  private renderEmail(name: string, title: string, message: string, meta?: Record<string, unknown>): string {
    const extras = meta ? Object.entries(meta).map(([k, v]) => `<tr><td style="color:#888">${escapeHtml(k)}</td><td><b>${escapeHtml(v)}</b></td></tr>`).join('') : '';
    return this.wrapEmail(`
          <h3 style="color:#0f172a">${escapeHtml(title)}</h3>
          <p style="color:#475569">${escapeHtml(message)}</p>
          ${extras ? `<table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:13px">${extras}</table>` : ''}`);
  }

  private wrapEmail(inner: string): string {
    return `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;background:#f8fafc">
        <div style="background:#0f766e;color:#fff;padding:18px 24px;border-radius:8px 8px 0 0">
          <h2 style="margin:0">HSNT WMS</h2>
        </div>
        <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
          ${inner}
          <hr style="margin:20px 0;border:none;border-top:1px solid #e2e8f0">
          <p style="color:#94a3b8;font-size:12px">HSNT WMS — Do not reply to this email.</p>
        </div>
      </div>`;
  }

  // ── Template administration ───────────────────────────────────────────────
  async listTemplates() {
    const rows = await this.prisma.notificationTemplate.findMany();
    const byType = new Map(rows.map((r) => [r.type, r]));
    return NOTIFICATION_TYPES.map((type) => {
      const row = byType.get(type);
      return {
        type,
        variables: TEMPLATE_VARIABLES[type],
        default: DEFAULT_TEMPLATES[type],
        custom: row ? { title: row.title, body: row.body, emailSubject: row.emailSubject, emailBody: row.emailBody, isActive: row.isActive, updatedAt: row.updatedAt } : null,
      };
    });
  }

  async saveTemplate(type: string, dto: TemplateInput, userId: string) {
    const v = validateTemplate(type, dto);
    const row = await this.prisma.notificationTemplate.upsert({
      where: { type: v.type },
      update: { title: v.title, body: v.body, emailSubject: v.emailSubject, emailBody: v.emailBody, isActive: v.isActive },
      create: { type: v.type, title: v.title, body: v.body, emailSubject: v.emailSubject, emailBody: v.emailBody, isActive: v.isActive },
    });
    await this.prisma.auditLog.create({ data: { userId, action: 'NOTIFICATION_TEMPLATE_SAVED', entityType: 'NotificationTemplate', entityId: row.id, detail: v.type } });
    return row;
  }

  async resetTemplate(type: string, userId: string) {
    if (!(NOTIFICATION_TYPES as readonly string[]).includes(type)) throw new BadRequestException(`Unknown notification type: ${type}`);
    const res = await this.prisma.notificationTemplate.deleteMany({ where: { type } });
    await this.prisma.auditLog.create({ data: { userId, action: 'NOTIFICATION_TEMPLATE_RESET', entityType: 'NotificationTemplate', entityId: type, detail: `${type} back to default` } });
    return { reset: res.count > 0 };
  }

  /** Whether email can be delivered, naming any missing settings — never their values. */
  deliveryStatus() {
    const missing = missingSmtpSettings((k) => this.config.get(k));
    return {
      inApp: { enabled: true },
      email: {
        configured: missing.length === 0 && !!this.mailer,
        missing,
        from: missing.length === 0 ? (this.config.get('SMTP_FROM') ? 'configured' : 'default (noreply@hsnt-wms.com)') : null,
        hint: missing.length ? `Email is off. Set ${missing.join(', ')} in the server environment and restart the API.` : null,
      },
    };
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
