// RQ10 — boundary and overlap checks for the 2D Floor Plan.
//
// WHY THIS FILE EXISTS AND NOT A SECOND SET OF RULES
// ---------------------------------------------------
// The geometry itself lives in ../warehouse-master/floor-geometry.ts and is NOT
// re-implemented here: `rectsOverlap` (Separating Axis Test), `rectInPolygon`
// and `rectCorners` are imported and used as-is, so the 2D plan, the 3D arrange
// path and the frontend all judge an overlap by the same code. This file only
// adds what is specific to the plan: the plan's coordinate frame (grid units,
// top-left origin, rotation in degrees) and WHICH overlaps are worth telling the
// user about.
//
// It is a separate file rather than more lines in floor-geometry.ts because that
// file is byte-for-byte mirrored into the frontend and a backend test fails when
// the two differ (floor-geometry.spec.ts, "frontend copy is identical"). Adding
// plan-only, Prisma-aware code there would drag the Prisma enum into the browser
// copy. The rule stays single-sourced; only the plan-specific wrapper is here.
//
// C5 "Separate": the layout is a DRAWING. Every function below is pure and
// read-only. A geometry problem is a WARNING, never a reason to refuse a save —
// a wrong picture does not make stock wrong, so the user must be able to save an
// imperfect drawing and fix it later.

import { LayoutObjectType } from '@prisma/client';
import {
  type Pt, type FloorRect, bbox, outlineOf, rectCorners, rectInPolygon, rectsOverlap,
} from '../warehouse-master/floor-geometry';

// ── The plan frame ───────────────────────────────────────────────────────────

/** The part of a LayoutObject this module needs. Any extra fields are ignored. */
export interface PlanObject {
  id: string;
  objectType: LayoutObjectType;
  name: string;
  code?: string | null;
  parentObjectId?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number | null;
  metadata?: string | null;
}

/**
 * A plan object as a rotated rectangle in floor-geometry's frame.
 *
 * The plan stores a top-left corner plus degrees; floor-geometry works with a
 * centre plus radians, and turns the same way as the 3D view (see
 * `planGeometry`/`footprint` in warehouse-layout.service.ts), so the sign is
 * negated here for the same reason. Overlap and containment are unaffected by
 * the sign as long as every rectangle and the floor use one frame — which they
 * do, because they all come through this one function.
 */
export function planRect(o: Pick<PlanObject, 'x' | 'y' | 'width' | 'height' | 'rotation'>): FloorRect {
  return {
    center: [o.x + o.width / 2, o.y + o.height / 2],
    length: o.width,
    depth: o.height,
    // `|| 0` keeps a zero rotation as 0 rather than -0.
    rotY: (-(o.rotation ?? 0) * Math.PI) / 180 || 0,
  };
}

export type FloorSource = 'OUTLINE' | 'CANVAS' | 'NONE';

/** The warehouse's floor as seen on the plan, in grid units. */
export interface PlanFloor {
  source: FloorSource;
  points: Pt[] | null;
}

/**
 * Which outline the plan is checked against.
 *
 * - OUTLINE: the warehouse's real floor shape, converted to grid units with the
 *   plan's own scale and anchor (the same numbers the 3D arrange path writes).
 *   Preferred, because it is the actual building.
 * - CANVAS: the plan's own extent (0,0 → widthUnits, heightUnits). Used when the
 *   scale or the anchor has never been recorded, which is every plan drawn by
 *   hand. Then "outside the floor" means "off the drawing", which is still the
 *   honest answer and is all the data supports.
 * - NONE: no extent at all — nothing can be said about boundaries.
 */
