// Pure mapping from the WMS tree (Warehouse → Rack → Slot) to 3D geometry for
// the 3D view. No three.js import here, so it stays cheap to load and easy to
// reason about.
//
// Where a rack sits on the floor:
//   1. If the 2D Floor Plan has a RACK object linked to it (rackId), use that
//      object's centre and orientation, so 2D and 3D agree.
//   2. Otherwise lay racks out automatically: one block per zone, racks as
//      parallel rows inside it.
// Slot colour follows the same placement-based states as the Racks & slots tab.

import type { LayoutObject } from '@/lib/api';
import {
  type RackData, type SlotData, type WarehouseData,
  isBlocked, isOccupied, slotUtil,
} from './occupancy';

// ─── Dimensions (world units ≈ metres) ─────────────────────────────────────────

export const SLOT_W = 1.0;   // along the rack (one column)
export const SLOT_H = 0.85;  // one level
export const RACK_D = 1.1;   // rack depth
export const BASE_Y = 0.12;  // first beam above the floor
const AISLE = 2.8;           // gap between rows of racks
const ZONE_GAP = 5;          // gap between zone blocks

// ─── Slot state (same rules as the Racks & slots tab) ──────────────────────────

export type SlotState3D = 'empty' | 'inUse' | 'full' | 'blocked';

export const slotState3D = (s: SlotData): SlotState3D =>
  isBlocked(s) ? 'blocked' : !isOccupied(s) ? 'empty' : slotUtil(s) >= 90 ? 'full' : 'inUse';

// One green ramp plus red for blocked — no rainbow.
export const STATE_3D: Record<SlotState3D, { label: string; color: string; swatch: string; pill: string }> = {
  empty:   { label: 'Empty',   color: '#e2e8f0', swatch: 'bg-slate-200 border-slate-300',     pill: 'bg-slate-100 text-slate-600' },
  inUse:   { label: 'In use',  color: '#86efac', swatch: 'bg-green-300 border-green-400',     pill: 'bg-emerald-50 text-emerald-700' },
  full:    { label: 'Full',    color: '#16a34a', swatch: 'bg-green-600 border-green-700',     pill: 'bg-green-600 text-white' },
  blocked: { label: 'Blocked', color: '#ef4444', swatch: 'bg-red-500 border-red-600',         pill: 'bg-red-50 text-red-700' },
};
export const GHOST_COLOR = '#f1f5f9'; // slots outside the current filter

// ─── Placed geometry ───────────────────────────────────────────────────────────

export interface PlacedSlot {
  slot: SlotData;
  rack: RackData;
  state: SlotState3D;
  /** World-space centre of the slot box. */
  pos: [number, number, number];
}

export interface PlacedRack {
  rack: RackData;
  /** World-space centre of the rack footprint (y = 0). */
  center: [number, number];
  /** Rotation around Y, radians. 0 = rack runs along +X. */
  rotY: number;
  levels: number;
  columns: number;
  length: number; // along the rack
  height: number;
  zone: string;
}

export interface ZoneArea { zone: string; minX: number; minZ: number; maxX: number; maxZ: number }

export interface Scene3D {
  racks: PlacedRack[];
  slots: PlacedSlot[];
  zones: ZoneArea[];
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number; maxY: number };
}

export const NO_ZONE = '—';
export const zoneOf = (r: RackData) => (r.zone && r.zone.trim()) || NO_ZONE;

/** Rack size from its slots, so a slot outside the declared grid still gets a cell. */
function rackDims(r: RackData) {
  let levels = Math.max(1, r.levels || 1);
  let columns = Math.max(1, r.columns || 1);
  for (const s of r.slots ?? []) {
    if (s.level > levels) levels = s.level;
    if (s.column > columns) columns = s.column;
  }
  return { levels, columns };
}

/** Local → world for a point on a rack. lx runs along the rack, lz across it. */
function toWorld(p: PlacedRack, lx: number, lz: number): [number, number] {
  const c = Math.cos(p.rotY), s = Math.sin(p.rotY);
  // three.js Y rotation: x' = x cos + z sin, z' = -x sin + z cos
  return [p.center[0] + lx * c + lz * s, p.center[1] - lx * s + lz * c];
}

