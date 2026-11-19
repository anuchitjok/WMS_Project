import { WarehouseMasterService } from './warehouse-master.service';

/**
 * RQ5 - the restore list. Without it a soft-deleted record is unreachable the
 * moment the page is reloaded: the row is still there and restoreRack still
 * works, the user just has no way to find it. Prisma is mocked; no database.
 */

const WH = { id: 'w1', code: 'WH-A', name: 'Main', isDeleted: false };
const WH_GONE = { id: 'w9', code: 'WH-OLD', name: 'Old site', isDeleted: true };

const deletedRack = (over: Record<string, unknown> = {}) => ({
  id: 'r1', code: 'A01', name: 'Aisle A', zone: 'A', warehouseId: 'w1',
  isActive: false, isDeleted: true, deletedAt: new Date('2026-11-12T08:00:00.000Z'), deletedBy: 'u7',
  warehouse: WH, ...over,
});

const deletedWarehouse = (over: Record<string, unknown> = {}) => ({
  id: 'w9', code: 'WH-OLD', name: 'Old site',
  isActive: false, isDeleted: true, deletedAt: new Date('2026-11-10T09:30:00.000Z'), deletedBy: 'u7', ...over,
});

/** The audit entry deleteRack writes - the restore list reads the same one. */
const deleteLog = (entityId: string, slotIds: string[]) => ({
  entityId, detail: JSON.stringify({ before: {}, after: { cascadedSlotIds: slotIds, cascadedSlotCodes: [] } }),
});

const WRITES = ['create', 'update', 'updateMany', 'createMany', 'delete', 'deleteMany', 'upsert'] as const;

function makePrisma() {
  const model = (extra: Record<string, unknown> = {}) => {
    const m: Record<string, jest.Mock> = {};
    for (const w of WRITES) m[w] = jest.fn();
    return { ...m, ...extra };
  };
  const prisma: any = {
    warehouse: model({ findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), findUnique: jest.fn() }),
    rack: model({ findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), findUnique: jest.fn(), count: jest.fn() }),
    slot: model({ findMany: jest.fn().mockResolvedValue([]), count: jest.fn() }),
    user: model({ findMany: jest.fn().mockResolvedValue([{ id: 'u7', username: 'anuchit', fullName: 'Anuchit J.' }]) }),
    auditLog: model({ findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) }),
    $transaction: jest.fn(),
  };
  return { prisma, svc: new WarehouseMasterService(prisma) };
}

/** Every write mock on every model, so "it wrote nothing" is checked, not assumed. */
const everyWrite = (prisma: any) =>
  Object.values(prisma).flatMap((m: any) => (m && typeof m === 'object' ? WRITES.map((w) => m[w]).filter(Boolean) : []));

