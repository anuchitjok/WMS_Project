// Pure mapping from the WMS tree (Warehouse → Rack → Slot) to 3D geometry for
// the 3D view. No three.js import here, so it stays cheap to load and easy to
// reason about (and to check without a browser).
//
// Where a rack sits on the floor:
//   1. If the 2D Floor Plan has a RACK object linked to it (rackId), use that
//      object's centre and orientation, so 2D and 3D agree. This still applies
//      while the 2D editor is hidden — positions drawn earlier are kept.
//   2. Otherwise lay racks out automatically: one block per zone, racks as
//      parallel rows inside it.
//
// Rack size: the rack's real size (Rack.lengthCm / widthCm / heightCm) when it
// has one, otherwise the defaults below. Two kinds of rack are drawn:
//   • shelf — selective pallet rack (uprights, beams, decks), slot = one bay cell
//   • floor — pallet on floor (rackType PALLET or template category
//             PALLET_ON_FLOOR): a marked floor area, slot = one pallet position.
//             "level" becomes a row across the area, since pallets aren't stacked
//             on beams.
// Slot colour follows the same placement-based states as the Racks & slots tab.

import type { LayoutObject } from '@/lib/api';
import {
  type RackData, type SlotData, type WarehouseData,
  isBlocked, isOccupied, slotUtil,
} from './occupancy';

// ─── Dimensions (world units = metres) ─────────────────────────────────────────

export const SLOT_W = 1.0;   // default: along the rack (one column)
export const SLOT_H = 0.85;  // default: one level
export const RACK_D = 1.1;   // default: rack depth
export const BASE_Y = 0.12;  // first beam above the floor
export const PALLET_H = 0.14; // wooden pallet height
const FLOOR_SLOT_W = 1.35;   // default pallet position (1.2 m pallet + gap)
const FLOOR_ROW_D = 1.25;    // default pallet row depth
const FLOOR_STACK_H = 1.5;   // default max stack height on the floor
const AISLE = 2.8;           // gap between rows of racks
const ZONE_GAP = 5;          // gap between zone blocks
export const FLOOR_MARGIN = 5; // floor around the racks

// ─── Slot state (same rules as the Racks & slots tab) ──────────────────────────

export type SlotState3D = 'empty' | 'inUse' | 'full' | 'blocked';

export const slotState3D = (s: SlotData): SlotState3D =>
  isBlocked(s) ? 'blocked' : !isOccupied(s) ? 'empty' : slotUtil(s) >= 90 ? 'full' : 'inUse';

// Labels are translated in the UI (layout3d.state.<key>); `label` is the English fallback.
export const STATE_3D: Record<SlotState3D, { label: string; color: string; swatch: string; pill: string }> = {
  empty:   { label: 'Empty',   color: '#e2e8f0', swatch: 'bg-slate-200 border-slate-300',     pill: 'bg-slate-100 text-slate-600' },
  inUse:   { label: 'In use',  color: '#86efac', swatch: 'bg-green-300 border-green-400',     pill: 'bg-emerald-50 text-emerald-700' },
  full:    { label: 'Full',    color: '#16a34a', swatch: 'bg-green-600 border-green-700',     pill: 'bg-green-600 text-white' },
  blocked: { label: 'Blocked', color: '#ef4444', swatch: 'bg-red-500 border-red-600',         pill: 'bg-red-50 text-red-700' },
};
export const GHOST_COLOR = '#e5e7eb'; // slots outside the current filter

// Real-warehouse palette (materials only, no photo textures).
export const COLORS = {
  upright: '#1d4ed8',   // blue upright frames
  beam: '#ea580c',      // orange load beams
  deck: '#cbd5e1',      // light wire / board deck
  carton: '#b98a5a',    // brown cardboard
  tape: '#d9b98c',      // packing tape on the carton top
  pallet: '#a47148',    // wooden pallet
  floor: '#d4d7da',     // light grey concrete
  floorJoint: '#c3c7cb',
  line: '#facc15',      // yellow floor marking
  sign: '#1e3a8a',      // overhead rack sign
  ghost: '#d1d5db',
} as const;

// ─── Placed geometry ───────────────────────────────────────────────────────────

