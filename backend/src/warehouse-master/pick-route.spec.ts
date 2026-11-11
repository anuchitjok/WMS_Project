// PR8 Phase 5: estimated pick route in the 3D view. The route code lives in the
// frontend (no test runner there), so it is tested from here like floor-scene.spec.ts.
// Loaded with require so the backend typecheck does not follow it into frontend code.
type Pt = [number, number];
interface Rack { rack: { id: string }; kind: 'shelf'; center: Pt; rotY: number; length: number; depth: number; height: number }
interface Route {
  start: Pt; startKind: 'shipping' | 'entrance'; path: Pt[]; lengthM: number; unreachable: string[];
  stops: { slotId: string; order: number; lines: number[]; at: Pt | null }[];
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const R = require('../../../frontend/src/components/warehouse-layout/pick-route') as {
  pickRoute: (scene: unknown, picks: { slotId: string; n: number }[]) => Route | null;
  orderStops: (d: number[][]) => number[];
};

// 30 × 20 m floor, centre (15, 10). Front edge = z 20.
const floor = (outline: Pt[] | null = null) => ({ cx: 15, cz: 10, w: 30, d: 20, real: { w: 30, d: 20 }, outline });
const rack = (id: string, cx: number, cz: number, rotY = 0): Rack =>
  ({ rack: { id }, kind: 'shelf', center: [cx, cz], rotY, length: 10, depth: 1.2, height: 3 });
// A slot at local x along the rack (rotY 0 → world x = cx + lx).
const slot = (id: string, r: Rack, lx: number) => ({ slot: { id }, rack: { id: r.rack.id }, pos: [r.center[0] + lx, 1, r.center[1]] });

// Two rack rows, each 10 m long along X, with a 3 m aisle between them.
const A = rack('A', 15, 7), B = rack('B', 15, 11.2);
const scene = (extra: Partial<Record<string, unknown>> = {}) => ({
  racks: [A, B],
  slots: [slot('a1', A, -4), slot('a5', A, 4), slot('b1', B, -4), slot('b5', B, 4)],
  areas: [],
  floor: floor(),
  ...extra,
});

/** Does any point along the path fall inside a rack footprint? */
function crossesRack(path: Pt[], racks: Rack[]): boolean {
  for (let i = 0; i + 1 < path.length; i++) {
    const [a, b] = [path[i], path[i + 1]];
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05) || 1;
    for (let s = 0; s <= n; s++) {
      const x = a[0] + ((b[0] - a[0]) * s) / n, z = a[1] + ((b[1] - a[1]) * s) / n;
      for (const r of racks) if (Math.abs(x - r.center[0]) < r.length / 2 && Math.abs(z - r.center[1]) < r.depth / 2) return true;
    }
  }
  return false;
}