describe('listDeleted (RQ5 restore list)', () => {
  it('lists a deleted rack with its warehouse, who deleted it, when, and how many slots went with it', async () => {
    const { prisma, svc } = makePrisma();
    prisma.rack.findMany.mockResolvedValue([deletedRack()]);
    prisma.auditLog.findMany.mockResolvedValue([deleteLog('r1', ['s1', 's2', 's3'])]);

    const res = await svc.listDeleted(null);

    expect(res.racks).toHaveLength(1);
    expect(res.racks[0]).toEqual({
      kind: 'RACK', id: 'r1', code: 'A01', name: 'Aisle A', zone: 'A',
      isDeleted: true, isActive: false,
      warehouse: { id: 'w1', code: 'WH-A', name: 'Main', isDeleted: false },
      deletedAt: '2026-11-12T08:00:00.000Z',
      deletedBy: { id: 'u7', username: 'anuchit', fullName: 'Anuchit J.' },
      slotsDeleted: 3, canRestore: true, blocked: null,
    });
    expect(res.totals).toEqual({ warehouses: 0, racks: 1, restorable: 1 });
    expect(res.generatedAt).toEqual(expect.any(String));
  });

  it('carries the warehouse so two racks sharing a code can be told apart', async () => {
    const { prisma, svc } = makePrisma();
    prisma.rack.findMany.mockResolvedValue([
      deletedRack({ id: 'r1', warehouseId: 'w1', warehouse: WH }),
      deletedRack({ id: 'r2', warehouseId: 'w2', warehouse: { id: 'w2', code: 'WH-B', name: 'Annex', isDeleted: false } }),
    ]);
    const res = await svc.listDeleted(null);
    expect(res.racks.map((r) => [r.code, r.warehouse!.code])).toEqual([['A01', 'WH-A'], ['A01', 'WH-B']]);
  });

  it('lists a deleted warehouse', async () => {
    const { prisma, svc } = makePrisma();
    prisma.warehouse.findMany.mockResolvedValue([deletedWarehouse()]);
    const res = await svc.listDeleted(null);
    expect(res.warehouses[0]).toMatchObject({
      kind: 'WAREHOUSE', id: 'w9', code: 'WH-OLD', name: 'Old site', isDeleted: true, isActive: false,
      warehouse: null, zone: null, slotsDeleted: 0, canRestore: true, blocked: null,
      deletedAt: '2026-11-10T09:30:00.000Z',
    });
    expect(res.totals).toEqual({ warehouses: 1, racks: 0, restorable: 1 });
  });

  describe('warehouse scope', () => {
    it('limits both queries to the caller warehouses', async () => {
      const { prisma, svc } = makePrisma();
      await svc.listDeleted({ roleKey: null, warehouseIds: ['w1', 'w2'] });
      expect(prisma.rack.findMany.mock.calls[0][0].where).toMatchObject({ isDeleted: true, warehouseId: { in: ['w1', 'w2'] } });
      expect(prisma.warehouse.findMany.mock.calls[0][0].where).toMatchObject({ isDeleted: true, id: { in: ['w1', 'w2'] } });
    });

    it('a deleted rack from a warehouse the caller cannot reach is never returned', async () => {
      const { prisma, svc } = makePrisma();
      // Prisma applies the filter; the service must ask for it. Only w1's rack comes back.
      prisma.rack.findMany.mockImplementation(async (a: any) => {
        const scoped = a.where.warehouseId?.in ?? null;
        return [deletedRack({ id: 'r1', warehouseId: 'w1' }), deletedRack({ id: 'r8', warehouseId: 'w8' })]
          .filter((r) => !scoped || scoped.includes(r.warehouseId));
      });
      const res = await svc.listDeleted({ roleKey: null, warehouseIds: ['w1'] });
      expect(res.racks.map((r) => r.id)).toEqual(['r1']);
    });

    it('an unrestricted caller gets no warehouse filter at all', async () => {
      const { prisma, svc } = makePrisma();
      await svc.listDeleted({ roleKey: 'SUPER_ADMIN', warehouseIds: ['w1'] });
      expect(prisma.rack.findMany.mock.calls[0][0].where).toEqual({ isDeleted: true });
      expect(prisma.warehouse.findMany.mock.calls[0][0].where).toEqual({ isDeleted: true });
    });
  });

  describe('a deleted rack inside a deleted warehouse', () => {
    it('is listed, but marked not restorable with the reason, so the UI never offers a restore that would 409', async () => {
      const { prisma, svc } = makePrisma();
      prisma.rack.findMany.mockResolvedValue([deletedRack({ warehouseId: 'w9', warehouse: WH_GONE })]);
      prisma.warehouse.findMany.mockResolvedValue([deletedWarehouse()]);

      const res = await svc.listDeleted(null);

      expect(res.racks).toHaveLength(1); // listed, not hidden
      expect(res.racks[0].canRestore).toBe(false);
      expect(res.racks[0].blocked).toEqual({ code: 'WAREHOUSE_DELETED', message: expect.stringContaining('WH-OLD') });
      expect(res.racks[0].blocked!.message).toMatch(/Restore warehouse .* first/);
      // The warehouse itself is restorable, and only it counts towards restorable.
      expect(res.warehouses[0].canRestore).toBe(true);
      expect(res.totals).toEqual({ warehouses: 1, racks: 1, restorable: 1 });
    });

    it('restoreRack refuses exactly the case the list marks, so the two agree', async () => {
      const { prisma, svc } = makePrisma();
      prisma.rack.findFirst.mockResolvedValue({ ...deletedRack({ warehouseId: 'w9' }), warehouse: undefined });
      prisma.warehouse.findUnique.mockResolvedValue({ id: 'w9', isDeleted: true });
      await expect(svc.restoreRack('r1', 'u1')).rejects.toThrow(/Restore the warehouse first/);
    });
  });

  describe('slot count', () => {
    it('reads the newest RACK_DELETED entry per rack, in one query', async () => {
      const { prisma, svc } = makePrisma();
      prisma.rack.findMany.mockResolvedValue([deletedRack({ id: 'r1' }), deletedRack({ id: 'r2' })]);
      prisma.auditLog.findMany.mockResolvedValue([
        deleteLog('r1', ['s1', 's2']),      // newest first, as the orderBy asks
        deleteLog('r1', ['s1', 's2', 's3']), // an older delete of the same rack - ignored
        deleteLog('r2', []),
      ]);
      const res = await svc.listDeleted(null);
      expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.findMany.mock.calls[0][0]).toMatchObject({
        where: { entityType: 'Rack', entityId: { in: ['r1', 'r2'] }, action: 'RACK_DELETED' },
        orderBy: { createdAt: 'desc' },
      });
      expect(res.racks.map((r) => r.slotsDeleted)).toEqual([2, 0]);
    });

    it('is 0 when there is no delete entry, or it cannot be read', async () => {
      const { prisma, svc } = makePrisma();
      prisma.rack.findMany.mockResolvedValue([deletedRack({ id: 'r1' }), deletedRack({ id: 'r2' })]);
      prisma.auditLog.findMany.mockResolvedValue([{ entityId: 'r2', detail: 'not json' }]);
      const res = await svc.listDeleted(null);
      expect(res.racks.map((r) => r.slotsDeleted)).toEqual([0, 0]);
    });

    it('a rack with no deletedAt is not looked up at all', async () => {
      const { prisma, svc } = makePrisma();
      prisma.rack.findMany.mockResolvedValue([deletedRack({ deletedAt: null })]);
      const res = await svc.listDeleted(null);
      expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
      expect(res.racks[0]).toMatchObject({ deletedAt: null, slotsDeleted: 0 });
    });
  });

  describe('deleted by', () => {
    it('resolves the actor to a person in one lookup for both kinds', async () => {
      const { prisma, svc } = makePrisma();
      prisma.warehouse.findMany.mockResolvedValue([deletedWarehouse({ deletedBy: 'u7' })]);
      prisma.rack.findMany.mockResolvedValue([deletedRack({ deletedBy: 'u7' })]);
      await svc.listDeleted(null);
      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['u7'] } });
    });

    it('keeps the id with null names when the user row is gone', async () => {
      const { prisma, svc } = makePrisma();
      prisma.rack.findMany.mockResolvedValue([deletedRack({ deletedBy: 'u404' })]);
      prisma.user.findMany.mockResolvedValue([]);
      const res = await svc.listDeleted(null);
      expect(res.racks[0].deletedBy).toEqual({ id: 'u404', username: null, fullName: null });
    });

    it('is null when nothing recorded who deleted it, and no user lookup is made', async () => {
      const { prisma, svc } = makePrisma();
      prisma.rack.findMany.mockResolvedValue([deletedRack({ deletedBy: null })]);
      const res = await svc.listDeleted(null);
      expect(res.racks[0].deletedBy).toBeNull();
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('read only', () => {
    it('writes nothing - no create, update, delete or transaction on any model', async () => {
      const { prisma, svc } = makePrisma();
      prisma.warehouse.findMany.mockResolvedValue([deletedWarehouse()]);
      prisma.rack.findMany.mockResolvedValue([deletedRack(), deletedRack({ id: 'r2', warehouse: WH_GONE })]);
      prisma.auditLog.findMany.mockResolvedValue([deleteLog('r1', ['s1'])]);

      await svc.listDeleted(null);

      for (const write of everyWrite(prisma)) expect(write).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      // Not even an audit entry: reading a list is not an event.
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('returns empty lists rather than failing when nothing is deleted', async () => {
      const { svc } = makePrisma();
      const res = await svc.listDeleted(null);
      expect(res).toMatchObject({ warehouses: [], racks: [], totals: { warehouses: 0, racks: 0, restorable: 0 } });
    });
  });
});
