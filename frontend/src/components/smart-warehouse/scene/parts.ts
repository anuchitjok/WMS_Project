// Reusable 3D parts — Rack (uprights + bracing), Beam, Pallet, Carton, Slot —
// as plain instance lists (position / scale / rotation / owner). Each list is
// drawn by ONE InstancedMesh, so a warehouse of thousands of slots is a fixed,
// small number of draw calls.
//
// `owner` is the rack index (rack parts) or slot index (slot parts) in the
// WarehouseLayout. Colour is applied later from the owner, so a filter or
// selection change only rewrites colours, never the geometry.

import {
  type PlacedRack, type PlacedSlot, type WarehouseLayout,
  BAY_W, LEVEL_H, toWorld,
} from '../layout';

export interface PartItem {
  pos: [number, number, number];
  scale: [number, number, number];
  rotY: number;
  /** Tilt around the rack's own X axis (diagonal braces). */
  rotX?: number;
  owner: number;
  /** Brightness multiplier (cartons), so stacks don't look flat. */
  shade?: number;
}

const POST = 0.08;          // upright section
const BEAM_H = 0.11;
const PLATE_Y = 0.07;       // slot plate (deck) above the beam centre
const PALLET_H = 0.14;
const BRACE_PANEL = 1.1;

/** Rack-local point → world. */
function at(r: PlacedRack, lx: number, y: number, lz: number): [number, number, number] {
  const [x, z] = toWorld(r, lx, lz);
  return [x, y, z];
}

// ─── Rack: upright frames with zig-zag bracing ────────────────────────────────

export function rackFrameParts(racks: PlacedRack[]) {
  const uprights: PartItem[] = [];
  const braces: PartItem[] = [];
  for (const r of racks) {
    const hx = r.length / 2, hz = r.depth / 2;
    const bays = Math.round(r.length / BAY_W);
    for (let b = 0; b <= bays; b++) {
      const lx = b * BAY_W - hx;
      for (const lz of [-hz, hz]) uprights.push({ pos: at(r, lx, r.height / 2, lz), scale: [POST, r.height, POST * 0.9], rotY: r.rotY, owner: r.index });
      const n = Math.max(1, Math.round(r.height / BRACE_PANEL));
      const h = r.height / n;
      for (let i = 0; i < n; i++) {
        const len = Math.hypot(r.depth, h);
        const tilt = Math.atan2(h, r.depth);
        braces.push({ pos: at(r, lx, (i + 0.5) * h, 0), scale: [0.03, 0.03, len], rotY: r.rotY, rotX: i % 2 ? tilt : -tilt, owner: r.index });
      }
      for (const y of [0.08, r.height - 0.04]) braces.push({ pos: at(r, lx, y, 0), scale: [0.035, 0.035, r.depth], rotY: r.rotY, owner: r.index });
    }
  }
  return { uprights, braces };
}

// ─── Beam: front and back load beam per level per bay ─────────────────────────

export function beamParts(layout: WarehouseLayout) {
  const beams: PartItem[] = [];
  for (const s of layout.slots) {
    const r = layout.racks[s.rackIndex];
    const lx = (s.slot.bay - 0.5) * BAY_W - r.length / 2;
    for (const lz of [-r.depth / 2, r.depth / 2]) {
      beams.push({ pos: at(r, lx, s.floorY, lz), scale: [BAY_W - POST, BEAM_H, 0.05], rotY: r.rotY, owner: s.index });
    }
  }
  return beams;
}

// ─── Slot: deck plate, status tag, hit volume, status volume ──────────────────

export function slotParts(layout: WarehouseLayout) {
  const plates: PartItem[] = [];
  const tags: PartItem[] = [];
  const hits: PartItem[] = [];
  const volumes: PartItem[] = [];
  for (const s of layout.slots) {
    const r = layout.racks[s.rackIndex];
    const lx = (s.slot.bay - 0.5) * BAY_W - r.length / 2;
    const [w, , d] = s.size;
    // Deck plate the pallet stands on; carries the status colour.
    plates.push({ pos: at(r, lx, s.floorY + PLATE_Y, 0), scale: [w - 0.14, 0.03, d - 0.08], rotY: r.rotY, owner: s.index });
    // Location label on the front beam, status-coloured, readable from the aisle.
    tags.push({ pos: at(r, lx, s.floorY, r.depth / 2 + 0.03), scale: [0.34, BEAM_H * 0.8, 0.012], rotY: r.rotY, owner: s.index });
    // Invisible pick volume between the beams (inset so beams/uprights stay outside it).
    const hitH = LEVEL_H - 0.16;
    hits.push({ pos: at(r, lx, s.floorY + 0.08 + hitH / 2, 0), scale: [w - 0.12, hitH, d - 0.04], rotY: r.rotY, owner: s.index });
    // Status view: translucent block filling the slot.
    const vh = LEVEL_H - 0.3;
    volumes.push({ pos: at(r, lx, s.floorY + PLATE_Y + 0.02 + vh / 2, 0), scale: [w - 0.22, vh, d - 0.14], rotY: r.rotY, owner: s.index });
  }
  return { plates, tags, hits, volumes };
}

