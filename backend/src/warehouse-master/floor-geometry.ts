// Floor geometry for warehouses that are not plain rectangles (L, U, T, custom).
//
// Pure functions, no imports: the SAME file lives in
//   backend/src/warehouse-master/floor-geometry.ts   (source of truth)
//   frontend/src/components/warehouse-layout/floor-geometry.ts (copy)
// and a backend test fails when the two differ. Edit the backend file, then copy.
//
// Coordinates are metres. (0, 0) is the warehouse's top-left corner; X runs
// along the length, Z along the width — the same axes as the 3D view.
// A rectangle outline gives exactly the old length × width figures.

export type Pt = [number, number];
export type ShapeKind = 'RECT' | 'L' | 'U' | 'T' | 'CUSTOM';
export type Corner = 'NW' | 'NE' | 'SE' | 'SW';
export type Side = 'N' | 'E' | 'S' | 'W';

/** Stored in Warehouse.floorOutline (JSON). */
export interface FloorOutline {
  version: 1;
  unit: 'm';
  /** Template it was made from, so the form can reopen it the same way. */
  shape: ShapeKind;
  points: Pt[];
  /** Template inputs (metres), for reopening the form. */
  params?: Record<string, number | string>;
}

export const MAX_OUTLINE_POINTS = 200;
const EPS = 1e-9;

// ── Basics ────────────────────────────────────────────────────────────────────

/** Shoelace sum / 2. Positive = counter-clockwise in X-right / Z-up maths terms. */
export function signedArea(points: Pt[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i], [x2, z2] = points[(i + 1) % points.length];
    s += x1 * z2 - x2 * z1;
  }
  return s / 2;
}

/** Floor area (m²) of a simple polygon — concave parts are not counted. */
export const polygonArea = (points: Pt[]) => Math.abs(signedArea(points));

export function bbox(points: Pt[]) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ, length: maxX - minX, width: maxZ - minZ };
}

/** Length of every side, in point order (side i runs from point i to i+1). */
export function edgeLengths(points: Pt[]): number[] {
  return points.map((p, i) => {
    const q = points[(i + 1) % points.length];
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
}

const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/**
 * Clean list: drops a repeated closing point, repeated neighbours and points on
 * a straight line, and orders the points with a positive signed area.
 */
export function normalizeOutline(points: Pt[]): Pt[] {
  let pts = points.map((p) => [Number(p[0]), Number(p[1])] as Pt);
  if (pts.length > 1 && same(pts[0], pts[pts.length - 1])) pts = pts.slice(0, -1);
  pts = pts.filter((p, i) => !same(p, pts[(i + 1) % pts.length]) || pts.length === 1);
  // drop collinear points (repeat until stable)
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      if (Math.abs(cross(a, b, c)) < 1e-9) { pts = pts.filter((_, j) => j !== i); changed = true; break; }
    }
  }
  if (signedArea(pts) < 0) pts = pts.slice().reverse();
  return pts;
}

// ── Point / segment tests ─────────────────────────────────────────────────────

function onSegment(p: Pt, a: Pt, b: Pt): boolean {
  if (Math.abs(cross(a, b, p)) > 1e-7) return false;
  return p[0] >= Math.min(a[0], b[0]) - 1e-7 && p[0] <= Math.max(a[0], b[0]) + 1e-7
    && p[1] >= Math.min(a[1], b[1]) - 1e-7 && p[1] <= Math.max(a[1], b[1]) + 1e-7;
}

/** Inside or on the edge (a rack may stand against a wall). */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (onSegment(p, a, b)) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** True when the two segments cross at a single interior point (touching does not count). */
export function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

/** Any contact at all (crossing, touching, overlapping) — used to reject self-intersecting outlines. */
function segmentsTouch(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  return segmentsCross(a, b, c, d) || onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b);
}

// ── Outline validation ────────────────────────────────────────────────────────

export type OutlineError = 'TOO_FEW_POINTS' | 'TOO_MANY_POINTS' | 'BAD_NUMBER' | 'DUPLICATE_POINT' | 'SELF_INTERSECT' | 'ZERO_AREA';

