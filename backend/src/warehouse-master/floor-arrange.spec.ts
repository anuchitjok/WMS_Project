import { planGeometry } from '../warehouse-layout/warehouse-layout.service';
// F6: racks arranged in 3D, saved on the Floor Plan in metres, must come back to
// the same place and facing. The 3D scene code lives in the frontend (no test
// runner there), so it is loaded with require, like floor-placement.spec.ts.

type Pt = [number, number];
type Placed = { rack: { id: string }; center: Pt; length: number; depth: number; rotY: number };
type Scene = {
  racks: Placed[];
  floor: { cx: number; cz: number; w: number; d: number; outline: Pt[] | null };
  placement: { outside: string[]; overlap: string[]; unplaced: string[] };
  frame: { scale: number; anchored: boolean; planRacks: number };
};
type Pose = { center: Pt; deg: number };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sg = require('../../../frontend/src/components/warehouse-layout/scene-geometry') as {
  buildScene: (wh: unknown, objects?: unknown[], plan?: unknown, draft?: Map<string, Pose> | null) => Scene;
  arrangeIssues: (scene: Scene) => { outside: string[]; overlap: string[] };
  poseDeg: (p: { rotY: number }) => number;
};

const rack = (i: number, lengthCm = 270, widthCm = 110) => ({
  id: `r${i}`, code: `A-${i}`, zone: 'A', levels: 3, columns: 3, isActive: true, slots: [], lengthCm, widthCm, heightCm: 250,
});
const WH = (racks: unknown[]) => ({ code: 'W', lengthCm: 2000, widthCm: 1000, racks }); // 20 × 10 m

/** What the API stores for a pose (rack id, metres → plan units). */
const saved = (r: ReturnType<typeof rack>, pose: Pose, mpu: number) => ({
  id: `o-${r.id}`, objectType: 'RACK', rackId: r.id, status: 'ACTIVE',
  ...planGeometry({ rackId: r.id, cx: pose.center[0], cz: pose.center[1], length: r.lengthCm / 100, depth: r.widthCm / 100, rotation: pose.deg }, mpu),
});

describe('F6 arrange in 3D → Floor Plan → 3D', () => {
  for (const mpu of [1, 0.5]) {
    for (const deg of [0, 90, 180, 270]) {
      it(`a rack at ${deg}° comes back the same (mpu ${mpu})`, () => {
        const r = rack(1);
        const pose: Pose = { center: [7.5, 4], deg };
        const scene = sg.buildScene(WH([r]), [saved(r, pose, mpu)], { metersPerUnit: mpu, floorOriginX: 0, floorOriginZ: 0 });
        expect(scene.racks[0].center[0]).toBeCloseTo(7.5);
        expect(scene.racks[0].center[1]).toBeCloseTo(4);
        expect(sg.poseDeg(scene.racks[0])).toBe(deg);
      });
    }
  }

  it('a rack deeper than long also comes back the same way round', () => {
    const r = rack(1, 100, 240);
    const pose: Pose = { center: [5, 5], deg: 90 };
    const scene = sg.buildScene(WH([r]), [saved(r, pose, 1)], { metersPerUnit: 1, floorOriginX: 0, floorOriginZ: 0 });
    expect(sg.poseDeg(scene.racks[0])).toBe(90);
  });

  it('a saved plan keeps its scale (no fitting) and the floor sits at the saved corner', () => {
    const rs = [rack(1), rack(2)];
    const objs = [saved(rs[0], { center: [3, 3], deg: 0 }, 1), saved(rs[1], { center: [6, 3], deg: 0 }, 1)];
    const scene = sg.buildScene(WH(rs), objs, { metersPerUnit: 1, floorOriginX: 0, floorOriginZ: 0 });
    expect(scene.frame).toEqual({ scale: 1, anchored: true, planRacks: 2 });
    expect([scene.floor.cx, scene.floor.cz, scene.floor.w, scene.floor.d]).toEqual([10, 5, 20, 10]);
    expect(scene.placement).toEqual({ outside: [], overlap: [], unplaced: [] });
    // Without a recorded scale the old rule still applies (unchanged for older plans).
    expect(sg.buildScene(WH(rs), objs).frame).toEqual({ scale: 1, anchored: false, planRacks: 2 });
  });

  it('dragging (a draft) moves racks but never the floor', () => {
    const rs = [rack(1), rack(2)];
    const base = sg.buildScene(WH(rs));
    const draft = new Map<string, Pose>([['r1', { center: [100, 100], deg: 90 }]]);
    const moved = sg.buildScene(WH(rs), [], null, draft);
    expect(moved.floor).toEqual(base.floor);
    expect(moved.racks.find((p) => p.rack.id === 'r1')!.center).toEqual([100, 100]);
    expect(sg.arrangeIssues(moved).outside).toEqual(['r1']);
  });

  it('save is not blocked by a rack bigger than the whole floor', () => {
    const rs = [rack(1, 2500, 110), rack(2)]; // 25 m long in a 20 × 10 m warehouse
    // No saved plan: the floor is centred on the racks, so place them from its corner.
    const f = sg.buildScene(WH(rs)).floor;
    const x0 = f.cx - 10, z0 = f.cz - 5;
    const draft = new Map<string, Pose>([['r1', { center: [x0 + 10, z0 + 2], deg: 0 }], ['r2', { center: [x0 + 5, z0 + 7], deg: 0 }]]);
    const scene = sg.buildScene(WH(rs), [], null, draft);
    expect(scene.placement.outside).toContain('r1'); // still shown as a setup problem
    expect(sg.arrangeIssues(scene)).toEqual({ outside: [], overlap: [] });
  });
});
