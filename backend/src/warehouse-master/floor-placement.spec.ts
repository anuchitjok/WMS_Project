import { outlineFromTemplate, rectInPolygon, rectsOverlap } from './floor-geometry';
// F4 (rack position checks) and F5 (auto layout inside a shaped floor). The 3D scene
// code lives in the frontend (no test runner there), so it is loaded with require,
// like floor-scene.spec.ts, and checked with the backend copy of floor-geometry.

type Pt = [number, number];
type Placed = { rack: { id: string; code: string }; center: Pt; length: number; depth: number; rotY: number };
type Scene = {
  racks: Placed[];
  floor: { cx: number; cz: number; w: number; d: number; outline: Pt[] | null };
  placement: { outside: string[]; overlap: string[]; unplaced: string[] };
};
type Auto = { rack: { id: string }; zone: string; center: Pt };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sg = require('../../../frontend/src/components/warehouse-layout/scene-geometry') as {
  buildScene: (wh: unknown, objects?: unknown[]) => Scene;
  autoLayout: (racks: unknown[], wh?: unknown) => Auto[];
  autoPlace: (racks: unknown[], wh: unknown) => { placed: Auto[]; unplaced: { id: string }[]; outline: Pt[] | null };
};

// Racks: 2.7 m long, 1.1 m deep (typical shelving), zone A unless given.
const rack = (i: number, zone = 'A', lengthCm = 270, widthCm = 110) => ({
  id: `r${i}`, code: `${zone}-R${String(i).padStart(2, '0')}`, zone, levels: 4, columns: 3, isActive: true, slots: [],
  lengthCm, widthCm, heightCm: 300,
});
const racks = (n: number, zone = 'A', from = 1) => Array.from({ length: n }, (_, i) => rack(from + i, zone));
const geo = (p: Placed) => ({ center: p.center, length: p.length, depth: p.depth, rotY: p.rotY });

// L: 40 × 30 m with a 15 × 10 m notch at SE.
const L = outlineFromTemplate({ shape: 'L', length: 40, width: 30, cutLength: 15, cutWidth: 10, corner: 'SE' } as any);
const lWh = (rs: unknown[]) => ({ code: 'L', lengthCm: 4000, widthCm: 3000, floorOutline: L, racks: rs });
// U: 30 × 20 m, a 10 m wide, 8 m deep gap open to the south.
const U = outlineFromTemplate({ shape: 'U', length: 30, width: 20, gap: 10, depth: 8, side: 'S' } as any);