export function planFloor(
  wh: { lengthCm?: number | null; widthCm?: number | null; floorOutline?: unknown } | null | undefined,
  layout: { widthUnits?: number | null; heightUnits?: number | null; metersPerUnit?: number | null; floorOriginX?: number | null; floorOriginZ?: number | null } | null | undefined,
): PlanFloor {
  const mpu = layout?.metersPerUnit;
  const ox = layout?.floorOriginX;
  const oz = layout?.floorOriginZ;
  const pts = wh ? outlineOf(wh) : null;
  if (pts && mpu && mpu > 0 && ox != null && oz != null) {
    const bb = bbox(pts);
    return { source: 'OUTLINE', points: pts.map(([x, z]) => [(ox + x - bb.minX) / mpu, (oz + z - bb.minZ) / mpu] as Pt) };
  }
  const w = layout?.widthUnits;
  const h = layout?.heightUnits;
  if (w && h && w > 0 && h > 0) return { source: 'CANVAS', points: [[0, 0], [w, 0], [w, h], [0, h]] };
  return { source: 'NONE', points: null };
}

// ── What counts as a problem ─────────────────────────────────────────────────

/**
 * How each object type behaves on the plan. Three roles, chosen so that the
 * normal way of drawing a warehouse produces NO warnings — a checker that cries
 * wolf is worse than no checker.
 *
 * - SOLID     a physical thing standing on the floor. Two solids in the same
 *             place is a real mistake.
 * - KEEP_CLEAR a route or an opening. It exists so that nothing stands in it, so
 *             a solid on top of one is reported.
 * - AREA      a region drawn on the floor. Regions overlap each other all the
 *             time (a QC area inside a storage zone) and are drawn around the
 *             things they contain, so they are never a collision.
 */
export type PlanRole = 'SOLID' | 'KEEP_CLEAR' | 'AREA';

export const PLAN_ROLE: Record<LayoutObjectType, PlanRole> = {
  RACK: 'SOLID',
  SHELF: 'SOLID',
  BIN: 'SOLID',
  AISLE: 'KEEP_CLEAR',
  DOOR: 'KEEP_CLEAR',
  ZONE: 'AREA',
  RECEIVING_AREA: 'AREA',
  SHIPPING_AREA: 'AREA',
  STAGING_AREA: 'AREA',
  QC_AREA: 'AREA',
  WORK_AREA: 'AREA',
  STORAGE_AREA: 'AREA',
  CUSTOM_AREA: 'AREA',
};

/**
 * Overlaps that are the drawing working as intended, not a collision.
 *
 * A BIN sits inside its SHELF, a SHELF and a BIN sit inside their RACK; an AREA
 * is drawn around whatever it covers. Nothing else may swallow anything: two
 * racks in the same place, or a bin drawn over a different rack, is a mistake.
 *
 * Containment is only accepted when the inner rectangle really is INSIDE the
 * outer one (`rectInPolygon`, so edge-to-edge counts). A rack half on top of
 * another rack is still reported, whatever the types.
 */
export const MAY_CONTAIN: Record<LayoutObjectType, readonly LayoutObjectType[]> = {
  RACK: ['SHELF', 'BIN'],
  SHELF: ['BIN'],
  BIN: [],
  AISLE: [],
  DOOR: [],
  // A region may be drawn around anything, including another region.
  ZONE: ALL_TYPES(),
  RECEIVING_AREA: ALL_TYPES(),
  SHIPPING_AREA: ALL_TYPES(),
  STAGING_AREA: ALL_TYPES(),
  QC_AREA: ALL_TYPES(),
  WORK_AREA: ALL_TYPES(),
  STORAGE_AREA: ALL_TYPES(),
  CUSTOM_AREA: ALL_TYPES(),
};

function ALL_TYPES(): LayoutObjectType[] {
  return Object.values(LayoutObjectType);
}

/**
 * A region the user has declared a walkway, by setting `{"walkway": true}` in
 * the object's metadata. Opt-in on purpose: there is no walkway object type and
 * guessing one from a name ("Zone W") would invent a rule nobody signed off.
 * A zone marked this way is treated exactly like an aisle.
 */
