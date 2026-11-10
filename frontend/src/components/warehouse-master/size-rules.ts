// Size sanity rules shared by the Warehouse / Rack / Rack Type forms, the 3D
// setup card and Warehouse Master. One place, so every screen warns the same way.
//
// WARN ONLY (decision G4, 10 Nov 2026): values past these limits show a yellow
// note but still save. Final block limits (and backend @Max) wait for the
// owner's approval — see .claude/plans/space-setup-ops-roadmap.md §3.

/** Warn above these sizes (metres), and below the slot minimum (cm). */
export const SIZE_WARN = {
  rackLengthM: 15,
  rackDepthM: 2,
  rackHeightM: 6,
  warehouseSideM: 300,
  warehouseHeightM: 30,
  slotMinCm: 25,
} as const;

export type SizeWarningKey =
  | 'rackLength' | 'rackDepth' | 'rackHeight'
  | 'warehouseSide' | 'warehouseHeight'
  | 'rackBiggerThanWarehouse' | 'slotTooSmall';

export interface SizeWarning {
  key: SizeWarningKey;
  /** Limit in metres (slotTooSmall: cm), for the message. */
  limit: number;
}

const pos = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

export interface SizeCm { lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null }

/** Rack / Rack Type size (cm) past the warn limits. Rack width = depth. */
export function rackSizeWarnings(s: SizeCm): SizeWarning[] {
  const out: SizeWarning[] = [];
  if (pos(s.lengthCm) && s.lengthCm / 100 > SIZE_WARN.rackLengthM) out.push({ key: 'rackLength', limit: SIZE_WARN.rackLengthM });
  if (pos(s.widthCm) && s.widthCm / 100 > SIZE_WARN.rackDepthM) out.push({ key: 'rackDepth', limit: SIZE_WARN.rackDepthM });
  if (pos(s.heightCm) && s.heightCm / 100 > SIZE_WARN.rackHeightM) out.push({ key: 'rackHeight', limit: SIZE_WARN.rackHeightM });
  return out;
}

/** Warehouse size (cm) past the warn limits. */
export function warehouseSizeWarnings(s: SizeCm): SizeWarning[] {
  const out: SizeWarning[] = [];
  const side = Math.max(pos(s.lengthCm) ? s.lengthCm : 0, pos(s.widthCm) ? s.widthCm : 0) / 100;
  if (side > SIZE_WARN.warehouseSideM) out.push({ key: 'warehouseSide', limit: SIZE_WARN.warehouseSideM });
  if (pos(s.heightCm) && s.heightCm / 100 > SIZE_WARN.warehouseHeightM) out.push({ key: 'warehouseHeight', limit: SIZE_WARN.warehouseHeightM });
  return out;
}

/**
 * Rack footprint does not fit the warehouse floor in either direction (racks
 * can be turned 90°) or is taller than the building. Unknown sizes never warn.
 */
export function rackBiggerThanWarehouse(rack: SizeCm, wh: SizeCm): boolean {
  if (!(pos(rack.lengthCm) && pos(rack.widthCm) && pos(wh.lengthCm) && pos(wh.widthCm))) return false;
  const [rl, rw] = [Math.max(rack.lengthCm, rack.widthCm), Math.min(rack.lengthCm, rack.widthCm)];
  const [wl, ww] = [Math.max(wh.lengthCm, wh.widthCm), Math.min(wh.lengthCm, wh.widthCm)];
  const tooTall = pos(rack.heightCm) && pos(wh.heightCm) && rack.heightCm > wh.heightCm;
  return rl > wl || rw > ww || !!tooTall;
}

/**
 * Size of one slot (cm). Shelf racks: length / columns × depth × (height / levels).
 * Pallet on floor: "levels" are rows across the depth. null when the size is unknown.
 */
export function slotSizeCm(s: SizeCm, levels: number, columns: number, floor: boolean) {
  if (!(pos(s.lengthCm) && pos(s.widthCm) && pos(s.heightCm) && levels >= 1 && columns >= 1)) return null;
  const w = s.lengthCm / columns, d = floor ? s.widthCm / levels : s.widthCm, h = floor ? s.heightCm : s.heightCm / levels;
  return { w, d, h, min: Math.min(w, d, floor ? Infinity : h) };
}
