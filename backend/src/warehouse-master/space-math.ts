// Space math for Warehouse Master — the ONE place where areas, rack footprints,
// slot sizes, slot codes and the space simulator are calculated (plan P1 1.3–1.6).
// Pure functions only (no Prisma), so they are unit-tested directly and reused by
// the space summary, the capacity planner, slot generation and the simulator.

export type RackCategory = 'STANDARD_RACK' | 'PALLET_ON_FLOOR';
export const RACK_CATEGORIES: RackCategory[] = ['STANDARD_RACK', 'PALLET_ON_FLOOR'];

export interface Size3 { lengthCm: number | null; widthCm: number | null; heightCm: number | null }

export interface TemplateLike extends Size3 {
  id?: string;
  code?: string;
  name?: string;
  category: string;
  levels: number;
  columns: number;
  slotCapacity?: number | null;
}

export interface RackLike extends Size3 {
  id?: string;
  code: string;
  rackType?: string | null;
  levels: number;
  columns: number;
  rackTypeMaster?: TemplateLike | null;
}

export interface WarehouseLike extends Size3 {
  usableAreaPct: number | null;
}

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const pos = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

// ── Categories ────────────────────────────────────────────────────────────────

/** Display category. Racks without a template: legacy PALLET → Pallet on Floor, everything else → Standard Rack. */
export function rackCategory(rack: Pick<RackLike, 'rackType' | 'rackTypeMaster'>): RackCategory {
  const c = rack.rackTypeMaster?.category;
  if (c === 'PALLET_ON_FLOOR' || c === 'STANDARD_RACK') return c;
  return rack.rackType === 'PALLET' ? 'PALLET_ON_FLOOR' : 'STANDARD_RACK';
}

/** Value written to the legacy `Rack.rackType` enum for a category. */
export function legacyRackType(category: RackCategory): 'STANDARD' | 'PALLET' {
  return category === 'PALLET_ON_FLOOR' ? 'PALLET' : 'STANDARD';
}

// ── Sizes ─────────────────────────────────────────────────────────────────────

/** Rack size: its own measurements, each missing value filled from its template. */
export function effectiveRackSize(rack: RackLike): Size3 {
  const t = rack.rackTypeMaster;
  return {
    lengthCm: pos(rack.lengthCm) ? rack.lengthCm : pos(t?.lengthCm) ? t!.lengthCm : null,
    widthCm: pos(rack.widthCm) ? rack.widthCm : pos(t?.widthCm) ? t!.widthCm : null,
    heightCm: pos(rack.heightCm) ? rack.heightCm : pos(t?.heightCm) ? t!.heightCm : null,
  };
}

/** Floor footprint in m² (L×W), or null when the size is unknown. */
export function footprintM2(size: Size3): number | null {
  return pos(size.lengthCm) && pos(size.widthCm) ? (size.lengthCm * size.widthCm) / 10_000 : null;
}

export interface SlotSize {
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  areaM2: number | null;
  volumeM3: number | null;
}

/** One slot of a rack: length / columns × width × height / levels. */
export function slotSize(size: Size3, levels: number, columns: number): SlotSize {
  const lv = Math.max(1, Math.floor(levels || 1));
  const cl = Math.max(1, Math.floor(columns || 1));
  const l = pos(size.lengthCm) ? round(size.lengthCm / cl, 1) : null;
  const w = pos(size.widthCm) ? round(size.widthCm, 1) : null;
  const h = pos(size.heightCm) ? round(size.heightCm / lv, 1) : null;
  const areaM2 = l != null && w != null ? round((l * w) / 10_000, 3) : null;
  const volumeM3 = areaM2 != null && h != null ? round((l! * w! * h) / 1_000_000, 3) : null;
  return { lengthCm: l, widthCm: w, heightCm: h, areaM2, volumeM3 };
}

export interface WarehouseArea {
  hasSize: boolean;
  usableAreaPct: number; // effective (100 when not set)
  totalAreaM2: number | null;
  usableAreaM2: number | null;
  volumeM3: number | null;
}

export function warehouseArea(wh: WarehouseLike): WarehouseArea {
  const pct = pos(wh.usableAreaPct) ? Math.min(100, wh.usableAreaPct) : 100;
  const total = footprintM2(wh);
  return {
    hasSize: total != null,
    usableAreaPct: pct,
    totalAreaM2: total != null ? round(total) : null,
    usableAreaM2: total != null ? round((total * pct) / 100) : null,
    volumeM3: total != null && pos(wh.heightCm) ? round((total * wh.heightCm) / 100) : null,
  };
}

