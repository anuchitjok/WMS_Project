// Product Master import (work stream A3). Uses the shared Data I/O pipeline
// (`/io/import/products/*`) with the product-only option `createMissingBrands`.
// Kept out of api.ts (shared file); the template download reuses dataioApi.
import { getT } from '@/i18n';
import { dataioApi } from '@/lib/api';

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export type DuplicateHit =
  | { kind: 'db'; existingCode: string; brandCode: string; sku: string }
  | { kind: 'file'; firstRowIndex: number; brandCode: string; sku: string };

export interface ProductImportRow {
  rowNumber: number;
  data: Record<string, any>;
  errors: string[];
  notes?: string[];
  valid: boolean;
  duplicate?: DuplicateHit | null;
}

export interface ProductImportPreview {
  columns: string[];
  rows: ProductImportRow[];
  summary: { total: number; valid: number; invalid: number; duplicatesDb?: number; duplicatesFile?: number; newBrands?: string[] };
  alreadyImported: { batch: string | null; at: string; by: string | null } | null;
  fileHash: string;
}

export interface ProductImportResult {
  batch: string;
  inserted: number;
  skipped: number;
  skippedRows: { rowNumber: number; errors: string[]; duplicate?: 'db' | 'file' }[];
  brandsCreated?: string[];
}

async function upload<T>(path: string, file: File): Promise<T> {
  let token: string | null = null;
  try { token = typeof window === 'undefined' ? null : localStorage.getItem('wms_token'); } catch { token = null; }
  const fd = new FormData();
  fd.append('file', file);
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
  } catch {
    throw new Error(getT().m.errors.network);
  }
  if (res.status === 401) {
    try { localStorage.removeItem('wms_token'); } catch { /* storage unavailable */ }
    if (typeof window !== 'undefined') window.location.href = '/login';
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const raw = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    const { m, t } = getT();
    const http = m.errors.http as Record<string, string>;
    throw Object.assign(new Error(raw || http[res.status] || t(m.errors.requestFailedStatus, { status: res.status })), { status: res.status, body });
  }
  return res.json();
}

function query(params: Record<string, boolean | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, 'true');
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const productImportApi = {
  template: () => dataioApi.downloadTemplate('products'),
  preview: (file: File, opts: { createMissingBrands?: boolean } = {}) =>
    upload<ProductImportPreview>(`/io/import/products/preview${query({ createMissingBrands: opts.createMissingBrands })}`, file),
  commit: (file: File, opts: { createMissingBrands?: boolean; allowReimport?: boolean } = {}) =>
    upload<ProductImportResult>(`/io/import/products/commit${query({ allowReimport: opts.allowReimport, createMissingBrands: opts.createMissingBrands })}`, file),
};

/** Roles that may create, edit and import products (plan 1.7) — mirrors the API. */
export const PRODUCT_WRITE_ROLES = ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER'];
export function canWriteProducts(role?: string | null): boolean {
  return !!role && PRODUCT_WRITE_ROLES.includes(role);
}
