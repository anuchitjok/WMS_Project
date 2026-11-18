import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { LayoutObjectType } from '@prisma/client';
import { WarehouseLayoutService } from './warehouse-layout.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalService } from '../approval/approval.service';

// RQ13: the layout service asks the approval engine for a plan's chain, so every
// test module needs one. The lifecycle itself is tested in
// warehouse-layout-lifecycle.service.spec.ts with a stub that records calls.
const APPROVAL_STUB = {
  provide: ApprovalService,
  useValue: {
    getByEntity: jest.fn().mockResolvedValue(null),
    ensurePendingInstance: jest.fn().mockResolvedValue({ id: 'ai1', currentStep: 1, steps: [{ stepOrder: 1, status: 'PENDING' }] }),
    decide: jest.fn().mockResolvedValue({ status: 'APPROVED' }),
  },
};


// Phase 3: RQ10 (plan warnings) and RQ27 (place a batch of racks).
//
// ── THE C5 GUARANTEE, ENFORCED BY THIS MOCK ──────────────────────────────────
// The layout is a DRAWING: it never moves stock. So Warehouse, Rack, Slot and
// StockItem get READ methods here, and every write method on them is a spy that
// records the attempt and throws. `inventoryWrites` must stay empty in every
// test below — if either new endpoint ever starts writing inventory, these tests
// fail with the exact model and method that was called.

const WH = { id: 'wh_1', code: 'WH1', name: 'Main', lengthCm: 2000, widthCm: 1000, floorOutline: null }; // 20 × 10 m

// 2.7 × 1.1 m racks from a Rack Type (decision C3: the TYPE owns the size),
// one legacy rack with its own size, one rack with no size at all.
const RACKS = [
  { id: 'r1', code: 'A-01', lengthCm: null, widthCm: null, rackTypeMaster: { lengthCm: 270, widthCm: 110 } },
  { id: 'r2', code: 'A-02', lengthCm: null, widthCm: null, rackTypeMaster: { lengthCm: 270, widthCm: 110 } },
  { id: 'r3', code: 'A-03', lengthCm: 300, widthCm: 120, rackTypeMaster: null },
  { id: 'r4', code: 'A-04', lengthCm: null, widthCm: null, rackTypeMaster: null },
];

const WRITE_METHODS = ['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'] as const;

function makePrisma(opts: { layout?: any; objects?: any[]; racks?: any[] } = {}) {
  const objects: any[] = (opts.objects ?? []).map((o) => ({ ...o }));
  let layout: any = opts.layout ? { ...opts.layout } : null;
  const inventoryWrites: string[] = [];
  let seq = 0;

  // Read-only models: any write records itself and throws.
  const readOnly = (model: string, reads: Record<string, any>) => {
    const m: any = { ...reads };
    for (const w of WRITE_METHODS) {
      m[w] = jest.fn(() => {
        inventoryWrites.push(`${model}.${w}`);
        throw new Error(`C5 violation: the layout must never write ${model}`);
      });
    }
    return m;
  };

  const p: any = {
    warehouse: readOnly('Warehouse', { findFirst: jest.fn().mockResolvedValue(WH), findUnique: jest.fn().mockResolvedValue(WH), findMany: jest.fn().mockResolvedValue([WH]) }),
    rack: readOnly('Rack', { findMany: jest.fn(async () => opts.racks ?? RACKS), findFirst: jest.fn(async () => (opts.racks ?? RACKS)[0]), findUnique: jest.fn(async () => (opts.racks ?? RACKS)[0]) }),
    slot: readOnly('Slot', { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) }),
    stockItem: readOnly('StockItem', { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0) }),
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
      create: jest.fn(async ({ data }: any) => {
        const o = { id: `new_${++seq}`, isDeleted: false, parentObjectId: null, rotation: 0, zIndex: 0, displayOrder: 0, code: null, metadata: null, rackId: null, slotId: null, ...data };
        objects.push(o);
        return o;
      }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(objects.find((o) => o.id === where.id), data)),
      updateMany: jest.fn(async ({ where, data }: any) => { for (const o of objects) if (where.id.in.includes(o.id)) Object.assign(o, data); }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  p.$transaction = jest.fn((fn: any) => fn(p));
  return { p, objects, inventoryWrites, layout: () => layout };
}

