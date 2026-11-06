// Withdrawal & Fulfillment API (work stream B2, plan P4 4.1–4.7).
// Existing calls stay on `requestsApi` / `fulfillmentApi` in api.ts (shared file).
//
// api.ts does not export its `request` helper, so this file has a small copy with
// the same contract (base URL, bearer token, 401 → /login, localized server message).
import { localizeError } from '@/lib/api';
import { getT } from '@/i18n';
import type { WithdrawalRequest } from '@/types';

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let token: string | null = null;
  try { token = typeof window === 'undefined' ? null : localStorage.getItem('wms_token'); } catch { token = null; }
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
    });
  } catch {
    throw Object.assign(new Error(getT().m.errors.network), { rawMessage: 'Network error' });
  }
  if (res.status === 401) {
    try { localStorage.removeItem('wms_token'); localStorage.removeItem('wms_user'); } catch { /* storage unavailable */ }
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw Object.assign(new Error(getT().m.errors.requestFailed), { status: 401 });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: '' }));
    const raw = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw Object.assign(
      new Error(raw ? localizeError(raw) : getT().t(getT().m.errors.requestFailedStatus, { status: res.status })),
      { status: res.status, body, rawMessage: raw },
    );
  }
  return res.json();
}

/** P4 4.7 — how the requester receives the goods. Older requests (null) are COLLECT. */
export type DeliveryMethod = 'COLLECT' | 'SHIP';
export const DELIVERY_METHODS: DeliveryMethod[] = ['COLLECT', 'SHIP'];
export const deliveryMethodOf = (v: unknown): DeliveryMethod => (v === 'SHIP' ? 'SHIP' : 'COLLECT');

export interface CreateRequestBody {
  rmaCaseNumber: string;
  remark?: string;
  department?: string;
  purpose?: string;
  deliveryMethod?: DeliveryMethod;
  items: { productId: string; quantity: number }[];
}

export interface BulkApproveResult {
  id: string;
  refNumber: string | null;
  ok: boolean;
  /** Request status after the decision (PENDING_APPROVAL = waiting on a later approval step). */
  status?: string;
  error?: string;
}

export interface BulkApproveResponse {
  results: BulkApproveResult[];
  approved: number;
  rejected: number;
  failed: number;
}

/** Max ids per bulk decision — same cap as the backend DTO. */
export const BULK_APPROVE_MAX = 100;

export const requestsApiP4 = {
  /** POST /requests — same as requestsApi.create plus deliveryMethod. */
  create: (data: CreateRequestBody) =>
    request<WithdrawalRequest>('/requests', { method: 'POST', body: JSON.stringify(data) }),
  /** POST /requests/bulk-approve — each id decided separately; per-id results. */
  bulkApprove: (ids: string[], approve: boolean, reason?: string) =>
    request<BulkApproveResponse>('/requests/bulk-approve', {
      method: 'POST',
      body: JSON.stringify({ ids, approve, reason }),
    }),
};
