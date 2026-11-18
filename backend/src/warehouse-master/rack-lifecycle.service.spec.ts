import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { WarehouseMasterService } from './warehouse-master.service';
import { WarehouseService } from '../warehouse/warehouse.service';

/**
 * RQ5 - Rack / Warehouse deactivate, activate, restore, and the delete that was
 * impossible before (every real rack has slots, and "has slots" used to block it).
 * Prisma is mocked; nothing here touches a database.
 */

const RACK = { id: 'r1', warehouseId: 'w1', code: 'A01', isActive: true, isDeleted: false, deletedAt: null, deletedBy: null, rackTypeId: null, rackType: 'STANDARD' };

function makePrisma() {
  const tx = {
    rack: { update: jest.fn(async (a: any) => ({ ...RACK, ...a.data })) },
    slot: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    rack: { findFirst: jest.fn().mockResolvedValue(RACK), update: jest.fn(async (a: any) => ({ ...RACK, ...a.data })), count: jest.fn().mockResolvedValue(0) },
    slot: { count: jest.fn().mockResolvedValue(0) },
    warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'w1', isDeleted: false }), findUnique: jest.fn().mockResolvedValue({ id: 'w1', isDeleted: false }), update: jest.fn(async (a: any) => ({ id: 'w1', ...a.data })) },
    stockItem: { count: jest.fn().mockResolvedValue(0) },
    relocationLine: { count: jest.fn().mockResolvedValue(0) },
    layoutObject: { count: jest.fn().mockResolvedValue(0) },
    auditLog: { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  return { prisma, tx, svc: new WarehouseMasterService(prisma) };
}

/** rackImpact fires five counts in one Promise.all: slots, stock now, history, relocations, layout. */
const impactCounts = (prisma: any, { slots = 0, stock = 0, history = 0, relocations = 0, layout = 0 } = {}) => {
  prisma.slot.count.mockResolvedValue(slots);
  prisma.stockItem.count.mockReset();
  prisma.stockItem.count.mockResolvedValueOnce(stock).mockResolvedValueOnce(history);
  prisma.relocationLine.count.mockResolvedValue(relocations);
  prisma.layoutObject.count.mockResolvedValue(layout);
};

const auditActions = (m: jest.Mock) => m.mock.calls.map((c) => c[0].data.action);

