import { LayoutObjectType } from '@prisma/client';
import type { Pt } from '../warehouse-master/floor-geometry';
import {
  type PlanObject, PLAN_ROLE, countProblems, isWalkway, layoutProblems, placeRacks, planFloor, planRect, rectContains,
} from './layout-geometry';

// RQ10 / RQ27 geometry. Pure functions — no Prisma, no database.

// 20 × 10 floor, plan units.
const FLOOR: Pt[] = [[0, 0], [20, 0], [20, 10], [0, 10]];

let n = 0;
const obj = (objectType: LayoutObjectType, x: number, y: number, width: number, height: number, extra: Partial<PlanObject> = {}): PlanObject => ({
  id: extra.id ?? `o${++n}`, objectType, name: extra.code ?? `${objectType}-${n}`, code: null,
  parentObjectId: null, x, y, width, height, rotation: 0, metadata: null, ...extra,
});

const kinds = (os: PlanObject[], floor: Pt[] | null = FLOOR) => layoutProblems(os, floor).map((p) => p.kind).sort();

describe('RQ8 — DOOR is a layout object type', () => {
  it('the generated Prisma enum carries DOOR', () => {
    expect(LayoutObjectType.DOOR).toBe('DOOR');
    expect(Object.values(LayoutObjectType)).toContain('DOOR');
  });

  it('a DOOR is a keep-clear object, and every type has a role', () => {
    expect(PLAN_ROLE[LayoutObjectType.DOOR]).toBe('KEEP_CLEAR');
    expect(PLAN_ROLE[LayoutObjectType.AISLE]).toBe('KEEP_CLEAR');
    for (const t of Object.values(LayoutObjectType)) expect(PLAN_ROLE[t]).toBeDefined();
  });

  it('a DOOR drawn on the floor is not a problem by itself', () => {
    expect(kinds([obj('DOOR', 0, 4, 0.3, 2)])).toEqual([]);
  });
});

describe('planFloor', () => {
  const wh = { lengthCm: 2000, widthCm: 1000, floorOutline: null }; // 20 × 10 m

  it('uses the real outline when the plan has a scale and an anchor', () => {
    const f = planFloor(wh, { widthUnits: 100, heightUnits: 60, metersPerUnit: 2, floorOriginX: 0, floorOriginZ: 0 });
    expect(f.source).toBe('OUTLINE');
    expect(f.points).toEqual([[0, 0], [10, 0], [10, 5], [0, 5]]); // metres / 2
  });

  it('falls back to the canvas when no scale was ever recorded (hand-drawn plans)', () => {
    const f = planFloor(wh, { widthUnits: 30, heightUnits: 20, metersPerUnit: null, floorOriginX: null, floorOriginZ: null });
    expect(f.source).toBe('CANVAS');
    expect(f.points).toEqual([[0, 0], [30, 0], [30, 20], [0, 20]]);
  });

  it('says NONE when there is no extent at all', () => {
    expect(planFloor(null, null)).toEqual({ source: 'NONE', points: null });
  });
});

describe('RQ10 — off the floor', () => {
  it('reports an object drawn past the wall', () => {
    expect(kinds([obj('RACK', 19, 2, 3, 1)])).toEqual(['OUT_OF_BOUNDS']);
  });

  it('a rack touching the wall is inside, not outside', () => {
    expect(kinds([obj('RACK', 0, 0, 3, 1)])).toEqual([]);
  });

  it('with no floor known, boundaries are not judged but overlaps still are', () => {
    const a = obj('RACK', 100, 100, 3, 1);
    const b = obj('RACK', 101, 100, 3, 1);
    expect(kinds([a, b], null)).toEqual(['OVERLAP']);
  });
});

