import { intersectSpans, outlineFromTemplate, polygonArea, spansAt } from './floor-geometry';
// F3: the 3D floor follows the saved shape. floorRect lives in the frontend (no test
// runner there), so it is tested from here like the floor-geometry copy check.
// Loaded with require so the backend typecheck does not follow it into frontend code
// (the frontend's own `@/` paths only resolve in the frontend).
type Floor = { cx: number; cz: number; w: number; d: number; real: { w: number; d: number } | null; outline: [number, number][] | null };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { floorRect } = require('../../../frontend/src/components/warehouse-layout/scene-geometry') as {
  floorRect: (b: { minX: number; minZ: number; maxX: number; maxZ: number }, wh: unknown) => Floor;
};

// L: 40 × 30 m, 15 × 10 m notch at SE → points (0,0) (40,0) (40,20) (25,20) (25,30) (0,30)
const L_SHAPE = outlineFromTemplate({ shape: 'L', length: 40, width: 30, cutLength: 15, cutWidth: 10, corner: 'SE' } as any);
const racks = { minX: 0, minZ: 0, maxX: 10, maxZ: 6 }; // racks centred on (5, 3)

describe('spansAt / intersectSpans', () => {
  const L = L_SHAPE.points as [number, number][];

  it('a line through the wide part crosses the whole length', () => {
    expect(spansAt(L, 10)).toEqual([[0, 40]]);
  });

  it('a line through the notch stops at the notch', () => {
    expect(spansAt(L, 25)).toEqual([[0, 25]]);
  });

  it('a line outside the floor crosses nothing', () => {
    expect(spansAt(L, 35)).toEqual([]);
    expect(spansAt(L, -1)).toEqual([]);
  });

  it('a U shape gives two ranges across its arms', () => {
    const U = outlineFromTemplate({ shape: 'U', length: 30, width: 20, gap: 10, depth: 8, side: 'S' } as any).points as [number, number][];
    expect(spansAt(U, 18)).toEqual([[0, 10], [20, 30]]);
  });

  it('overlap keeps only what both sets share', () => {
    expect(intersectSpans([[0, 40]], [[0, 25]])).toEqual([[0, 25]]);
    expect(intersectSpans([[0, 10], [20, 30]], [[5, 25]])).toEqual([[5, 10], [20, 25]]);
    expect(intersectSpans([[0, 5]], [[6, 9]])).toEqual([]);
  });
});

describe('floorRect.outline (3D floor shape)', () => {
  it('rectangle warehouse: no outline, same box as before', () => {
    const f = floorRect(racks, { lengthCm: 4000, widthCm: 3000 });
    expect(f).toMatchObject({ cx: 5, cz: 3, w: 40, d: 30, real: { w: 40, d: 30 }, outline: null });
  });

  it('L-shape: outline points centred on the racks, same outer box', () => {
    const f = floorRect(racks, { lengthCm: 4000, widthCm: 3000, floorOutline: L_SHAPE });
    expect(f).toMatchObject({ cx: 5, cz: 3, w: 40, d: 30 });
    expect(f.outline).toHaveLength(6);
    // box (0..40, 0..30) moved so its centre (20, 15) sits on (5, 3)
    expect(f.outline).toEqual(expect.arrayContaining([[-15, -12], [25, -12], [25, 8], [10, 8], [10, 18], [-15, 18]]));
    expect(polygonArea(f.outline!)).toBe(1050);
  });

  it('a saved 4-corner box is drawn as the plain rectangle', () => {
    const box = { version: 1, unit: 'm', shape: 'CUSTOM', points: [[0, 0], [40, 0], [40, 30], [0, 30]] };
    expect(floorRect(racks, { lengthCm: 4000, widthCm: 3000, floorOutline: box }).outline).toBeNull();
  });

  it('a broken saved shape falls back to the rectangle', () => {
    const bad = { points: [[0, 0], [1, 0]] };
    expect(floorRect(racks, { lengthCm: 4000, widthCm: 3000, floorOutline: bad }).outline).toBeNull();
  });

  it('no real size: no outline even when a shape is saved', () => {
    const f = floorRect(racks, { lengthCm: null, widthCm: null, floorOutline: L_SHAPE });
    expect(f.real).toBeNull();
    expect(f.outline).toBeNull();
  });
});
