// RQ15 — how much room a quantity needs, and which slots suit it.
//
// Pure on purpose (like space-math.ts): the rules are here and unit-tested, the
// service only fetches rows. Nothing in this file decides anything about stock;
// it ranks candidates and the person putting the item away still chooses.
//
// What it will NOT do: invent a number. A product with no size recorded, or a
// slot with no size, yields `null` for the size-based answers — never 0, never
// a guess. The caller says so on screen (the fallback the analysis asked for).

import { boxFitsSlot } from './putaway-fit.util';

/** A product's box, in centimetres. Any missing side means "no size recorded". */
export interface BoxSize {
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
}

/** One candidate location, as the database has it. */
export interface SlotCandidate {
  slotId: string;
  slotCode: string;
  rackId: string;
  rackCode: string;
  zone: string | null;
  warehouseId: string;
  warehouseCode: string;
  status: string;
  capacity: number;
  /** Stock rows sitting in the slot now. */
  used: number;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  /** The slot already holds the product being put away. */
  holdsSameProduct: boolean;
}

export type SuggestionReason = 'SAME_PRODUCT' | 'EMPTY' | 'HAS_ROOM';

export interface Suggestion extends SlotCandidate {
  free: number;
  /** true / false by size, or null when either size is unknown. */
  fits: boolean | null;
  /** How many of this box the slot could hold by volume; null when a size is unknown. */
  unitsBySize: number | null;
  reason: SuggestionReason;
  score: number;
}

/** Why candidates were left out — shown so the list never looks mysteriously short. */
export interface SkippedCounts {
  full: number;
  blocked: number;
  tooSmall: number;
}

export interface SpaceNeed {
  quantity: number;
  /** One box, m³. Null when the product has no size. */
  unitVolumeM3: number | null;
  /** quantity × unitVolumeM3. Null when the product has no size. */
  totalVolumeM3: number | null;
  /** One box footprint, m². Null when the product has no size. */
  unitFootprintM2: number | null;
}

export interface SuggestResult {
  hasProductSize: boolean;
  need: SpaceNeed;
  suggestions: Suggestion[];
  skipped: SkippedCounts;
}

const pos = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** A usable box, or null when any side is missing. */
export function boxOf(size: BoxSize): [number, number, number] | null {
  return pos(size.lengthCm) && pos(size.widthCm) && pos(size.heightCm)
    ? [size.lengthCm, size.widthCm, size.heightCm]
    : null;
}

/** Room one quantity of this product needs. Null figures mean "no size recorded". */
export function spaceNeeded(quantity: number, size: BoxSize): SpaceNeed {
  const qty = Math.max(0, Math.trunc(quantity || 0));
  const box = boxOf(size);
  if (!box) return { quantity: qty, unitVolumeM3: null, totalVolumeM3: null, unitFootprintM2: null };
  const [l, w, h] = box;
  const unitVolumeM3 = (l * w * h) / 1_000_000; // cm³ → m³
  return {
    quantity: qty,
    unitVolumeM3,
    totalVolumeM3: unitVolumeM3 * qty,
    unitFootprintM2: (l * w) / 10_000, // cm² → m²
  };
}

/**
 * How many of the box fit in the slot by volume, once it fits at all.
 *
 * Volume, not bin packing: the slot's capacity column is the real limit the WMS
 * enforces, and this is only a hint next to it. It is never used to let someone
 * exceed `capacity`.
 */
export function unitsBySize(box: [number, number, number] | null, slot: BoxSize): number | null {
  const s = boxOf(slot);
  if (!box || !s) return null;
  if (!boxFitsSlot(box, s)) return 0;
  const boxV = box[0] * box[1] * box[2];
  const slotV = s[0] * s[1] * s[2];
  return Math.max(1, Math.floor(slotV / boxV));
}

/**
 * Rank the candidates. Highest score first, then the slot code so the order is
 * stable for the same data.
 *
 * The order of preference:
 *   1. a slot that already holds this product (keep one product in one place)
 *   2. a slot the box is known to fit
 *   3. an empty slot over a part-used one, and more free capacity over less
 *
 * A slot with no room left, one that is blocked, and one the box is known not
 * to fit are not suggested at all — they are counted in `skipped` instead.
 */
export function suggestSlots(
  quantity: number,
  productSize: BoxSize,
  candidates: SlotCandidate[],
  limit = 8,
): SuggestResult {
  const box = boxOf(productSize);
  const need = spaceNeeded(quantity, productSize);
  const skipped: SkippedCounts = { full: 0, blocked: 0, tooSmall: 0 };
  const out: Suggestion[] = [];

  for (const c of candidates) {
    const free = Math.max(0, (c.capacity ?? 0) - (c.used ?? 0));
    if (c.status === 'BLOCKED' || c.status === 'QUARANTINE' || c.status === 'RTV') { skipped.blocked++; continue; }
    if (free <= 0) { skipped.full++; continue; }

    const slotBox = boxOf(c);
    const fits = box && slotBox ? boxFitsSlot(box, slotBox) : null;
    if (fits === false) { skipped.tooSmall++; continue; }

    const reason: SuggestionReason = c.holdsSameProduct ? 'SAME_PRODUCT' : c.used === 0 ? 'EMPTY' : 'HAS_ROOM';
    // Weights are deliberately far apart so one reason never outranks another by
    // accident: same product beats everything, a known fit beats an unknown one.
    const score =
      (c.holdsSameProduct ? 1000 : 0) +
      (fits === true ? 100 : 0) +
      (c.used === 0 ? 10 : 0) +
      Math.min(free, 9);

    out.push({ ...c, free, fits, unitsBySize: unitsBySize(box, c), reason, score });
  }

  out.sort((a, b) => (b.score - a.score) || a.slotCode.localeCompare(b.slotCode));
  return { hasProductSize: !!box, need, suggestions: out.slice(0, Math.max(1, limit)), skipped };
}
