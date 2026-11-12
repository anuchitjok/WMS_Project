// PR8 Phase 5 — estimated pick route in the 3D view.
//
// Works only on the 3D scene's own world (metres): the floor, and every rack
// footprint as an obstacle. Floor plans drawn in 2D have no real scale (the scene
// stretches them so racks never overlap), so the route is an ESTIMATE that follows
// the 3D picture, not measured aisles. Pure functions, no React: tested from the
// backend jest run (see floor-scene.spec.ts for the pattern).
//
//   1. Walking grid: 0.5 m cells inside the floor; cells within a rack footprint
//      (+ a small clearance) are blocked. Operational areas stay walkable.
//   2. Each slot to pick is reached from the aisle cell in front of it (either
//      face of the rack, whichever is reachable and nearer the start).
//   3. Start = the Shipping area of the floor plan, else the middle of the front
//      floor edge (+Z, the side the default camera looks from). The tour returns there.
//   4. Stop order = nearest neighbour, then 2-opt, on real walking distances.
//   5. Each leg is a shortest 8-way path (no squeezing between two rack corners),
//      then straightened where the straight line stays clear.

import type { Scene3D, PlacedRack } from './scene-geometry';
import { pointInPolygon, spansAt, type Pt } from './floor-geometry';

export const ROUTE_CELL = 0.5;
/** Kept free round each rack, so the line never touches a rack face. */
const CLEAR = 0.1;
/** Big floors use coarser cells to keep this fast. */
const MAX_CELLS = 150_000;
/** Farthest a picker may stand from the slot centre when no aisle cell is right in front (m). */
const REACH = 1.5;

export type RouteStartKind = 'shipping' | 'entrance';
export interface PickStopIn { slotId: string; n: number }
export interface RouteStop {
  slotId: string;
  /** Walking order, 1-based. Unreachable stops come last. */
  order: number;
  /** Order line numbers picked here (a slot can hold more than one line). */
  lines: number[];
  /** Aisle point the picker stands on; null when no aisle reaches the slot. */
  at: Pt | null;
}
export interface PickRoute {
  start: Pt;
  startKind: RouteStartKind;
  stops: RouteStop[];
  /** Polyline on the floor (x, z), start → stops → start. Empty when nothing is reachable. */
  path: Pt[];
  lengthM: number;
  unreachable: string[];
}

// ─── Walking grid ────────────────────────────────────────────────────────────

export interface WalkGrid {
  minX: number; minZ: number; cell: number; nx: number; nz: number;
  /** 1 = walkable. */
  free: Uint8Array;
}

const idx = (g: WalkGrid, i: number, j: number) => j * g.nx + i;
const cellOf = (g: WalkGrid, [x, z]: Pt): [number, number] => [
  Math.min(g.nx - 1, Math.max(0, Math.floor((x - g.minX) / g.cell))),
  Math.min(g.nz - 1, Math.max(0, Math.floor((z - g.minZ) / g.cell))),
];
const centreOf = (g: WalkGrid, k: number): Pt => [g.minX + ((k % g.nx) + 0.5) * g.cell, g.minZ + (Math.floor(k / g.nx) + 0.5) * g.cell];

/** Rack-local coordinates of a world point (inverse of the scene's rack transform). */
function toLocal(p: Pick<PlacedRack, 'center' | 'rotY'>, x: number, z: number): [number, number] {
  const c = Math.cos(p.rotY), s = Math.sin(p.rotY);
  const dx = x - p.center[0], dz = z - p.center[1];
  return [dx * c - dz * s, dx * s + dz * c];
}
function toWorld(p: Pick<PlacedRack, 'center' | 'rotY'>, lx: number, lz: number): Pt {
  const c = Math.cos(p.rotY), s = Math.sin(p.rotY);
  return [p.center[0] + lx * c + lz * s, p.center[1] - lx * s + lz * c];
}