/** Problems with an outline (empty list = usable). Checks the raw points, then the cleaned shape. */
export function validateOutline(points: unknown, maxPoints = MAX_OUTLINE_POINTS): OutlineError[] {
  if (!Array.isArray(points)) return ['TOO_FEW_POINTS'];
  if (points.length > maxPoints + 1) return ['TOO_MANY_POINTS'];
  if (!points.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)))) return ['BAD_NUMBER'];
  const pts = normalizeOutline(points as Pt[]);
  if (pts.length < 3) return ['TOO_FEW_POINTS'];
  if (pts.length > maxPoints) return ['TOO_MANY_POINTS'];
  const errs: OutlineError[] = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (same(pts[i], pts[j])) { errs.push('DUPLICATE_POINT'); i = pts.length; break; }
  const n = pts.length;
  outer: for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // neighbours share a point
      if (segmentsTouch(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) { errs.push('SELF_INTERSECT'); break outer; }
    }
  }
  if (polygonArea(pts) < 1e-6) errs.push('ZERO_AREA');
  return errs;
}

/** True when every side runs along X or Z (L, U, T and similar). */
export function isRectilinear(points: Pt[]): boolean {
  return points.every((p, i) => {
    const q = points[(i + 1) % points.length];
    return Math.abs(p[0] - q[0]) < 1e-6 || Math.abs(p[1] - q[1]) < 1e-6;
  });
}

// ── Racks (rotated rectangles) ────────────────────────────────────────────────

export interface FloorRect { center: Pt; length: number; depth: number; rotY: number }

/** Corners of a rack, same convention as the 3D view (three.js Y rotation). */
export function rectCorners(r: FloorRect): Pt[] {
  const c = Math.cos(r.rotY), s = Math.sin(r.rotY), hx = r.length / 2, hz = r.depth / 2;
  const w = (lx: number, lz: number): Pt => [r.center[0] + lx * c + lz * s, r.center[1] - lx * s + lz * c];
  return [w(-hx, -hz), w(hx, -hz), w(hx, hz), w(-hx, hz)];
}

/** The whole rack is on the floor: corners inside, no wall crosses it, no wall corner pokes into it. */
export function rectInPolygon(r: FloorRect, poly: Pt[]): boolean {
  const c = rectCorners(r);
  if (!c.every((p) => pointInPolygon(p, poly))) return false;
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    for (let j = 0; j < poly.length; j++) if (segmentsCross(a, b, poly[j], poly[(j + 1) % poly.length])) return false;
  }
  return !poly.some((v) => strictlyInsideConvex(v, c));
}

function strictlyInsideConvex(p: Pt, quad: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < quad.length; i++) {
    const v = cross(quad[i], quad[(i + 1) % quad.length], p);
    if (Math.abs(v) < 1e-7) return false; // on the edge = touching, allowed
    const sg = v > 0 ? 1 : -1;
    if (sign && sg !== sign) return false;
    sign = sg;
  }
  return true;
}

/**
 * Two racks overlap (Separating Axis Test). Touching is fine; `gap` (m) asks for
 * that much free space between them (an aisle).
 */
export function rectsOverlap(a: FloorRect, b: FloorRect, gap = 0): boolean {
  const grow = (r: FloorRect): FloorRect => ({ ...r, length: r.length + gap, depth: r.depth + gap });
  const ca = rectCorners(gap ? grow(a) : a), cb = rectCorners(gap ? grow(b) : b);
  for (const poly of [ca, cb]) {
    for (let i = 0; i < 2; i++) {
      const p = poly[i], q = poly[i + 1];
      const ax = q[1] - p[1], az = p[0] - q[0]; // edge normal
      const proj = (pts: Pt[]) => pts.map(([x, z]) => x * ax + z * az);
      const pa = proj(ca), pb = proj(cb);
      if (Math.max(...pa) <= Math.min(...pb) + 1e-7 || Math.max(...pb) <= Math.min(...pa) + 1e-7) return false;
    }
  }
  return true;
}

/** Problems for one rack: outside the floor, or overlapping other racks (by index). */
export function rackPlacementIssues(rack: FloorRect, floor: Pt[] | null, others: FloorRect[] = [], gap = 0) {
  const outside = floor ? !rectInPolygon(rack, floor) : false;
  const overlaps = others.map((o, i) => (rectsOverlap(rack, o, gap) ? i : -1)).filter((i) => i >= 0);
  return { outside, overlaps };
}

// ── Split a rectilinear floor into rectangles (for automatic layout) ─────────

