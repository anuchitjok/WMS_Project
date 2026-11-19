import { BadRequestException } from '@nestjs/common';
import { WarehouseMasterService } from './warehouse-master.service';
import { AUTO_RACK_TYPE_MARK, isAutoRackType } from './warehouse-master.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import {
  DEFAULT_RACK_CODE_PATTERN, RACK_CODE_PATTERNS, RACK_CODE_PATTERN_KEY, SETTING_BY_KEY, parseSetting,
} from '../settings/setting-definitions';

/**
 * C3 — setupRacks accepts a size instead of a Rack Type (find-or-create), and
 * C4 — the rack code pattern is configurable for NEW racks only.
 *
 * Prisma is mocked throughout; nothing here touches a database.
 */

const TYPE = { id: 't1', code: 'RT-250', name: 'Shelf 250', category: 'STANDARD_RACK', lengthCm: 250, widthCm: 100, heightCm: 400, levels: 3, columns: 4, slotCapacity: 2, description: null, isActive: true };
const WH = { id: 'w1', code: 'WH', lengthCm: 10000, widthCm: 10000, usableAreaPct: 100, isDeleted: false };
const SIZE = { lengthCm: 250, widthCm: 100, heightCm: 400, levels: 3, columns: 4, slotCapacity: 2 };

type Opts = { existing?: any[]; match?: any; autoCodes?: string[]; pattern?: 'zone-r01' | 'rack-001' };

