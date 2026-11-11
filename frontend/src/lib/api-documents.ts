// Warehouse documents & QR (plan P5): request QR page, on-screen QR, location labels.
//
// api.ts does not export its `request` helper, so this file has a small copy with
// the same contract (base URL, bearer token, 401 → /login, localized server message).
import { localizeError } from '@/lib/api';
import { getT } from '@/i18n';

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type ApiError = Error & { status?: number; body?: unknown; rawMessage?: string };

function token(): string | null {
  return typeof window === 'undefined' ? null : localStorage.getItem('wms_token');
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const tk = token();
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}), ...init.headers },
    });
  } catch {
    throw Object.assign(new Error(getT().m.errors.network), { rawMessage: 'Network error' });
  }
  if (res.status === 401) {
    localStorage.removeItem('wms_token');
    localStorage.removeItem('wms_user');
    if (typeof window !== 'undefined') {
      try { if (window.location.pathname !== '/login') sessionStorage.setItem('wms_return_to', window.location.pathname + window.location.search); } catch { /* storage blocked */ }
      window.location.href = '/login';
    }
    throw Object.assign(new Error(getT().m.errors.requestFailed), { status: 401 });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: '' }));
    const raw = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    const msg = raw ? localizeError(raw) : getT().t(getT().m.errors.requestFailedStatus, { status: res.status });
    throw Object.assign(new Error(msg), { status: res.status, body, rawMessage: raw }) as ApiError;
  }
  return res;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await send(path, init)).json();
}

// ── Types (mirror backend/src/documents) ─────────────────────────────────────
export type DeliveryMethod = 'COLLECT' | 'SHIP';
export type ReceiptState = 'NOT_READY' | 'READY' | 'RECEIVED' | 'CANCELLED';

export interface SlipRow {
  no: number;
  sku: string;
  partNumber: string | null;
  description: string;
  brand: string;
  serial: string;
  qty: number;
  unit: string | null;
  condition: string;
  /** Only for warehouse users; null for the requester. */
  location: { warehouse: string; bin: string } | null;
  /** PR6: the approver chose this stock location (Manual Pick). */
  selectedByApprover?: boolean;
}

export type RefView =
  | { view: 'NONE'; canReceive: false; canPick: false; refNumber: string }
  | {
      view: 'REQUESTER' | 'WAREHOUSE';
      canReceive: boolean;
      canPick: boolean;
      refNumber: string;
      requestId: string;
      status: string;
      createdAt: string;
      requiredDate: string | null;
      purpose: string | null;
      deliveryMethod: DeliveryMethod;
      requesterName: string;
      department: string | null;
      pickerName: string | null;
      receiptState: ReceiptState;
      task: { id: string; refNumber: string; status: string; version: number } | null;
      items: SlipRow[];
    };

export interface RefQr { refNumber: string; url: string; svg: string }

const enc = encodeURIComponent;

export const documentsRefApi = {
  view: (ref: string) => request<RefView>(`/documents/ref/${enc(ref)}`),
  /** Runs the existing handover. Repeat presses return alreadyConfirmed: true. */
  confirmReceipt: (ref: string, version?: number) =>
    request<{ alreadyConfirmed: boolean; receiptState: ReceiptState }>(`/documents/ref/${enc(ref)}/confirm-receipt`, {
      method: 'POST',
      body: JSON.stringify(version != null ? { version } : {}),
    }),
  qr: (ref: string) => request<RefQr>(`/documents/ref/${enc(ref)}/qr`),
};

/** Web-app path the request QR opens (static export → query string, not a path segment). */
export const refPagePath = (ref: string) => `/r?ref=${enc(ref)}`;

/**
 * Ref number from a scanned value: the request QR URL (…/r?ref=X) or the
 * canonical REQ|X payload. Mirrors backend BarcodeParserService.
 */
export function refFromScan(raw: string): string | null {
  const v = (raw ?? '').trim();
  if (/^REQ\|/i.test(v)) return v.slice(4).trim() || null;
  if (!/^https?:\/\//i.test(v)) return null;
  try {
    const u = new URL(v);
    if (!/\/r\/?$/.test(u.pathname)) return null;
    return u.searchParams.get('ref')?.trim() || null;
  } catch {
    return null;
  }
}

// ── Location labels (plan 5.4) ───────────────────────────────────────────────
export interface LocationLabelTarget { slotIds?: string[]; rackIds?: string[]; warehouseIds?: string[] }

export async function printLocationLabels(target: LocationLabelTarget, fileName = 'location-labels.pdf'): Promise<void> {
  const res = await send('/labels/bin/print', { method: 'POST', body: JSON.stringify(target) });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
