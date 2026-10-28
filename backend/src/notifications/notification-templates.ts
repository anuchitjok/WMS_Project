import { BadRequestException } from '@nestjs/common';

/**
 * Notification template catalogue: built-in defaults plus the variables each
 * type may use. Admin edits are stored in NotificationTemplate (one row per
 * type) and override the defaults; deleting the row restores the default.
 */
export const NOTIFICATION_TYPES = [
  'REQUEST_SUBMITTED',
  'REQUEST_APPROVED',
  'REQUEST_REJECTED',
  'PICKING_TASK',
  'READY_FOR_PICKUP',
  'USAGE_REQUIRED',
  'DOA_DECLARED',
  'RTV_OVERDUE',
  'UNUSED_RETURN',
  'LOW_STOCK',
  'SLA_OVERDUE',
  'GENERAL',
] as const;
export type NotificationTypeKey = (typeof NOTIFICATION_TYPES)[number];

/** Always available: recipient name, the event's own title and message. */
const COMMON_VARS = ['name', 'title', 'message'];

export const TEMPLATE_VARIABLES: Record<NotificationTypeKey, string[]> = {
  REQUEST_SUBMITTED: [...COMMON_VARS, 'refNumber', 'department'],
  REQUEST_APPROVED: [...COMMON_VARS],
  REQUEST_REJECTED: [...COMMON_VARS],
  PICKING_TASK: [...COMMON_VARS, 'refNumber'],
  READY_FOR_PICKUP: [...COMMON_VARS],
  USAGE_REQUIRED: [...COMMON_VARS],
  DOA_DECLARED: [...COMMON_VARS],
  RTV_OVERDUE: [...COMMON_VARS],
  UNUSED_RETURN: [...COMMON_VARS],
  LOW_STOCK: [...COMMON_VARS, 'productCode', 'onHand', 'minStock'],
  SLA_OVERDUE: [...COMMON_VARS],
  GENERAL: [...COMMON_VARS],
};

export const DEFAULT_TEMPLATES: Record<
  NotificationTypeKey,
  { title: string; body: string; emailSubject: string }
> = {
  REQUEST_SUBMITTED: {
    title: '📋 New Withdrawal Request',
    body: '{{message}}',
    emailSubject: '[WMS] Request submitted — action required',
  },
  REQUEST_APPROVED: {
    title: '✅ Request Approved',
    body: '{{message}}',
    emailSubject: '[WMS] Your request has been approved',
  },
  REQUEST_REJECTED: {
    title: '❌ Request Rejected',
    body: '{{message}}',
    emailSubject: '[WMS] Your request was rejected',
  },
  PICKING_TASK: {
    title: '📦 Picking Task Assigned',
    body: '{{message}}',
    emailSubject: '[WMS] New picking task for you',
  },
  READY_FOR_PICKUP: {
    title: '🚚 Ready for Pickup',
    body: '{{message}}',
    emailSubject: '[WMS] Your goods are ready for pickup',
  },
  USAGE_REQUIRED: {
    title: '🔔 Usage Confirmation Required',
    body: '{{message}}',
    emailSubject: '[WMS] Please confirm RMA usage result',
  },
  DOA_DECLARED: {
    title: '⚠️ DOA Item Declared',
    body: '{{message}}',
    emailSubject: '[WMS] DOA item requires RTV review',
  },
  RTV_OVERDUE: {
    title: '⏱ RTV Case Overdue',
    body: '{{message}}',
    emailSubject: '[WMS] RTV case SLA exceeded',
  },
  UNUSED_RETURN: {
    title: '🔁 Unused Return Submitted',
    body: '{{message}}',
    emailSubject: '[WMS] Unused goods return pending verification',
  },
  LOW_STOCK: {
    title: '↓ Low Stock Alert',
    body: '{{message}}',
    emailSubject: '[WMS] Stock below minimum threshold',
  },
  SLA_OVERDUE: {
    title: '⏰ SLA Overdue',
    body: '{{message}}',
    emailSubject: '[WMS] Workflow SLA has been exceeded',
  },
  GENERAL: {
    title: '💬 System Notification',
    body: '{{message}}',
    emailSubject: '[WMS] Notification',
  },
};

const VAR_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

/** Every {{var}} used in the text must be allowed for the type; braces must be balanced. */
export function validateTemplateText(
  type: NotificationTypeKey,
  field: string,
  text: string,
  errors: string[],
) {
  const allowed = TEMPLATE_VARIABLES[type];
  for (const m of text.matchAll(VAR_RE)) {
    if (!allowed.includes(m[1]))
      errors.push(
        `${field}: unknown variable {{${m[1]}}} (allowed: ${allowed.map((v) => `{{${v}}}`).join(', ')})`,
      );
  }
  const stripped = text.replace(VAR_RE, '');
  if (stripped.includes('{{') || stripped.includes('}}'))
    errors.push(`${field}: malformed placeholder — use {{variable}}`);
}

export interface TemplateInput {
  title?: string;
  body?: string;
  emailSubject?: string | null;
  emailBody?: string | null;
  isActive?: boolean;
}

export function validateTemplate(type: string, dto: TemplateInput) {
  if (!(NOTIFICATION_TYPES as readonly string[]).includes(type))
    throw new BadRequestException(`Unknown notification type: ${type}`);
  const t = type as NotificationTypeKey;
  const errors: string[] = [];
  const req = (v: unknown, field: string, max: number) => {
    if (typeof v !== 'string' || !v.trim()) {
      errors.push(`${field} is required`);
      return '';
    }
    if (v.length > max)
      errors.push(`${field} must be at most ${max} characters`);
    return v.trim();
  };
  const opt = (v: unknown, field: string, max: number) => {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string') {
      errors.push(`${field} must be text`);
      return null;
    }
    if (v.length > max)
      errors.push(`${field} must be at most ${max} characters`);
    return v.trim();
  };
  const title = req(dto.title, 'Title', 150);
  const body = req(dto.body, 'Message', 2000);
  const emailSubject = opt(dto.emailSubject, 'Email subject', 200);
  const emailBody = opt(dto.emailBody, 'Email body', 5000);
  for (const [field, text] of [
    ['Title', title],
    ['Message', body],
    ['Email subject', emailSubject],
    ['Email body', emailBody],
  ] as const) {
    if (text) validateTemplateText(t, field, text, errors);
  }
  if (errors.length) throw new BadRequestException(errors);
  return {
    type: t,
    title,
    body,
    emailSubject,
    emailBody,
    isActive: dto.isActive ?? true,
  };
}

/** Fills {{vars}}; unknown or missing values render as empty text. */
export function renderTemplate(
  text: string,
  vars: Record<string, unknown>,
): string {
  return text.replace(VAR_RE, (_, k: string) =>
    vars[k] === undefined || vars[k] === null ? '' : String(vars[k]),
  );
}

export function escapeHtml(v: unknown): string {
  return String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] as string,
  );
}

/** Names of required SMTP settings that are missing — never their values. */
export function missingSmtpSettings(get: (k: string) => unknown): string[] {
  const missing: string[] = [];
  if (!get('SMTP_HOST')) missing.push('SMTP_HOST');
  // Credentials are optional for relays that allow unauthenticated sending, but must come as a pair.
  const user = !!get('SMTP_USER');
  const pass = !!get('SMTP_PASS');
  if (user !== pass) missing.push(user ? 'SMTP_PASS' : 'SMTP_USER');
  return missing;
}
