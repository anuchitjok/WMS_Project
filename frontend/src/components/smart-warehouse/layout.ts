// Where every rack and slot sits in 3D (metres). Pure functions, no three.js,
// so it is cheap to load and easy to check.
//
// Default arrangement (when a rack has no `placement`):
//   • each aisle runs along X with a row of racks on both sides;
//     left-side racks face +Z into the aisle, right-side racks face -Z;
//   • aisles of a zone are stacked along Z, back to back;
//   • zones are laid out on a grid, two or more per row.
// Bay 1 is the left end of a rack as seen from its aisle.

import type { AisleNode, RackNode, SlotNode, SmartWarehouseData, ZoneNode } from './types';

export const BAY_W = 1.35;    // one pallet bay (1.2 m pallet + clearance)
export const LEVEL_H = 1.2;   // beam pitch
export const RACK_D = 1.1;    // frame depth
export const BASE_Y = 0.15;   // first beam above ground
export const TOP_GAP = 0.35;  // upright above the top beam
const RACK_GAP = 0.15;        // between racks in one row
const AISLE_W = 3.2;          // clear aisle width
const FLUE = 0.4;             // back-to-back gap between aisles
const ZONE_GAP = 6;

export interface PlacedRack {
  index: number;
  rack: RackNode;
  /** Footprint centre (y = 0). */
  cx: number;
  cz: number;
  rotY: number;
  length: number;
  depth: number;
  height: number;
}

export interface PlacedSlot {
  index: number;
  rackIndex: number;
  slot: SlotNode;
  /** Centre of the slot volume. */
  pos: [number, number, number];
  /** Along the rack, height, depth. */
  size: [number, number, number];
  /** Top of the beam the slot sits on. */
  floorY: number;
  rotY: number;
}

export interface AreaBox { id: string; minX: number; maxX: number; minZ: number; maxZ: number }

export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number }

export interface WarehouseLayout {
  warehouseId: string;
  racks: PlacedRack[];
  slots: PlacedSlot[];
  zones: (AreaBox & { zone: ZoneNode })[];
  aisles: (AreaBox & { aisle: AisleNode; label: [number, number] })[];
  bounds: Bounds;
  rackIndex: Map<string, number>;
  slotIndex: Map<string, number>;
  /** Slot indices per rack index. */
  slotsOfRack: number[][];
}

/** Rack-local (lx along, lz towards the aisle) → world XZ. */
export function toWorld(r: Pick<PlacedRack, 'cx' | 'cz' | 'rotY'>, lx: number, lz: number): [number, number] {
  const c = Math.cos(r.rotY), s = Math.sin(r.rotY);
  return [r.cx + lx * c + lz * s, r.cz - lx * s + lz * c];
}

/** Unit vector pointing out of the rack's face into its aisle. */
export function frontNormal(r: Pick<PlacedRack, 'rotY'>): [number, number] {
  return [Math.sin(r.rotY), Math.cos(r.rotY)];
}

export const rackLength = (bays: number) => bays * BAY_W;
export const rackHeight = (levels: number) => BASE_Y + levels * LEVEL_H + TOP_GAP;

function sortCode<T extends { code: string }>(a: T, b: T) {
  return a.code.localeCompare(b.code, undefined, { numeric: true });
}