// ── Space summary (plan 1.5) ──────────────────────────────────────────────────

export interface SlotCounts {
  total: number;
  empty: number;
  occupied: number;
  reserved: number;
  blocked: number;
  other: number; // QUARANTINE, RTV, …
  capacity: number; // sum of Slot.capacity
}

export const emptySlotCounts = (): SlotCounts => ({ total: 0, empty: 0, occupied: 0, reserved: 0, blocked: 0, other: 0, capacity: 0 });

/** Adds `count` slots of `status` with `capacity` total units to `c` (mutates and returns it). */
export function addSlots(c: SlotCounts, status: string, count: number, capacity: number): SlotCounts {
  c.total += count;
  c.capacity += capacity;
  if (status === 'EMPTY') c.empty += count;
  else if (status === 'OCCUPIED') c.occupied += count;
  else if (status === 'RESERVED') c.reserved += count;
  else if (status === 'BLOCKED') c.blocked += count;
  else c.other += count;
  return c;
}

export interface RackFootprint {
  totalM2: number;
  standardM2: number;
  palletM2: number;
  racks: number;
  standardRacks: number;
  palletRacks: number;
  withoutSize: number;
  withoutSizeCodes: string[];
}

export function rackFootprints(racks: RackLike[]): RackFootprint {
  const out: RackFootprint = { totalM2: 0, standardM2: 0, palletM2: 0, racks: 0, standardRacks: 0, palletRacks: 0, withoutSize: 0, withoutSizeCodes: [] };
  for (const r of racks) {
    const cat = rackCategory(r);
    out.racks++;
    if (cat === 'PALLET_ON_FLOOR') out.palletRacks++; else out.standardRacks++;
    const fp = footprintM2(effectiveRackSize(r));
    if (fp == null) { out.withoutSize++; out.withoutSizeCodes.push(r.code); continue; }
    out.totalM2 += fp;
    if (cat === 'PALLET_ON_FLOOR') out.palletM2 += fp; else out.standardM2 += fp;
  }
  out.totalM2 = round(out.totalM2);
  out.standardM2 = round(out.standardM2);
  out.palletM2 = round(out.palletM2);
  return out;
}

// ── Floor space (Layer 1) and rack storage space (Layer 2) ────────────────────
// Layer 1 compares rack footprints with the FULL warehouse area (100%, never the
// usable %). Layer 2 estimates storage area from the share of slots per status.
// The two layers are never mixed.

export type StorageBucket = 'occupied' | 'reserved' | 'available' | 'blockedOther';
export const STORAGE_BUCKETS: StorageBucket[] = ['occupied', 'reserved', 'available', 'blockedOther'];

/**
 * Bucket of one slot. "Occupied" comes from real stock (same rule as the 3D view),
 * because receiving and putaway never change slot.status:
 *  1. holds in-location stock → occupied (whatever the status says)
 *  2. no stock, RESERVED → reserved
 *  3. no stock, EMPTY or a stale OCCUPIED → available
 *  4. no stock, anything else (BLOCKED, QUARANTINE, RTV, unknown) → blockedOther
 */
export function storageBucket(status: string, hasStock: boolean): StorageBucket {
  if (hasStock) return 'occupied';
  if (status === 'RESERVED') return 'reserved';
  if (status === 'EMPTY' || status === 'OCCUPIED') return 'available';
  return 'blockedOther';
}

export type BucketValues = Record<StorageBucket, number>;
const zeroBuckets = (): BucketValues => ({ occupied: 0, reserved: 0, available: 0, blockedOther: 0 });

/** Slot counts per storage bucket, plus the total. */
export type StorageSlots = BucketValues & { total: number };
export const emptyStorageSlots = (): StorageSlots => ({ ...zeroBuckets(), total: 0 });

/** Adds `n` slots of one status (with / without stock) to `s`. */
export function addStorageSlot(s: StorageSlots, status: string, hasStock: boolean, n = 1): void {
  s[storageBucket(status, hasStock)] += n;
  s.total += n;
}

/**
 * Splits `totalCents` by `weights` so the parts are whole cents and add up EXACTLY
 * to the total (largest-remainder rounding). Used so the 4 storage areas always
 * sum to the rack area shown, without changing any input.
 */