export interface FloorPart { minX: number; minZ: number; maxX: number; maxZ: number; area: number }

/**
 * Rectilinear outline → non-overlapping rectangles covering it, biggest first.
 * Cells between the outline's X and Z lines are merged into horizontal strips,
 * then strips with the same X range are stacked. null for other shapes.
 */
export function splitRectilinear(points: Pt[]): FloorPart[] | null {
  const pts = normalizeOutline(points);
  if (pts.length < 4 || !isRectilinear(pts)) return null;
  const xs = [...new Set(pts.map((p) => p[0]))].sort((a, b) => a - b);
  const zs = [...new Set(pts.map((p) => p[1]))].sort((a, b) => a - b);
  // strips per row band
  type Strip = { x0: number; x1: number; z0: number; z1: number };
  const rows: Strip[][] = [];
  for (let j = 0; j < zs.length - 1; j++) {
    const z0 = zs[j], z1 = zs[j + 1], zm = (z0 + z1) / 2;
    const strips: Strip[] = [];
    let cur: Strip | null = null;
    for (let i = 0; i < xs.length - 1; i++) {
      const inside = pointInPolygon([(xs[i] + xs[i + 1]) / 2, zm], pts);
      if (inside) { if (cur && Math.abs(cur.x1 - xs[i]) < 1e-9) cur.x1 = xs[i + 1]; else { cur = { x0: xs[i], x1: xs[i + 1], z0, z1 }; strips.push(cur); } }
      else cur = null;
    }
    rows.push(strips);
  }
  // stack strips with the same x range across consecutive rows
  const out: Strip[] = [];
  const open: Strip[] = [];
  for (const strips of rows) {
    const next: Strip[] = [];
    for (const s of strips) {
      const above = open.find((o) => Math.abs(o.x0 - s.x0) < 1e-9 && Math.abs(o.x1 - s.x1) < 1e-9 && Math.abs(o.z1 - s.z0) < 1e-9);
      if (above) { above.z1 = s.z1; next.push(above); } else { next.push(s); out.push(s); }
    }
    open.length = 0; open.push(...next);
  }
  return out
    .map((s) => ({ minX: s.x0, minZ: s.z0, maxX: s.x1, maxZ: s.z1, area: (s.x1 - s.x0) * (s.z1 - s.z0) }))
    .sort((a, b) => b.area - a.area || a.minZ - b.minZ || a.minX - b.minX);
}

// ── Templates ─────────────────────────────────────────────────────────────────

export type TemplateInput =
  | { shape: 'RECT'; length: number; width: number }
  /** L: a cutLength × cutWidth piece is missing at `corner`. */
  | { shape: 'L'; length: number; width: number; cutLength: number; cutWidth: number; corner: Corner }
  /** U: an opening `gap` wide and `depth` deep, centred on `side`. */
  | { shape: 'U'; length: number; width: number; gap: number; depth: number; side: Side }
  /** T: a full-width bar `barDepth` deep along `side`, and a centred stem `stemWidth` wide. */
  | { shape: 'T'; length: number; width: number; barDepth: number; stemWidth: number; side: Side };

export type TemplateError = 'SIZE' | 'CUT_TOO_BIG' | 'GAP_TOO_BIG' | 'DEPTH_TOO_BIG' | 'STEM_TOO_BIG' | 'BAR_TOO_BIG';

const posNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** Checks the numbers of a template (empty list = fine). */
export function templateErrors(t: TemplateInput): TemplateError[] {
  if (!posNum(t.length) || !posNum(t.width)) return ['SIZE'];
  const e: TemplateError[] = [];
  const along = (side: Side) => (side === 'N' || side === 'S' ? t.length : t.width);
  const across = (side: Side) => (side === 'N' || side === 'S' ? t.width : t.length);
  if (t.shape === 'L') {
    if (!posNum(t.cutLength) || !posNum(t.cutWidth) || t.cutLength >= t.length || t.cutWidth >= t.width) e.push('CUT_TOO_BIG');
  } else if (t.shape === 'U') {
    if (!posNum(t.gap) || t.gap >= along(t.side)) e.push('GAP_TOO_BIG');
    if (!posNum(t.depth) || t.depth >= across(t.side)) e.push('DEPTH_TOO_BIG');
  } else if (t.shape === 'T') {
    if (!posNum(t.stemWidth) || t.stemWidth >= along(t.side)) e.push('STEM_TOO_BIG');
    if (!posNum(t.barDepth) || t.barDepth >= across(t.side)) e.push('BAR_TOO_BIG');
  }
  return e;
}