export function buildWalkGrid(scene: Pick<Scene3D, 'floor' | 'racks'>): WalkGrid {
  const f = scene.floor;
  const minX = f.cx - f.w / 2, minZ = f.cz - f.d / 2;
  let cell = ROUTE_CELL;
  while ((f.w / cell) * (f.d / cell) > MAX_CELLS) cell *= 1.5;
  const nx = Math.max(1, Math.ceil(f.w / cell)), nz = Math.max(1, Math.ceil(f.d / cell));
  const g: WalkGrid = { minX, minZ, cell, nx, nz, free: new Uint8Array(nx * nz) };

  for (let j = 0; j < nz; j++) {
    const z = minZ + (j + 0.5) * cell;
    for (let i = 0; i < nx; i++) {
      const x = minX + (i + 0.5) * cell;
      g.free[idx(g, i, j)] = !f.outline || pointInPolygon([x, z], f.outline) ? 1 : 0;
    }
  }
  // Each rack only touches the cells under its own bounding box.
  for (const p of scene.racks) {
    const hx = p.length / 2 + CLEAR, hz = p.depth / 2 + CLEAR;
    const r = Math.hypot(hx, hz);
    const [i0, j0] = cellOf(g, [p.center[0] - r, p.center[1] - r]);
    const [i1, j1] = cellOf(g, [p.center[0] + r, p.center[1] + r]);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const [lx, lz] = toLocal(p, minX + (i + 0.5) * cell, minZ + (j + 0.5) * cell);
        if (Math.abs(lx) <= hx && Math.abs(lz) <= hz) g.free[idx(g, i, j)] = 0;
      }
    }
  }
  return g;
}

/** Nearest walkable cell to a point (rings outwards); -1 when the floor has none. */
export function nearestFree(g: WalkGrid, pt: Pt, maxR = Math.max(g.nx, g.nz)): number {
  const [ci, cj] = cellOf(g, pt);
  let best = -1, bestD = Infinity;
  for (let r = 0; r <= maxR; r++) {
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue; // ring only
        if (i < 0 || j < 0 || i >= g.nx || j >= g.nz || !g.free[idx(g, i, j)]) continue;
        const c = centreOf(g, idx(g, i, j));
        const d = Math.hypot(c[0] - pt[0], c[1] - pt[1]);
        if (d < bestD) { bestD = d; best = idx(g, i, j); }
      }
    }
    if (best >= 0) return best; // the next ring is always farther
  }
  return best;
}

// ─── Shortest paths (8-way Dijkstra, no corner cutting) ──────────────────────

const STEP_DI = [1, -1, 0, 0, 1, 1, -1, -1];
const STEP_DJ = [0, 0, 1, -1, 1, -1, 1, -1];
const STEP_W = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

/**
 * Walking distance (cells) from `src` to every cell, plus the previous cell on each
 * path. With `targets`, stops as soon as every target is settled (their distances and
 * paths are final; cells farther away are left at Infinity).
 */
export function distanceField(g: WalkGrid, src: number, targets?: number[]): { dist: Float64Array; prev: Int32Array } {
  const n = g.nx * g.nz, nx = g.nx, nz = g.nz, free = g.free;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  if (src < 0 || !free[src]) return { dist, prev };
  let want = -1;
  const isTarget = targets ? new Uint8Array(n) : null;
  if (isTarget) { want = 0; for (const t of targets!) if (t >= 0 && !isTarget[t]) { isTarget[t] = 1; want++; } }
  // Binary min-heap of (cost, cell) in two growable typed arrays; no per-step allocation.
  let cap = 1024, size = 0;
  let hc = new Float64Array(cap), hk = new Int32Array(cap);
  const push = (c: number, k: number) => {
    if (size === cap) {
      cap *= 2;
      const nc = new Float64Array(cap); nc.set(hc); hc = nc;
      const nk = new Int32Array(cap); nk.set(hk); hk = nk;
    }
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hc[p] <= c) break;
      hc[i] = hc[p]; hk[i] = hk[p]; i = p;
    }
    hc[i] = c; hk[i] = k;
  };
  dist[src] = 0; push(0, src);
  while (size) {
    const d = hc[0], k = hk[0];
    // Pop: move the last item down from the root.
    const lc = hc[--size], lk = hk[size];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= size) break;
      const m = l + 1 < size && hc[l + 1] < hc[l] ? l + 1 : l;
      if (hc[m] >= lc) break;
      hc[i] = hc[m]; hk[i] = hk[m]; i = m;
    }
    hc[i] = lc; hk[i] = lk;

    if (d > dist[k]) continue;
    if (isTarget && isTarget[k]) { isTarget[k] = 0; if (--want === 0) break; }
    const ci = k % nx, cj = (k - ci) / nx;
    for (let s = 0; s < 8; s++) {
      const di = STEP_DI[s], dj = STEP_DJ[s];
      const a = ci + di, b = cj + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const nk = b * nx + a;
      if (!free[nk]) continue;
      // Diagonal only when both side cells are open (never squeeze past a rack corner).
      if (di && dj && (!free[cj * nx + a] || !free[b * nx + ci])) continue;
      const nd = d + STEP_W[s];
      if (nd < dist[nk]) { dist[nk] = nd; prev[nk] = k; push(nd, nk); }
    }
  }
  return { dist, prev };
}