export function splitCents(totalCents: number, weights: BucketValues): BucketValues {
  const sumW = STORAGE_BUCKETS.reduce((a, k) => a + weights[k], 0);
  const out = zeroBuckets();
  if (sumW <= 0 || totalCents <= 0) return out;
  const raw = STORAGE_BUCKETS.map((k) => ({ k, v: (totalCents * weights[k]) / sumW }));
  let given = 0;
  for (const r of raw) { out[r.k] = Math.floor(r.v); given += out[r.k]; }
  raw.sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)));
  for (let i = 0; given < totalCents; i++, given++) out[raw[i % raw.length].k] += 1;
  return out;
}

const toM2 = (cents: number) => cents / 100;

export interface RackSpaceRow {
  rackId: string;
  rackCode: string;
  zone: string | null;
  isActive: boolean;
  hasSize: boolean;
  /** Rack footprint (L×W) in m²; null = size not entered. */
  rackSizeM2: number | null;
  /** true when the rack has a size AND at least one slot, so it is in the Layer 2 totals. */
  counted: boolean;
  slots: BucketValues & { total: number };
  /** m² per status; null when the rack is not counted. */
  areaM2: BucketValues | null;
  /** (occupied + reserved) ÷ rack size × 100; null when not counted. */
  utilPct: number | null;
}

export function rackSpaceRow(
  rack: RackLike & { id: string; zone?: string | null; isActive?: boolean },
  slots: StorageSlots,
): RackSpaceRow {
  const fp = footprintM2(effectiveRackSize(rack));
  const cents = fp != null ? Math.round(fp * 100) : null;
  const b: BucketValues = { occupied: slots.occupied, reserved: slots.reserved, available: slots.available, blockedOther: slots.blockedOther };
  const counted = cents != null && cents > 0 && slots.total > 0;
  const area = counted ? splitCents(cents!, b) : null;
  return {
    rackId: rack.id,
    rackCode: rack.code,
    zone: rack.zone ?? null,
    isActive: rack.isActive ?? true,
    hasSize: fp != null,
    rackSizeM2: cents != null ? toM2(cents) : null,
    counted,
    slots: { ...b, total: slots.total },
    areaM2: area ? { occupied: toM2(area.occupied), reserved: toM2(area.reserved), available: toM2(area.available), blockedOther: toM2(area.blockedOther) } : null,
    utilPct: area ? round(((area.occupied + area.reserved) / cents!) * 100, 1) : null,
  };
}

export interface FloorSpace {
  /** Full warehouse area L×W (100%); null = warehouse size not entered. */
  totalAreaM2: number | null;
  /** Sum of the real footprint of racks that have a size. */
  rackFootprintM2: number;
  /** total − footprint, NOT clamped: negative means racks exceed the warehouse (data problem). */
  availableM2: number | null;
  /** footprint ÷ total × 100, NOT clamped (can exceed 100). */
  utilPct: number | null;
  /** true when the rack footprint is larger than the warehouse area → show a "check data" warning. */
  overCapacity: boolean;
  racksWithoutSize: number;
  racksWithoutSizeCodes: string[];
}

export function floorSpace(wh: Size3, racks: RackLike[]): FloorSpace {
  const total = footprintM2(wh);
  const totalCents = total != null ? Math.round(total * 100) : null;
  let fpCents = 0;
  const withoutSizeCodes: string[] = [];
  for (const r of racks) {
    const fp = footprintM2(effectiveRackSize(r));
    if (fp == null) withoutSizeCodes.push(r.code); else fpCents += Math.round(fp * 100);
  }
  return {
    totalAreaM2: totalCents != null ? toM2(totalCents) : null,
    rackFootprintM2: toM2(fpCents),
    availableM2: totalCents != null ? toM2(totalCents - fpCents) : null,
    utilPct: totalCents ? round((fpCents / totalCents) * 100, 1) : null,
    overCapacity: totalCents != null && fpCents > totalCents,
    racksWithoutSize: withoutSizeCodes.length,
    racksWithoutSizeCodes: withoutSizeCodes,
  };
}

export interface StorageSpace {
  /** Sum of rack sizes of counted racks (size + at least one slot). */
  totalRackAreaM2: number;
  /** m² per status; the four always add up to totalRackAreaM2. */
  areaM2: BucketValues;
  /** Slot counts per status in counted racks. */
  slots: BucketValues & { total: number };
  /** (occupied + reserved) ÷ totalRackAreaM2 × 100; null when nothing is counted. */
  utilPct: number | null;
  racksCounted: number;
  /** Racks left out of Layer 2 because they have no size. */
  racksWithoutSizeCodes: string[];
  /** Racks with a size but no slots, also left out of Layer 2. */
  racksWithoutSlotsCodes: string[];
}

