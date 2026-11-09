// Pure calculations for the Warehouse Space dashboard tab (plan P6 6.1 / 6.2).
// Inputs are rows from GET /warehouse-master/space-summary; nothing here
// fetches or renders, so the rules stay easy to check by reading.
import type { BucketValues, SlotCounts, StorageBucket, WarehouseSpaceSummary } from '@/lib/api-warehouse';

export const DEFAULT_NEAR_FULL_PCT = 85;
export const MIN_NEAR_FULL_PCT = 50;
export const MAX_NEAR_FULL_PCT = 100;
const THRESHOLD_KEY = 'wms_dashboard_space_near_full_pct';

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export interface SpaceAggregate {
  warehouses: number;
  withSize: number;
  withoutSize: WarehouseSpaceSummary[];
  totalAreaM2: number;
  usableAreaM2: number;
  /** Rack footprint inside warehouses that have a size (so it can be compared with usable area). */
  usedAreaM2: number;
  standardM2: number;
  palletM2: number;
  freeAreaM2: number;
  overAllocatedM2: number;
  volumeM3: number;
  /** usedAreaM2 ÷ usableAreaM2 × 100; null when no warehouse has a size. */
  usedPct: number | null;
  racks: { total: number; standard: number; pallet: number; withoutSize: number };
  slots: SlotCounts;
  stockQty: number;
  /** stock quantity ÷ slot capacity × 100; null when no slot capacity. */
  capacityUsedPct: number | null;
}

const emptySlots = (): SlotCounts => ({ total: 0, empty: 0, occupied: 0, reserved: 0, blocked: 0, other: 0, capacity: 0 });

/** Totals for the selected warehouses (all rows, or just one). */
export function aggregateSpace(rows: WarehouseSpaceSummary[]): SpaceAggregate {
  const a: SpaceAggregate = {
    warehouses: rows.length, withSize: 0, withoutSize: [],
    totalAreaM2: 0, usableAreaM2: 0, usedAreaM2: 0, standardM2: 0, palletM2: 0,
    freeAreaM2: 0, overAllocatedM2: 0, volumeM3: 0, usedPct: null,
    racks: { total: 0, standard: 0, pallet: 0, withoutSize: 0 },
    slots: emptySlots(), stockQty: 0, capacityUsedPct: null,
  };
  for (const w of rows) {
    if (w.hasSize) {
      a.withSize += 1;
      a.totalAreaM2 += w.totalAreaM2 ?? 0;
      a.usableAreaM2 += w.usableAreaM2 ?? 0;
      a.volumeM3 += w.volumeM3 ?? 0;
      a.usedAreaM2 += w.rackFootprintM2;
      a.standardM2 += w.standardFootprintM2;
      a.palletM2 += w.palletFootprintM2;
      a.freeAreaM2 += w.freeAreaM2 ?? 0;
      a.overAllocatedM2 += w.overAllocatedM2;
    } else {
      a.withoutSize.push(w);
    }
    a.racks.total += w.racks.total;
    a.racks.standard += w.racks.standard;
    a.racks.pallet += w.racks.pallet;
    a.racks.withoutSize += w.racks.withoutSize;
    (Object.keys(a.slots) as (keyof SlotCounts)[]).forEach((k) => { a.slots[k] += w.slots[k] ?? 0; });
    a.stockQty += w.stockQty;
  }
  a.totalAreaM2 = round(a.totalAreaM2);
  a.usableAreaM2 = round(a.usableAreaM2);
  a.usedAreaM2 = round(a.usedAreaM2);
  a.standardM2 = round(a.standardM2);
  a.palletM2 = round(a.palletM2);
  a.freeAreaM2 = round(a.freeAreaM2);
  a.overAllocatedM2 = round(a.overAllocatedM2);
  a.volumeM3 = round(a.volumeM3);
  a.stockQty = round(a.stockQty);
  a.usedPct = a.usableAreaM2 > 0 ? round((a.usedAreaM2 / a.usableAreaM2) * 100, 1) : null;
  a.capacityUsedPct = a.slots.capacity > 0 ? round((a.stockQty / a.slots.capacity) * 100, 1) : null;
  return a;
}

/** Share (0–100) of `part` in `whole`, clamped so bars never overflow. */
export function share(part: number, whole: number): number {
  if (!(whole > 0) || !(part > 0)) return 0;
  return Math.min(100, (part / whole) * 100);
}

/** The fuller of area used % and slot capacity used % (null when neither is known). */
export function fullnessPct(w: Pick<WarehouseSpaceSummary, 'usedAreaPct' | 'capacityUsedPct'>): number | null {
  const v = [w.usedAreaPct, w.capacityUsedPct].filter((x): x is number => typeof x === 'number');
  return v.length ? Math.max(...v) : null;
}

export interface NearFullRow { warehouse: WarehouseSpaceSummary; pct: number; basis: 'area' | 'capacity' }