function make({ existing = [], match = null, autoCodes = [], pattern }: Opts = {}) {
  let n = 0;
  const tx: any = {
    rack: {
      create: jest.fn((a) => ({ id: `r${++n}`, code: a.data.code })),
      // A rename of an existing rack would have to go through one of these.
      update: jest.fn(() => { throw new Error('existing rack was renamed'); }),
      updateMany: jest.fn(() => { throw new Error('existing racks were renamed'); }),
    },
    slot: {
      createMany: jest.fn((a) => ({ count: a.data.length })),
      update: jest.fn(() => { throw new Error('existing slot was renamed'); }),
      updateMany: jest.fn(() => { throw new Error('existing slots were renamed'); }),
    },
    rackTypeMaster: { create: jest.fn((a) => ({ id: 'auto1', ...a.data })) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    warehouse: { findFirst: jest.fn().mockResolvedValue(WH) },
    rackTypeMaster: {
      findUnique: jest.fn().mockResolvedValue(TYPE),
      findFirst: jest.fn().mockResolvedValue(match),
      findMany: jest.fn().mockResolvedValue(autoCodes.map((code) => ({ code }))),
      create: jest.fn(() => { throw new Error('a Rack Type was created outside the transaction'); }),
    },
    rack: {
      findMany: jest.fn().mockResolvedValue(existing),
      update: jest.fn(() => { throw new Error('existing rack was renamed'); }),
      updateMany: jest.fn(() => { throw new Error('existing racks were renamed'); }),
    },
    $transaction: jest.fn((fn) => fn(tx)),
  };
  const settings = pattern ? ({ rackCodePattern: jest.fn().mockResolvedValue(pattern) } as any) : undefined;
  return { prisma, tx, settings, svc: new WarehouseMasterService(prisma, settings) };
}

const ZONES = [{ name: 'A', racks: 2 }];

describe('C3 — a size instead of a Rack Type', () => {
  it('accepts the size form and the rackTypeId form, and refuses both or neither', async () => {
    const { svc } = make();
    await expect(svc.setupRacks('w1', { rackTypeId: 't1', zones: ZONES, preview: true }, 'u1')).resolves.toMatchObject({ totalRacks: 2 });
    await expect(svc.setupRacks('w1', { ...SIZE, zones: ZONES, preview: true }, 'u1')).resolves.toMatchObject({ totalRacks: 2 });

    const both = svc.setupRacks('w1', { rackTypeId: 't1', ...SIZE, zones: ZONES, preview: true }, 'u1');
    await expect(both).rejects.toBeInstanceOf(BadRequestException);
    await expect(both).rejects.toThrow(/not both/i);

    const neither = svc.setupRacks('w1', { zones: ZONES, preview: true } as any, 'u1');
    await expect(neither).rejects.toBeInstanceOf(BadRequestException);
    await expect(neither).rejects.toThrow(/length, width and height/i);
  });

  it('refuses a rackTypeId sent beside any size field, rather than ignoring it', async () => {
    const { svc } = make();
    await expect(svc.setupRacks('w1', { rackTypeId: 't1', levels: 5, zones: ZONES, preview: true }, 'u1'))
      .rejects.toThrow(/levels/);
  });

  it('refuses a half-filled size (all three of length, width, height are needed)', async () => {
    const { svc } = make();
    await expect(svc.setupRacks('w1', { lengthCm: 250, widthCm: 100, zones: ZONES, preview: true }, 'u1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('reuses an active Rack Type that already matches the size — nothing new is created', async () => {
    const { prisma, tx, svc } = make({ match: TYPE });
    const r = await svc.setupRacks('w1', { ...SIZE, zones: ZONES }, 'u1');
    expect(prisma.rackTypeMaster.findFirst).toHaveBeenCalledWith({
      where: { isActive: true, category: 'STANDARD_RACK', lengthCm: 250, widthCm: 100, heightCm: 400, levels: 3, columns: 4, slotCapacity: 2 },
      orderBy: { createdAt: 'asc' },
    });
    expect(tx.rackTypeMaster.create).not.toHaveBeenCalled();
    expect(r.rackType).toMatchObject({ id: 't1', code: 'RT-250', willBeCreated: false, autoCreated: false });
    expect(tx.rack.create.mock.calls[0][0].data.rackTypeId).toBe('t1');
  });

  it('creates a Rack Type only when nothing matches, marks it [auto] and uses it', async () => {
    const { tx, svc } = make({ match: null });
    const r = await svc.setupRacks('w1', { ...SIZE, zones: ZONES }, 'u1');
    expect(tx.rackTypeMaster.create).toHaveBeenCalledTimes(1);
    const made = tx.rackTypeMaster.create.mock.calls[0][0].data;
    expect(made).toMatchObject({
      code: 'RT-AUTO-250x100x400-L3C4',
      name: 'Auto 250x100x400 cm (3 levels x 4 columns)',
      category: 'STANDARD_RACK', lengthCm: 250, widthCm: 100, heightCm: 400, levels: 3, columns: 4, slotCapacity: 2,
    });
    expect(made.description.startsWith(AUTO_RACK_TYPE_MARK)).toBe(true);
    expect(isAutoRackType(made.description)).toBe(true);
    expect(isAutoRackType(null)).toBe(false);
    expect(isAutoRackType('A rack type someone typed by hand')).toBe(false);
    // Every rack points at the type that was just created.
    expect(tx.rack.create.mock.calls.every((c: any[]) => c[0].data.rackTypeId === 'auto1')).toBe(true);
    expect(r.rackType).toMatchObject({ id: 'auto1', willBeCreated: false, autoCreated: true });
  });

  it('creates the Rack Type inside the same transaction — a failure leaves no orphan type', async () => {
    const { prisma, tx, svc } = make({ match: null });
    tx.slot.createMany.mockImplementationOnce(() => { throw new Error('db down'); });
    await expect(svc.setupRacks('w1', { ...SIZE, zones: ZONES }, 'u1')).rejects.toThrow('db down');
    expect(prisma.rackTypeMaster.create).not.toHaveBeenCalled(); // never outside $transaction
    expect(tx.rackTypeMaster.create).toHaveBeenCalledTimes(1);   // inside it, so the rollback takes it with the racks
    const setup = tx.auditLog.create.mock.calls.map((c: any[]) => c[0].data).filter((d: any) => d.action === 'RACKS_SETUP');
    expect(setup).toHaveLength(0);
  });

  it('a second press with the same size reuses the type the first press made', async () => {
    const first = make({ match: null });
    await first.svc.setupRacks('w1', { ...SIZE, zones: ZONES }, 'u1');
    const made = { id: 'auto1', ...first.tx.rackTypeMaster.create.mock.calls[0][0].data, isActive: true };

    const second = make({ match: made });
    const r = await second.svc.setupRacks('w1', { ...SIZE, zones: ZONES }, 'u1');
    expect(second.tx.rackTypeMaster.create).not.toHaveBeenCalled();
    expect(r.rackType).toMatchObject({ id: 'auto1', autoCreated: true });
  });

  it('generated codes do not collide with Rack Type codes already taken', async () => {
    const { tx, svc } = make({ match: null, autoCodes: ['RT-AUTO-250x100x400-L3C4', 'rt-auto-250x100x400-l3c4-2'] });
    await svc.setupRacks('w1', { ...SIZE, zones: ZONES }, 'u1');
    expect(tx.rackTypeMaster.create.mock.calls[0][0].data.code).toBe('RT-AUTO-250x100x400-L3C4-3');
  });

  it('a pallet-on-floor size gets one level, and the size defaults are 1', async () => {
    const { tx, svc } = make({ match: null });
    await svc.setupRacks('w1', { lengthCm: 120, widthCm: 100, heightCm: 150, category: 'PALLET_ON_FLOOR', columns: 2, zones: [{ name: 'P', racks: 1 }] }, 'u1');
    expect(tx.rackTypeMaster.create.mock.calls[0][0].data).toMatchObject({
      category: 'PALLET_ON_FLOOR', levels: 1, columns: 2, slotCapacity: 1,
      code: 'RT-AUTO-120x100x150-L1C2', name: 'Auto 120x100x150 cm (2 pallets)',
    });
    expect(tx.rack.create.mock.calls[0][0].data.rackType).toBe('PALLET');
  });

  it('preview with a size writes nothing, and says the type would be created', async () => {
    const { prisma, tx, svc } = make({ match: null });
    const r = await svc.setupRacks('w1', { ...SIZE, zones: ZONES, preview: true }, 'u1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.rackTypeMaster.create).not.toHaveBeenCalled();
    expect(prisma.rackTypeMaster.create).not.toHaveBeenCalled();
    expect(r.rackType).toMatchObject({ id: '', code: 'RT-AUTO-250x100x400-L3C4', willBeCreated: true, autoCreated: true });
    expect(r).toMatchObject({ created: 0, totalRacks: 2, slotsPerRack: 12, rackFootprintM2: 2.5, newFootprintM2: 5 });
  });
});

describe('C4 — the warehouse.rackCodePattern setting', () => {
  const def = SETTING_BY_KEY.get(RACK_CODE_PATTERN_KEY)!;
  const read = (row: any) => new SystemSettingsService({ setting: { findUnique: jest.fn().mockResolvedValue(row) } } as any);

  it('is defined, enforced, and seeded with the built-in pattern', () => {
    expect(def).toBeDefined();
    expect(def.effect).toBe('enforced');
    expect(def.seed).toBe('zone-r01');
    expect(DEFAULT_RACK_CODE_PATTERN).toBe('zone-r01');
    expect(RACK_CODE_PATTERNS).toEqual(['zone-r01', 'rack-001']);
  });

  it('accepts only the known patterns', () => {
    expect(parseSetting(def, 'zone-r01')).toEqual({ state: 'configured', value: 'zone-r01' });
    expect(parseSetting(def, 'rack-001')).toEqual({ state: 'configured', value: 'rack-001' });
    expect(parseSetting(def, 'RACK-001').state).toBe('invalid');
    expect(parseSetting(def, 'disabled').state).toBe('invalid');
  });

  it('reads back as the default while the row is missing, off or invalid', async () => {
    await expect(read(null).rackCodePattern()).resolves.toBe('zone-r01');
    await expect(read({ value: 'rack-001', isActive: false }).rackCodePattern()).resolves.toBe('zone-r01');
    await expect(read({ value: 'nonsense', isActive: true }).rackCodePattern()).resolves.toBe('zone-r01');
    await expect(read({ value: 'rack-001', isActive: true }).rackCodePattern()).resolves.toBe('rack-001');
  });
});

describe('C4 — configurable rack code pattern (new racks only)', () => {
  it('defaults to <Zone>-R01 when nothing is configured', async () => {
    const { svc } = make();
    const r = await svc.setupRacks('w1', { rackTypeId: 't1', zones: [{ name: 'A', racks: 2 }], preview: true }, 'u1');
    expect(r.rackCodePattern).toBe('zone-r01');
    expect(r.racks.map((x) => x.code)).toEqual(['A-R01', 'A-R02']);
  });

  it('falls back to the default when the setting is missing, disabled or invalid', async () => {
    // SystemSettingsService.rackCodePattern() already resolves those states to
    // the default, so the service only has to honour what it is handed.
    const { svc } = make({ pattern: 'zone-r01' });
    const r = await svc.setupRacks('w1', { rackTypeId: 't1', zones: [{ name: 'A', racks: 1 }], preview: true }, 'u1');
    expect(r.racks[0].code).toBe('A-R01');
  });

  it('RACK-001 numbers across the whole warehouse, zone still recorded on the rack', async () => {
    const { tx, svc } = make({ pattern: 'rack-001' });
    const r = await svc.setupRacks('w1', { rackTypeId: 't1', zones: [{ name: 'A', racks: 2 }, { name: 'B', racks: 1 }] }, 'u1');
    expect(r.rackCodePattern).toBe('rack-001');
    expect(r.racks).toEqual([
      { code: 'RACK-001', zone: 'A', lengthCm: 250, widthCm: 100, footprintM2: 2.5 },
      { code: 'RACK-002', zone: 'A', lengthCm: 250, widthCm: 100, footprintM2: 2.5 },
      { code: 'RACK-003', zone: 'B', lengthCm: 250, widthCm: 100, footprintM2: 2.5 },
    ]);
    expect(tx.rack.create.mock.calls.map((c: any[]) => c[0].data.zone)).toEqual(['A', 'A', 'B']);
    // Slot codes are built from the new rack code, as always.
    expect(tx.slot.createMany.mock.calls[0][0].data[0].code).toBe('RACK-001-01-01');
  });

  it('RACK-001 continues after the highest existing number and skips taken codes', async () => {
    const { svc } = make({
      pattern: 'rack-001',
      existing: [
        { code: 'RACK-004', isDeleted: false, rackTypeMaster: TYPE },
        { code: 'RACK-009', isDeleted: true, rackTypeMaster: TYPE }, // deleted: its code still holds the key
        { code: 'RACK-011', isDeleted: false, rackTypeMaster: TYPE },
        { code: 'A-R03', isDeleted: false, rackTypeMaster: TYPE },   // older pattern, left alone
      ],
    });
    const r = await svc.setupRacks('w1', { rackTypeId: 't1', zones: [{ name: 'A', racks: 2 }], preview: true }, 'u1');
    expect(r.racks.map((x) => x.code)).toEqual(['RACK-012', 'RACK-013']);
  });

  it('changing the pattern never renames a rack that already exists', async () => {
    const before = [
      { code: 'A-R01', isDeleted: false, rackTypeMaster: TYPE },
      { code: 'A-R02', isDeleted: false, rackTypeMaster: TYPE },
      { code: 'B-R01', isDeleted: true, rackTypeMaster: TYPE },
    ];
    const { prisma, tx, svc } = make({ pattern: 'rack-001', existing: before });
    const r = await svc.setupRacks('w1', { rackTypeId: 't1', zones: [{ name: 'A', racks: 2 }] }, 'u1');

    // Only new codes are written; the old ones are untouched and still unique.
    expect(r.racks.map((x) => x.code)).toEqual(['RACK-001', 'RACK-002']);
    expect(tx.rack.create).toHaveBeenCalledTimes(2);
    // Any rename would have had to call one of these (they throw if used).
    expect(prisma.rack.update).not.toHaveBeenCalled();
    expect(prisma.rack.updateMany).not.toHaveBeenCalled();
    expect(tx.rack.update).not.toHaveBeenCalled();
    expect(tx.rack.updateMany).not.toHaveBeenCalled();
    expect(tx.slot.update).not.toHaveBeenCalled();
    expect(tx.slot.updateMany).not.toHaveBeenCalled();
    // The warehouse's racks were read, not written.
    expect(prisma.rack.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { warehouseId: 'w1' } }));

    // Switching back produces the next <Zone>-R number, still touching nothing.
    const back = make({ pattern: 'zone-r01', existing: [...before, { code: 'RACK-001', isDeleted: false, rackTypeMaster: TYPE }] });
    const r2 = await back.svc.setupRacks('w1', { rackTypeId: 't1', zones: [{ name: 'A', racks: 1 }], preview: true }, 'u1');
    expect(r2.racks.map((x) => x.code)).toEqual(['A-R03']);
  });

  it('the rackTypeId path is byte-identical to before: same codes, same rack rows, no type created', async () => {
    const { prisma, tx, svc } = make({ existing: [{ code: 'A-R01', isDeleted: false, rackTypeMaster: TYPE }] });
    const r = await svc.setupRacks('w1', { rackTypeId: 't1', zones: [{ name: 'A', racks: 2 }] }, 'u1');

    expect(prisma.rackTypeMaster.findUnique).toHaveBeenCalledWith({ where: { id: 't1' } });
    expect(prisma.rackTypeMaster.findFirst).not.toHaveBeenCalled(); // no find-or-create on this path
    expect(tx.rackTypeMaster.create).not.toHaveBeenCalled();
    expect(r.racks.map((x) => x.code)).toEqual(['A-R02', 'A-R03']);
    expect(tx.rack.create.mock.calls[0][0].data).toEqual({
      warehouseId: 'w1', code: 'A-R02', zone: 'A', levels: 3, columns: 4,
      rackTypeId: 't1', rackType: 'STANDARD', capacity: 24,
    });
    expect(tx.slot.createMany.mock.calls[0][0].data).toHaveLength(12);
    expect(tx.slot.createMany.mock.calls[0][0].data[0]).toMatchObject({ code: 'A-R02-01-01', capacity: 2, lengthCm: 62.5, widthCm: 100 });
    expect(r).toMatchObject({ created: 2, totalRacks: 2, totalSlots: 24, rackCodePattern: 'zone-r01' });
    expect(r.rackType).toMatchObject({ id: 't1', code: 'RT-250', autoCreated: false, willBeCreated: false });
    // Audit still records one RACKS_SETUP entry with the codes that were made.
    const setup = tx.auditLog.create.mock.calls.map((c: any[]) => c[0].data).filter((d: any) => d.action === 'RACKS_SETUP');
    expect(setup).toHaveLength(1);
    expect(JSON.parse(setup[0].detail).after).toMatchObject({ rackTypeId: 't1', rackType: 'RT-250', rackTypeAutoCreated: false, rackCodePattern: 'zone-r01' });
  });
});