export function storageSpace(rows: RackSpaceRow[]): StorageSpace {
  const cents = zeroBuckets();
  const slots = { ...zeroBuckets(), total: 0 };
  let totalCents = 0;
  let counted = 0;
  const noSize: string[] = [];
  const noSlots: string[] = [];
  for (const r of rows) {
    if (!r.hasSize) { noSize.push(r.rackCode); continue; }
    if (!r.counted || !r.areaM2) { noSlots.push(r.rackCode); continue; }
    counted++;
    totalCents += Math.round(r.rackSizeM2! * 100);
    for (const k of STORAGE_BUCKETS) { cents[k] += Math.round(r.areaM2[k] * 100); slots[k] += r.slots[k]; }
    slots.total += r.slots.total;
  }
  return {
    totalRackAreaM2: toM2(totalCents),
    areaM2: { occupied: toM2(cents.occupied), reserved: toM2(cents.reserved), available: toM2(cents.available), blockedOther: toM2(cents.blockedOther) },
    slots,
    utilPct: totalCents > 0 ? round(((cents.occupied + cents.reserved) / totalCents) * 100, 1) : null,
    racksCounted: counted,
    racksWithoutSizeCodes: noSize,
    racksWithoutSlotsCodes: noSlots,
  };
}

/**
 * Stable shape returned by GET /warehouse-master/space-summary (one per warehouse).
 * Reused by the capacity planner, the simulator and (later) the dashboard.
 * All areas in m², volumes in m³; null = cannot be known (warehouse size not entered).
 */
export interface WarehouseSpaceSummary {
  warehouseId: string;
  code: string;
  name: string;
  isActive: boolean;
  dimensions: { lengthCm: number | null; widthCm: number | null; heightCm: number | null; usableAreaPct: number };
  hasSize: boolean;
  totalAreaM2: number | null;
  usableAreaM2: number | null;
  volumeM3: number | null;
  rackFootprintM2: number;
  standardFootprintM2: number;
  palletFootprintM2: number;
  freeAreaM2: number | null; // usable − footprint, never below 0
  overAllocatedM2: number; // footprint beyond usable area (0 normally)
  usedAreaPct: number | null; // footprint ÷ usable × 100
  racks: { total: number; standard: number; pallet: number; withoutSize: number; withoutSizeCodes: string[] };
  slots: SlotCounts;
  stockQty: number; // active stock quantity sitting in slots
  capacityUsedPct: number | null; // stockQty ÷ slots.capacity × 100
  /** Layer 1 — floor space vs the FULL warehouse area. */
  floor: FloorSpace;
  /** Layer 2 — rack storage space estimated from slot status share. */
  storage: StorageSpace;
}

export function buildSpaceSummary(
  wh: WarehouseLike & { id: string; code: string; name: string; isActive: boolean },
  racks: RackLike[],
  slots: SlotCounts,
  stockQty: number,
  rackRows: RackSpaceRow[] = [],
): WarehouseSpaceSummary {
  const area = warehouseArea(wh);
  const fp = rackFootprints(racks);
  const diff = area.usableAreaM2 != null ? area.usableAreaM2 - fp.totalM2 : null;
  return {
    warehouseId: wh.id,
    code: wh.code,
    name: wh.name,
    isActive: wh.isActive,
    dimensions: { lengthCm: wh.lengthCm ?? null, widthCm: wh.widthCm ?? null, heightCm: wh.heightCm ?? null, usableAreaPct: area.usableAreaPct },
    hasSize: area.hasSize,
    totalAreaM2: area.totalAreaM2,
    usableAreaM2: area.usableAreaM2,
    volumeM3: area.volumeM3,
    rackFootprintM2: fp.totalM2,
    standardFootprintM2: fp.standardM2,
    palletFootprintM2: fp.palletM2,
    freeAreaM2: diff == null ? null : round(Math.max(0, diff)),
    overAllocatedM2: diff == null ? 0 : round(Math.max(0, -diff)),
    usedAreaPct: area.usableAreaM2 ? round((fp.totalM2 / area.usableAreaM2) * 100, 1) : null,
    racks: { total: fp.racks, standard: fp.standardRacks, pallet: fp.palletRacks, withoutSize: fp.withoutSize, withoutSizeCodes: fp.withoutSizeCodes },
    slots: { ...slots },
    stockQty: round(stockQty),
    capacityUsedPct: slots.capacity > 0 ? round((stockQty / slots.capacity) * 100, 1) : null,
    floor: floorSpace(wh, racks),
    storage: storageSpace(rackRows),
  };
}