describe('Rack lifecycle (RQ5)', () => {
  describe('deactivate / activate', () => {
    it('round trip flips isActive only and never touches the delete fields', async () => {
      const { prisma, svc } = makePrisma();
      const off = await svc.deactivateRack('r1', 'u1');
      expect(prisma.rack.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { isActive: false } });
      expect(off.isDeleted).toBe(false);
      expect(off.deletedAt).toBeNull();

      prisma.rack.findFirst.mockResolvedValue({ ...RACK, isActive: false });
      const on = await svc.activateRack('r1', 'u1');
      expect(prisma.rack.update).toHaveBeenLastCalledWith({ where: { id: 'r1' }, data: { isActive: true } });
      expect(on.isActive).toBe(true);
      expect(auditActions(prisma.auditLog.create)).toEqual(['RACK_DEACTIVATED', 'RACK_ACTIVATED']);
    });

    it('is a no-op when the rack is already in that state', async () => {
      const { prisma, svc } = makePrisma();
      await svc.activateRack('r1', 'u1'); // RACK is active already
      prisma.rack.findFirst.mockResolvedValue({ ...RACK, isActive: false });
      await svc.deactivateRack('r1', 'u1');
      expect(prisma.rack.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('a deleted rack cannot be deactivated or activated', async () => {
      const { prisma, svc } = makePrisma();
      prisma.rack.findFirst.mockResolvedValue(null); // the lookup filters isDeleted: false
      await expect(svc.deactivateRack('r1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.activateRack('r1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteRack', () => {
    it('SUCCEEDS for a rack that has slots but no stock, and soft deletes the slots with it in one transaction', async () => {
      const { prisma, tx, svc } = makePrisma();
      impactCounts(prisma, { slots: 25 });
      tx.slot.findMany.mockResolvedValue([{ id: 's1', code: 'A01-01-01' }, { id: 's2', code: 'A01-01-02' }]);
      tx.slot.updateMany.mockResolvedValue({ count: 2 });

      const res = await svc.deleteRack('r1', 'u1');

      expect(res).toEqual({ success: true, id: 'r1', slotsDeleted: 2 });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // One transaction: slots and rack, same call, same deletedAt.
      const slotData = tx.slot.updateMany.mock.calls[0][0].data;
      const rackData = tx.rack.update.mock.calls[0][0].data;
      expect(slotData).toMatchObject({ isActive: false, isDeleted: true, deletedBy: 'u1' });
      expect(rackData).toMatchObject({ isActive: false, isDeleted: true, deletedBy: 'u1' });
      expect(slotData.deletedAt).toBe(rackData.deletedAt);
      // Only live slots with nothing in them are written.
      expect(tx.slot.updateMany.mock.calls[0][0].where).toMatchObject({ id: { in: ['s1', 's2'] }, isDeleted: false });
      // Nothing was written outside the transaction.
      expect(prisma.rack.update).not.toHaveBeenCalled();
    });

    it('records the cascaded slot ids in the RACK_DELETED audit entry, inside the transaction', async () => {
      const { prisma, tx, svc } = makePrisma();
      impactCounts(prisma, { slots: 2 });
      tx.slot.findMany.mockResolvedValue([{ id: 's1', code: 'A01-01-01' }, { id: 's2', code: 'A01-01-02' }]);
      tx.slot.updateMany.mockResolvedValue({ count: 2 });
      await svc.deleteRack('r1', 'u1');
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
      expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
      const entry = tx.auditLog.create.mock.calls[0][0].data;
      expect(entry.action).toBe('RACK_DELETED');
      expect(JSON.parse(entry.detail).after.cascadedSlotIds).toEqual(['s1', 's2']);
    });

    it('refuses when stock is in the rack now', async () => {
      const { prisma, svc } = makePrisma();
      impactCounts(prisma, { slots: 4, stock: 3, history: 3 });
      await expect(svc.deleteRack('r1', 'u1')).rejects.toMatchObject({
        constructor: ConflictException,
        message: expect.stringContaining('3 stock item(s) are in this rack now'),
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses when the rack has stock history, even with nothing in it now', async () => {
      const { prisma, svc } = makePrisma();
      impactCounts(prisma, { slots: 4, stock: 0, history: 7 });
      await expect(svc.deleteRack('r1', 'u1')).rejects.toThrow(/7 stock movement\(s\) reference this rack/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses when an open relocation line still points at the rack', async () => {
      const { prisma, svc } = makePrisma();
      impactCounts(prisma, { slots: 4, relocations: 1 });
      await expect(svc.deleteRack('r1', 'u1')).rejects.toThrow(/1 open relocation line\(s\)/);
    });

    it('rolls back when stock lands in a slot between the check and the write', async () => {
      const { prisma, tx, svc } = makePrisma();
      impactCounts(prisma, { slots: 2 });
      tx.slot.findMany.mockResolvedValue([{ id: 's1', code: 'A' }, { id: 's2', code: 'B' }]);
      tx.slot.updateMany.mockResolvedValue({ count: 1 }); // one slot fell out of the guard
      await expect(svc.deleteRack('r1', 'u1')).rejects.toBeInstanceOf(ConflictException);
      expect(tx.rack.update).not.toHaveBeenCalled();
    });

    it('a rack with no slots at all still deletes', async () => {
      const { prisma, tx, svc } = makePrisma();
      impactCounts(prisma, { slots: 0 });
      const res = await svc.deleteRack('r1', 'u1');
      expect(res).toEqual({ success: true, id: 'r1', slotsDeleted: 0 });
      expect(tx.slot.updateMany).not.toHaveBeenCalled();
    });

    it('an unknown or already deleted rack is a 404', async () => {
      const { prisma, svc } = makePrisma();
      prisma.rack.findFirst.mockResolvedValue(null);
      await expect(svc.deleteRack('r1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('rackImpact - the single rule the delete reads', () => {
    it('slots are reported but are not a blocker', async () => {
      const { prisma, svc } = makePrisma();
      impactCounts(prisma, { slots: 30, layout: 1 });
      const impact = await svc.rackImpact('r1');
      expect(impact).toMatchObject({ entity: 'rack', id: 'r1', slots: 30, stock: 0, history: 0, openRelocations: 0, layoutObjects: 1, canDelete: true });
      expect(impact.blockers).toEqual([]);
    });

    it('lists every blocker it found', async () => {
      const { prisma, svc } = makePrisma();
      impactCounts(prisma, { slots: 30, stock: 2, history: 9, relocations: 1 });
      const impact = await svc.rackImpact('r1');
      expect(impact.canDelete).toBe(false);
      expect(impact.blockers.map((b) => b.kind)).toEqual(['STOCK', 'HISTORY', 'OPEN_RELOCATION']);
    });

    it('counts stock in the rack itself and in its slots, now and ever', async () => {
      const { prisma, svc } = makePrisma();
      impactCounts(prisma);
      await svc.rackImpact('r1');
      const [now, ever] = prisma.stockItem.count.mock.calls.map((c: any[]) => c[0].where);
      expect(now.OR).toEqual([{ rackId: 'r1' }, { slot: { rackId: 'r1' } }]);
      expect(now.status).toBeDefined();   // only what is in a location now
      expect(ever.OR).toEqual([{ rackId: 'r1' }, { slot: { rackId: 'r1' } }]);
      expect(ever.status).toBeUndefined(); // every row that ever referenced the rack
    });

    it('only open relocation requests count', async () => {
      const { prisma, svc } = makePrisma();
      impactCounts(prisma);
      await svc.rackImpact('r1');
      expect(prisma.relocationLine.count.mock.calls[0][0].where.request.status.in).toEqual(['PENDING_APPROVAL', 'APPROVED']);
    });

    it('getImpact("rack") goes through the same rule', async () => {
      const { prisma, svc } = makePrisma();
      impactCounts(prisma, { slots: 5, history: 1 });
      const impact: any = await svc.getImpact('rack', 'r1');
      expect(impact.canDelete).toBe(false);
      expect(impact.blockers).toHaveLength(1);
    });
  });

  describe('restoreRack', () => {
    const DELETED_AT = new Date('2026-11-12T08:00:00.000Z');
    const DELETED_RACK = { ...RACK, isActive: false, isDeleted: true, deletedAt: DELETED_AT, deletedBy: 'u1' };
    const deleteLog = (ids: string[]) => ({ detail: JSON.stringify({ before: {}, after: { cascadedSlotIds: ids, cascadedSlotCodes: [] } }) });

    it('clears isDeleted, deletedAt and deletedBy on the rack', async () => {
      const { prisma, tx, svc } = makePrisma();
      prisma.rack.findFirst.mockResolvedValue(DELETED_RACK);
      const after = await svc.restoreRack('r1', 'u2');
      expect(tx.rack.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { isDeleted: false, deletedAt: null, deletedBy: null } });
      expect(after).toMatchObject({ isDeleted: false, deletedAt: null, deletedBy: null });
      expect(tx.auditLog.create.mock.calls[0][0].data.action).toBe('RACK_RESTORED');
    });

    it('leaves the rack inactive - restoring is not putting it back in use', async () => {
      const { prisma, tx, svc } = makePrisma();
      prisma.rack.findFirst.mockResolvedValue(DELETED_RACK);
      await svc.restoreRack('r1', 'u2');
      expect(tx.rack.update.mock.calls[0][0].data).not.toHaveProperty('isActive');
    });

    it('is refused when the warehouse the rack belongs to is deleted', async () => {
      const { prisma, svc } = makePrisma();
      prisma.rack.findFirst.mockResolvedValue(DELETED_RACK);
      prisma.warehouse.findUnique.mockResolvedValue({ id: 'w1', isDeleted: true });
      await expect(svc.restoreRack('r1', 'u2')).rejects.toBeInstanceOf(ConflictException);
      await expect(svc.restoreRack('r1', 'u2')).rejects.toThrow(/Restore the warehouse first/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('brings back only the slots the rack delete took with it, matched by id AND by the rack deletedAt', async () => {
      const { prisma, tx, svc } = makePrisma();
      prisma.rack.findFirst.mockResolvedValue(DELETED_RACK);
      prisma.auditLog.findFirst.mockResolvedValue(deleteLog(['s1', 's2']));
      tx.slot.updateMany.mockResolvedValue({ count: 2 });
      await svc.restoreRack('r1', 'u2');
      expect(tx.slot.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['s1', 's2'] }, rackId: 'r1', isDeleted: true, deletedAt: DELETED_AT },
        data: { isDeleted: false, deletedAt: null, deletedBy: null, isActive: true },
      });
    });

    it('does NOT resurrect a slot that was deleted on its own before the rack went', async () => {
      const { prisma, tx, svc } = makePrisma();
      prisma.rack.findFirst.mockResolvedValue(DELETED_RACK);
      // s9 was deleted earlier on its own, so the rack delete never listed it.
      prisma.auditLog.findFirst.mockResolvedValue(deleteLog(['s1']));
      tx.slot.updateMany.mockResolvedValue({ count: 1 });
      await svc.restoreRack('r1', 'u2');
      expect(tx.slot.updateMany.mock.calls[0][0].where.id.in).toEqual(['s1']);
      expect(tx.slot.updateMany.mock.calls[0][0].where.id.in).not.toContain('s9');
    });

    it('restores the rack alone when there is no delete entry to read (racks deleted before this feature)', async () => {
      const { prisma, tx, svc } = makePrisma();
      prisma.rack.findFirst.mockResolvedValue(DELETED_RACK);
      prisma.auditLog.findFirst.mockResolvedValue(null);
      await svc.restoreRack('r1', 'u2');
      expect(tx.slot.updateMany).not.toHaveBeenCalled();
      expect(tx.rack.update).toHaveBeenCalled();
    });

    it('restores the rack alone when the delete entry cannot be read', async () => {
      const { prisma, tx, svc } = makePrisma();
      prisma.rack.findFirst.mockResolvedValue(DELETED_RACK);
      prisma.auditLog.findFirst.mockResolvedValue({ detail: 'not json' });
      await svc.restoreRack('r1', 'u2');
      expect(tx.slot.updateMany).not.toHaveBeenCalled();
    });

    it('reads the most recent delete entry, not the first', async () => {
      const { prisma, svc } = makePrisma();
      prisma.rack.findFirst.mockResolvedValue(DELETED_RACK);
      prisma.auditLog.findFirst.mockResolvedValue(deleteLog(['s1']));
      await svc.restoreRack('r1', 'u2');
      expect(prisma.auditLog.findFirst).toHaveBeenCalledWith({
        where: { entityType: 'Rack', entityId: 'r1', action: 'RACK_DELETED' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('a rack that is not deleted is a 404', async () => {
      const { prisma, svc } = makePrisma();
      prisma.rack.findFirst.mockResolvedValue(null); // the lookup filters isDeleted: true
      await expect(svc.restoreRack('r1', 'u2')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('restoreWarehouse', () => {
    it('clears the delete fields and brings the warehouse back inactive', async () => {
      const { prisma, svc } = makePrisma();
      prisma.warehouse.findFirst.mockResolvedValue({ id: 'w1', isDeleted: true, deletedAt: new Date(), deletedBy: 'u1', isActive: false });
      const after = await svc.restoreWarehouse('w1', 'u2');
      expect(prisma.warehouse.update).toHaveBeenCalledWith({ where: { id: 'w1' }, data: { isDeleted: false, deletedAt: null, deletedBy: null, isActive: false } });
      expect(after).toMatchObject({ isDeleted: false, deletedAt: null, deletedBy: null, isActive: false });
      expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('WAREHOUSE_RESTORED');
    });

    it('a warehouse that is not deleted is a 404', async () => {
      const { prisma, svc } = makePrisma();
      prisma.warehouse.findFirst.mockResolvedValue(null);
      await expect(svc.restoreWarehouse('w1', 'u2')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.warehouse.update).not.toHaveBeenCalled();
    });
  });

  describe('no schema change', () => {
    it('restore and delete only ever write fields the Rack already has', async () => {
      const { prisma, tx, svc } = makePrisma();
      impactCounts(prisma, { slots: 0 });
      await svc.deleteRack('r1', 'u1');
      prisma.rack.findFirst.mockResolvedValue({ ...RACK, isDeleted: true, deletedAt: new Date() });
      await svc.restoreRack('r1', 'u1');
      const written = new Set([...Object.keys(tx.rack.update.mock.calls[0][0].data), ...Object.keys(tx.rack.update.mock.calls[1][0].data)]);
      expect([...written].sort()).toEqual(['deletedAt', 'deletedBy', 'isActive', 'isDeleted']);
    });
  });
});

describe('Rack size follows the Rack Type (RQ7)', () => {
  const STD = { id: 't1', code: 'STD-250', category: 'STANDARD_RACK', lengthCm: 250, widthCm: 100, heightCm: 250, levels: 5, columns: 5, slotCapacity: 3 };

  function rackPrisma() {
    const prisma: any = {
      rack: {
        findFirst: jest.fn(), findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(async (a: any) => ({ id: 'r1', ...a.data })), update: jest.fn(async (a: any) => ({ id: 'r1', ...a.data })),
      },
      warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'w1' }) },
      rackTypeMaster: { findUnique: jest.fn().mockResolvedValue(STD) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    return { prisma, svc: new WarehouseMasterService(prisma) };
  }

  const expectRule = async (p: Promise<unknown>) => {
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await p.catch((e: BadRequestException) => {
      expect(e.getResponse()).toMatchObject({ code: 'RACK_SIZE_FROM_TYPE' });
      expect((e.getResponse() as any).message).toMatch(/Change the Rack Type instead/);
    });
  };

  describe('create', () => {
    it.each([['lengthCm', 250], ['widthCm', 100], ['heightCm', 250], ['levels', 4], ['columns', 6]])(
      'rejects %s on a rack that is given a Rack Type', async (field, value) => {
        const { prisma, svc } = rackPrisma();
        await expectRule(svc.createRack({ warehouseId: 'w1', code: 'A01', rackTypeId: 't1', [field]: value } as any, 'u1'));
        expect(prisma.rack.create).not.toHaveBeenCalled();
      });

    it('names every field the caller tried to set', async () => {
      const { svc } = rackPrisma();
      await svc.createRack({ warehouseId: 'w1', code: 'A01', rackTypeId: 't1', lengthCm: 1, levels: 2 } as any, 'u1').catch((e: BadRequestException) => {
        expect((e.getResponse() as any).message).toContain('length, levels');
      });
    });

    it('takes the grid from the Rack Type and leaves the rack size empty (G5)', async () => {
      const { prisma, svc } = rackPrisma();
      const rack = await svc.createRack({ warehouseId: 'w1', code: 'A01', rackTypeId: 't1' }, 'u1');
      expect(rack).toMatchObject({ rackTypeId: 't1', levels: 5, columns: 5 });
      const data = prisma.rack.create.mock.calls[0][0].data;
      expect(data.lengthCm).toBeUndefined();
      expect(data.widthCm).toBeUndefined();
      expect(data.heightCm).toBeUndefined();
    });

    it('a legacy rack with no Rack Type keeps its own size, exactly as today', async () => {
      const { prisma, svc } = rackPrisma();
      const rack = await svc.createRack({ warehouseId: 'w1', code: 'L01', lengthCm: 300, widthCm: 120, heightCm: 200, levels: 3, columns: 2 }, 'u1');
      expect(rack).toMatchObject({ lengthCm: 300, widthCm: 120, heightCm: 200, levels: 3, columns: 2 });
      expect(prisma.rack.create).toHaveBeenCalled();
    });

    it('clearing a size with null is allowed even with a Rack Type', async () => {
      const { prisma, svc } = rackPrisma();
      await svc.createRack({ warehouseId: 'w1', code: 'A01', rackTypeId: 't1', lengthCm: null }, 'u1');
      expect(prisma.rack.create).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('rejects a size change on a rack that already has a Rack Type', async () => {
      const { prisma, svc } = rackPrisma();
      prisma.rack.findFirst.mockResolvedValue({ id: 'r1', rackTypeId: 't1', rackType: 'STANDARD' });
      await expectRule(svc.updateRack('r1', { lengthCm: 999 }, 'u1'));
      expect(prisma.rack.update).not.toHaveBeenCalled();
    });

    it('rejects a grid change on a rack that already has a Rack Type', async () => {
      const { prisma, svc } = rackPrisma();
      prisma.rack.findFirst.mockResolvedValue({ id: 'r1', rackTypeId: 't1', rackType: 'STANDARD' });
      await expectRule(svc.updateRack('r1', { levels: 9, columns: 9 }, 'u1'));
      expect(prisma.rack.update).not.toHaveBeenCalled();
    });

    it('rejects a size sent in the same call that attaches a Rack Type', async () => {
      const { prisma, svc } = rackPrisma();
      prisma.rack.findFirst.mockResolvedValue({ id: 'r1', rackTypeId: null, rackType: 'STANDARD' });
      await expectRule(svc.updateRack('r1', { rackTypeId: 't1', widthCm: 80 }, 'u1'));
      expect(prisma.rack.update).not.toHaveBeenCalled();
    });

    it('a legacy rack with no Rack Type can still set its own size and grid', async () => {
      const { prisma, svc } = rackPrisma();
      prisma.rack.findFirst.mockResolvedValue({ id: 'r1', rackTypeId: null, rackType: 'CANTILEVER' });
      await svc.updateRack('r1', { lengthCm: 300, widthCm: 120, heightCm: 200, levels: 3, columns: 4 }, 'u1');
      expect(prisma.rack.update.mock.calls[0][0].data).toMatchObject({ lengthCm: 300, widthCm: 120, heightCm: 200, levels: 3, columns: 4 });
    });

    it('a rack that drops its Rack Type in the same call may set its own size again', async () => {
      const { prisma, svc } = rackPrisma();
      prisma.rack.findFirst.mockResolvedValue({ id: 'r1', rackTypeId: 't1', rackType: 'STANDARD' });
      await svc.updateRack('r1', { rackTypeId: null, lengthCm: 300 }, 'u1');
      expect(prisma.rack.update.mock.calls[0][0].data).toMatchObject({ rackTypeId: null, lengthCm: 300 });
    });

    it('fields the Rack Type does not own are untouched by the rule', async () => {
      const { prisma, svc } = rackPrisma();
      prisma.rack.findFirst.mockResolvedValue({ id: 'r1', rackTypeId: 't1', rackType: 'STANDARD' });
      await svc.updateRack('r1', { zone: 'Z', name: 'Aisle A', capacity: 120 }, 'u1');
      expect(prisma.rack.update.mock.calls[0][0].data).toMatchObject({ zone: 'Z', name: 'Aisle A', capacity: 120 });
    });
  });

  // The older /warehouse/racks route is the one the Warehouse Layout control centre
  // calls. A rule enforced only in Warehouse Master would be walked around from there,
  // so the same helper guards both and these two services must never drift apart.
  describe('the legacy /warehouse/racks route obeys the same rule', () => {
    function legacyPrisma() {
      const prisma: any = {
        rack: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn(async (a: any) => ({ id: 'r1', ...a.data })),
          update: jest.fn(async (a: any) => ({ id: 'r1', code: 'A01', ...a.data })),
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      };
      return { prisma, svc: new WarehouseService(prisma) };
    }
    const typedRack = { id: 'r1', code: 'A01', warehouseId: 'w1', rackTypeId: 't1' };

    it.each([['lengthCm', 250], ['widthCm', 100], ['heightCm', 250], ['levels', 4], ['columns', 6]])(
      'rejects %s on a rack that already follows a Rack Type', async (field, value) => {
        const { prisma, svc } = legacyPrisma();
        prisma.rack.findUnique.mockResolvedValue(typedRack);
        await expectRule(svc.updateRack('r1', { [field]: value } as any, 'u1'));
        expect(prisma.rack.update).not.toHaveBeenCalled();
      });

    it.each([['lengthCm', 250], ['widthCm', 100], ['heightCm', 250], ['levels', 4], ['columns', 6]])(
      'rejects %s on create when a Rack Type is given', async (field, value) => {
        const { prisma, svc } = legacyPrisma();
        await expectRule(svc.createRack({ warehouseId: 'w1', code: 'A01', rackTypeId: 't1', [field]: value } as any, 'u1'));
        expect(prisma.rack.create).not.toHaveBeenCalled();
      });

    it('a legacy rack with no Rack Type still sets its own size and grid through the old route', async () => {
      const { prisma, svc } = legacyPrisma();
      prisma.rack.findUnique.mockResolvedValue({ ...typedRack, rackTypeId: null });
      await svc.updateRack('r1', { levels: 3, columns: 4, lengthCm: 300 }, 'u1');
      expect(prisma.rack.update.mock.calls[0][0].data).toMatchObject({ levels: 3, columns: 4, lengthCm: 300 });
    });

    it("the Warehouse Layout control centre's own payload still goes through untouched", async () => {
      const { prisma, svc } = legacyPrisma();
      // control-center.tsx: warehouseApi.createRack({ ...form, code, warehouseId, levels, columns })
      const payload = { code: 'R-01', name: '', zone: '', rackType: 'STANDARD' as const, levels: 5, columns: 10, warehouseId: 'w1' };
      const rack = await svc.createRack(payload, 'u1');
      expect(rack).toMatchObject({ code: 'R-01', levels: 5, columns: 10, warehouseId: 'w1' });
      expect(prisma.rack.create).toHaveBeenCalledWith({ data: payload });
    });

    it('both services refuse with the SAME error code and the same message, so they cannot drift', async () => {
      const legacy = legacyPrisma();
      legacy.prisma.rack.findUnique.mockResolvedValue(typedRack);
      const master = rackPrisma();
      master.prisma.rack.findFirst.mockResolvedValue({ id: 'r1', rackTypeId: 't1', rackType: 'STANDARD' });

      const body = async (p: Promise<unknown>) => p.then(() => null, (e: BadRequestException) => e.getResponse() as any);
      const fromLegacy = await body(legacy.svc.updateRack('r1', { levels: 4 }, 'u1'));
      const fromMaster = await body(master.svc.updateRack('r1', { levels: 4 }, 'u1'));

      expect(fromLegacy).not.toBeNull();
      expect(fromLegacy.code).toBe('RACK_SIZE_FROM_TYPE');
      expect(fromLegacy).toEqual(fromMaster);
    });
  });
});
