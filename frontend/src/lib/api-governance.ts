// API calls for the governance work stream (module visibility, Users import/export).
// Follows the conventions of lib/api.ts (same base URL, token, error shape); that file
// does not export its request helpers, so the small pieces needed are mirrored here.
import { getT } from '@/i18n';
import { dataioApi, localizeError } from '@/lib/api';
import type { ModuleKey } from '@/lib/feature-flags';

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function token(): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem('wms_token'); } catch { return null; }
}

function sessionExpired() {
  try {
    localStorage.removeItem('wms_token');
    localStorage.removeItem('wms_user');
  } catch { /* storage unavailable */ }
  if (typeof window !== 'undefined') window.location.href = '/login';
}

async function errorFrom(res: Response): Promise<Error> {
  const body = await res.json().catch(() => ({ message: '' }));
  const raw = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
  const { m, t } = getT();
  const api = m.errors.api as Record<string, string>;
  const http = m.errors.http as Record<string, string>;
  const text = typeof raw === 'string' ? raw.trim() : '';
  const message = (text && api[text]) || text || http[res.status] || t(m.errors.requestFailedStatus, { status: res.status });
  return Object.assign(new Error(message), { status: res.status, body, rawMessage: raw });
}

async function get<T>(path: string, opts: { redirectOn401?: boolean } = {}): Promise<T> {
  const tk = token();
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, { headers: { ...(tk ? { Authorization: `Bearer ${tk}` } : {}) } });
  } catch {
    throw new Error(getT().m.errors.network);
  }
  if (res.status === 401 && opts.redirectOn401 !== false) { sessionExpired(); throw await errorFrom(res); }
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

async function download(path: string, fallbackName: string): Promise<void> {
  const tk = token();
  const res = await fetch(`${BASE}/api${path}`, { headers: { ...(tk ? { Authorization: `Bearer ${tk}` } : {}) } });
  if (res.status === 401) { sessionExpired(); throw await errorFrom(res); }
  if (!res.ok) throw await errorFrom(res);
  const blob = await res.blob();
  const match = (res.headers.get('Content-Disposition') || '').match(/filename="?([^"]+)"?/);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match?.[1] || fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface ModuleVisibility {
  hidden: ModuleKey[];
  visible: Record<ModuleKey, boolean>;
  source: 'configured' | 'default';
}

export interface UsersCapabilities {
  manageUsers: boolean;
  assignWarehouses: boolean;
  exportUsers: boolean;
  importUsers: boolean;
}

export const governanceApi = {
  /** Has a signed-in session (module visibility is only fetched then). */
  hasSession: () => !!token(),
  /** Which optional modules are on. Never redirects: callers fall back to defaults. */
  moduleVisibility: () => get<ModuleVisibility>('/settings/modules', { redirectOn401: false }),
  usersCapabilities: () => get<UsersCapabilities>('/users/capabilities'),
  /** Users export (.xlsx / .csv) — the API never includes passwords. */
  exportUsers: (format: 'xlsx' | 'csv') => download(`/users/export?format=${format}`, `users.${format}`),
  // Users import reuses the existing Import / Export (dataio) flow for type "users".
  usersTemplate: () => dataioApi.downloadTemplate('users'),
  previewUsers: (file: File) => dataioApi.preview('users', file),
  commitUsers: (file: File, allowReimport = false) => dataioApi.commit('users', file, allowReimport),
};

export { localizeError };