// ── Capacity planner (plan 1.3) ───────────────────────────────────────────────

export interface CapacityPlan {
  warehouseId: string;
  template: { id?: string; code?: string; name?: string; category: RackCategory; lengthCm: number; widthCm: number; heightCm: number; levels: number; columns: number; slotCapacity: number };
  templateFootprintM2: number | null;
  freeAreaM2: number | null;
  racksThatFit: number | null; // null = warehouse size or template size unknown
  slotsPerRack: number;
  slotsThatFit: number | null;
  slotSize: SlotSize;
  racksWithoutSize: number;
  racksWithoutSizeCodes: string[];
}

export function planCapacity(summary: WarehouseSpaceSummary, t: TemplateLike): CapacityPlan {
  const fp = footprintM2(t);
  const fit = summary.freeAreaM2 != null && fp ? Math.floor(summary.freeAreaM2 / fp + 1e-9) : null;
  const levels = Math.max(1, t.levels || 1);
  const columns = Math.max(1, t.columns || 1);
  const slotsPerRack = levels * columns;
  return {
    warehouseId: summary.warehouseId,
    template: {
      id: t.id, code: t.code, name: t.name,
      category: t.category === 'PALLET_ON_FLOOR' ? 'PALLET_ON_FLOOR' : 'STANDARD_RACK',
      lengthCm: t.lengthCm ?? 0, widthCm: t.widthCm ?? 0, heightCm: t.heightCm ?? 0,
      levels, columns, slotCapacity: t.slotCapacity ?? 1,
    },
    templateFootprintM2: fp != null ? round(fp, 3) : null,
    freeAreaM2: summary.freeAreaM2,
    racksThatFit: fit,
    slotsPerRack,
    slotsThatFit: fit != null ? fit * slotsPerRack : null,
    slotSize: slotSize(t, levels, columns),
    racksWithoutSize: summary.racks.withoutSize,
    racksWithoutSizeCodes: summary.racks.withoutSizeCodes,
  };
}

// ── Slot generation (plan 1.4) ────────────────────────────────────────────────

export const MAX_GRID = 99;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** `<RackCode>-<LL>-<CC>`, e.g. A01-01-08. */
export function slotCode(rackCode: string, level: number, column: number): string {
  return `${rackCode.trim()}-${pad2(level)}-${pad2(column)}`;
}

export interface PlannedSlot { code: string; level: number; column: number; exists: boolean }

/**
 * Every code for a levels × columns grid, flagged when the rack already has it
 * (including soft-deleted rows — the DB unique key still holds their code).
 */
export function planSlotCodes(rackCode: string, levels: number, columns: number, existingCodes: Iterable<string>): PlannedSlot[] {
  if (!Number.isInteger(levels) || !Number.isInteger(columns) || levels < 1 || columns < 1 || levels > MAX_GRID || columns > MAX_GRID) {
    throw new RangeError(`levels and columns must be whole numbers between 1 and ${MAX_GRID}`);
  }
  const existing = new Set(existingCodes);
  const out: PlannedSlot[] = [];
  for (let level = 1; level <= levels; level++) {
    for (let column = 1; column <= columns; column++) {
      const code = slotCode(rackCode, level, column);
      out.push({ code, level, column, exists: existing.has(code) });
    }
  }
  return out;
}

// ── Space simulator (plan 1.6) ────────────────────────────────────────────────

export interface SimLineInput {
  label: string;
  productId?: string | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  quantity: number;
  stackLayers: number;
}

export interface SimLineResult {
  label: string;
  productId: string | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  quantity: number;
  stackLayers: number;
  boxesPerLayer: number;
  boxesPerPallet: number;
  pallets: number;
  slots: number;
  areaM2: number;
  oversize: boolean; // box larger than the pallet → floor-stacked on its own footprint
  error: 'MISSING_SIZE' | null;
}

export interface Pallet { lengthCm: number; widthCm: number }

/** Boxes that fit on one pallet layer, trying both orientations. */
export function boxesPerLayer(p: Pallet, l: number, w: number): number {
  const a = Math.floor(p.lengthCm / l) * Math.floor(p.widthCm / w);
  const b = Math.floor(p.lengthCm / w) * Math.floor(p.widthCm / l);
  return Math.max(a, b);
}