describe('RQ10 — overlap, with rotation', () => {
  it('two racks in the same place are reported once, as a pair', () => {
    const ps = layoutProblems([obj('RACK', 1, 1, 4, 2), obj('RACK', 2, 1, 4, 2)], FLOOR);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ kind: 'OVERLAP', severity: 'WARNING' });
    expect(ps[0].objectId).not.toBe(ps[0].otherId);
  });

  it('rotation is honoured: the same two squares collide at 0° and clear each other at 45°', () => {
    // Axis-aligned bounding boxes overlap in BOTH cases; only the rotated
    // rectangles are actually apart. Comparing raw x/y/width/height would
    // report the second case as a collision.
    const flat = [obj('RACK', 2, 2, 2, 2), obj('RACK', 3.5, 3.5, 2, 2)];
    expect(kinds(flat)).toEqual(['OVERLAP']);

    const turned = [obj('RACK', 2, 2, 2, 2, { rotation: 45 }), obj('RACK', 3.5, 3.5, 2, 2, { rotation: 45 })];
    const box = (o: PlanObject) => [o.x, o.y, o.x + o.width, o.y + o.height];
    expect(box(turned[0])[2]).toBeGreaterThan(box(turned[1])[0]); // bounding boxes do overlap
    expect(kinds(turned)).toEqual([]);
  });

  it('a rotated rack that really does cross another is still reported', () => {
    expect(kinds([obj('RACK', 8, 2, 6, 1), obj('RACK', 10, 3, 6, 1, { rotation: 90 })])).toEqual(['OVERLAP']);
  });
});

describe('RQ10 — containment is normal, not a collision', () => {
  it('a BIN drawn inside a RACK is not reported, with or without a parent link', () => {
    const rack = obj('RACK', 2, 2, 4, 2, { id: 'rack' });
    const loose = obj('BIN', 2.5, 2.2, 1, 1);
    expect(kinds([rack, loose])).toEqual([]);

    const child = obj('BIN', 2.5, 2.2, 1, 1, { parentObjectId: 'rack' });
    expect(kinds([rack, child])).toEqual([]);
  });

  it('a SHELF inside a RACK, and a BIN inside that SHELF, are all fine', () => {
    const rack = obj('RACK', 2, 2, 6, 3, { id: 'rack' });
    const shelf = obj('SHELF', 2, 2, 6, 1, { id: 'shelf' });
    const bin = obj('BIN', 3, 2.1, 1, 0.8, { id: 'bin' });
    expect(kinds([rack, shelf, bin])).toEqual([]);
  });

  it('a BIN only HALF over a rack is still a collision — containment must be real', () => {
    const rack = obj('RACK', 2, 2, 4, 2, { id: 'rack' });
    const half = obj('BIN', 5, 2.2, 2, 1);
    expect(kinds([rack, half])).toEqual(['OVERLAP']);
  });

  it('a rack swallowing another rack IS a collision — a rack may not hold a rack', () => {
    expect(kinds([obj('RACK', 2, 2, 8, 4), obj('RACK', 3, 3, 2, 1)])).toEqual(['OVERLAP']);
  });

  it('a bin belonging to a rack by the tree is accepted even when it sticks out', () => {
    // The drawing tree is the user saying "this belongs there"; trust it.
    const rack = obj('RACK', 2, 2, 4, 2, { id: 'rack' });
    const out = obj('BIN', 5, 2.2, 2, 1, { parentObjectId: 'rack' });
    expect(kinds([rack, out])).toEqual([]);
  });

  it('areas and zones overlapping each other are never reported', () => {
    const zone = obj('ZONE', 0, 0, 20, 10);
    const qc = obj('QC_AREA', 1, 1, 8, 4);
    const storage = obj('STORAGE_AREA', 5, 2, 8, 4);
    const rack = obj('RACK', 6, 2.5, 3, 1);
    expect(kinds([zone, qc, storage, rack])).toEqual([]);
  });
});

