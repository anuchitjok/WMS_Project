// RQ17 / RQ18 — boxes: their own code, their own QR, their own place.
//
// api.ts does not export its `request` helper, so this file keeps the same
// small copy api-warehouse.ts uses (base URL, bearer token, 401 → /login,
// server message on error).
import { localizeError } from '@/lib/api';
import { getT } from '@/i18n';

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('wms_token');
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
    localStorage.removeItem('wms_token');
    localStorage.removeItem('wms_user');
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw Object.assign(new Error(getT().m.errors.requestFailed), { status: 401 });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: '' }));
    const raw = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw Object.assign(new Error(raw ? localizeError(raw) : getT().t(getT().m.errors.requestFailedStatus, { status: res.status })), { status: res.status, body, rawMessage: raw });
  }
  return res.json();
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export type ContainerType = 'BOX' | 'CARTON' | 'CRATE' | 'TOTE' | 'PALLET';
export type ContainerStatus = 'OPEN' | 'CLOSED';

export interface ContainerStockRow {
  id: string;
  quantity: number;
  status: string;
  serialNumber: string | null;
  batchNumber: string | null;
  product: { id: string; code: string; name: string; unit?: string | null };
}

/** A box as the list shows it. */
export interface ContainerRow {
  id: string;
  code: string;
  name: string | null;
  type: ContainerType;
  status: ContainerStatus;
  warehouseId: string | null;
  rackId: string | null;
  slotId: string | null;
  warehouse?: { code: string } | null;
  rack?: { code: string } | null;
  slot?: { code: string } | null;
  parent?: { id: string; code: string } | null;
  _count?: { stockItems: number; children: number };
}

/** A box with what is in it. */
export interface ContainerDetail extends Omit<ContainerRow, '_count'> {
  notes: string | null;
  warehouse?: { id: string; code: string; name: string } | null;
  rack?: { id: string; code: string } | null;
  slot?: { id: string; code: string } | null;
  splitFrom?: { id: string; code: string } | null;
  children: { id: string; code: string; name: string | null; status: ContainerStatus }[];
  stockItems: ContainerStockRow[];
}

export const containersApi = {
  list: (params: { warehouseId?: string; slotId?: string; search?: string } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && q.set(k, v));
    return request<ContainerRow[]>(`/containers?${q}`);
  },
  get: (id: string) => request<ContainerDetail>(`/containers/${id}`),
  /** What the scanner's BOX|<code> resolves to. */
  byCode: (code: string) => request<ContainerDetail>(`/containers/by-code/${encodeURIComponent(code)}`),

  create: (dto: { name?: string; type?: ContainerType; notes?: string; slotId?: string; parentContainerId?: string }) =>
    request<ContainerDetail>('/containers', json('POST', dto)),
  update: (id: string, dto: { name?: string; notes?: string; type?: ContainerType; status?: ContainerStatus }) =>
    request<ContainerDetail>(`/containers/${id}`, json('PATCH', dto)),
  /** Moving the box moves the stock inside it. */
  move: (id: string, slotId?: string) => request<ContainerDetail>(`/containers/${id}/move`, json('POST', { slotId })),
  pack: (id: string, stockItemIds: string[]) => request<ContainerDetail>(`/containers/${id}/pack`, json('POST', { stockItemIds })),
  unpack: (id: string, stockItemIds: string[]) => request<ContainerDetail>(`/containers/${id}/unpack`, json('POST', { stockItemIds })),
  split: (id: string, dto: { stockItemIds: string[]; name?: string; allowEmptySource?: boolean }) =>
    request<{ source: ContainerDetail; created: ContainerDetail }>(`/containers/${id}/split`, json('POST', dto)),
  /** `retireSource` closes the emptied box so a merge leaves nothing behind. */
  merge: (id: string, fromContainerId: string, retireSource = false) =>
    request<{ target: ContainerDetail; source: ContainerDetail | null; moved: { stock: number; children: number; retired: boolean } }>(
      `/containers/${id}/merge`, json('POST', { fromContainerId, retireSource }),
    ),
  remove: (id: string) => request<{ success: boolean }>(`/containers/${id}`, { method: 'DELETE' }),
};
