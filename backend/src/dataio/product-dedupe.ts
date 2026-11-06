// Product import: duplicate detection by Brand + SKU (plan item 2.4).
//
// A row's SKU is its partNumber and/or its code. Two products are the same item
// when they have the same brand code and share a SKU value. Comparison is
// case-insensitive and ignores surrounding spaces. A product without a brand
// counts as brand "" (so two brandless rows with one SKU are duplicates too).
//
// - Duplicate of a product already in the database → reported and skipped.
// - Duplicate of an earlier row in the same file   → error on the later row.

export interface DedupeRow { brandCode?: unknown; code?: unknown; partNumber?: unknown }
export interface DedupeDbProduct { code: string; partNumber?: string | null; brand?: { code: string } | null }

export type DuplicateHit =
  | { kind: 'db'; existingCode: string; brandCode: string; sku: string }
  | { kind: 'file'; firstRowIndex: number; brandCode: string; sku: string };

export const norm = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim().toLowerCase();

/** All Brand+SKU keys of one row/product (one per distinct non-empty SKU value). */
export function brandSkuKeys(brandCode: unknown, code: unknown, partNumber: unknown): string[] {
  const brand = norm(brandCode);
  const skus = new Set([norm(partNumber), norm(code)].filter(Boolean));
  return [...skus].map((sku) => `${brand}|${sku}`);
}

/** key → existing product code, for every product in the database. */
export function buildDbIndex(products: DedupeDbProduct[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const p of products) {
    for (const k of brandSkuKeys(p.brand?.code, p.code, p.partNumber)) if (!idx.has(k)) idx.set(k, p.code);
  }
  return idx;
}

/**
 * One result per row (same order): null, or the duplicate found.
 * A database duplicate wins over a within-file one (it is skipped either way);
 * a row that is a database duplicate is not remembered as a "first" row, so
 * the next copy is reported against the database too, not against the file.
 */
export function detectProductDuplicates(rows: DedupeRow[], dbProducts: DedupeDbProduct[]): (DuplicateHit | null)[] {
  const dbIndex = buildDbIndex(dbProducts);
  const seen = new Map<string, number>();
  return rows.map((r, i) => {
    const keys = brandSkuKeys(r.brandCode, r.code, r.partNumber);
    const label = (k: string) => { const [b, sku] = k.split('|'); return { brandCode: b, sku }; };
    for (const k of keys) {
      const existing = dbIndex.get(k);
      if (existing) return { kind: 'db', existingCode: existing, ...label(k) };
    }
    for (const k of keys) {
      const first = seen.get(k);
      if (first !== undefined) return { kind: 'file', firstRowIndex: first, ...label(k) };
    }
    for (const k of keys) seen.set(k, i);
    return null;
  });
}