/** Pick shells for a whole rack: top cap and both end frames. They sit outside every slot volume. */
export function rackHitParts(racks: PlacedRack[]) {
  const out: PartItem[] = [];
  for (const r of racks) {
    out.push({ pos: at(r, 0, r.height + 0.12, 0), scale: [r.length + 0.1, 0.24, r.depth + 0.1], rotY: r.rotY, owner: r.index });
    for (const sx of [-1, 1]) out.push({ pos: at(r, sx * (r.length / 2 + 0.02), r.height / 2, 0), scale: [0.16, r.height, r.depth + 0.12], rotY: r.rotY, owner: r.index });
  }
  return out;
}

// ─── Pallet and Carton ────────────────────────────────────────────────────────

const shadeOf = (i: number, j: number) => 0.88 + (((i * 73 + j * 151) % 17) / 16) * 0.18;

/** Cartons to draw: proportional to qty / capacity, at least one when stocked. */
export function cartonCount(qty: number, capacity: number, cap: number) {
  if (qty <= 0 || cap <= 0) return 0;
  const fill = capacity > 0 ? Math.min(1, qty / capacity) : 1;
  return Math.max(1, Math.min(cap, Math.round(fill * cap)));
}

export function stockParts(layout: WarehouseLayout) {
  const palletTops: PartItem[] = [];
  const palletRunners: PartItem[] = [];
  const cartons: PartItem[] = [];
  for (const s of layout.slots) {
    if (s.slot.qty <= 0) continue;
    const r = layout.racks[s.rackIndex];
    const lx = (s.slot.bay - 0.5) * BAY_W - r.length / 2;
    const surface = s.floorY + PLATE_Y + 0.015;
    const pw = Math.min(s.size[0] - 0.2, 1.1), pd = Math.min(s.size[2] - 0.1, 1.0);
    palletTops.push({ pos: at(r, lx, surface + PALLET_H - 0.015, 0), scale: [pw, 0.03, pd], rotY: r.rotY, owner: s.index });
    for (const lz of [-pd / 2 + 0.05, 0, pd / 2 - 0.05]) {
      palletRunners.push({ pos: at(r, lx, surface + (PALLET_H - 0.03) / 2, lz), scale: [pw, PALLET_H - 0.03, 0.1], rotY: r.rotY, owner: s.index });
    }
    // 2 × 2 cartons per layer, up to 3 layers.
    const nx = 2, nz = 2, layers = 3;
    const room = LEVEL_H - 0.16 - PALLET_H - 0.12;
    const ch = Math.min(room / layers, 0.32);
    const cw = pw / nx, cd = pd / nz;
    const n = cartonCount(s.slot.qty, s.slot.capacity, nx * nz * layers);
    const y0 = surface + PALLET_H;
    for (let i = 0; i < n; i++) {
      const layer = Math.floor(i / (nx * nz));
      const cell = i % (nx * nz);
      const ix = cell % nx, iz = Math.floor(cell / nx);
      cartons.push({
        pos: at(r, lx + (ix + 0.5) * cw - pw / 2, y0 + layer * ch + (ch * 0.94) / 2, (iz + 0.5) * cd - pd / 2),
        scale: [cw * 0.92, ch * 0.94, cd * 0.92], rotY: r.rotY, owner: s.index, shade: shadeOf(s.index, i),
      });
    }
  }
  return { palletTops, palletRunners, cartons };
}

/** Everything static for one warehouse. Built once per warehouse. */
export function buildParts(layout: WarehouseLayout) {
  return {
    ...rackFrameParts(layout.racks),
    beams: beamParts(layout),
    ...slotParts(layout),
    rackHits: rackHitParts(layout.racks),
    ...stockParts(layout),
  };
}
export type Parts = ReturnType<typeof buildParts>;

/** Slot centre used by labels and the camera. */
export const slotCentre = (s: PlacedSlot): [number, number, number] => [s.pos[0], s.floorY + LEVEL_H / 2, s.pos[2]];