describe('RQ10 — aisles, doors and walkways must stay clear', () => {
  const aisle = obj('AISLE', 0, 4, 20, 2, { id: 'aisle', code: 'AISLE-1' });

  it('a rack standing in an aisle is reported against the aisle', () => {
    const rack = obj('RACK', 3, 4.5, 3, 1, { code: 'A-01' });
    const ps = layoutProblems([aisle, rack], FLOOR);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ kind: 'BLOCKS_AISLE', severity: 'WARNING', objectId: rack.id, otherId: 'aisle' });
    expect(ps[0].message).toContain('A-01');
  });

  it('a rack in a doorway is reported as BLOCKS_DOOR', () => {
    const door = obj('DOOR', 0, 4, 0.4, 2, { id: 'door' });
    expect(kinds([door, obj('RACK', 0, 4.2, 2, 1)])).toEqual(['BLOCKS_DOOR']);
  });

  it('a zone marked as a walkway is kept clear too', () => {
    const walk = obj('ZONE', 0, 4, 20, 2, { id: 'walk', metadata: '{"walkway":true}' });
    expect(isWalkway(walk)).toBe(true);
    expect(kinds([walk, obj('RACK', 3, 4.5, 3, 1)])).toEqual(['BLOCKS_WALKWAY']);
  });

  it('an unmarked zone is not a walkway, and broken metadata is not either', () => {
    expect(isWalkway(obj('ZONE', 0, 0, 2, 2))).toBe(false);
    expect(isWalkway(obj('ZONE', 0, 0, 2, 2, { metadata: 'not json' }))).toBe(false);
    expect(isWalkway(obj('RACK', 0, 0, 2, 2, { metadata: '{"walkway":true}' }))).toBe(false);
  });

  it('a zone drawn across an aisle is fine, and a door inside an aisle is fine', () => {
    const zone = obj('ZONE', 0, 0, 20, 10);
    const door = obj('DOOR', 0, 4.2, 0.4, 1.5);
    expect(kinds([aisle, zone, door])).toEqual([]);
  });

  it('a bin or shelf in an aisle counts as blocking it, same as a rack', () => {
    expect(kinds([aisle, obj('BIN', 3, 4.5, 1, 1)])).toEqual(['BLOCKS_AISLE']);
    expect(kinds([aisle, obj('SHELF', 3, 4.5, 2, 1)])).toEqual(['BLOCKS_AISLE']);
  });
});

describe('a well-drawn plan produces no warnings at all', () => {
  it('zone, aisle, door, two racks and their bins', () => {
    const os = [
      obj('STORAGE_AREA', 0, 0, 20, 10),
      obj('AISLE', 0, 4, 20, 2),
      obj('DOOR', 0, 4.2, 0.4, 1.5),
      obj('RACK', 1, 1, 6, 1.2, { id: 'r1' }),
      obj('BIN', 1.1, 1.1, 1, 1, { parentObjectId: 'r1' }),
      obj('RACK', 1, 7, 6, 1.2, { id: 'r2' }),
      obj('BIN', 1.1, 7.1, 1, 1, { parentObjectId: 'r2' }),
    ];
    const ps = layoutProblems(os, FLOOR);
    expect(ps).toEqual([]);
    expect(countProblems(ps)).toEqual({ total: 0, outOfBounds: 0, overlap: 0, blocksAisle: 0, blocksDoor: 0, blocksWalkway: 0 });
  });
});

describe('planRect / rectContains', () => {
  it('a plan object becomes a centred rotated rectangle', () => {
    expect(planRect({ x: 2, y: 4, width: 6, height: 2, rotation: 0 })).toEqual({ center: [5, 5], length: 6, depth: 2, rotY: 0 });
  });

  it('a missing rotation is treated as 0', () => {
    expect(planRect({ x: 0, y: 0, width: 2, height: 2, rotation: null }).rotY).toBe(0);
  });

  it('containment counts edge-to-edge, and is not symmetric', () => {
    const outer = planRect({ x: 0, y: 0, width: 4, height: 4, rotation: 0 });
    const inner = planRect({ x: 0, y: 0, width: 4, height: 2, rotation: 0 });
    expect(rectContains(outer, inner)).toBe(true);
    expect(rectContains(inner, outer)).toBe(false);
  });
});