/** Points for a template (in a north-up frame, then turned for the chosen side). Throws on bad numbers. */
export function templatePoints(t: TemplateInput): Pt[] {
  const errs = templateErrors(t);
  if (errs.length) throw new RangeError(`Bad ${t.shape} template: ${errs.join(', ')}`);
  const L = t.length, W = t.width;
  let pts: Pt[];
  switch (t.shape) {
    case 'RECT':
      pts = [[0, 0], [L, 0], [L, W], [0, W]];
      break;
    case 'L': {
      const a = t.cutLength, b = t.cutWidth;
      const nw: Pt[] = [[a, 0], [L, 0], [L, W], [0, W], [0, b], [a, b]];
      // build with the cut at NW, then mirror for other corners
      const mx = t.corner === 'NE' || t.corner === 'SE', mz = t.corner === 'SW' || t.corner === 'SE';
      pts = nw.map(([x, z]) => [mx ? L - x : x, mz ? W - z : z] as Pt);
      break;
    }
    case 'U':
    case 'T': {
      // Work in a frame where `side` is north: sideLen along X, depthLen along Z.
      const ns = t.side === 'N' || t.side === 'S';
      const A = ns ? L : W, B = ns ? W : L;
      let local: Pt[];
      if (t.shape === 'U') {
        const g0 = (A - t.gap) / 2, g1 = g0 + t.gap, d = t.depth;
        local = [[0, 0], [g0, 0], [g0, d], [g1, d], [g1, 0], [A, 0], [A, B], [0, B]];
      } else {
        const s0 = (A - t.stemWidth) / 2, s1 = s0 + t.stemWidth, d = t.barDepth;
        local = [[0, 0], [A, 0], [A, d], [s1, d], [s1, B], [s0, B], [s0, d], [0, d]];
      }
      // turn the north-up frame to the real side
      pts = local.map(([x, z]): Pt => {
        switch (t.side) {
          case 'N': return [x, z];
          case 'S': return [A - x, B - z];
          case 'W': return [z, A - x];
          default: return [B - z, x]; // 'E'
        }
      });
      break;
    }
  }
  return normalizeOutline(pts);
}

/** Template → stored outline (points cleaned, inputs kept for reopening the form). */
export function outlineFromTemplate(t: TemplateInput): FloorOutline {
  const { shape, ...params } = t;
  return { version: 1, unit: 'm', shape, points: templatePoints(t), params: params as Record<string, number | string> };
}

/**
 * The floor of a warehouse: its saved outline when valid, else a rectangle from
 * length × width (cm), else null (size unknown). Rectangles are never stored.
 */
export function outlineOf(wh: { floorOutline?: unknown; lengthCm?: number | null; widthCm?: number | null }): Pt[] | null {
  const o = wh.floorOutline as Partial<FloorOutline> | null | undefined;
  if (o && Array.isArray(o.points) && validateOutline(o.points).length === 0) return normalizeOutline(o.points as Pt[]);
  if (posNum(wh.lengthCm) && posNum(wh.widthCm)) {
    const L = wh.lengthCm / 100, W = wh.widthCm / 100;
    return [[0, 0], [L, 0], [L, W], [0, W]];
  }
  return null;
}

/** Floor area (m²) of a warehouse by the same rule: outline when set, else length × width. */
export function floorAreaM2(wh: { floorOutline?: unknown; lengthCm?: number | null; widthCm?: number | null }): number | null {
  const pts = outlineOf(wh);
  return pts ? polygonArea(pts) : null;
}

/** X ranges where the line Z = z crosses the inside of the floor outline (even-odd rule). */
export function spansAt(pts: Pt[], z: number): [number, number][] {
  const xs: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    if ((az > z) !== (bz > z)) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax));
  }
  xs.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

/** Overlap of two sets of X ranges. */
export function intersectSpans(a: [number, number][], b: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a0, a1] of a) for (const [b0, b1] of b) {
    const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
    if (hi > lo) out.push([lo, hi]);
  }
  return out;
}