export type RackKind = 'shelf' | 'floor';

export interface PlacedSlot {
  slot: SlotData;
  rack: RackData;
  state: SlotState3D;
  /** World-space centre of the slot volume. */
  pos: [number, number, number];
  /** Slot volume: along the rack, height, across the rack. */
  size: [number, number, number];
  /** Surface the stock stands on (deck top, or the floor). */
  baseY: number;
  rotY: number;
  kind: RackKind;
}

export interface PlacedRack {
  rack: RackData;
  kind: RackKind;
  /** World-space centre of the rack footprint (y = 0). */
  center: [number, number];
  /** Rotation around Y, radians. 0 = rack runs along +X. */
  rotY: number;
  levels: number;
  columns: number;
  length: number; // along the rack
  depth: number;  // across the rack
  height: number;
  /** One column (along the rack). */
  slotW: number;
  /** Shelf: one level. Floor: max stack height. */
  levelH: number;
  /** Floor only: one row across the area. Shelf: = depth. */
  rowD: number;
  zone: string;
}

export interface ZoneArea { zone: string; minX: number; minZ: number; maxX: number; maxZ: number }
export interface FloorRect { cx: number; cz: number; w: number; d: number }

export interface Scene3D {
  racks: PlacedRack[];
  slots: PlacedSlot[];
  zones: ZoneArea[];
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number; maxY: number };
  floor: FloorRect;
}

export const NO_ZONE = '—';
export const zoneOf = (r: RackData) => (r.zone && r.zone.trim()) || NO_ZONE;

/** Pallet-on-floor area rather than a beam rack. */
export const isFloorRack = (r: RackData) =>
  r.rackType === 'PALLET' || r.rackTypeMaster?.category === 'PALLET_ON_FLOOR';

/** cm → m, or null when missing / not a sensible size (0.3 m … 500 m). */
export function cmToM(cm: number | null | undefined): number | null {
  if (cm == null || !Number.isFinite(cm)) return null;
  const m = cm / 100;
  return m >= 0.3 && m <= 500 ? m : null;
}

/** Rack grid from its slots, so a slot outside the declared grid still gets a cell. */
export function rackGrid(r: RackData) {
  let levels = Math.max(1, r.levels || 1);
  let columns = Math.max(1, r.columns || 1);
  for (const s of r.slots ?? []) {
    if (s.level > levels) levels = s.level;
    if (s.column > columns) columns = s.column;
  }
  return { levels, columns };
}

/** Rack size in metres: real size when recorded, defaults otherwise. */
export function rackSize(r: RackData) {
  const { levels, columns } = rackGrid(r);
  const kind: RackKind = isFloorRack(r) ? 'floor' : 'shelf';
  if (kind === 'floor') {
    const length = cmToM(r.lengthCm) ?? columns * FLOOR_SLOT_W;
    const depth = cmToM(r.widthCm) ?? levels * FLOOR_ROW_D;
    const height = cmToM(r.heightCm) ?? FLOOR_STACK_H;
    return { kind, levels, columns, length, depth, height, slotW: length / columns, levelH: height, rowD: depth / levels };
  }
  const length = cmToM(r.lengthCm) ?? columns * SLOT_W;
  const depth = cmToM(r.widthCm) ?? RACK_D;
  const height = Math.max(cmToM(r.heightCm) ?? BASE_Y + levels * SLOT_H, BASE_Y + levels * 0.3);
  return { kind, levels, columns, length, depth, height, slotW: length / columns, levelH: (height - BASE_Y) / levels, rowD: depth };
}

/** Local → world for a point on a rack. lx runs along the rack, lz across it. */
function toWorld(p: Pick<PlacedRack, 'center' | 'rotY'>, lx: number, lz: number): [number, number] {
  const c = Math.cos(p.rotY), s = Math.sin(p.rotY);
  // three.js Y rotation: x' = x cos + z sin, z' = -x sin + z cos
  return [p.center[0] + lx * c + lz * s, p.center[1] - lx * s + lz * c];
}

