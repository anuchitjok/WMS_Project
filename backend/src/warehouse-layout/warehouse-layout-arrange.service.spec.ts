import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { LayoutObjectType } from '@prisma/client';
import { WarehouseLayoutService, planGeometry, rackPositionIssues } from './warehouse-layout.service';
import { PrismaService } from '../prisma/prisma.service';

// F6: racks arranged in the 3D view are saved as RACK drawings on the Floor Plan.
// Rack, Slot and StockItem get READ methods only in this mock: a write to any of
// them would throw "is not a function" and fail the suite.

const RACKS = [{ id: 'r1', code: 'A-01' }, { id: 'r2', code: 'A-02' }];
const WH = { id: 'wh_1', lengthCm: 2000, widthCm: 1000, floorOutline: null }; // 20 × 10 m

function makePrisma(opts: { layout?: any; objects?: any[] } = {}) {
  const objects: any[] = (opts.objects ?? []).map((o) => ({ ...o }));
  let layout: any = opts.layout ? { ...opts.layout } : null;
  let seq = 0;
  const p: any = {
    warehouse: { findFirst: jest.fn().mockResolvedValue(WH) },
    rack: { findMany: jest.fn().mockResolvedValue(RACKS) },
    slot: { findMany: jest.fn() },
    stockItem: { findMany: jest.fn() },
    warehouseLayout: {
      findUnique: jest.fn(async () => layout),
      findFirst: jest.fn(async () => (layout && !layout.isDeleted ? layout : null)),
      create: jest.fn(async ({ data }: any) => (layout = {
        id: 'lay_new', widthUnits: 100, heightUnits: 60, version: 0, isDeleted: false,
        metersPerUnit: null, floorOriginX: null, floorOriginZ: null, ...data,
      })),
      update: jest.fn(async ({ data }: any) => {
        const { version, ...rest } = data;
        layout = { ...layout, ...rest, version: version?.increment ? layout.version + version.increment : layout.version };
        return layout;
      }),
    },
    layoutObject: {
      findMany: jest.fn(async () => objects.filter((o) => !o.isDeleted)),
      create: jest.fn(async ({ data }: any) => { const o = { id: `new_${++seq}`, isDeleted: false, parentObjectId: null, ...data }; objects.push(o); return o; }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(objects.find((o) => o.id === where.id), data)),
      updateMany: jest.fn(async ({ where, data }: any) => { for (const o of objects) if (where.id.in.includes(o.id)) Object.assign(o, data); }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  p.$transaction = jest.fn((fn: any) => fn(p));
  return { p, objects, layout: () => layout };
}

async function serviceWith(db: ReturnType<typeof makePrisma>) {
  const mod = await Test.createTestingModule({
    providers: [WarehouseLayoutService, { provide: PrismaService, useValue: db.p }],
  }).compile();
  return mod.get(WarehouseLayoutService);
}

// Two 2.7 × 1.1 m racks side by side along X, well inside the 20 × 10 m floor.
const pos = (rackId: string, cx: number, cz = 3, rotation = 0) => ({ rackId, cx, cz, length: 2.7, depth: 1.1, rotation });
const body = (racks: any[], extra: any = {}) => ({ metersPerUnit: 1, floorOriginX: 0, floorOriginZ: 0, racks, ...extra });

describe('F6 save rack positions from 3D', () => {
  it('first save: creates the layout at 1 m per unit, anchors the floor, draws every rack', async () => {
    const db = makePrisma();
    const svc = await serviceWith(db);
    const res = await svc.saveRackPositions('wh_1', body([pos('r1', 3), pos('r2', 6)]) as any, 'u1');

    expect(db.layout()).toMatchObject({ metersPerUnit: 1, floorOriginX: 0, floorOriginZ: 0, version: 1 });
    const r1 = res.objects.find((o: any) => o.rackId === 'r1')!;
    expect(r1).toMatchObject({ objectType: LayoutObjectType.RACK, name: 'A-01', code: 'A-01', rotation: 0 });
    expect(r1.x).toBeCloseTo(3 - 1.35); expect(r1.y).toBeCloseTo(3 - 0.55);
    expect(r1.width).toBeCloseTo(2.7); expect(r1.height).toBeCloseTo(1.1);
    expect(JSON.parse(r1.metadata!)).toEqual({ source: '3d' });
    expect(db.p.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'LAYOUT_RACKS_ARRANGED' }) }));
  });

  it('an older plan keeps its recorded scale: metres are divided by it', async () => {
    const db = makePrisma({ layout: { id: 'lay_1', warehouseId: 'wh_1', version: 4, isDeleted: false, widthUnits: 100, heightUnits: 60, metersPerUnit: 2, floorOriginX: 0, floorOriginZ: 0 } });
    const svc = await serviceWith(db);
    const res = await svc.saveRackPositions('wh_1', body([pos('r1', 4), pos('r2', 8)], { version: 4, metersPerUnit: 1 }) as any, 'u1');
    const r1 = res.objects.find((o: any) => o.rackId === 'r1')!;
    expect(r1.width).toBeCloseTo(1.35);
    expect(r1.x).toBeCloseTo(2 - 0.675);
    expect(db.layout().metersPerUnit).toBe(2);
    expect(db.layout().version).toBe(5);
  });

  it('every active rack must be listed once, and only racks of this warehouse', async () => {
    const svc = await serviceWith(makePrisma());
    await expect(svc.saveRackPositions('wh_1', body([pos('r1', 3)]) as any, 'u1')).rejects.toThrow(/missing: A-02/);
    await expect(svc.saveRackPositions('wh_1', body([pos('r1', 3), pos('r1', 6), pos('r2', 9)]) as any, 'u1')).rejects.toThrow(/listed twice/);
    await expect(svc.saveRackPositions('wh_1', body([pos('r1', 3), pos('r2', 6), pos('rX', 9)]) as any, 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a stale version is refused (409) and nothing is written', async () => {
    const db = makePrisma({ layout: { id: 'lay_1', warehouseId: 'wh_1', version: 4, isDeleted: false, widthUnits: 100, heightUnits: 60 } });
    const svc = await serviceWith(db);
    await expect(svc.saveRackPositions('wh_1', body([pos('r1', 3), pos('r2', 6)], { version: 3 }) as any, 'u1')).rejects.toBeInstanceOf(ConflictException);
    // Someone created the layout after the client read "no layout".
    await expect(svc.saveRackPositions('wh_1', body([pos('r1', 3), pos('r2', 6)]) as any, 'u1')).rejects.toBeInstanceOf(ConflictException);
    expect(db.p.layoutObject.create).not.toHaveBeenCalled();
    expect(db.p.layoutObject.update).not.toHaveBeenCalled();
  });

  it('overlapping racks and racks off the floor are refused, with their codes', async () => {
    const svc = await serviceWith(makePrisma());
    await expect(svc.saveRackPositions('wh_1', body([pos('r1', 3), pos('r2', 4)]) as any, 'u1')).rejects.toThrow(/overlapping: A-01, A-02/);
    await expect(svc.saveRackPositions('wh_1', body([pos('r1', 3), pos('r2', 19.5)]) as any, 'u1')).rejects.toThrow(/outside the warehouse: A-02/);
    // Touching is fine (2.7 m apart = edge to edge).
    await expect(svc.saveRackPositions('wh_1', body([pos('r1', 3), pos('r2', 5.7)]) as any, 'u1')).resolves.toBeDefined();
  });

  it('a hand-drawn rack is moved in place, and the bins inside it move and turn with it', async () => {
    const db = makePrisma({
      layout: { id: 'lay_1', warehouseId: 'wh_1', version: 1, isDeleted: false, widthUnits: 100, heightUnits: 60, metersPerUnit: 1, floorOriginX: 0, floorOriginZ: 0 },
      objects: [
        { id: 'o1', layoutId: 'lay_1', objectType: 'RACK', rackId: 'r1', parentObjectId: null, x: 1.65, y: 2.45, width: 2.7, height: 1.1, rotation: 0, metadata: null },
        // A bin at the rack's right end: 1 m right of the rack centre (3, 3).
        { id: 'b1', layoutId: 'lay_1', objectType: 'BIN', rackId: null, parentObjectId: 'o1', x: 3.5, y: 2.5, width: 1, height: 1, rotation: 0, metadata: null },
      ],
    });
    const svc = await serviceWith(db);
    await svc.saveRackPositions('wh_1', body([pos('r1', 8, 5, 90), pos('r2', 3)], { version: 1 }) as any, 'u1');
    const o1 = db.objects.find((o) => o.id === 'o1')!;
    expect(o1.rotation).toBe(90);
    expect(o1.x + o1.width / 2).toBeCloseTo(8); expect(o1.y + o1.height / 2).toBeCloseTo(5);
    const b1 = db.objects.find((o) => o.id === 'b1')!;
    // Turned 90° with the rack: the end that was +X is now +Z (3D convention).
    expect(b1.x + b1.width / 2).toBeCloseTo(8); expect(b1.y + b1.height / 2).toBeCloseTo(6);
    expect(b1.rotation).toBe(90);
    expect(db.objects.filter((o) => o.rackId === 'r1')).toHaveLength(1); // no second drawing
  });

  it('the floor anchor is kept while racks are drawn, and replaced when none are left', async () => {
    const lay = { id: 'lay_1', warehouseId: 'wh_1', version: 1, isDeleted: false, widthUnits: 100, heightUnits: 60, metersPerUnit: 1, floorOriginX: 7, floorOriginZ: 7 };
    // No rack drawing left (e.g. after "back to auto layout"): 3D's new anchor is taken.
    const fresh = makePrisma({ layout: lay });
    await (await serviceWith(fresh)).saveRackPositions('wh_1', body([pos('r1', 3), pos('r2', 6)], { version: 1 }) as any, 'u1');
    expect(fresh.layout()).toMatchObject({ floorOriginX: 0, floorOriginZ: 0 });
    // Racks still drawn against it: the stored anchor wins (the floor must not move).
    const kept = makePrisma({
      layout: lay,
      objects: [{ id: 'o1', layoutId: 'lay_1', objectType: 'RACK', rackId: 'r1', parentObjectId: null, x: 8.65, y: 9.45, width: 2.7, height: 1.1, rotation: 0, metadata: null }],
    });
    await (await serviceWith(kept)).saveRackPositions('wh_1', body([pos('r1', 10, 10), pos('r2', 14, 10)], { version: 1 }) as any, 'u1');
    expect(kept.layout()).toMatchObject({ floorOriginX: 7, floorOriginZ: 7 });
  });

  it('respects warehouse scope', async () => {
    const svc = await serviceWith(makePrisma());
    await expect(svc.saveRackPositions('wh_1', body([pos('r1', 3), pos('r2', 6)]) as any, 'u1', { roleKey: 'X', warehouseIds: ['wh_2'] }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('F6 back to auto layout', () => {
  it('removes only the drawings 3D created; hand-drawn racks and racks with bins under them stay', async () => {
    const meta3d = JSON.stringify({ source: '3d' });
    const db = makePrisma({
      layout: { id: 'lay_1', warehouseId: 'wh_1', version: 2, isDeleted: false, widthUnits: 100, heightUnits: 60, metersPerUnit: 1 },
      objects: [
        { id: 'a', layoutId: 'lay_1', objectType: 'RACK', rackId: 'r1', parentObjectId: null, metadata: meta3d },
        { id: 'b', layoutId: 'lay_1', objectType: 'RACK', rackId: 'r2', parentObjectId: null, metadata: null },
        { id: 'c', layoutId: 'lay_1', objectType: 'RACK', rackId: 'r3', parentObjectId: null, metadata: meta3d },
        { id: 'c-bin', layoutId: 'lay_1', objectType: 'BIN', rackId: null, parentObjectId: 'c', metadata: null },
        { id: 'aisle', layoutId: 'lay_1', objectType: 'AISLE', rackId: null, parentObjectId: null, metadata: meta3d },
      ],
    });
    const svc = await serviceWith(db);
    const res = await svc.resetRackPositions('wh_1', { version: 2 }, 'u1');
    expect(res).toMatchObject({ removed: 1, kept: 2 });
    expect(db.objects.filter((o) => o.isDeleted).map((o) => o.id)).toEqual(['a']);
    expect(db.layout().version).toBe(3);
    await expect(svc.resetRackPositions('wh_1', { version: 2 }, 'u1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('F6 geometry helpers', () => {
  it('a rack deeper than long is stored so 3D turns it back the same way', () => {
    const g = planGeometry({ rackId: 'r', cx: 0, cz: 0, length: 1, depth: 2, rotation: 0 }, 1);
    expect(g.width).toBe(1); expect(g.height).toBe(2);
    // 3D reads a tall drawing as turned -90°, so +270 cancels it back to 0.
    expect(g.rotation).toBe(270);
  });

  it('a rack bigger than the floor is not counted as outside (it can never fit)', () => {
    const floor: [number, number][] = [[0, 0], [5, 0], [5, 4], [0, 4]];
    const big = { rackId: 'big', cx: 2.5, cz: 2, length: 6, depth: 1, rotation: 0 };
    const off = { rackId: 'off', cx: 10, cz: 2, length: 2, depth: 1, rotation: 0 };
    expect(rackPositionIssues([big, off], floor).outside).toEqual(['off']);
  });
});
