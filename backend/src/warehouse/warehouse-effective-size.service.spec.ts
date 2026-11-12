import { Test } from '@nestjs/testing';
import { WarehouseService } from './warehouse.service';
import { PrismaService } from '../prisma/prisma.service';

// GET /warehouse and /warehouse/:id (the 3D view) carry each rack's
// effectiveSize: its own size, every missing value from its Rack Type — the same
// rule as Warehouse Master and the Dashboard (space-math.effectiveRackSize).

const rack = (over: Record<string, unknown>) => ({
  id: 'r1', code: 'A01', levels: 2, columns: 3, lengthCm: null, widthCm: null, heightCm: null,
  rackTypeMaster: null, slots: [], ...over,
});

function makePrisma(racks: any[]) {
  const wh = { id: 'wh_1', code: 'WH', racks };
  return {
    warehouse: {
      findMany: jest.fn().mockResolvedValue([wh]),
      findUnique: jest.fn().mockResolvedValue(wh),
    },
  } as any;
}

async function serviceWith(prisma: any) {
  const mod = await Test.createTestingModule({
    providers: [WarehouseService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return mod.get(WarehouseService);
}

describe('WarehouseService rack effectiveSize (3D view)', () => {
  it('fills missing sizes from the Rack Type, keeps the rack own values', async () => {
    const prisma = makePrisma([
      rack({ lengthCm: 300, rackTypeMaster: { category: 'STANDARD_RACK', lengthCm: 250, widthCm: 100, heightCm: 500 } }),
    ]);
    const svc = await serviceWith(prisma);
    const [w] = await svc.findAll();
    expect(w.racks[0].effectiveSize).toEqual({ lengthCm: 300, widthCm: 100, heightCm: 500 });
    // the stored values are untouched
    expect(w.racks[0].lengthCm).toBe(300);
    expect(w.racks[0].widthCm).toBeNull();
  });

  it('is all null when neither the rack nor its type has a size', async () => {
    const svc = await serviceWith(makePrisma([rack({})]));
    const w = await svc.findOne('wh_1');
    expect(w.racks[0].effectiveSize).toEqual({ lengthCm: null, widthCm: null, heightCm: null });
  });

  it('asks Prisma for the Rack Type size (read only)', async () => {
    const prisma = makePrisma([]);
    const svc = await serviceWith(prisma);
    await svc.findAll();
    const sel = prisma.warehouse.findMany.mock.calls[0][0].include.racks.include.rackTypeMaster.select;
    expect(sel).toEqual({ category: true, lengthCm: true, widthCm: true, heightCm: true });
  });
});