export function rackCorners(p: PlacedRack): [number, number][] {
  const hx = p.length / 2, hz = RACK_D / 2;
  return [toWorld(p, -hx, -hz), toWorld(p, hx, -hz), toWorld(p, hx, hz), toWorld(p, -hx, hz)];
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
    const need = rackDims(r).columns * SLOT_W;
    const have = Math.max(o.width, o.height, 0.1);
    k = Math.max(k, need / have);
  }
  let linkedMaxZ = -Infinity;
  for (const r of linked) {
    const o = drawn.get(r.id)!;
    const { levels, columns } = rackDims(r);
    const alongX = o.width >= o.height;
    const rotY = (alongX ? 0 : -Math.PI / 2) - ((o.rotation || 0) * Math.PI) / 180;
    const p: PlacedRack = {
      rack: r, levels, columns, zone: zoneOf(r),
      center: [(o.x + o.width / 2) * k, (o.y + o.height / 2) * k],
      rotY, length: columns * SLOT_W, height: BASE_Y + levels * SLOT_H,
    };
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
    const blockLen = Math.max(...list.map((r) => rackDims(r).columns * SLOT_W));
    list.forEach((r, i) => {
      const { levels, columns } = rackDims(r);
      const length = columns * SLOT_W;
      placed.push({
        rack: r, levels, columns, zone, rotY: 0, length,
        height: BASE_Y + levels * SLOT_H,
        // Left-aligned in the block so rack ends line up along the main aisle.
        center: [cursorX + length / 2, startZ + RACK_D / 2 + i * (RACK_D + AISLE)],
      });
    });
    cursorX += blockLen + ZONE_GAP;
  }

  // Slots
  const slots: PlacedSlot[] = [];
  for (const p of placed) {
    for (const s of p.rack.slots ?? []) {
      const lx = (Math.max(1, s.column) - 0.5) * SLOT_W - p.length / 2;
      const [x, z] = toWorld(p, lx, 0);
      const y = BASE_Y + (Math.max(1, s.level) - 1) * SLOT_H + SLOT_H * 0.38;
      slots.push({ slot: s, rack: p.rack, state: slotState3D(s), pos: [x, y, z] });
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

  return { racks: placed, slots, zones, bounds: { minX, minZ, maxX, maxZ, maxY } };
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

// ─── View modes ────────────────────────────────────────────────────────────────
// Status: the four placement states above.
// Fill %: slotUtil = stock rows in the slot ÷ slot capacity (same rule as the
//         Racks & slots tab — capacity counts stock rows, not units).
// Stock age: whole days from the OLDEST receivedDate of stock still in the slot
//         to the server's `asOf` time (GET /warehouse/:id/slot-stock-age).
// Blocked slots stay red in every mode so a blocked location is never hidden.

export type ViewMode = 'status' | 'fill' | 'age';

export interface Band { label: string; color: string }

export const FILL_BANDS: (Band & { max: number })[] = [
  { max: 29, label: '1–29%', color: '#bbf7d0' },
  { max: 59, label: '30–59%', color: '#86efac' },
  { max: 89, label: '60–89%', color: '#22c55e' },
  { max: 100, label: '90–100%', color: '#15803d' },
];

export const AGE_BANDS: (Band & { maxDays: number })[] = [
  { maxDays: 6, label: 'Under 7 days', color: '#bbf7d0' },
  { maxDays: 30, label: '7–30 days', color: '#4ade80' },
  { maxDays: 90, label: '31–90 days', color: '#16a34a' },
  { maxDays: Infinity, label: 'Over 90 days', color: '#14532d' },
];

export const NO_AGE_COLOR = '#cbd5e1';   // occupied, but no age row (yet)
export const PALLET_COLOR = '#d5dbe3';   // empty slot: bare pallet

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
  if (mode === 'status') return STATE_3D[slotState3D(s)].color;
  if (mode === 'fill') return fillBand(slotUtil(s)).color;
  const d = ageOf?.(s.id);
  return d == null ? NO_AGE_COLOR : ageBand(d).color;
}