describe('F5 auto layout inside a shaped floor', () => {
  it('rectangle warehouses keep the old auto layout exactly', () => {
    const rs = [...racks(10, 'A'), ...racks(6, 'B', 11)];
    const wh = { code: 'R', lengthCm: 4800, widthCm: 3000, racks: rs };
    const scene = sg.buildScene(wh);
    const old = sg.autoLayout(rs, wh);
    expect(scene.racks.map((p) => [p.rack.id, p.center])).toEqual(old.map((a) => [a.rack.id, a.center]));
    expect(sg.autoPlace(rs, wh).outline).toBeNull();
    // A 4-corner outline is still a rectangle.
    const boxed = { ...wh, floorOutline: { shape: 'RECT', points: [[0, 0], [48, 0], [48, 30], [0, 30]] } };
    expect(sg.buildScene(boxed).racks.map((p) => p.center)).toEqual(old.map((a) => a.center));
  });

  it('L shape: every rack on the floor, none in the notch, none overlapping', () => {
    const rs = [...racks(16, 'A'), ...racks(10, 'B', 17), ...racks(6, 'C', 27)];
    const scene = sg.buildScene(lWh(rs));
    const poly = L.points as Pt[];
    expect(scene.placement).toEqual({ outside: [], overlap: [], unplaced: [] });
    expect(scene.racks).toHaveLength(rs.length);
    for (const p of scene.racks) expect(rectInPolygon(geo(p), poly)).toBe(true);
    for (let i = 0; i < scene.racks.length; i++)
      for (let j = i + 1; j < scene.racks.length; j++) expect(rectsOverlap(geo(scene.racks[i]), geo(scene.racks[j]))).toBe(false);
    // The floor is anchored to the outline (not centred on the racks).
    expect(scene.floor.outline).toEqual(poly);
    expect([scene.floor.cx, scene.floor.cz, scene.floor.w, scene.floor.d]).toEqual([20, 15, 40, 30]);
  });

  it('U shape: racks stay out of the open gap', () => {
    const rs = racks(14, 'A');
    const scene = sg.buildScene({ code: 'U', lengthCm: 3000, widthCm: 2000, floorOutline: U, racks: rs });
    for (const p of scene.racks) expect(rectInPolygon(geo(p), U.points as Pt[])).toBe(true);
    expect(scene.placement.outside).toEqual([]);
  });

  it('racks that do not fit are listed, drawn below the floor, never dropped', () => {
    const small = outlineFromTemplate({ shape: 'L', length: 12, width: 10, cutLength: 6, cutWidth: 5, corner: 'SE' } as any);
    const rs = racks(30, 'A');
    const scene = sg.buildScene({ code: 'S', lengthCm: 1200, widthCm: 1000, floorOutline: small, racks: rs });
    const un = new Set(scene.placement.unplaced);
    expect(un.size).toBeGreaterThan(0);
    expect(scene.racks).toHaveLength(30);
    for (const p of scene.racks) {
      if (un.has(p.rack.id)) expect(p.center[1] - p.depth / 2).toBeGreaterThan(10); // below the floor
      else expect(rectInPolygon(geo(p), small.points as Pt[])).toBe(true);
    }
    // Unplaced racks are reported as such, not also as "outside".
    expect(scene.placement.outside.filter((id) => un.has(id))).toEqual([]);
  });

  it('the wizard preview uses the same rule as 3D', () => {
    const rs = racks(12, 'A');
    const p = sg.autoPlace(rs, lWh(rs));
    expect(p.outline).toEqual(L.points);
    expect(p.placed.map((a) => a.center)).toEqual(sg.buildScene(lWh(rs)).racks.map((r) => r.center));
  });
});

describe('F4 rack position checks', () => {
  it('a rectangle warehouse too small for its racks flags the racks outside', () => {
    const scene = sg.buildScene({ code: 'T', lengthCm: 600, widthCm: 400, racks: racks(12, 'A') });
    expect(scene.placement.outside.length).toBeGreaterThan(0);
    expect(scene.placement.overlap).toEqual([]);
  });

  it('no size recorded: nothing is "outside" (there is no floor to check against)', () => {
    const scene = sg.buildScene({ code: 'N', racks: racks(12, 'A') });
    expect(scene.placement).toEqual({ outside: [], overlap: [], unplaced: [] });
  });

  it('two racks drawn on top of each other on the floor plan both overlap', () => {
    const rs = racks(3, 'A');
    const obj = (id: string, x: number) => ({ id: `o-${id}`, objectType: 'RACK', rackId: id, x, y: 0, width: 2.7, height: 1.1, rotation: 0 });
    const scene = sg.buildScene({ code: 'O', racks: rs }, [obj('r1', 0), obj('r2', 1), obj('r3', 10)]);
    expect(scene.placement.overlap.sort()).toEqual(['r1', 'r2']);
  });

  it('racks that only touch do not count as overlapping', () => {
    const rs = racks(2, 'A');
    const obj = (id: string, x: number) => ({ id: `o-${id}`, objectType: 'RACK', rackId: id, x, y: 0, width: 2.7, height: 1.1, rotation: 0 });
    expect(sg.buildScene({ code: 'O', racks: rs }, [obj('r1', 0), obj('r2', 2.7)]).placement.overlap).toEqual([]);
  });
});
