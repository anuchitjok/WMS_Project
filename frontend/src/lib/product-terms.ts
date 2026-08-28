// Shared user-facing wording for Product Master enum values.
// Display only — the stored values and API payloads keep the original enum strings.

export const PRODUCT_TYPE_LABEL: Record<string, string> = {
  SPARE_PART: 'Spare Part',
  FINISHED_GOODS: 'Finished Goods',
};

/** Business wording for a ProductType value; falls back to the raw value made readable. */
export function typeLabel(t?: string | null): string {
  if (!t) return '—';
  return PRODUCT_TYPE_LABEL[t] ?? t.replace(/_/g, ' ');
}