export function rackCorners(p: PlacedRack): [number, number][] {
  const hx = p.length / 2, hz = p.depth / 2;
  return [toWorld(p, -hx, -hz), toWorld(p, hx, -hz), toWorld(p, hx, hz), toWorld(p, -hx, hz)];
}

/** Slot cell in rack-local coordinates (lx along, lz across, y = centre height). */
export function slotLocal(p: PlacedRack, level: number, column: number) {
  const col = Math.max(1, column), lvl = Math.max(1, level);
  const lx = (col - 0.5) * p.slotW - p.length / 2;
  if (p.kind === 'floor') {
    const lz = (lvl - 0.5) * p.rowD - p.depth / 2;
    return { lx, lz, baseY: 0, y: p.levelH / 2, size: [p.slotW, p.levelH, p.rowD] as [number, number, number] };
  }
  const baseY = BASE_Y + (lvl - 1) * p.levelH;
  return { lx, lz: 0, baseY, y: baseY + p.levelH / 2, size: [p.slotW, p.levelH, p.depth] as [number, number, number] };
}

/**
 * Floor slab: covers every rack plus a margin, and is at least the warehouse's
 * real size when that is recorded (length → X, width → Z), centred on the racks.
 */
export function floorRect(
  b: { minX: number; minZ: number; maxX: number; maxZ: number },
  wh?: Pick<WarehouseData, 'lengthCm' | 'widthCm'> | null,
  margin = FLOOR_MARGIN,
): FloorRect {
  const w = Math.max(b.maxX - b.minX + margin * 2, cmToM(wh?.lengthCm) ?? 0);
  const d = Math.max(b.maxZ - b.minZ + margin * 2, cmToM(wh?.widthCm) ?? 0);
  return { cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, w, d };
}

function place(r: RackData, center: [number, number], rotY: number, zone: string): PlacedRack {
  const sz = rackSize(r);
  return { rack: r, zone, center, rotY, ...sz };
}

export function buildScene(wh: WarehouseData | null, layoutObjects: LayoutObject[] = []): Scene3D {
  const racks = (wh?.racks ?? []).filter((r) => r.isActive !== false);
  const placed: PlacedRack[] = [];

  // 1) Racks drawn on the 2D floor plan.
  const drawn = new Map<string, LayoutObject>();
  for (const o of layoutObjects) if (o.objectType === 'RACK' && o.rackId) drawn.set(o.rackId, o);

  const linked = racks.filter((r) => drawn.has(r.id));
  // The plan's units are arbitrary; scale it up just enough that every linked
  // rack fits its drawn footprint, so racks never overlap each other.
  let k = 1;
  for (const r of linked) {
    const o = drawn.get(r.id)!;
    const need = rackSize(r).length;
    const have = Math.max(o.width, o.height, 0.1);
    k = Math.max(k, need / have);
  }
  let linkedMaxZ = -Infinity;
  for (const r of linked) {
    const o = drawn.get(r.id)!;
    const alongX = o.width >= o.height;
    const rotY = (alongX ? 0 : -Math.PI / 2) - ((o.rotation || 0) * Math.PI) / 180;
    const p = place(r, [(o.x + o.width / 2) * k, (o.y + o.height / 2) * k], rotY, zoneOf(r));
    placed.push(p);
    for (const [, z] of rackCorners(p)) linkedMaxZ = Math.max(linkedMaxZ, z);
  }

  // 2) Everything else: zone blocks side by side, rows inside each block.
  const rest = racks.filter((r) => !drawn.has(r.id));
  const byZone = new Map<string, RackData[]>();
  for (const r of rest) {
    const z = zoneOf(r);
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z)!.push(r);
  }
  const zoneNames = [...byZone.keys()].sort((a, b) => (a === NO_ZONE ? 1 : b === NO_ZONE ? -1 : a.localeCompare(b, undefined, { numeric: true })));
  const startZ = Number.isFinite(linkedMaxZ) ? linkedMaxZ + ZONE_GAP : 0;
  let cursorX = 0;
  for (const zone of zoneNames) {
    const list = byZone.get(zone)!.slice().sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    const sizes = list.map(rackSize);
    const blockLen = Math.max(...sizes.map((s) => s.length));
    let z = startZ;
    list.forEach((r, i) => {
      const { length, depth } = sizes[i];
      // Left-aligned in the block so rack ends line up along the main aisle.
      placed.push(place(r, [cursorX + length / 2, z + depth / 2], 0, zone));
      z += depth + AISLE;
    });
    cursorX += blockLen + ZONE_GAP;
  }

  // Slots
  const slots: PlacedSlot[] = [];
  for (const p of placed) {
    for (const s of p.rack.slots ?? []) {
      const c = slotLocal(p, s.level, s.column);
      const [x, z] = toWorld(p, c.lx, c.lz);
      slots.push({ slot: s, rack: p.rack, state: slotState3D(s), pos: [x, c.y, z], size: c.size, baseY: c.baseY, rotY: p.rotY, kind: p.kind });
    }
  }

  // Zone floor areas (around each zone's racks)
  const zoneBox = new Map<string, ZoneArea>();
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, maxY = 0;
  for (const p of placed) {
    for (const [x, z] of rackCorners(p)) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      const b = zoneBox.get(p.zone) ?? { zone: p.zone, minX: x, minZ: z, maxX: x, maxZ: z };
      b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x); b.minZ = Math.min(b.minZ, z); b.maxZ = Math.max(b.maxZ, z);
      zoneBox.set(p.zone, b);
    }
    maxY = Math.max(maxY, p.height);
  }
  if (!placed.length) { minX = -5; minZ = -5; maxX = 5; maxZ = 5; }
  const zones = [...zoneBox.values()].map((b) => ({ ...b, minX: b.minX - 1.2, minZ: b.minZ - 1.2, maxX: b.maxX + 1.2, maxZ: b.maxZ + 1.2 }));
  const bounds = { minX, minZ, maxX, maxZ, maxY };

  return { racks: placed, slots, zones, bounds, floor: floorRect(bounds, wh) };
}