async function serviceWith(db: ReturnType<typeof makePrisma>) {
  const mod = await Test.createTestingModule({
    providers: [WarehouseLayoutService, { provide: PrismaService, useValue: db.p }, APPROVAL_STUB],
  }).compile();
  return mod.get(WarehouseLayoutService);
}

const LAYOUT = {
  id: 'lay_1', warehouseId: 'wh_1', widthUnits: 20, heightUnits: 10, version: 3, isDeleted: false,
  metersPerUnit: 1, floorOriginX: 0, floorOriginZ: 0,
};

let n = 0;
const drawn = (objectType: LayoutObjectType, x: number, y: number, width: number, height: number, extra: any = {}) => ({
  id: extra.id ?? `d${++n}`, layoutId: 'lay_1', objectType, name: extra.code ?? `${objectType}`, code: null,
  parentObjectId: null, x, y, width, height, rotation: 0, zIndex: 0, displayOrder: 0,
  rackId: null, slotId: null, metadata: null, isDeleted: false, ...extra,
});

// ─── RQ10 ─────────────────────────────────────────────────────────────────────

describe('RQ10 — plan warnings (GET :warehouseId/problems)', () => {
  it('reports an overlap, a rack off the floor and a blocked door — all as WARNING', async () => {
    const db = makePrisma({
      layout: LAYOUT,
      objects: [
        drawn('RACK', 1, 1, 4, 2, { id: 'a', code: 'A-01' }),
        drawn('RACK', 2, 1, 4, 2, { id: 'b', code: 'A-02' }),
        drawn('RACK', 19, 6, 4, 2, { id: 'c', code: 'A-03' }),
        drawn('DOOR', 0, 4, 0.4, 2, { id: 'door', code: 'DOOR-1' }),
        drawn('RACK', 0, 4.2, 2, 1, { id: 'd', code: 'A-04' }),
      ],
    });
    const svc = await serviceWith(db);
    const res = await svc.problems('wh_1');

    expect(res.floor.source).toBe('OUTLINE');
    expect(res.counts).toMatchObject({ overlap: 1, outOfBounds: 1, blocksDoor: 1 });
    expect(res.problems.every((p) => p.severity === 'WARNING')).toBe(true);
    expect(res.problems.map((p) => p.kind).sort()).toEqual(['BLOCKS_DOOR', 'OUT_OF_BOUNDS', 'OVERLAP']);
  });

  it('writes nothing at all — not even an audit row', async () => {
    const db = makePrisma({ layout: LAYOUT, objects: [drawn('RACK', 1, 1, 4, 2), drawn('RACK', 2, 1, 4, 2)] });
    const svc = await serviceWith(db);
    await svc.problems('wh_1');

    expect(db.inventoryWrites).toEqual([]);
    expect(db.p.layoutObject.create).not.toHaveBeenCalled();
    expect(db.p.layoutObject.update).not.toHaveBeenCalled();
    expect(db.p.warehouseLayout.update).not.toHaveBeenCalled();
    expect(db.p.warehouseLayout.create).not.toHaveBeenCalled();
    expect(db.p.auditLog.create).not.toHaveBeenCalled();
  });

  it('a warehouse with no layout yet is an empty answer, not an error', async () => {
    const db = makePrisma();
    const svc = await serviceWith(db);
    await expect(svc.problems('wh_1')).resolves.toMatchObject({ layoutId: null, problems: [], floor: { source: 'NONE' } });
  });

  it('a tidy plan reports nothing', async () => {
    const db = makePrisma({
      layout: LAYOUT,
      objects: [
        drawn('STORAGE_AREA', 0, 0, 20, 10, { id: 'z' }),
        drawn('AISLE', 0, 4, 20, 2, { id: 'ai' }),
        drawn('RACK', 1, 1, 6, 1.2, { id: 'r1' }),
        drawn('BIN', 1.1, 1.1, 1, 1, { id: 'b1', parentObjectId: 'r1' }),
      ],
    });
    const svc = await serviceWith(db);
    await expect(svc.problems('wh_1')).resolves.toMatchObject({ problems: [] });
  });

  it('is scoped to the caller\'s warehouses', async () => {
    const db = makePrisma({ layout: LAYOUT });
    const svc = await serviceWith(db);
    await expect(svc.problems('wh_1', { roleKey: 'WAREHOUSE_MANAGER', warehouseIds: ['wh_other'] }))
      .rejects.toThrow(ForbiddenException);
  });
});

