import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { WarehouseMasterService } from './warehouse-master.service';

// PR4 setup wizard: whole zones of racks + their slots, all-or-nothing.

const TYPE = { id: 't1', code: 'RT-250', name: 'Shelf 250', category: 'STANDARD_RACK', lengthCm: 250, widthCm: 100, heightCm: 400, levels: 3, columns: 4, slotCapacity: 2, isActive: true };
const WH = { id: 'w1', code: 'WH', lengthCm: 2000, widthCm: 1000, usableAreaPct: 50, isDeleted: false };

function makePrisma(existing: any[] = []) {
  let n = 0;
  const tx: any = {
    rack: { create: jest.fn((a) => ({ id: `r${++n}`, code: a.data.code })) },
    slot: { createMany: jest.fn((a) => ({ count: a.data.length })) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    warehouse: { findFirst: jest.fn().mockResolvedValue(WH) },
    rackTypeMaster: { findUnique: jest.fn().mockResolvedValue(TYPE) },
    rack: { findMany: jest.fn().mockResolvedValue(existing) },
    $transaction: jest.fn((fn) => fn(tx)),
  };
  return { prisma, tx, svc: new WarehouseMasterService(prisma) };
}

describe('setupRacks (setup wizard)', () => {
  it('preview plans codes per zone, slots from the type grid, writes nothing', async () => {
    const { prisma, tx, svc } = makePrisma();
    const r = await svc.setupRacks('w1', { rackTypeId: 't1', zones: [{ name: 'A', racks: 2 }, { name: 'B', racks: 1 }], preview: true }, 'u1');
    expect(r.racks).toEqual([{ code: 'A-R01', zone: 'A' }, { code: 'A-R02', zone: 'A' }, { code: 'B-R01', zone: 'B' }]);
    expect(r).toMatchObject({ slotsPerRack: 12, totalRacks: 3, totalSlots: 36, newFootprintM2: 7.5, usableAreaM2: 100, warnings: [], preview: true, created: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.rack.create).not.toHaveBeenCalled();
  });

  it('codes continue after the highest existing number (deleted racks too)', async () => {
    const { svc } = makePrisma([
      { code: 'A-R01', isDeleted: false, rackTypeMaster: TYPE },
      { code: 'A-R07', isDeleted: true, rackTypeMaster: TYPE },
      { code: 'B-R02', isDeleted: false, rackTypeMaster: null, rackType: 'STANDARD' },
    ]);
    const r = await svc.setupRacks('w1', { rackTypeId: 't1', zones: [{ name: 'A', racks: 2 }, { name: 'b', racks: 1 }], preview: true }, 'u1');
    expect(r.racks.map((x) => x.code)).toEqual(['A-R08', 'A-R09', 'b-R03']);
    // used floor counts live racks with a known size only (A-R01 = 2.5 m²)
    expect(r.usedFootprintM2).toBe(2.5);
  });

  it('create: one transaction, racks follow the type, slots with type size, one audit entry', async () => {
    const { prisma, tx, svc } = makePrisma();
    const r = await svc.setupRacks('w1', { rackTypeId: 't1', zones: [{ name: 'A', racks: 2 }] }, 'u1');
    expect(r.created).toBe(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const rack = tx.rack.create.mock.calls[0][0].data;
    expect(rack).toMatchObject({ warehouseId: 'w1', code: 'A-R01', zone: 'A', levels: 3, columns: 4, rackTypeId: 't1', rackType: 'STANDARD', capacity: 24 });
    expect(rack.lengthCm).toBeUndefined(); // size comes from the Rack Type
    const slots = tx.slot.createMany.mock.calls[0][0].data;
    expect(slots).toHaveLength(12);
    expect(slots[0]).toMatchObject({ rackId: 'r1', code: 'A-R01-01-01', level: 1, column: 1, slotType: 'STANDARD', capacity: 2, lengthCm: 62.5, widthCm: 100 });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(JSON.parse(tx.auditLog.create.mock.calls[0][0].data.detail).after.codes).toEqual(['A-R01', 'A-R02']);
  });

  it('a failure part-way throws out of the transaction (nothing half-created, no audit)', async () => {
    const { tx, svc } = makePrisma();
    tx.slot.createMany.mockImplementationOnce(() => ({ count: 12 })).mockImplementationOnce(() => { throw new Error('db down'); });
    await expect(svc.setupRacks('w1', { rackTypeId: 't1', zones: [{ name: 'A', racks: 3 }] }, 'u1')).rejects.toThrow('db down');
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('pallet-on-floor type → PALLET racks and slots', async () => {
    const { prisma, tx, svc } = makePrisma();
    prisma.rackTypeMaster.findUnique.mockResolvedValue({ ...TYPE, category: 'PALLET_ON_FLOOR', levels: 1, columns: 2 });
    await svc.setupRacks('w1', { rackTypeId: 't1', zones: [{ name: 'P', racks: 1 }] }, 'u1');
    expect(tx.rack.create.mock.calls[0][0].data.rackType).toBe('PALLET');
    expect(tx.slot.createMany.mock.calls[0][0].data[0].slotType).toBe('PALLET');
  });

  it('warns (does not block) when the warehouse has no size or racks exceed the usable floor', async () => {
    const { prisma, svc } = makePrisma();
    const big = await svc.setupRacks('w1', { rackTypeId: 't1', zones: [{ name: 'A', racks: 41 }], preview: true }, 'u1');
    expect(big.warnings).toEqual(['OVER_AREA']); // 41 × 2.5 m² > 100 m²
    prisma.warehouse.findFirst.mockResolvedValue({ ...WH, lengthCm: null });
    const nosize = await svc.setupRacks('w1', { rackTypeId: 't1', zones: [{ name: 'A', racks: 1 }], preview: true }, 'u1');
    expect(nosize.warnings).toEqual(['NO_WAREHOUSE_SIZE']);
    expect(nosize.usableAreaM2).toBeNull();
  });

  it('refuses duplicate zones, too many racks, unknown / inactive type, unknown warehouse, out-of-scope warehouse', async () => {
    const { prisma, svc } = makePrisma();
    await expect(svc.setupRacks('w1', { rackTypeId: 't1', zones: [{ name: 'A', racks: 1 }, { name: 'a', racks: 1 }] }, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.setupRacks('w1', { rackTypeId: 't1', zones: Array.from({ length: 6 }, (_, i) => ({ name: `Z${i}`, racks: 99 })) }, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.setupRacks('w1', { rackTypeId: 't1', zones: [{ name: 'A', racks: 1 }] }, 'u1', { roleKey: null, warehouseIds: ['w2'] })).rejects.toBeInstanceOf(ForbiddenException);
    prisma.rackTypeMaster.findUnique.mockResolvedValueOnce({ ...TYPE, isActive: false });
    await expect(svc.setupRacks('w1', { rackTypeId: 't1', zones: [{ name: 'A', racks: 1 }] }, 'u1')).rejects.toBeInstanceOf(NotFoundException);
    prisma.warehouse.findFirst.mockResolvedValueOnce(null);
    await expect(svc.setupRacks('w1', { rackTypeId: 't1', zones: [{ name: 'A', racks: 1 }] }, 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
