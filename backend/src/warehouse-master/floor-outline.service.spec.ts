import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WarehouseMasterService, prepareOutline } from './warehouse-master.service';
import { warehouseArea, floorSpace } from './space-math';
import { outlineFromTemplate } from './floor-geometry';

// F2: Warehouse.floorOutline — checked + cleaned in the API, sizes follow the outer box,
// area follows the real shape (D3). Rectangles keep their old figures.

// 40 × 30 m with a 15 × 10 m notch cut out = 1200 − 150 = 1050 m²
const L_SHAPE = outlineFromTemplate({ shape: 'L', length: 40, width: 30, cutLength: 15, cutWidth: 10, corner: 'SE' } as any);

function makeSvc(before: any = null) {
  const prisma: any = {
    warehouse: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(before),
      create: jest.fn((a) => ({ id: 'w1', ...a.data })),
      update: jest.fn((a) => ({ ...before, ...a.data })),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  return { prisma, svc: new WarehouseMasterService(prisma) };
}

const codeOf = (fn: () => unknown) => {
  try { fn(); } catch (e) { return (e as BadRequestException).getResponse() as any; }
  return null;
};

describe('prepareOutline', () => {
  it('cleans points, moves the outer box to (0,0), sizes in cm from the box', () => {
    const r = prepareOutline({ version: 1, unit: 'm', shape: 'L', points: [[5, 5], [45, 5], [45, 25], [30, 25], [30, 35], [5, 35], [5, 5]], params: { cutLength: 15 } });
    expect(r.lengthCm).toBe(4000);
    expect(r.widthCm).toBe(3000);
    expect(r.outline.points[0]).toEqual([0, 0]);
    expect(r.outline.points).toHaveLength(6); // closing point dropped
    expect(r.outline).toMatchObject({ version: 1, unit: 'm', shape: 'L', params: { cutLength: 15 } });
  });

  it('rejects broken shapes with FLOOR_SHAPE_INVALID', () => {
    expect(codeOf(() => prepareOutline({ points: [[0, 0], [1, 0]] }))?.code).toBe('FLOOR_SHAPE_INVALID');
    expect(codeOf(() => prepareOutline({ points: [[0, 0], [10, 10], [10, 0], [0, 10]] }))?.message).toMatch(/SELF_INTERSECT/);
    expect(codeOf(() => prepareOutline({ points: [[0, 0], ['a', 0], [1, 1]] }))?.message).toMatch(/BAD_NUMBER/);
    expect(codeOf(() => prepareOutline({ points: 'nope' }))?.code).toBe('FLOOR_SHAPE_INVALID');
    expect(codeOf(() => prepareOutline({ shape: 'STAR', points: [[0, 0], [1, 0], [1, 1]] }))?.message).toMatch(/Unknown floor shape/);
    expect(codeOf(() => prepareOutline({ unit: 'cm', points: [[0, 0], [1, 0], [1, 1]] }))?.message).toMatch(/metres/);
    expect(codeOf(() => prepareOutline({ points: [[0, 0], [3000, 0], [3000, 10], [0, 10]] }))?.message).toMatch(/larger than/);
  });

  it('keeps only short number/string params', () => {
    const r = prepareOutline({ points: [[0, 0], [1, 0], [1, 1]], params: { a: 1, b: 'SE', c: { x: 1 }, d: NaN } });
    expect(r.outline.params).toEqual({ a: 1, b: 'SE' });
    expect(codeOf(() => prepareOutline({ points: [[0, 0], [1, 0], [1, 1]], params: [1] }))?.code).toBe('FLOOR_SHAPE_INVALID');
  });
});

describe('createWarehouse / updateWarehouse with a floor shape', () => {
  it('create stores the cleaned shape and sets length × width from it', async () => {
    const { prisma, svc } = makeSvc();
    await svc.createWarehouse({ code: 'WL', name: 'L', lengthCm: 1, widthCm: 1, floorOutline: L_SHAPE as any }, 'u1');
    const data = prisma.warehouse.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ lengthCm: 4000, widthCm: 3000 });
    expect(data.floorOutline.points).toHaveLength(6);
  });

  it('create without a shape is unchanged (no floorOutline written)', async () => {
    const { prisma, svc } = makeSvc();
    await svc.createWarehouse({ code: 'WR', name: 'R', lengthCm: 2000, widthCm: 1000 }, 'u1');
    expect(prisma.warehouse.create.mock.calls[0][0].data.floorOutline).toBeUndefined();
  });

  it('create with a broken shape writes nothing', async () => {
    const { prisma, svc } = makeSvc();
    await expect(svc.createWarehouse({ code: 'WX', name: 'X', floorOutline: { points: [[0, 0], [1, 0]] } }, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.warehouse.create).not.toHaveBeenCalled();
  });

  it('update sets the shape + sizes, and audits before/after', async () => {
    const { prisma, svc } = makeSvc({ id: 'w1', lengthCm: 2000, widthCm: 1000, floorOutline: null });
    await svc.updateWarehouse('w1', { floorOutline: L_SHAPE as any }, 'u1');
    expect(prisma.warehouse.update.mock.calls[0][0].data).toMatchObject({ lengthCm: 4000, widthCm: 3000 });
    const detail = JSON.parse(prisma.auditLog.create.mock.calls[0][0].data.detail);
    expect(detail.before.floorOutline).toBeNull();
    expect(detail.after.floorOutline.shape).toBe('L');
  });

  it('update with null goes back to a rectangle and keeps the sizes', async () => {
    const { prisma, svc } = makeSvc({ id: 'w1', lengthCm: 4000, widthCm: 3000, floorOutline: L_SHAPE });
    await svc.updateWarehouse('w1', { floorOutline: null }, 'u1');
    const data = prisma.warehouse.update.mock.calls[0][0].data;
    expect(data.floorOutline).toBe(Prisma.DbNull);
    expect(data.lengthCm).toBeUndefined();
  });

  it('a different length alone is refused while a shape is saved (FLOOR_SHAPE_SET)', async () => {
    const { prisma, svc } = makeSvc({ id: 'w1', lengthCm: 4000, widthCm: 3000, floorOutline: L_SHAPE });
    await expect(svc.updateWarehouse('w1', { lengthCm: 5000 }, 'u1')).rejects.toMatchObject({ response: { code: 'FLOOR_SHAPE_SET' } });
    await expect(svc.updateWarehouse('w1', { widthCm: null }, 'u1')).rejects.toMatchObject({ response: { code: 'FLOOR_SHAPE_SET' } });
    expect(prisma.warehouse.update).not.toHaveBeenCalled();
  });

  it('the same size (±0.5 cm) and other fields still save with a shape', async () => {
    const { prisma, svc } = makeSvc({ id: 'w1', lengthCm: 4000, widthCm: 3000, floorOutline: L_SHAPE });
    await svc.updateWarehouse('w1', { lengthCm: 4000.2, widthCm: 3000, heightCm: 900, name: 'New' }, 'u1');
    expect(prisma.warehouse.update).toHaveBeenCalledTimes(1);
  });
});