// ─── RQ27 ─────────────────────────────────────────────────────────────────────

describe('RQ27 — place a batch of racks (POST :warehouseId/place-racks)', () => {
  it('draws every unplaced rack at the size its Rack Type gives it', async () => {
    const db = makePrisma({ layout: LAYOUT });
    const svc = await serviceWith(db);
    const res = await svc.placeRacks('wh_1', { version: 3 } as any, 'u1');

    expect(res.placed.map((p) => p.code).sort()).toEqual(['A-01', 'A-02', 'A-03']);
    const a1 = res.placed.find((p) => p.code === 'A-01')!;
    expect(a1.width).toBeCloseTo(2.7); // 270 cm, 1 m per unit
    expect(a1.height).toBeCloseTo(1.1);
    const a3 = res.placed.find((p) => p.code === 'A-03')!;
    expect(a3.width).toBeCloseTo(3); // legacy rack keeps its own size
    expect(a3.height).toBeCloseTo(1.2);
    // A-04 has no size anywhere, so there is nothing honest to draw.
    expect(res.skipped).toEqual([{ rackId: 'r4', code: 'A-04', reason: 'NO_SIZE' }]);
  });

  it('creates RACK drawings linked to the existing racks, and bumps the layout', async () => {
    const db = makePrisma({ layout: LAYOUT });
    const svc = await serviceWith(db);
    await svc.placeRacks('wh_1', { version: 3 } as any, 'u1');

    const made = db.objects.filter((o) => o.objectType === LayoutObjectType.RACK);
    expect(made).toHaveLength(3);
    for (const o of made) {
      expect(o.rackId).toMatch(/^r[123]$/);
      expect(JSON.parse(o.metadata)).toEqual({ source: 'auto-place' });
    }
    expect(db.layout()).toMatchObject({ version: 4 });
    expect(db.p.auditLog.create).toHaveBeenCalled();
  });

  it('a rack that already has a drawing does not get a second one', async () => {
    const db = makePrisma({
      layout: LAYOUT,
      objects: [drawn('RACK', 1, 1, 2.7, 1.1, { id: 'has', rackId: 'r1', code: 'A-01' })],
    });
    const svc = await serviceWith(db);
    const res = await svc.placeRacks('wh_1', { version: 3 } as any, 'u1');

    expect(res.skipped).toEqual(expect.arrayContaining([{ rackId: 'r1', code: 'A-01', reason: 'ALREADY_DRAWN' }]));
    expect(res.placed.map((p) => p.rackId).sort()).toEqual(['r2', 'r3']);
    expect(db.objects.filter((o) => o.rackId === 'r1')).toHaveLength(1);
  });

  it('never draws a rack on top of what is already there', async () => {
    // Existing drawings and an aisle leave only the bottom-left corner free.
    const db = makePrisma({
      layout: LAYOUT,
      racks: [RACKS[0]],
      objects: [
        drawn('AISLE', 0, 3, 20, 7, { id: 'ai' }),
        drawn('RACK', 4, 0, 16, 3, { id: 'big', rackId: 'rX' }),
      ],
    });
    const svc = await serviceWith(db);
    const res = await svc.placeRacks('wh_1', { version: 3, gap: 0.1 } as any, 'u1');

    expect(res.placed).toHaveLength(1);
    expect(res.placed[0].x + res.placed[0].width).toBeLessThanOrEqual(4);
    expect(res.placed[0].y + res.placed[0].height).toBeLessThanOrEqual(3);

    // And the result is a plan with no new warnings.
    const after = await svc.problems('wh_1');
    expect(after.problems).toEqual([]);
  });

  it('a rack that does not fit is reported, not stacked', async () => {
    const db = makePrisma({
      layout: LAYOUT,
      racks: [{ id: 'rbig', code: 'TOO-BIG', lengthCm: 3000, widthCm: 500, rackTypeMaster: null }],
    });
    const svc = await serviceWith(db);
    const res = await svc.placeRacks('wh_1', { version: 3 } as any, 'u1');

    expect(res.placed).toEqual([]);
    expect(res.skipped).toEqual([{ rackId: 'rbig', code: 'TOO-BIG', reason: 'NO_ROOM' }]);
    expect(db.p.layoutObject.create).not.toHaveBeenCalled();
  });

  it('a dry run returns the positions and saves nothing', async () => {
    const db = makePrisma({ layout: LAYOUT });
    const svc = await serviceWith(db);
    const res = await svc.placeRacks('wh_1', { version: 3, dryRun: true } as any, 'u1');

    expect(res.dryRun).toBe(true);
    expect(res.placed).toHaveLength(3);
    expect(res.placed.every((p: any) => p.objectId === null)).toBe(true);
    expect(db.p.layoutObject.create).not.toHaveBeenCalled();
    expect(db.p.warehouseLayout.update).not.toHaveBeenCalled();
    expect(db.p.auditLog.create).not.toHaveBeenCalled();
    expect(db.layout()).toMatchObject({ version: 3 });
  });

  it('creates the layout on a first run, recording the scale and the floor anchor', async () => {
    const db = makePrisma();
    const svc = await serviceWith(db);
    const res = await svc.placeRacks('wh_1', {} as any, 'u1');

    expect(res.placed.length).toBeGreaterThan(0);
    expect(db.layout()).toMatchObject({ metersPerUnit: 1, floorOriginX: 0, floorOriginZ: 0, version: 1 });
  });

  it('refuses a stale version instead of fighting another editor', async () => {
    const db = makePrisma({ layout: LAYOUT });
    const svc = await serviceWith(db);
    await expect(svc.placeRacks('wh_1', { version: 1 } as any, 'u1')).rejects.toThrow(ConflictException);
    expect(db.p.layoutObject.create).not.toHaveBeenCalled();
  });

  it('only places the racks asked for, and rejects an id that is not one', async () => {
    const db = makePrisma({ layout: LAYOUT, racks: [RACKS[0]] });
    const svc = await serviceWith(db);
    const res = await svc.placeRacks('wh_1', { version: 3, rackIds: ['r1'] } as any, 'u1');
    expect(res.placed.map((p) => p.rackId)).toEqual(['r1']);

    const db2 = makePrisma({ layout: LAYOUT, racks: [RACKS[0]] });
    const svc2 = await serviceWith(db2);
    await expect(svc2.placeRacks('wh_1', { version: 3, rackIds: ['r1', 'nope'] } as any, 'u1'))
      .rejects.toThrow(BadRequestException);
  });

  it('is scoped to the caller\'s warehouses', async () => {
    const db = makePrisma({ layout: LAYOUT });
    const svc = await serviceWith(db);
    await expect(svc.placeRacks('wh_1', { version: 3 } as any, 'u1', { roleKey: 'WAREHOUSE_MANAGER', warehouseIds: ['wh_other'] }))
      .rejects.toThrow(ForbiddenException);
  });
});