/** True when the straight segment a→b only crosses walkable cells. */
function clearLine(g: WalkGrid, a: Pt, b: Pt): boolean {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(len / (g.cell / 4)));
  for (let s = 0; s <= n; s++) {
    const t = s / n;
    const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
    const i = Math.floor((x - g.minX) / g.cell), j = Math.floor((z - g.minZ) / g.cell);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.nz || !g.free[idx(g, i, j)]) return false;
  }
  return true;
}

/** Drop corners the walker can cut straight past. */
export function straighten(g: WalkGrid, pts: Pt[]): Pt[] {
  if (pts.length <= 2) return pts;
  const out: Pt[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !clearLine(g, pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

// ─── Stop order ──────────────────────────────────────────────────────────────

const tourLen = (d: number[][], t: number[]) => t.reduce((s, v, i) => s + d[v][t[(i + 1) % t.length]], 0);

/** Closed tour from node 0 through every node: nearest neighbour, then 2-opt. */
export function orderStops(d: number[][]): number[] {
  const n = d.length;
  if (n <= 2) return [...Array(n).keys()];
  const left = new Set([...Array(n).keys()].slice(1));
  const t = [0];
  while (left.size) {
    const last = t[t.length - 1];
    let best = -1;
    for (const k of left) if (best < 0 || d[last][k] < d[last][best]) best = k;
    t.push(best); left.delete(best);
  }
  // 2-opt: reverse t[i..j] while it shortens the closed tour (start stays first).
  for (let improved = true, guard = 0; improved && guard < 200; guard++) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = t[i - 1], b = t[i], c = t[j], e = t[(j + 1) % n];
        if (d[a][c] + d[b][e] < d[a][b] + d[c][e] - 1e-9) {
          t.splice(i, j - i + 1, ...t.slice(i, j + 1).reverse());
          improved = true;
        }
      }
    }
  }
  return t;
}

// ─── Start point ─────────────────────────────────────────────────────────────

export function routeStart(scene: Pick<Scene3D, 'floor' | 'areas'>, g: WalkGrid): { pt: Pt; kind: RouteStartKind } {
  const ship = scene.areas.find((a) => a.type === 'SHIPPING_AREA');
  if (ship) return { pt: [ship.cx, ship.cz], kind: 'shipping' };
  const f = scene.floor;
  const z = f.cz + f.d / 2 - g.cell; // just inside the front edge
  let x = f.cx;
  if (f.outline) {
    // Middle of the front edge part nearest the centre (L / U / T fronts can be split).
    const spans = spansAt(f.outline, z);
    if (spans.length) {
      const mids = spans.map(([a, b]) => (a + b) / 2);
      x = mids.reduce((m, v) => (Math.abs(v - f.cx) < Math.abs(m - f.cx) ? v : m), mids[0]);
    }
  }
  return { pt: [x, z], kind: 'entrance' };
}

