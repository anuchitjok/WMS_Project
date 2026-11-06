// Pure rules for the request QR page (plan P5 5.3 / Q10). Kept free of Prisma so
// they are unit-tested directly.

export type ReceiptState = 'NOT_READY' | 'READY' | 'RECEIVED' | 'CANCELLED';

/** Task states in which the existing handover (issue to requester / RMA) is allowed. */
export const HANDOVER_READY_TASK_STATUSES = ['READY_TO_SHIP', 'SHIPPED', 'DELIVERED'] as const;

/**
 * Whether the requester can confirm receipt now. Mirrors HandoverService.issueToRma:
 * READY_TO_SHIP / SHIPPED / DELIVERED may be handed over; a CLOSED task (or a request
 * already ISSUED_TO_RMA / COMPLETED) has been received.
 */
export function receiptState(requestStatus: string, taskStatus: string | null | undefined): ReceiptState {
  if (requestStatus === 'CANCELLED' || requestStatus === 'REJECTED') return 'CANCELLED';
  if (taskStatus === 'CLOSED' || requestStatus === 'ISSUED_TO_RMA' || requestStatus === 'COMPLETED') return 'RECEIVED';
  if (taskStatus && (HANDOVER_READY_TASK_STATUSES as readonly string[]).includes(taskStatus)) return 'READY';
  return 'NOT_READY';
}

export type RefView = 'REQUESTER' | 'WAREHOUSE' | 'NONE';

/**
 * Who sees what. Warehouse staff (fulfillment access within their warehouse scope)
 * get the pick list; the requester who owns the request gets the receipt view.
 * A person who is both sees the warehouse view with the receipt action enabled.
 */
export function resolveRefView(p: { isOwner: boolean; isWarehouse: boolean }): {
  view: RefView; canReceive: boolean; canPick: boolean;
} {
  if (p.isWarehouse) return { view: 'WAREHOUSE', canReceive: p.isOwner, canPick: true };
  if (p.isOwner) return { view: 'REQUESTER', canReceive: true, canPick: false };
  return { view: 'NONE', canReceive: false, canPick: false };
}

export type ConfirmDecision =
  | { action: 'ALREADY_DONE' }
  | { action: 'REJECT'; reason: 'NOT_OWNER' | 'NOT_READY' | 'CANCELLED' | 'NO_TASK' | 'STALE' }
  | { action: 'HANDOVER' };

/**
 * Guard for "Confirm receipt": owner only, ready state only, optimistic lock on the
 * task version the page was showing, and a repeat press is a no-op (ALREADY_DONE).
 */
export function decideConfirm(p: {
  isOwner: boolean;
  requestStatus: string;
  task: { status: string; version: number } | null;
  expectedVersion?: number | null;
}): ConfirmDecision {
  if (!p.isOwner) return { action: 'REJECT', reason: 'NOT_OWNER' };
  const state = receiptState(p.requestStatus, p.task?.status);
  if (state === 'RECEIVED') return { action: 'ALREADY_DONE' };
  if (state === 'CANCELLED') return { action: 'REJECT', reason: 'CANCELLED' };
  if (!p.task) return { action: 'REJECT', reason: 'NO_TASK' };
  if (state !== 'READY') return { action: 'REJECT', reason: 'NOT_READY' };
  if (p.expectedVersion != null && p.expectedVersion !== p.task.version) return { action: 'REJECT', reason: 'STALE' };
  return { action: 'HANDOVER' };
}