/** Warehouses whose area used % or capacity used % is at or above the threshold, fullest first. */
export function nearFull(rows: WarehouseSpaceSummary[], thresholdPct: number): NearFullRow[] {
  const out: NearFullRow[] = [];
  for (const w of rows) {
    const pct = fullnessPct(w);
    if (pct == null || pct < thresholdPct) continue;
    const basis = (w.usedAreaPct ?? -1) >= (w.capacityUsedPct ?? -1) ? 'area' : 'capacity';
    out.push({ warehouse: w, pct, basis });
  }
  return out.sort((x, y) => y.pct - x.pct || x.warehouse.code.localeCompare(y.warehouse.code));
}

/** Space still available to offer: most free area first; warehouses without a size go last. */
export function offerable(rows: WarehouseSpaceSummary[]): WarehouseSpaceSummary[] {
  return [...rows].sort((x, y) => {
    const fx = x.freeAreaM2 ?? -1;
    const fy = y.freeAreaM2 ?? -1;
    return fy - fx || y.slots.empty - x.slots.empty || x.code.localeCompare(y.code);
  });
}

/** Keep the threshold a whole number between the allowed bounds; invalid → default. */
export function clampThreshold(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_NEAR_FULL_PCT;
  return Math.min(MAX_NEAR_FULL_PCT, Math.max(MIN_NEAR_FULL_PCT, Math.round(n)));
}

// Per-viewer convenience only; the page works without storage.
export function readThreshold(): number {
  try {
    const raw = localStorage.getItem(THRESHOLD_KEY);
    return raw == null ? DEFAULT_NEAR_FULL_PCT : clampThreshold(raw);
  } catch {
    return DEFAULT_NEAR_FULL_PCT;
  }
}

export function writeThreshold(v: number): void {
  try { localStorage.setItem(THRESHOLD_KEY, String(v)); } catch { /* storage unavailable */ }
}

// ── Layer 1 (floor) / Layer 2 (storage) totals for the selected warehouses ────
// Same rules as the backend: added in whole cents so totals match the rows,
// never clamped, and the two layers are never mixed.

export const STORAGE_BUCKETS: StorageBucket[] = ['occupied', 'reserved', 'available', 'blockedOther'];
const cents = (n: number) => Math.round(n * 100);
const pct1 = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

export interface FloorTotals {
  /** null when none of the selected warehouses has a size. */
  totalAreaM2: number | null;
  rackFootprintM2: number;
  availableM2: number | null;
  utilPct: number | null;
  overCapacity: WarehouseSpaceSummary[];
  withoutSize: WarehouseSpaceSummary[];
  racksWithoutSizeCodes: string[];
}

export function floorTotals(rows: WarehouseSpaceSummary[]): FloorTotals {
  let total = 0, fp = 0, sized = 0;
  const over: WarehouseSpaceSummary[] = [];
  const noSize: WarehouseSpaceSummary[] = [];
  const rackCodes: string[] = [];
  for (const w of rows) {
    rackCodes.push(...w.floor.racksWithoutSizeCodes.map((c) => `${w.code}/${c}`));
    if (w.floor.totalAreaM2 == null) { noSize.push(w); continue; }
    sized++;
    total += cents(w.floor.totalAreaM2);
    fp += cents(w.floor.rackFootprintM2);
    if (w.floor.overCapacity) over.push(w);
  }
  return {
    totalAreaM2: sized ? total / 100 : null,
    rackFootprintM2: fp / 100,
    availableM2: sized ? (total - fp) / 100 : null,
    utilPct: pct1(fp, total),
    overCapacity: over,
    withoutSize: noSize,
    racksWithoutSizeCodes: rackCodes,
  };
}

export interface StorageTotals {
  totalRackAreaM2: number;
  areaM2: BucketValues;
  slots: BucketValues & { total: number };
  utilPct: number | null;
  racksCounted: number;
  racksWithoutSlotsCodes: string[];
}

export function storageTotals(rows: WarehouseSpaceSummary[]): StorageTotals {
  let total = 0, counted = 0;
  const area: BucketValues = { occupied: 0, reserved: 0, available: 0, blockedOther: 0 };
  const slots = { ...area, total: 0 };
  const noSlots: string[] = [];
  for (const w of rows) {
    const s = w.storage;
    total += cents(s.totalRackAreaM2);
    counted += s.racksCounted;
    noSlots.push(...s.racksWithoutSlotsCodes.map((c) => `${w.code}/${c}`));
    for (const k of STORAGE_BUCKETS) { area[k] += cents(s.areaM2[k]); slots[k] += s.slots[k]; }
    slots.total += s.slots.total;
  }
  const used = area.occupied + area.reserved;
  for (const k of STORAGE_BUCKETS) area[k] /= 100;
  return { totalRackAreaM2: total / 100, areaM2: area, slots, utilPct: pct1(used, total), racksCounted: counted, racksWithoutSlotsCodes: noSlots };
}
