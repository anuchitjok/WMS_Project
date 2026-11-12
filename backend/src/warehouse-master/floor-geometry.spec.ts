import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  Pt, bbox, edgeLengths, floorAreaM2, isRectilinear, normalizeOutline, outlineFromTemplate, outlineOf,
  pointInPolygon, polygonArea, rackPlacementIssues, rectCorners, rectInPolygon, rectsOverlap, segmentsCross,
  signedArea, splitRectilinear, templateErrors, templatePoints, validateOutline,
} from './floor-geometry';

// F1 (non-rectangular floors): pure geometry, no screens. Example from the
// analysis: an L of 60 × 40 m with a 20 × 20 m corner missing = 2,000 m².

const L_SHAPE: Pt[] = [[0, 0], [60, 0], [60, 20], [40, 20], [40, 40], [0, 40]];
const rack = (x: number, z: number, length = 2.5, depth = 1, rotY = 0) => ({ center: [x, z] as Pt, length, depth, rotY });
const sortPts = (p: Pt[]) => p.map((q) => q.join(',')).sort();

describe('floor-geometry', () => {
  describe('area (Shoelace)', () => {
    it('L example = 2,000 m² (bounding box 2,400 m²)', () => {
      expect(polygonArea(L_SHAPE)).toBe(2000);
      expect(bbox(L_SHAPE)).toMatchObject({ length: 60, width: 40 });
    });
    it('a rectangle gives exactly length × width (old figures unchanged)', () => {
      expect(floorAreaM2({ lengthCm: 2000, widthCm: 1500 })).toBe(300);
      expect(floorAreaM2({ lengthCm: 12345, widthCm: 6789 })).toBeCloseTo(123.45 * 67.89, 9);
    });
    it('direction does not change the area', () => {
      expect(polygonArea([...L_SHAPE].reverse())).toBe(2000);
      expect(signedArea(normalizeOutline([...L_SHAPE].reverse()))).toBeGreaterThan(0);
    });
    it('edge lengths follow point order', () => {
      expect(edgeLengths(L_SHAPE)).toEqual([60, 20, 20, 20, 40, 40]);
    });
  });

  describe('normalizeOutline / validateOutline', () => {
    it('drops a closing point, repeats and points on a straight line', () => {
      const messy: Pt[] = [[0, 0], [5, 0], [10, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
      expect(sortPts(normalizeOutline(messy))).toEqual(sortPts([[0, 0], [10, 0], [10, 10], [0, 10]]));
    });
    it('accepts the L, rejects bad input', () => {
      expect(validateOutline(L_SHAPE)).toEqual([]);
      expect(validateOutline([[0, 0], [1, 0]])).toEqual(['TOO_FEW_POINTS']);
      expect(validateOutline('nope')).toEqual(['TOO_FEW_POINTS']);
      expect(validateOutline([[0, 0], [1, NaN], [1, 1]])).toEqual(['BAD_NUMBER']);
      expect(validateOutline([[0, 0], [1, 0], [2, 0]])).toEqual(['ZERO_AREA']); // a line, not a floor
      expect(validateOutline(Array.from({ length: 202 }, (_, i) => [i, i % 2]))).toEqual(['TOO_MANY_POINTS']);
    });
    it('rejects a self-crossing outline (bow tie) and a point visited twice', () => {
      expect(validateOutline([[0, 0], [10, 10], [10, 0], [0, 10]])).toContain('SELF_INTERSECT');
      expect(validateOutline([[0, 0], [10, 0], [10, 10], [5, 0], [0, 10]])).not.toEqual([]);
    });
    it('isRectilinear', () => {
      expect(isRectilinear(L_SHAPE)).toBe(true);
      expect(isRectilinear([[0, 0], [10, 0], [5, 8]])).toBe(false);
    });
  });

  describe('points and segments', () => {
    it('point in L: inside, on the wall, in the missing corner', () => {
      expect(pointInPolygon([10, 10], L_SHAPE)).toBe(true);
      expect(pointInPolygon([60, 10], L_SHAPE)).toBe(true); // on the wall counts as inside
      expect(pointInPolygon([50, 30], L_SHAPE)).toBe(false); // the notch
      expect(pointInPolygon([-1, 5], L_SHAPE)).toBe(false);
    });
    it('segmentsCross ignores touching', () => {
      expect(segmentsCross([0, 0], [10, 10], [0, 10], [10, 0])).toBe(true);
      expect(segmentsCross([0, 0], [10, 0], [10, 0], [10, 10])).toBe(false);
      expect(segmentsCross([0, 0], [10, 0], [5, 0], [5, 5])).toBe(false);
    });
  });

  describe('racks', () => {
    it('rectCorners matches the 3D view convention (rotY 90° turns length onto Z)', () => {
      const c = rectCorners(rack(10, 10, 4, 2, Math.PI / 2));
      const b = bbox(c);
      expect(b.length).toBeCloseTo(2, 9);
      expect(b.width).toBeCloseTo(4, 9);
    });
    it('rack inside / touching a wall / across the notch / outside', () => {
      expect(rectInPolygon(rack(10, 10), L_SHAPE)).toBe(true);
      expect(rectInPolygon(rack(58.75, 10), L_SHAPE)).toBe(true); // against the east wall
      expect(rectInPolygon(rack(70, 10), L_SHAPE)).toBe(false);
      // all 4 corners inside the L's bounding box but the rack spans the notch corner
      expect(rectInPolygon(rack(40, 20, 6, 6), L_SHAPE)).toBe(false);
    });
    it('concave trap: all four corners on the floor, the wall corner inside the rack', () => {
      // U opening north between x 20..40, 20 deep; a long rack across the opening at z = 10 has corners on the arms
      const U = templatePoints({ shape: 'U', length: 60, width: 40, gap: 20, depth: 20, side: 'N' });
      expect(rectInPolygon(rack(30, 10, 50, 2), U)).toBe(false);
      expect(rectInPolygon(rack(30, 30, 50, 2), U)).toBe(true); // below the opening
    });
    it('turned rack is checked with its turned corners', () => {
      const narrow: Pt[] = [[0, 0], [10, 0], [10, 3], [0, 3]];
      expect(rectInPolygon(rack(5, 1.5, 8, 1, 0), narrow)).toBe(true);
      expect(rectInPolygon(rack(5, 1.5, 8, 1, Math.PI / 2), narrow)).toBe(false);
    });
    it('rectsOverlap: overlap, touching, gap, rotated', () => {
      expect(rectsOverlap(rack(0, 0), rack(1, 0))).toBe(true);
      expect(rectsOverlap(rack(0, 0), rack(2.5, 0))).toBe(false); // side by side, touching
      expect(rectsOverlap(rack(0, 0), rack(0, 2))).toBe(false);
      expect(rectsOverlap(rack(0, 0), rack(0, 2), 1.5)).toBe(true); // needs a 1.5 m aisle
      expect(rectsOverlap(rack(0, 0, 4, 1), rack(0, 0, 4, 1, Math.PI / 2))).toBe(true);
      expect(rectsOverlap(rack(0, 0, 2, 2, Math.PI / 4), rack(2.9, 0, 2, 2))).toBe(false);
    });
    it('rackPlacementIssues lists outside and overlaps by index', () => {
      const others = [rack(10, 10), rack(30, 10)];
      expect(rackPlacementIssues(rack(10.5, 10), L_SHAPE, others)).toEqual({ outside: false, overlaps: [0] });
      expect(rackPlacementIssues(rack(50, 30), L_SHAPE, others)).toEqual({ outside: true, overlaps: [] });
      expect(rackPlacementIssues(rack(50, 30), null, [])).toEqual({ outside: false, overlaps: [] }); // size unknown
    });
  });

  describe('splitRectilinear', () => {
    it('rectangle → itself', () => {
      expect(splitRectilinear([[0, 0], [20, 0], [20, 15], [0, 15]])).toEqual([{ minX: 0, minZ: 0, maxX: 20, maxZ: 15, area: 300 }]);
    });
    it('L → two parts covering 2,000 m², no overlap', () => {
      const parts = splitRectilinear(L_SHAPE)!;
      expect(parts.reduce((a, p) => a + p.area, 0)).toBe(2000);
      expect(parts).toHaveLength(2);
      expect(parts[0].area).toBeGreaterThanOrEqual(parts[1].area);
    });
    it('U and T split into parts with the right total', () => {
      for (const t of [
        { shape: 'U', length: 60, width: 40, gap: 20, depth: 20, side: 'N' },
        { shape: 'T', length: 60, width: 40, barDepth: 15, stemWidth: 20, side: 'N' },
        { shape: 'T', length: 60, width: 40, barDepth: 15, stemWidth: 20, side: 'E' },
      ] as const) {
        const pts = templatePoints(t);
        const parts = splitRectilinear(pts)!;
        expect(parts.reduce((a, p) => a + p.area, 0)).toBeCloseTo(polygonArea(pts), 9);
        for (const p of parts) expect(pointInPolygon([(p.minX + p.maxX) / 2, (p.minZ + p.maxZ) / 2], pts)).toBe(true);
      }
    });
    it('non-rectilinear → null', () => {
      expect(splitRectilinear([[0, 0], [10, 0], [5, 8]])).toBeNull();
    });
  });

  describe('templates', () => {
    it('RECT', () => {
      expect(polygonArea(templatePoints({ shape: 'RECT', length: 20, width: 15 }))).toBe(300);
    });
    it('L on every corner = same area, notch at that corner', () => {
      for (const corner of ['NW', 'NE', 'SE', 'SW'] as const) {
        const pts = templatePoints({ shape: 'L', length: 60, width: 40, cutLength: 20, cutWidth: 20, corner });
        expect(polygonArea(pts)).toBe(2000);
        const probe: Pt = [corner.includes('E') ? 55 : 5, corner.includes('S') ? 35 : 5];
        expect(pointInPolygon(probe, pts)).toBe(false);
      }
      expect(sortPts(templatePoints({ shape: 'L', length: 60, width: 40, cutLength: 20, cutWidth: 20, corner: 'SE' }))) // Z grows southward
        .toEqual(sortPts(L_SHAPE));
    });
    it('U and T on every side keep the area and the bounding box', () => {
      for (const side of ['N', 'E', 'S', 'W'] as const) {
        const u = templatePoints({ shape: 'U', length: 60, width: 40, gap: 10, depth: 15, side });
        expect(polygonArea(u)).toBe(2400 - 150);
        expect(bbox(u)).toMatchObject({ length: 60, width: 40 });
        const t = templatePoints({ shape: 'T', length: 60, width: 40, barDepth: 10, stemWidth: 10, side });
        const along = side === 'N' || side === 'S' ? 60 : 40, across = side === 'N' || side === 'S' ? 40 : 60;
        expect(polygonArea(t)).toBe(along * 10 + 10 * (across - 10));
        expect(bbox(t)).toMatchObject({ length: 60, width: 40 });
        expect(validateOutline(u)).toEqual([]);
        expect(validateOutline(t)).toEqual([]);
      }
    });
    it('bad numbers are reported, and templatePoints refuses them', () => {
      expect(templateErrors({ shape: 'RECT', length: 0, width: 5 })).toEqual(['SIZE']);
      expect(templateErrors({ shape: 'L', length: 10, width: 10, cutLength: 10, cutWidth: 2, corner: 'NW' })).toEqual(['CUT_TOO_BIG']);
      expect(templateErrors({ shape: 'U', length: 10, width: 10, gap: 12, depth: 10, side: 'N' })).toEqual(['GAP_TOO_BIG', 'DEPTH_TOO_BIG']);
      expect(templateErrors({ shape: 'T', length: 10, width: 10, barDepth: 11, stemWidth: 3, side: 'W' })).toEqual(['BAR_TOO_BIG']);
      expect(() => templatePoints({ shape: 'L', length: 10, width: 10, cutLength: 11, cutWidth: 2, corner: 'NW' })).toThrow(RangeError);
    });
    it('outlineFromTemplate keeps the inputs for reopening the form', () => {
      const o = outlineFromTemplate({ shape: 'L', length: 60, width: 40, cutLength: 20, cutWidth: 20, corner: 'NE' });
      expect(o).toMatchObject({ version: 1, unit: 'm', shape: 'L', params: { length: 60, width: 40, cutLength: 20, cutWidth: 20, corner: 'NE' } });
      expect(polygonArea(o.points)).toBe(2000);
    });
  });

  describe('outlineOf', () => {
    it('saved outline wins; else a rectangle from length × width; else null', () => {
      const o = outlineFromTemplate({ shape: 'L', length: 60, width: 40, cutLength: 20, cutWidth: 20, corner: 'NE' });
      expect(polygonArea(outlineOf({ floorOutline: o, lengthCm: 6000, widthCm: 4000 })!)).toBe(2000);
      expect(outlineOf({ lengthCm: 2000, widthCm: 1500 })).toEqual([[0, 0], [20, 0], [20, 15], [0, 15]]);
      expect(outlineOf({ lengthCm: null, widthCm: 1500 })).toBeNull();
    });
    it('a broken saved outline falls back to the rectangle (never crashes a screen)', () => {
      expect(outlineOf({ floorOutline: { points: [[0, 0], [1, 1]] }, lengthCm: 1000, widthCm: 1000 })).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
      expect(outlineOf({ floorOutline: 'garbage', lengthCm: null, widthCm: null })).toBeNull();
    });
  });

  it('frontend copy is identical to this file', () => {
    const here = readFileSync(join(__dirname, 'floor-geometry.ts'), 'utf8').replace(/\r\n/g, '\n');
    const copy = join(__dirname, '../../../frontend/src/components/warehouse-layout/floor-geometry.ts');
    if (!existsSync(copy)) return; // backend-only checkout (e.g. the Render build)
    expect(readFileSync(copy, 'utf8').replace(/\r\n/g, '\n')).toBe(here);
  });
});
