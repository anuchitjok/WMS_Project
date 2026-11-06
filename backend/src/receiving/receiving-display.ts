// Display rules shared by Goods Receiving and the Receive report.
//
// Source type: the stored value 'RTV Replacement' (written by the RTV flow and by
// older receipts) is shown as "RTV Return". Display only — the stored value never
// changes, so filters must match both the stored value and the label.
//
// Item condition: New / Refurbish chosen at receipt (GoodsReceivingItem.itemCondition,
// migration 31). Separate from the QC condition (good / damaged / doa).

export const RTV_SOURCE_VALUE = 'RTV Replacement';
export const RTV_SOURCE_LABEL = 'RTV Return';

/** English display label for a stored source type (exports and report rows). */
export function sourceTypeLabel(value?: string | null): string {
  if (!value) return '';
  return value === RTV_SOURCE_VALUE ? RTV_SOURCE_LABEL : value;
}

/**
 * True when a free-text term matches a stored source type, by its stored value or
 * its display label ("rtv replacement" and "rtv return" both match old rows).
 */
export function sourceTypeMatches(value: string | null | undefined, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  if (!value) return false;
  return value.toLowerCase().includes(t) || sourceTypeLabel(value).toLowerCase().includes(t);
}

export const ITEM_CONDITIONS = ['NEW', 'REFURBISH'] as const;
export type ItemCondition = (typeof ITEM_CONDITIONS)[number];

const ITEM_CONDITION_LABEL: Record<ItemCondition, string> = { NEW: 'New', REFURBISH: 'Refurbish' };

/**
 * Lenient parse for file imports: blank → null (old files / not given),
 * 'new' / 'Refurbish' / 'REFURBISHED' → the stored code, anything else → undefined (invalid).
 */
export function parseItemCondition(v: unknown): ItemCondition | null | undefined {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toUpperCase();
  if (!s) return null;
  if (s === 'NEW') return 'NEW';
  if (s === 'REFURBISH' || s === 'REFURBISHED') return 'REFURBISH';
  return undefined;
}

/**
 * Condition column: New / Refurbish when chosen at receipt; older receipts only have
 * the QC condition, shown as "QC: good" so the two are never confused.
 */
export function conditionLabel(itemCondition?: string | null, qcCondition?: string | null): string {
  if (itemCondition && itemCondition in ITEM_CONDITION_LABEL) return ITEM_CONDITION_LABEL[itemCondition as ItemCondition];
  if (itemCondition) return itemCondition;
  return qcCondition ? `QC: ${qcCondition}` : '';
}