/** Bounds of a subset of racks (used to frame the camera on a filter). */
export function boundsOf(racks: PlacedRack[]) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, maxY = 1;
  for (const p of racks) {
    for (const [x, z] of rackCorners(p)) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    maxY = Math.max(maxY, p.height);
  }
  if (!racks.length) return { minX: -5, minZ: -5, maxX: 5, maxZ: 5, maxY };
  return { minX, minZ, maxX, maxZ, maxY };
}

export { toWorld as rackToWorld };

// ─── Rack structure (uprights, bracing, beams) ─────────────────────────────────

/** Column boundaries that get an upright frame: both ends, then every bay (~2.7 m). */
export function frameColumns(columns: number, slotW: number): number[] {
  const every = Math.max(1, Math.round(2.7 / Math.max(slotW, 0.1)));
  const out: number[] = [];
  for (let c = 0; c <= columns; c += every) out.push(c);
  if (out[out.length - 1] !== columns) out.push(columns);
  return out;
}

/** Diagonal bracing panels up a frame: [yBottom, yTop] pairs, ~1.2 m each, zig-zag. */
export function bracingPanels(height: number, panel = 1.2): [number, number][] {
  const n = Math.max(1, Math.round(height / panel));
  const h = height / n;
  return Array.from({ length: n }, (_, i) => [i * h, (i + 1) * h] as [number, number]);
}

// ─── Cartons on a slot ─────────────────────────────────────────────────────────

export interface CartonBox {
  /** Centre, local to the slot: x along the rack, z across, y above the pallet top. */
  x: number; y: number; z: number;
  sx: number; sy: number; sz: number;
}

/** How many cartons a slot can show, given its space. */
export function cartonGrid(w: number, d: number, h: number, maxLayers = 3) {
  const nx = w >= 0.9 ? 2 : 1;
  const nz = d >= 0.7 ? 2 : 1;
  const layers = Math.max(1, Math.min(maxLayers, Math.floor(h / 0.28)));
  return { nx, nz, layers, cap: nx * nz * layers };
}

/**
 * Number of cartons to draw: none when empty, otherwise proportional to slot
 * fill (stock rows ÷ capacity), at least one, at most `cap`.
 */
export function cartonCount(slot: SlotData, cap: number): number {
  if (!isOccupied(slot) || cap <= 0) return 0;
  return Math.max(1, Math.min(cap, Math.round((slotUtil(slot) / 100) * cap)));
}