export function isWalkway(o: Pick<PlanObject, 'objectType' | 'metadata'>): boolean {
  if (PLAN_ROLE[o.objectType] !== 'AREA') return false;
  try {
    return !!o.metadata && JSON.parse(o.metadata)?.walkway === true;
  } catch {
    return false;
  }
}

export type LayoutProblemKind = 'OUT_OF_BOUNDS' | 'OVERLAP' | 'BLOCKS_AISLE' | 'BLOCKS_DOOR' | 'BLOCKS_WALKWAY';

export interface LayoutProblem {
  kind: LayoutProblemKind;
  /** Always 'WARNING'. The plan is a drawing; a wrong drawing never blocks a save. */
  severity: 'WARNING';
  objectId: string;
  objectType: LayoutObjectType;
  objectName: string;
  objectCode: string | null;
  /** The other object, for the pair problems (everything except OUT_OF_BOUNDS). */
  otherId?: string;
  otherType?: LayoutObjectType;
  otherName?: string;
  otherCode?: string | null;
  /** Plain-language explanation; the UI may translate by `kind` instead. */
  message: string;
}

const label = (o: PlanObject) => o.code || o.name;

/** True when either object is an ancestor of the other in the drawing tree. */
function related(a: PlanObject, b: PlanObject, parentOf: Map<string, string | null>): boolean {
  for (const [from, to] of [[a, b], [b, a]] as const) {
    let cur = parentOf.get(from.id) ?? null;
    for (let i = 0; cur && i < 64; i++) { // same depth guard as the service
      if (cur === to.id) return true;
      cur = parentOf.get(cur) ?? null;
    }
  }
  return false;
}

/** `inner` lies wholly within `outer` (touching edges counts as inside). */
export function rectContains(outer: FloorRect, inner: FloorRect): boolean {
  return rectInPolygon(inner, rectCorners(outer));
}

/**
 * Every geometry problem in one layout, as warnings.
 *
 * Pure: it is handed plain objects and returns plain objects. It reads no
 * database and writes nothing — see the C5 note at the top of the file.
 *
 * `floor` null (source NONE) simply skips the boundary check; overlaps are still
 * reported.
 */
