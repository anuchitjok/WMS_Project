// Warehouse code generation — WH-{NAME SLUG}-{RUNNING NUMBER}.
//
// Pure on purpose (like space-math.ts / pick-route.ts) so every rule is unit-tested and
// the API, the preview endpoint and the create transaction all speak the same language.
// The running number is global: it never restarts per name, and a number is never
// reused, because the caller feeds in EVERY code the database holds (soft-deleted rows
// included). The database unique index on Warehouse.code stays the final guard.

/** Trailing words that say nothing about which warehouse this is. */
const GENERIC_WORDS = new Set([
  'WAREHOUSE', 'WAREHOUSES', 'CENTER', 'CENTERS', 'CENTRE', 'CENTRES', 'DC', 'STORE', 'STORES', 'STORAGE',
]);

/** Longest name slug we put in a code (the prefix and number are on top of this). */
export const MAX_SLUG_LENGTH = 20;

/** Used when a name has no usable latin letters at all (Thai, Chinese, digits, symbols). */
export const FALLBACK_SLUG = 'WAREHOUSE';

export const CODE_PREFIX = 'WH';

/** Codes this module generates: WH-<SLUG>-<3+ digits>. Legacy codes never match. */
const GENERATED_CODE = /^WH-[A-Z0-9]+(?:-[A-Z0-9]+)*-(\d{3,})$/;

/**
 * Name → code slug: UPPERCASE, latin letters and digits only, words joined with "-",
 * trailing generic words dropped, at most MAX_SLUG_LENGTH characters (cut on a word
 * boundary when one fits). Never returns an empty string.
 *
 *   "Chiang Mai Warehouse"      → CHIANG-MAI
 *   "Main Distribution Center"  → MAIN-DISTRIBUTION
 *   "Spare Part Warehouse!!"    → SPARE-PART
 *   "คลังสินค้าเชียงใหม่"           → WAREHOUSE
 */
export function warehouseSlug(name: string): string {
  const words = String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents left by NFKD (É → E)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  // Drop generic tail words, but never empty the slug ("Warehouse" stays WAREHOUSE).
  while (words.length > 1 && GENERIC_WORDS.has(words[words.length - 1])) words.pop();
  if (!words.length) return FALLBACK_SLUG;

  let slug = words.join('-');
  if (slug.length > MAX_SLUG_LENGTH) {
    const boundary = slug.lastIndexOf('-', MAX_SLUG_LENGTH);
    slug = (boundary > 0 ? slug.slice(0, boundary) : slug.slice(0, MAX_SLUG_LENGTH)).replace(/-+$/, '');
  }
  // A slug of digits alone would read like a running number — fall back instead.
  return /[A-Z]/.test(slug) ? slug : FALLBACK_SLUG;
}

/**
 * Next global running number: one past the highest number already used by a generated
 * code. Legacy codes (SCG, WH-MAIN, THPCA-OS-RF…) are ignored, so the first generated
 * code in an existing database is 001.
 */
export function nextRunningNumber(codes: Iterable<string | null | undefined>): number {
  let max = 0;
  for (const raw of codes) {
    const m = GENERATED_CODE.exec(String(raw ?? '').trim().toUpperCase());
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/** WH-SPARE-PART-003 — at least three digits, more once the sequence passes 999. */
export function buildWarehouseCode(slug: string, runningNumber: number): string {
  const n = Math.max(1, Math.trunc(runningNumber));
  return `${CODE_PREFIX}-${slug || FALLBACK_SLUG}-${String(n).padStart(3, '0')}`;
}

/** Name + every code in the database → the code to store. */
export function generateWarehouseCode(name: string, existingCodes: Iterable<string | null | undefined>): string {
  return buildWarehouseCode(warehouseSlug(name), nextRunningNumber(existingCodes));
}

/** True when a code looks like one this module generated (used by tests and reports). */
export function isGeneratedWarehouseCode(code: string): boolean {
  return GENERATED_CODE.test(String(code ?? '').trim().toUpperCase());
}