export function simulateLine(line: SimLineInput, pallet: Pallet): SimLineResult {
  const quantity = Math.max(0, Math.ceil(line.quantity || 0));
  const stackLayers = Math.max(1, Math.floor(line.stackLayers || 1));
  const base = {
    label: line.label, productId: line.productId ?? null,
    lengthCm: line.lengthCm, widthCm: line.widthCm, heightCm: line.heightCm, quantity, stackLayers,
  };
  if (!pos(line.lengthCm) || !pos(line.widthCm)) {
    return { ...base, boxesPerLayer: 0, boxesPerPallet: 0, pallets: 0, slots: 0, areaM2: 0, oversize: false, error: 'MISSING_SIZE' };
  }
  const perLayer = boxesPerLayer(pallet, line.lengthCm, line.widthCm);
  if (perLayer === 0) {
    // Bigger than a pallet: stacks of `stackLayers` boxes on the box's own footprint.
    const stacks = Math.ceil(quantity / stackLayers);
    return {
      ...base, boxesPerLayer: 0, boxesPerPallet: 0, pallets: 0, slots: stacks,
      areaM2: round((stacks * line.lengthCm * line.widthCm) / 10_000, 3), oversize: true, error: null,
    };
  }
  const perPallet = perLayer * stackLayers;
  const pallets = Math.ceil(quantity / perPallet);
  return {
    ...base, boxesPerLayer: perLayer, boxesPerPallet: perPallet, pallets, slots: pallets,
    areaM2: round((pallets * pallet.lengthCm * pallet.widthCm) / 10_000, 3), oversize: false, error: null,
  };
}

export interface SimWarehouseFit {
  warehouseId: string;
  code: string;
  name: string;
  freeAreaM2: number | null;
  emptySlots: number;
  fitsArea: boolean | null; // null = warehouse size unknown
  freeAreaAfterM2: number | null;
  fitsSlots: boolean;
  emptySlotsAfter: number;
}

export interface SimulationResult {
  mode: 'AREA' | 'SLOTS' | 'ITEMS';
  pallet: Pallet;
  requiredAreaM2: number;
  requiredSlots: number;
  pallets: number;
  lines: SimLineResult[];
  warehouses: SimWarehouseFit[];
}

export function fitWarehouses(summaries: WarehouseSpaceSummary[], requiredAreaM2: number, requiredSlots: number): SimWarehouseFit[] {
  return summaries.map((s) => ({
    warehouseId: s.warehouseId,
    code: s.code,
    name: s.name,
    freeAreaM2: s.freeAreaM2,
    emptySlots: s.slots.empty,
    fitsArea: s.freeAreaM2 == null ? null : s.freeAreaM2 + 1e-9 >= requiredAreaM2,
    freeAreaAfterM2: s.freeAreaM2 == null ? null : round(s.freeAreaM2 - requiredAreaM2),
    fitsSlots: s.slots.empty >= requiredSlots,
    emptySlotsAfter: s.slots.empty - requiredSlots,
  }));
}

export function simulate(
  input: { mode: 'AREA' | 'SLOTS' | 'ITEMS'; areaM2?: number; slots?: number; pallet?: Partial<Pallet>; lines?: SimLineInput[] },
  summaries: WarehouseSpaceSummary[],
): SimulationResult {
  const pallet: Pallet = {
    lengthCm: pos(input.pallet?.lengthCm) ? input.pallet!.lengthCm! : 120,
    widthCm: pos(input.pallet?.widthCm) ? input.pallet!.widthCm! : 100,
  };
  let requiredAreaM2 = 0;
  let requiredSlots = 0;
  let pallets = 0;
  let lines: SimLineResult[] = [];
  if (input.mode === 'AREA') requiredAreaM2 = Math.max(0, input.areaM2 ?? 0);
  else if (input.mode === 'SLOTS') requiredSlots = Math.max(0, Math.ceil(input.slots ?? 0));
  else {
    lines = (input.lines ?? []).map((l) => simulateLine(l, pallet));
    for (const l of lines) { requiredAreaM2 += l.areaM2; requiredSlots += l.slots; pallets += l.pallets; }
  }
  requiredAreaM2 = round(requiredAreaM2, 3);
  return { mode: input.mode, pallet, requiredAreaM2, requiredSlots, pallets, lines, warehouses: fitWarehouses(summaries, requiredAreaM2, requiredSlots) };
}