describe('area follows the real shape (D3)', () => {
  const base = { lengthCm: 4000, widthCm: 3000, heightCm: 1000, usableAreaPct: 50 };

  it('L-shape: total = 1050 m², usable = 50 %', () => {
    expect(warehouseArea({ ...base, floorOutline: L_SHAPE })).toMatchObject({ hasSize: true, totalAreaM2: 1050, usableAreaM2: 525, volumeM3: 10500 });
    expect(floorSpace({ ...base, floorOutline: L_SHAPE }, []).totalAreaM2).toBe(1050);
  });

  it('no shape / broken shape → same figures as before (length × width)', () => {
    expect(warehouseArea(base).totalAreaM2).toBe(1200);
    expect(warehouseArea({ ...base, floorOutline: { points: [[0, 0], [1, 0]] } }).totalAreaM2).toBe(1200);
    expect(warehouseArea({ ...base, floorOutline: null }).totalAreaM2).toBe(1200);
  });

  it('setup wizard OVER_AREA uses the shaped area', async () => {
    const TYPE = { id: 't1', code: 'RT', category: 'STANDARD_RACK', lengthCm: 1000, widthCm: 1000, heightCm: 400, levels: 1, columns: 1, slotCapacity: 1, isActive: true };
    const prisma: any = {
      warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'w1', ...base, usableAreaPct: 100, floorOutline: L_SHAPE, isDeleted: false }) },
      rackTypeMaster: { findUnique: jest.fn().mockResolvedValue(TYPE) },
      rack: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new WarehouseMasterService(prisma);
    // 11 racks × 100 m² = 1100 m²: fits 1200 (rectangle) but not 1050 (L-shape)
    const r = await svc.setupRacks('w1', { rackTypeId: 't1', zones: [{ name: 'A', racks: 11 }], preview: true }, 'u1');
    expect(r.usableAreaM2).toBe(1050);
    expect(r.warnings).toContain('OVER_AREA');
  });
});