describe('RQ27 — fitting racks onto the plan', () => {
  const rack = (code: string, width = 2.7, height = 1.1) => ({ rackId: `r_${code}`, code, width, height });

  it('lays racks out in rows, inside the floor and never touching', () => {
    const racks = [rack('A-01'), rack('A-02'), rack('A-03')];
    const res = placeRacks(racks, FLOOR, [], { gap: 0.5 });
    expect(res.noRoom).toEqual([]);
    expect(res.placed).toHaveLength(3);
    // Everything on the floor, nothing overlapping anything else.
    expect(layoutProblems(res.placed.map((p, i) => ({
      id: `p${i}`, objectType: 'RACK' as const, name: p.code, code: p.code, parentObjectId: null,
      x: p.x, y: p.y, width: p.width, height: p.height, rotation: 0, metadata: null,
    })), FLOOR)).toEqual([]);
  });

  it('results come back in the order they were asked for, not the packing order', () => {
    const res = placeRacks([rack('small', 1, 1), rack('big', 8, 2)], FLOOR, [], { gap: 0.5 });
    expect(res.placed.map((p) => p.code)).toEqual(['small', 'big']);
  });

  it('refuses to put a rack on top of something already drawn', () => {
    // A blocker covering the whole floor but a 3 × 3 corner.
    const blockers = [
      planRect({ x: 0, y: 3, width: 20, height: 7, rotation: 0 }),
      planRect({ x: 3, y: 0, width: 17, height: 10, rotation: 0 }),
    ];
    const res = placeRacks([rack('A-01', 2, 2)], FLOOR, blockers, { gap: 0.1 });
    expect(res.noRoom).toEqual([]);
    const p = res.placed[0];
    expect(p.x).toBeLessThan(3);
    expect(p.y).toBeLessThan(3);
  });

  it('says so instead of stacking when a rack cannot fit', () => {
    const res = placeRacks([rack('HUGE', 30, 5)], FLOOR, [], { gap: 0.5 });
    expect(res.placed).toEqual([]);
    expect(res.noRoom.map((r) => r.code)).toEqual(['HUGE']);
  });

  it('a rack that fits is still placed after one that does not', () => {
    const res = placeRacks([rack('HUGE', 30, 5), rack('A-01')], FLOOR, [], { gap: 0.5 });
    expect(res.placed.map((r) => r.code)).toEqual(['A-01']);
    expect(res.noRoom.map((r) => r.code)).toEqual(['HUGE']);
  });

  it('a floor fully covered leaves no room for anyone', () => {
    const res = placeRacks([rack('A-01')], FLOOR, [planRect({ x: 0, y: 0, width: 20, height: 10, rotation: 0 })], { gap: 0.1 });
    expect(res.placed).toEqual([]);
    expect(res.noRoom).toHaveLength(1);
  });

  it('with no floor to fit inside, nothing is placed rather than guessed', () => {
    const res = placeRacks([rack('A-01')], null, []);
    expect(res.placed).toEqual([]);
    expect(res.noRoom).toHaveLength(1);
  });

  it('many racks on a big floor stay apart', () => {
    const racks = Array.from({ length: 40 }, (_, i) => rack(`A-${String(i).padStart(2, '0')}`));
    const res = placeRacks(racks, FLOOR, [], { gap: 0.3 });
    expect(res.placed.length).toBeGreaterThan(20);
    const os = res.placed.map((p, i) => ({
      id: `p${i}`, objectType: 'RACK' as const, name: p.code, code: p.code, parentObjectId: null,
      x: p.x, y: p.y, width: p.width, height: p.height, rotation: 0, metadata: null,
    }));
    expect(layoutProblems(os, FLOOR)).toEqual([]);
  });
});