/**
 * Lay `count` cartons on a pallet of size w × d with height h available above it.
 * Bottom layer fills first; boxes are slightly smaller than their cell so the
 * gaps read as separate cartons.
 */
export function cartonLayout(count: number, w: number, d: number, h: number, maxLayers = 3): CartonBox[] {
  const { nx, nz, layers, cap } = cartonGrid(w, d, h, maxLayers);
  const n = Math.max(0, Math.min(cap, Math.floor(count)));
  const cw = w / nx, cd = d / nz;
  const ch = Math.min(h / layers, 0.5);
  const out: CartonBox[] = [];
  for (let i = 0; i < n; i++) {
    const layer = Math.floor(i / (nx * nz));
    const cell = i % (nx * nz);
    const ix = cell % nx, iz = Math.floor(cell / nx);
    out.push({
      x: (ix + 0.5) * cw - w / 2,
      z: (iz + 0.5) * cd - d / 2,
      y: layer * ch + (ch * 0.94) / 2,
      sx: cw * 0.92, sy: ch * 0.94, sz: cd * 0.92,
    });
  }
  return out;
}

// ─── View modes ────────────────────────────────────────────────────────────────
// Status: cartons are drawn in natural cardboard brown; the number of cartons
//         shows how full a slot is and an empty slot is an empty shelf.
// Fill %: slotUtil = stock rows in the slot ÷ slot capacity (same rule as the
//         Racks & slots tab — capacity counts stock rows, not units).
// Stock age: whole days from the OLDEST receivedDate of stock still in the slot
//         to the server's `asOf` time (GET /warehouse/:id/slot-stock-age).
// Blocked slots stay red in every mode so a blocked location is never hidden.

export type ViewMode = 'status' | 'fill' | 'age';

/** `key` is the translation key under layout3d.bands; `label` is the English fallback. */
export interface Band { key: string; label: string; color: string }

export const FILL_BANDS: (Band & { max: number })[] = [
  { key: 'fill1', max: 29, label: '1–29%', color: '#bbf7d0' },
  { key: 'fill2', max: 59, label: '30–59%', color: '#86efac' },
  { key: 'fill3', max: 89, label: '60–89%', color: '#22c55e' },
  { key: 'fill4', max: 100, label: '90–100%', color: '#15803d' },
];

export const AGE_BANDS: (Band & { maxDays: number })[] = [
  { key: 'age1', maxDays: 6, label: 'Under 7 days', color: '#bbf7d0' },
  { key: 'age2', maxDays: 30, label: '7–30 days', color: '#4ade80' },
  { key: 'age3', maxDays: 90, label: '31–90 days', color: '#16a34a' },
  { key: 'age4', maxDays: Infinity, label: 'Over 90 days', color: '#14532d' },
];

export const NO_AGE_COLOR = '#cbd5e1';   // occupied, but no age row (yet)
export const PALLET_COLOR = COLORS.deck; // legend swatch for an empty slot (bare deck)

export const fillBand = (util: number) => FILL_BANDS.find((b) => util <= b.max) ?? FILL_BANDS[FILL_BANDS.length - 1];
export const ageBand = (days: number) => AGE_BANDS.find((b) => days <= b.maxDays) ?? AGE_BANDS[AGE_BANDS.length - 1];

export function ageDays(oldestIso: string, asOfIso: string): number {
  const d = (Date.parse(asOfIso) - Date.parse(oldestIso)) / 86_400_000;
  return Number.isFinite(d) ? Math.max(0, Math.floor(d)) : 0;
}

/** Carton colour for a slot in the given mode; null = no carton (empty slot). */
export function slotColor(s: SlotData, mode: ViewMode, ageOf?: (slotId: string) => number | null): string | null {
  if (isBlocked(s)) return STATE_3D.blocked.color;
  if (!isOccupied(s)) return null;
  if (mode === 'status') return COLORS.carton;
  if (mode === 'fill') return fillBand(slotUtil(s)).color;
  const d = ageOf?.(s.id);
  return d == null ? NO_AGE_COLOR : ageBand(d).color;
}