export function layoutProblems(objects: PlanObject[], floor: Pt[] | null): LayoutProblem[] {
  const out: LayoutProblem[] = [];
  const rect = new Map<string, FloorRect>();
  const box = new Map<string, { minX: number; maxX: number; minY: number; maxY: number }>();
  const parentOf = new Map<string, string | null>();

  for (const o of objects) {
    const r = planRect(o);
    rect.set(o.id, r);
    parentOf.set(o.id, o.parentObjectId ?? null);
    const c = rectCorners(r);
    box.set(o.id, {
      minX: Math.min(...c.map((p) => p[0])), maxX: Math.max(...c.map((p) => p[0])),
      minY: Math.min(...c.map((p) => p[1])), maxY: Math.max(...c.map((p) => p[1])),
    });
  }

  // 1. Off the floor.
  if (floor) {
    for (const o of objects) {
      if (!rectInPolygon(rect.get(o.id)!, floor)) {
        out.push({
          kind: 'OUT_OF_BOUNDS', severity: 'WARNING',
          objectId: o.id, objectType: o.objectType, objectName: o.name, objectCode: o.code ?? null,
          message: `${label(o)} is drawn outside the warehouse floor.`,
        });
      }
    }
  }

  // 2. Pairs. O(n²) with a cheap bounding-box reject first, matching
  //    rackPositionIssues in warehouse-layout.service.ts.
  for (let i = 0; i < objects.length; i++) {
    for (let j = i + 1; j < objects.length; j++) {
      const a = objects[i], b = objects[j];
      const ba = box.get(a.id)!, bb2 = box.get(b.id)!;
      if (ba.maxX <= bb2.minX || bb2.maxX <= ba.minX || ba.maxY <= bb2.minY || bb2.maxY <= ba.minY) continue;
      const ra = rect.get(a.id)!, rb = rect.get(b.id)!;
      if (!rectsOverlap(ra, rb)) continue;

      const clearA = PLAN_ROLE[a.objectType] === 'KEEP_CLEAR' || isWalkway(a);
      const clearB = PLAN_ROLE[b.objectType] === 'KEEP_CLEAR' || isWalkway(b);

      // A solid standing in a route or an opening.
      if (clearA !== clearB) {
        const route = clearA ? a : b;
        const thing = clearA ? b : a;
        if (PLAN_ROLE[thing.objectType] !== 'SOLID') continue; // a zone drawn across an aisle is fine
        const kind: LayoutProblemKind = isWalkway(route)
          ? 'BLOCKS_WALKWAY'
          : route.objectType === LayoutObjectType.DOOR ? 'BLOCKS_DOOR' : 'BLOCKS_AISLE';
        const what = kind === 'BLOCKS_DOOR' ? 'door' : kind === 'BLOCKS_WALKWAY' ? 'walkway' : 'aisle';
        out.push({
          kind, severity: 'WARNING',
          objectId: thing.id, objectType: thing.objectType, objectName: thing.name, objectCode: thing.code ?? null,
          otherId: route.id, otherType: route.objectType, otherName: route.name, otherCode: route.code ?? null,
          message: `${label(thing)} is drawn over the ${what} ${label(route)}.`,
        });
        continue;
      }

      // Two solids in the same place — unless one legitimately holds the other.
      if (PLAN_ROLE[a.objectType] !== 'SOLID' || PLAN_ROLE[b.objectType] !== 'SOLID') continue;
      if (related(a, b, parentOf)) continue; // the tree says it belongs there
      if (MAY_CONTAIN[a.objectType].includes(b.objectType) && rectContains(ra, rb)) continue;
      if (MAY_CONTAIN[b.objectType].includes(a.objectType) && rectContains(rb, ra)) continue;
      out.push({
        kind: 'OVERLAP', severity: 'WARNING',
        objectId: a.id, objectType: a.objectType, objectName: a.name, objectCode: a.code ?? null,
        otherId: b.id, otherType: b.objectType, otherName: b.name, otherCode: b.code ?? null,
        message: `${label(a)} and ${label(b)} are drawn on top of each other.`,
      });
    }
  }
  return out;
}

/** Counts per kind, so the editor can show a badge without walking the list. */
export function countProblems(problems: LayoutProblem[]) {
  return {
    total: problems.length,
    outOfBounds: problems.filter((p) => p.kind === 'OUT_OF_BOUNDS').length,
    overlap: problems.filter((p) => p.kind === 'OVERLAP').length,
    blocksAisle: problems.filter((p) => p.kind === 'BLOCKS_AISLE').length,
    blocksDoor: problems.filter((p) => p.kind === 'BLOCKS_DOOR').length,
    blocksWalkway: problems.filter((p) => p.kind === 'BLOCKS_WALKWAY').length,
  };
}

// ── RQ27: fit a batch of racks onto the plan ─────────────────────────────────

/** A rack waiting for a drawing, with the footprint its Rack Type gives it. */
export interface RackToPlace {
  rackId: string;
  code: string;
  /** Grid units. */
  width: number;
  height: number;
}

export interface PlacedRack extends RackToPlace {
  x: number;
  y: number;
}

export interface PlaceRacksResult {
  placed: PlacedRack[];
  /** Racks that genuinely do not fit anywhere free on the floor. */
  noRoom: RackToPlace[];
}