describe('pickRoute', () => {
  it('returns null when no pick slot is in the scene', () => {
    expect(R.pickRoute(scene(), [{ slotId: 'nope', n: 1 }])).toBeNull();
  });

  it('starts and ends at the front edge when there is no Shipping area', () => {
    const r = R.pickRoute(scene(), [{ slotId: 'a1', n: 1 }])!;
    expect(r.startKind).toBe('entrance');
    expect(r.start[1]).toBeGreaterThan(19); // front edge is z = 20
    expect(r.path[0]).toEqual(r.start);
    expect(r.path[r.path.length - 1]).toEqual(r.start);
  });

  it('starts at the Shipping area when the floor plan has one', () => {
    const areas = [{ type: 'SHIPPING_AREA', cx: 3, cz: 3, w: 2, d: 2 }];
    const r = R.pickRoute(scene({ areas }), [{ slotId: 'b5', n: 1 }])!;
    expect(r.startKind).toBe('shipping');
    expect(Math.hypot(r.start[0] - 3, r.start[1] - 3)).toBeLessThan(0.5);
  });

  it('never walks through a rack', () => {
    const r = R.pickRoute(scene(), [{ slotId: 'a1', n: 1 }, { slotId: 'b5', n: 2 }, { slotId: 'a5', n: 3 }])!;
    expect(r.unreachable).toEqual([]);
    expect(r.path.length).toBeGreaterThan(2);
    expect(crossesRack(r.path, [A, B])).toBe(false);
  });

  it('stands in the aisle next to the slot', () => {
    const r = R.pickRoute(scene(), [{ slotId: 'a1', n: 1 }])!;
    const at = r.stops[0].at!;
    expect(Math.abs(at[0] - (15 - 4))).toBeLessThanOrEqual(0.5); // in line with the slot
    expect(Math.abs(at[1] - 7)).toBeGreaterThan(0.6);            // outside the rack depth
    expect(Math.abs(at[1] - 7)).toBeLessThan(1.6);
  });

  it('numbers stops by walking order, not order line order', () => {
    // Lines go far, near, far; from the front edge the near row (B, z 11.2) comes first.
    const r = R.pickRoute(scene(), [{ slotId: 'a5', n: 1 }, { slotId: 'b5', n: 2 }, { slotId: 'a1', n: 3 }])!;
    expect(r.stops.map((s) => s.order)).toEqual([1, 2, 3]);
    expect(r.stops[0].slotId).toBe('b5');
  });

  it('a slot holding two lines is one stop with both line numbers', () => {
    const r = R.pickRoute(scene(), [{ slotId: 'a1', n: 1 }, { slotId: 'b1', n: 2 }, { slotId: 'a1', n: 3 }])!;
    expect(r.stops).toHaveLength(2);
    expect(r.stops.find((s) => s.slotId === 'a1')!.lines).toEqual([1, 3]);
  });

  it('length is the length of the drawn line', () => {
    const r = R.pickRoute(scene(), [{ slotId: 'b1', n: 1 }])!;
    let len = 0;
    for (let i = 1; i < r.path.length; i++) len += Math.hypot(r.path[i][0] - r.path[i - 1][0], r.path[i][1] - r.path[i - 1][1]);
    expect(r.lengthM).toBeCloseTo(len, 6);
    expect(r.lengthM).toBeGreaterThan(2 * 7); // there and back from the front edge (z ≈ 19.75 → ≈ 12.3)
  });

  it('lists a slot no aisle reaches and leaves it off the line', () => {
    // A rack boxed in by four others: no gap to stand in.
    const C = rack('C', 15, 3);
    const walls = [rack('W1', 15, 1.6), rack('W2', 15, 4.4), { ...rack('W3', 9.4, 3), length: 4, depth: 4 }, { ...rack('W4', 20.6, 3), length: 4, depth: 4 }] as Rack[];
    const s = scene({ racks: [A, B, C, ...walls], slots: [...scene().slots, slot('c1', C, 0)] });
    const r = R.pickRoute(s, [{ slotId: 'c1', n: 1 }, { slotId: 'b1', n: 2 }])!;
    expect(r.unreachable).toEqual(['c1']);
    expect(r.stops.map((x) => [x.slotId, x.order])).toEqual([['b1', 1], ['c1', 2]]);
  });

  it('stays inside an L-shaped floor', () => {
    // Floor without its NE quarter (x > 20, z < 10).
    const L: Pt[] = [[0, 0], [20, 0], [20, 10], [30, 10], [30, 20], [0, 20]];
    const r = R.pickRoute(scene({ floor: floor(L) }), [{ slotId: 'a5', n: 1 }])!;
    expect(r.unreachable).toEqual([]);
    for (const [x, z] of r.path) expect(x > 20.01 && z < 9.99).toBe(false);
  });
});

describe('orderStops', () => {
  it('visits every node once, starting at 0', () => {
    const pts = [[0, 0], [5, 0], [1, 0], [3, 0]];
    const d = pts.map((a) => pts.map((b) => Math.abs(a[0] - b[0])));
    const t = R.orderStops(d);
    expect(t[0]).toBe(0);
    expect([...t].sort()).toEqual([0, 1, 2, 3]);
    expect(t).toEqual([0, 2, 3, 1]); // along the line and back
  });
});
