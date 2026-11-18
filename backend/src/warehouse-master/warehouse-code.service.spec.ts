import { Prisma } from '@prisma/client';
import { WarehouseMasterService } from './warehouse-master.service';

// Service side of the auto-generated warehouse code: spec cases 3 (same name),
// 7 (concurrent creation), 8 (duplicate prevented) and 9 (rename keeps the code).

const duplicateCode = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`code`)', {
    code: 'P2002', clientVersion: 'test', meta: { target: ['code'] },
  });

/** Prisma double backed by a list of codes, with the unique index enforced like the DB. */
function makeSvc(existing: string[] = [], opts: { failFirst?: number } = {}) {
  const codes = [...existing];
  let failsLeft = opts.failFirst ?? 0;
  const created: any[] = [];
  const tx = {
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    warehouse: {
      findMany: jest.fn(async () => codes.map((code) => ({ code }))),
      create: jest.fn(async ({ data }: any) => {
        // Someone else inserted this number between our count and our insert.
        if (failsLeft > 0) { failsLeft--; codes.push(data.code); throw duplicateCode(); }
        if (codes.includes(data.code)) throw duplicateCode();
        codes.push(data.code);
        const row = { id: `w${codes.length}`, ...data };
        created.push(row);
        return row;
      }),
    },
  };
  const prisma: any = {
    $transaction: jest.fn(async (cb: any) => cb(tx)),
    warehouse: {
      findMany: tx.warehouse.findMany,
      findFirst: jest.fn(async () => ({ id: 'w1', code: 'WH-BANGKOK-001', name: 'Bangkok Warehouse', floorOutline: null, lengthCm: null, widthCm: null })),
      update: jest.fn(async ({ data }: any) => ({ id: 'w1', code: 'WH-BANGKOK-001', ...data })),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  return { svc: new WarehouseMasterService(prisma), prisma, tx, codes, created };
}

describe('createWarehouse — generated code', () => {
  it('generates the code and ignores anything the caller sends as code', async () => {
    const { svc, tx } = makeSvc();
    const wh: any = await svc.createWarehouse({ code: 'HAND-TYPED', name: 'Chiang Mai Warehouse' } as any, 'u1');
    expect(wh.code).toBe('WH-CHIANG-MAI-001');
    expect(tx.warehouse.create.mock.calls[0][0].data.code).not.toBe('HAND-TYPED');
  });

  it('takes the lock and counts inside the same transaction', async () => {
    const { svc, prisma, tx } = makeSvc();
    await svc.createWarehouse({ name: 'Bangkok Warehouse' } as any, 'u1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRawUnsafe.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(tx.warehouse.findMany).toHaveBeenCalled();
  });

  it('separates two warehouses with the same name by the running number (case 3)', async () => {
    const { svc } = makeSvc();
    const a: any = await svc.createWarehouse({ name: 'Spare Part Warehouse' } as any, 'u1');
    const b: any = await svc.createWarehouse({ name: 'Spare Part Warehouse' } as any, 'u1');
    expect([a.code, b.code]).toEqual(['WH-SPARE-PART-001', 'WH-SPARE-PART-002']);
  });

  it('continues the global sequence and never reuses a number', async () => {
    const { svc } = makeSvc(['SCG', 'WH-MAIN', 'WH-CHIANG-MAI-007']);
    const wh: any = await svc.createWarehouse({ name: 'Bangkok Warehouse' } as any, 'u1');
    expect(wh.code).toBe('WH-BANGKOK-008');
  });

  it('recounts and wins when another user takes the number first (case 7)', async () => {
    const { svc, tx } = makeSvc([], { failFirst: 1 });
    const wh: any = await svc.createWarehouse({ name: 'Bangkok Warehouse' } as any, 'u1');
    expect(tx.warehouse.create).toHaveBeenCalledTimes(2);
    expect(wh.code).toBe('WH-BANGKOK-002'); // 001 was taken mid-flight
  });

  it('gives up instead of writing a duplicate when every attempt collides (case 8)', async () => {
    const { svc, tx } = makeSvc([], { failFirst: 99 });
    await expect(svc.createWarehouse({ name: 'Bangkok Warehouse' } as any, 'u1')).rejects.toThrow();
    expect(tx.warehouse.create).toHaveBeenCalledTimes(5);
  });

  it('refuses a warehouse with no name', async () => {
    const { svc, tx } = makeSvc();
    await expect(svc.createWarehouse({ name: '   ' } as any, 'u1')).rejects.toThrow(/name/i);
    expect(tx.warehouse.create).not.toHaveBeenCalled();
  });

  it('writes a code for a Thai-only name (case 4, end to end)', async () => {
    const { svc } = makeSvc();
    const wh: any = await svc.createWarehouse({ name: 'คลังสินค้าเชียงใหม่' } as any, 'u1');
    expect(wh.code).toBe('WH-WAREHOUSE-001');
  });
});

describe('updateWarehouse — the code never moves (case 9)', () => {
  it('renaming writes only the name', async () => {
    const { svc, prisma } = makeSvc();
    await svc.updateWarehouse('w1', { name: 'Bangkok Main Hub' } as any, 'u1');
    const data = prisma.warehouse.update.mock.calls[0][0].data;
    expect(data.name).toBe('Bangkok Main Hub');
    expect(data).not.toHaveProperty('code');
  });
});

describe('previewWarehouseCode', () => {
  it('shows the code the next create would use, without writing anything', async () => {
    const { svc, tx } = makeSvc(['WH-A-004']);
    expect(await svc.previewWarehouseCode('Spare Part Warehouse')).toEqual({
      name: 'Spare Part Warehouse', slug: 'SPARE-PART', preview: 'WH-SPARE-PART-005',
    });
    expect(tx.warehouse.create).not.toHaveBeenCalled();
  });

  it('still previews something for an empty name', async () => {
    const { svc } = makeSvc();
    expect((await svc.previewWarehouseCode('')).preview).toBe('WH-WAREHOUSE-001');
  });
});