/**
 * Rows of racks on the free part of the floor, left to right then top to bottom
 * ("shelf packing"): a cursor walks the floor's bounding box, slides past
 * anything in the way, and drops to the next row when it runs out of width.
 *
 * `blockers` are the rectangles already on the plan — existing drawings, aisles,
 * doors, zones marked as walkways — that a new rack must not sit on. A spot is
 * accepted only when the rack is wholly inside the floor and clear of every
 * blocker and of the racks placed so far, judged by the same `rectInPolygon` /
 * `rectsOverlap` as the checks above. A batch placement therefore cannot create
 * a problem that `layoutProblems` would turn round and report.
 *
 * Nothing is stacked silently: a rack with no free spot comes back in `noRoom`.
 * The sweep step is clamped so the cursor visits at most ~200 × 200 positions
 * whatever the size of the building.
 */
export function placeRacks(
  racks: RackToPlace[],
  floor: Pt[] | null,
  blockers: FloorRect[],
  opts: { gap?: number; step?: number } = {},
): PlaceRacksResult {
  const gap = opts.gap ?? 0.5;
  const placed: PlacedRack[] = [];
  const noRoom: RackToPlace[] = [];
  if (!floor || !floor.length) {
    // No floor to fit inside: say so rather than invent one.
    return { placed: [], noRoom: [...racks] };
  }
  const bb = bbox(floor);
  const base = opts.step ?? Math.max(0.25, Math.min(gap, 1));
  const sx = Math.max(base, bb.length / 200);
  const sy = Math.max(base, bb.width / 200);
  const EPS = 1e-9;

  const taken = blockers.map((t) => {
    const c = rectCorners(t);
    return {
      rect: t,
      minX: Math.min(...c.map((p) => p[0])) - gap, maxX: Math.max(...c.map((p) => p[0])) + gap,
      minY: Math.min(...c.map((p) => p[1])) - gap, maxY: Math.max(...c.map((p) => p[1])) + gap,
    };
  });
  const free = (cand: FloorRect, x: number, y: number, w: number, h: number) =>
    !taken.some((t) => !(t.maxX <= x || t.minX >= x + w || t.maxY <= y || t.minY >= y + h) && rectsOverlap(cand, t.rect, gap));
  const keep = (rect: FloorRect) => {
    const c = rectCorners(rect);
    taken.push({
      rect,
      minX: Math.min(...c.map((p) => p[0])) - gap, maxX: Math.max(...c.map((p) => p[0])) + gap,
      minY: Math.min(...c.map((p) => p[1])) - gap, maxY: Math.max(...c.map((p) => p[1])) + gap,
    });
  };

  // Biggest first: a long rack left to last tends to find no row open.
  const order = [...racks].sort((a, b) => b.width * b.height - a.width * a.height || a.code.localeCompare(b.code));

  let cx = bb.minX, cy = bb.minZ, rowH = 0;
  for (const r of order) {
    let spot: PlacedRack | null = null;
    while (cy + r.height <= bb.maxZ + EPS) {
      if (cx + r.width > bb.maxX + EPS) { // row full → next row
        cx = bb.minX;
        cy += (rowH > 0 ? rowH : sy) + gap;
        rowH = 0;
        continue;
      }
      const cand = planRect({ x: cx, y: cy, width: r.width, height: r.height, rotation: 0 });
      if (rectInPolygon(cand, floor) && free(cand, cx, cy, r.width, r.height)) {
        spot = { ...r, x: cx, y: cy };
        placed.push(spot);
        keep(cand);
        cx += r.width + gap;
        rowH = Math.max(rowH, r.height);
        break;
      }
      cx += sx; // slide past whatever is in the way
    }
    if (!spot) {
      noRoom.push(r);
      // Start the cursor over: a smaller rack may still fit a gap this one could not.
      cx = bb.minX; cy = bb.minZ; rowH = 0;
    }
  }
  // Report in the caller's order, not the packing order.
  const byId = new Map(placed.map((p) => [p.rackId, p]));
  const missed = new Set(noRoom.map((r) => r.rackId));
  return {
    placed: racks.map((r) => byId.get(r.rackId)).filter((p): p is PlacedRack => !!p),
    noRoom: racks.filter((r) => missed.has(r.rackId)),
  };
}
