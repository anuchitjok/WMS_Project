// Setup health: what is missing or looks wrong in a warehouse's master data.
// One rule set for the 3D page and Warehouse Master, so both show the same list.
// Pure functions (no React) — the cards render the result.

import {
  type SizeCm, rackSizeWarnings, rackBiggerThanWarehouse, slotSizeCm, SIZE_WARN,
} from '../warehouse-master/size-rules';

/** The rack fields both APIs return (3D `/warehouse` and Warehouse Master tree). */
export interface HealthRack extends SizeCm {
  id: string;
  code: string;
  zone?: string | null;
  isActive?: boolean;
  levels: number;
  columns: number;
  rackType?: string | null;
  rackTypeMaster?: { category?: string | null } | null;
  /** Own size with gaps filled from the Rack Type (backend space-math). */
  effectiveSize?: SizeCm | null;
  slots?: unknown[];
  _count?: { slots?: number };
}
export interface HealthWarehouse extends SizeCm { code: string; racks: HealthRack[] }

export type MissingKey = 'whSize' | 'rackSize' | 'rackZone' | 'rackSlots';
/** Serious ones get a red outline in 3D; slotTooSmall is a softer hint. */
export type AnomalyKey = 'rackTooBig' | 'rackBiggerThanWh' | 'slotsOverGrid' | 'slotTooSmall'
  /** F4/F5 (3D only, from the placed scene): outside the floor, overlapping, could not be auto-placed. */
  | 'rackOutside' | 'rackOverlap' | 'rackUnplaced';

/** Rack ids with a position problem (3D scene placement). */
export interface PlacementIds { outside: string[]; overlap: string[]; unplaced: string[] }

export interface HealthItem<K extends string> { key: K; racks: { id: string; code: string }[] }
export interface SetupHealth {
  missing: HealthItem<MissingKey>[];
  anomalies: HealthItem<AnomalyKey>[];
  /** Racks to outline in red in 3D (serious anomalies only). */
  flagged: Set<string>;
  ok: boolean;
}

const pos = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const isFloor = (r: HealthRack) => r.rackType === 'PALLET' || r.rackTypeMaster?.category === 'PALLET_ON_FLOOR';
const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, undefined, { numeric: true });

/** Size used everywhere: backend effective size, else the rack's own values. */
export function sizeOf(r: HealthRack): SizeCm {
  const e = r.effectiveSize;
  return {
    lengthCm: pos(e?.lengthCm) ? e!.lengthCm : r.lengthCm ?? null,
    widthCm: pos(e?.widthCm) ? e!.widthCm : r.widthCm ?? null,
    heightCm: pos(e?.heightCm) ? e!.heightCm : r.heightCm ?? null,
  };
}

const slotCount = (r: HealthRack) => r.slots?.length ?? r._count?.slots ?? 0;

export function setupHealth(wh: HealthWarehouse, placement?: PlacementIds | null): SetupHealth {
  const racks = wh.racks.filter((r) => r.isActive !== false).slice().sort(byCode);
  const pick = (f: (r: HealthRack) => boolean) => racks.filter(f).map((r) => ({ id: r.id, code: r.code }));

  const missing: HealthItem<MissingKey>[] = [];
  if (!(pos(wh.lengthCm) && pos(wh.widthCm))) missing.push({ key: 'whSize', racks: [] });
  const add = <K extends string>(list: HealthItem<K>[], key: K, f: (r: HealthRack) => boolean) => {
    const found = pick(f);
    if (found.length) list.push({ key, racks: found });
  };
  add(missing, 'rackSize', (r) => { const s = sizeOf(r); return !(pos(s.lengthCm) && pos(s.widthCm)); });
  add(missing, 'rackZone', (r) => !r.zone?.trim());
  add(missing, 'rackSlots', (r) => slotCount(r) === 0);

  const anomalies: HealthItem<AnomalyKey>[] = [];
  add(anomalies, 'rackTooBig', (r) => rackSizeWarnings(sizeOf(r)).length > 0);
  add(anomalies, 'rackBiggerThanWh', (r) => rackBiggerThanWarehouse(sizeOf(r), wh));
  add(anomalies, 'slotsOverGrid', (r) => slotCount(r) > Math.max(1, r.levels) * Math.max(1, r.columns));
  add(anomalies, 'slotTooSmall', (r) => {
    const s = slotSizeCm(sizeOf(r), r.levels, r.columns, isFloor(r));
    return !!s && s.min < SIZE_WARN.slotMinCm;
  });

  if (placement) {
    const ids = (list: string[]) => { const set = new Set(list); return (r: HealthRack) => set.has(r.id); };
    add(anomalies, 'rackUnplaced', ids(placement.unplaced));
    add(anomalies, 'rackOutside', ids(placement.outside));
    add(anomalies, 'rackOverlap', ids(placement.overlap));
  }

  const flagged = new Set<string>();
  for (const a of anomalies) if (a.key !== 'slotTooSmall') for (const r of a.racks) flagged.add(r.id);
  return { missing, anomalies, flagged, ok: !missing.length && !anomalies.length };
}