export function buildLayout(data: SmartWarehouseData, warehouseId: string): WarehouseLayout {
  const zones = data.zones.filter((z) => z.warehouseId === warehouseId).sort(sortCode);
  const aislesByZone = new Map<string, AisleNode[]>();
  for (const a of data.aisles) {
    if (a.warehouseId !== warehouseId) continue;
    if (!aislesByZone.has(a.zoneId)) aislesByZone.set(a.zoneId, []);
    aislesByZone.get(a.zoneId)!.push(a);
  }
  const racksByAisle = new Map<string, RackNode[]>();
  for (const r of data.racks) {
    if (r.warehouseId !== warehouseId) continue;
    if (!racksByAisle.has(r.aisleId)) racksByAisle.set(r.aisleId, []);
    racksByAisle.get(r.aisleId)!.push(r);
  }

  const racks: PlacedRack[] = [];
  const zoneBoxes: WarehouseLayout['zones'] = [];
  const aisleBoxes: WarehouseLayout['aisles'] = [];
  const place = (rack: RackNode, cx: number, cz: number, rotY: number) => {
    const p = rack.placement;
    racks.push({
      index: racks.length, rack,
      cx: p?.x ?? cx, cz: p?.z ?? cz, rotY: p?.rotY ?? rotY,
      length: rackLength(rack.bays), depth: RACK_D, height: rackHeight(rack.levels),
    });
  };

  // Zone block sizes first, so the grid lines up.
  const blocks = zones.map((zone) => {
    const aisles = (aislesByZone.get(zone.id) ?? []).slice().sort(sortCode);
    let w = 0;
    for (const a of aisles) {
      const rs = racksByAisle.get(a.id) ?? [];
      const rowLen = (side: 'left' | 'right') => rs.filter((r) => r.side === side)
        .reduce((sum, r, i) => sum + rackLength(r.bays) + (i ? RACK_GAP : 0), 0);
      w = Math.max(w, rowLen('left'), rowLen('right'));
    }
    const d = aisles.length * (RACK_D * 2 + AISLE_W) + Math.max(0, aisles.length - 1) * FLUE;
    return { zone, aisles, w, d };
  });
  const cols = Math.max(1, Math.ceil(Math.sqrt(blocks.length)));
  const colW = Array.from({ length: cols }, (_, c) => Math.max(0, ...blocks.filter((_, i) => i % cols === c).map((b) => b.w)));
  const rowsN = Math.ceil(blocks.length / cols);
  const rowD = Array.from({ length: rowsN }, (_, r) => Math.max(0, ...blocks.slice(r * cols, r * cols + cols).map((b) => b.d)));

  blocks.forEach((b, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x0 = colW.slice(0, col).reduce((s, v) => s + v + ZONE_GAP, 0);
    const z0 = rowD.slice(0, row).reduce((s, v) => s + v + ZONE_GAP, 0);
    let z = z0;
    for (const a of b.aisles) {
      const rs = (racksByAisle.get(a.id) ?? []).slice().sort(sortCode);
      const leftZ = z + RACK_D / 2;
      const rightZ = z + RACK_D + AISLE_W + RACK_D / 2;
      for (const side of ['left', 'right'] as const) {
        let x = x0;
        for (const r of rs.filter((q) => q.side === side)) {
          const len = rackLength(r.bays);
          // Left row faces +Z (rotY 0); right row faces -Z (rotY π) so bay 1 is
          // on the picker's left from either side of the aisle.
          place(r, x + len / 2, side === 'left' ? leftZ : rightZ, side === 'left' ? 0 : Math.PI);
          x += len + RACK_GAP;
        }
      }
      const aMinZ = z, aMaxZ = z + RACK_D * 2 + AISLE_W;
      aisleBoxes.push({ id: a.id, aisle: a, minX: x0, maxX: x0 + b.w, minZ: aMinZ, maxZ: aMaxZ, label: [x0 - 0.6, z + RACK_D + AISLE_W / 2] });
      z = aMaxZ + FLUE;
    }
    zoneBoxes.push({ id: b.zone.id, zone: b.zone, minX: x0 - 1.5, maxX: x0 + b.w + 1.5, minZ: z0 - 1.5, maxZ: z0 + b.d + 1.5 });
  });

  // Racks with no zone/aisle in the tree still get drawn, in a row at the back.
  const placedIds = new Set(racks.map((r) => r.rack.id));
  let orphanX = 0;
  const orphanZ = rowD.reduce((s, v) => s + v + ZONE_GAP, 0);
  for (const r of data.racks) {
    if (r.warehouseId !== warehouseId || placedIds.has(r.id)) continue;
    const len = rackLength(r.bays);
    place(r, orphanX + len / 2, orphanZ, 0);
    orphanX += len + RACK_GAP;
  }

  const rackIndex = new Map(racks.map((r) => [r.rack.id, r.index]));
  const slots: PlacedSlot[] = [];
  const slotsOfRack: number[][] = racks.map(() => []);
  for (const s of data.slots) {
    if (s.warehouseId !== warehouseId) continue;
    const ri = rackIndex.get(s.rackId);
    if (ri == null) continue;
    const r = racks[ri];
    const lx = (Math.max(1, s.bay) - 0.5) * BAY_W - r.length / 2;
    const floorY = BASE_Y + (Math.max(1, s.level) - 1) * LEVEL_H;
    const [x, z] = toWorld(r, lx, 0);
    const idx = slots.length;
    slots.push({ index: idx, rackIndex: ri, slot: s, pos: [x, floorY + LEVEL_H / 2, z], size: [BAY_W, LEVEL_H, RACK_D], floorY, rotY: r.rotY });
    slotsOfRack[ri].push(idx);
  }

  return {
    warehouseId, racks, slots, zones: zoneBoxes, aisles: aisleBoxes,
    bounds: boundsOf(racks), rackIndex, slotIndex: new Map(slots.map((s) => [s.slot.id, s.index])), slotsOfRack,
  };
}

export function rackCorners(r: PlacedRack): [number, number][] {
  const hx = r.length / 2, hz = r.depth / 2;
  return [toWorld(r, -hx, -hz), toWorld(r, hx, -hz), toWorld(r, hx, hz), toWorld(r, -hx, hz)];
}

export function boundsOf(racks: PlacedRack[]): Bounds {
  if (!racks.length) return { minX: -5, maxX: 5, minZ: -5, maxZ: 5, maxY: 3 };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 0;
  for (const r of racks) {
    for (const [x, z] of rackCorners(r)) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    maxY = Math.max(maxY, r.height);
  }
  return { minX, maxX, minZ, maxZ, maxY };
}