// ─── Whole route ─────────────────────────────────────────────────────────────

/**
 * Estimated pick route for the given slots (each tagged with its order line
 * number). Slots missing from the scene are ignored.
 */
export function pickRoute(scene: Scene3D, picks: PickStopIn[]): PickRoute | null {
  // One stop per slot, keeping every line number picked there.
  const lines = new Map<string, number[]>();
  for (const p of picks) lines.set(p.slotId, [...(lines.get(p.slotId) ?? []), p.n]);
  const slots = scene.slots.filter((s) => lines.has(s.slot.id));
  if (!slots.length) return null;

  const g = buildWalkGrid(scene);
  const start = routeStart(scene, g);
  const startCell = nearestFree(g, start.pt);
  const fromStart = distanceField(g, startCell);
  const rackOf = new Map(scene.racks.map((p) => [p.rack.id, p]));

  // Where to stand for each slot: the aisle cell in front of either rack face.
  const stand = slots.map((s) => {
    const p = rackOf.get(s.rack.id);
    const pos: Pt = [s.pos[0], s.pos[2]];
    const cands: number[] = [];
    if (p) {
      const [lx] = toLocal(p, pos[0], pos[1]);
      const off = p.depth / 2 + CLEAR + g.cell * 0.75;
      for (const side of [1, -1]) {
        const k = nearestFree(g, toWorld(p, lx, side * off), 1);
        if (k >= 0) cands.push(k);
      }
    }
    // No free cell right in front: anything within arm's reach of the slot, else unreachable.
    if (!cands.length) { const k = nearestFree(g, pos, Math.ceil(REACH / g.cell)); if (k >= 0) cands.push(k); }
    const reach = cands.filter((k) => Number.isFinite(fromStart.dist[k]));
    reach.sort((a, b) => fromStart.dist[a] - fromStart.dist[b]);
    return reach[0] ?? -1;
  });

  const okIdx = slots.map((_, i) => i).filter((i) => stand[i] >= 0);
  const nodes = [startCell, ...okIdx.map((i) => stand[i])];
  // From each stop, search only until every other node is reached.
  const fields = [fromStart, ...okIdx.map((i) => distanceField(g, stand[i], nodes))];
  const d = nodes.map((_, a) => nodes.map((k) => fields[a].dist[k]));
  const tour = okIdx.length ? orderStops(d) : [0];

  // Legs: walk back along `prev` from the next node to this one.
  const path: Pt[] = [];
  let lengthM = 0;
  const legs = okIdx.length ? [...tour, 0] : [];
  for (let s = 0; s + 1 < legs.length; s++) {
    const from = legs[s], to = legs[s + 1];
    const cells: number[] = [];
    for (let k = nodes[to]; k !== -1; k = fields[from].prev[k]) { cells.push(k); if (k === nodes[from]) break; }
    cells.reverse();
    const leg = straighten(g, cells.map((k) => centreOf(g, k)));
    for (let i = 0; i < leg.length; i++) {
      if (path.length && i === 0) continue; // shared joint
      const q = leg[i], last = path[path.length - 1];
      if (last) lengthM += Math.hypot(q[0] - last[0], q[1] - last[1]);
      path.push(q);
    }
  }

  const orderOf = new Map<number, number>(); // slot index → walking order
  tour.slice(1).forEach((node, i) => orderOf.set(okIdx[node - 1], i + 1));
  let next = orderOf.size;
  const stops: RouteStop[] = slots.map((s, i) => ({
    slotId: s.slot.id,
    order: orderOf.get(i) ?? ++next,
    lines: lines.get(s.slot.id)!,
    at: stand[i] >= 0 ? centreOf(g, stand[i]) : null,
  })).sort((a, b) => a.order - b.order);

  return {
    start: startCell >= 0 ? centreOf(g, startCell) : start.pt,
    startKind: start.kind,
    stops,
    path,
    lengthM,
    unreachable: stops.filter((s) => !s.at).map((s) => s.slotId),
  };
}