// ─── C5 ───────────────────────────────────────────────────────────────────────

describe('C5 — the layout never writes inventory', () => {
  it('neither endpoint touches Warehouse, Rack, Slot or StockItem', async () => {
    const db = makePrisma({ layout: LAYOUT, objects: [drawn('RACK', 1, 1, 4, 2), drawn('RACK', 2, 1, 4, 2)] });
    const svc = await serviceWith(db);

    await svc.problems('wh_1');
    await svc.placeRacks('wh_1', { version: 3 } as any, 'u1');
    await svc.placeRacks('wh_1', { version: 4, dryRun: true } as any, 'u1');

    expect(db.inventoryWrites).toEqual([]);
    for (const model of ['warehouse', 'rack', 'slot', 'stockItem'] as const) {
      for (const w of WRITE_METHODS) expect(db.p[model][w]).not.toHaveBeenCalled();
    }
  });

  it('the racks themselves are only ever read', async () => {
    const db = makePrisma({ layout: LAYOUT });
    const svc = await serviceWith(db);
    await svc.placeRacks('wh_1', { version: 3 } as any, 'u1');

    expect(db.p.rack.findMany).toHaveBeenCalled();
    // Every write went to the drawing tables and the audit log, nowhere else.
    expect(db.p.layoutObject.create).toHaveBeenCalled();
    expect(db.p.warehouseLayout.update).toHaveBeenCalled();
    expect(db.inventoryWrites).toEqual([]);
  });
});
