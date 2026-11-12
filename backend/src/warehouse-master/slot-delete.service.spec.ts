import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { WarehouseMasterService } from './warehouse-master.service';
import { NOT_IN_LOCATION } from '../common/stock-presence';

// G3 (10 Nov 2026): a slot can be deleted when no stock is in it NOW, even if
// stock passed through it before. Soft delete only (the row and all stock
// history stay), one audit entry, all-or-nothing writes, warehouse scope.

const slotRow = (id: string, code: string, stock: number, warehouseId = 'w1') =>
  ({ id, code, rackId: 'r1', rack: { warehouseId }, _count: { stockItems: stock } });

function makePrisma() {
  const tx: any = {
    slot: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    slot: { findFirst: jest.fn(), findMany: tx.slot.findMany, updateMany: tx.slot.updateMany },
    stockItem: { count: jest.fn().mockResolvedValue(0) },
    auditLog: tx.auditLog,
    $transaction: jest.fn((fn) => fn(tx)),
  };
  return { prisma, tx, svc: new WarehouseMasterService(prisma) };
}

describe('Slot delete (G3)', () => {
  describe('bulkDeleteSlots', () => {
    it('deletes empty slots (history only is fine), skips slots with stock now, one audit entry', async () => {
      const { tx, svc } = makePrisma();
      tx.slot.findMany.mockResolvedValue([slotRow('a', 'A-01', 0), slotRow('b', 'A-02', 2), slotRow('c', 'A-03', 0)]);
      tx.slot.updateMany.mockResolvedValue({ count: 2 });
      const r = await svc.bulkDeleteSlots(['a', 'b', 'c', 'a', 'x'], 'u1');

      expect(r.deleted).toEqual([{ id: 'a', code: 'A-01' }, { id: 'c', code: 'A-03' }]);
      expect(r.blocked).toEqual([{ id: 'b', code: 'A-02', stock: 2 }]);
      expect(r.notFound).toEqual(['x']);
      // stock "now" = the occupancy rule (shipped / consumed / closed / cancelled rows do not count)
      expect(tx.slot.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['a', 'b', 'c', 'x'] }, isDeleted: false });
      expect(tx.slot.findMany.mock.calls[0][0].select._count.select.stockItems)
        .toEqual({ where: { status: { notIn: NOT_IN_LOCATION } } });
      // soft delete, guarded by "still nothing in it"
      const upd = tx.slot.updateMany.mock.calls[0][0];
      expect(upd.where).toEqual({ id: { in: ['a', 'c'] }, isDeleted: false, stockItems: { none: { status: { notIn: NOT_IN_LOCATION } } } });
      expect(upd.data).toMatchObject({ isActive: false, isDeleted: true, deletedBy: 'u1' });
      expect(upd.data.deletedAt).toBeInstanceOf(Date);
      expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
      const audit = tx.auditLog.create.mock.calls[0][0].data; audit.changes = JSON.parse(audit.detail);
      expect(audit.action).toBe('SLOTS_BULK_DELETED');
      expect(audit.changes.after).toMatchObject({ codes: ['A-01', 'A-03'], blocked: [{ code: 'A-02' }], notFound: ['x'] });
    });

    it('never touches stock rows (quantities before = after)', async () => {
      const { prisma, tx, svc } = makePrisma();
      tx.slot.findMany.mockResolvedValue([slotRow('a', 'A-01', 0)]);
      tx.slot.updateMany.mockResolvedValue({ count: 1 });
      tx.stockItem = { update: jest.fn(), updateMany: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() };
      await svc.bulkDeleteSlots(['a'], 'u1');
      for (const fn of Object.values(tx.stockItem)) expect(fn).not.toHaveBeenCalled();
      expect(prisma.stockItem.count).not.toHaveBeenCalled();
    });

    it('preview reports the same split and writes nothing', async () => {
      const { prisma, tx, svc } = makePrisma();
      tx.slot.findMany.mockResolvedValue([slotRow('a', 'A-01', 0), slotRow('b', 'A-02', 1)]);
      const r = await svc.bulkDeleteSlots(['a', 'b'], 'u1', true);
      expect(r).toMatchObject({ preview: true, deleted: [{ id: 'a' }], blocked: [{ id: 'b', stock: 1 }] });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.slot.updateMany).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('all blocked → nothing written, no audit', async () => {
      const { tx, svc } = makePrisma();
      tx.slot.findMany.mockResolvedValue([slotRow('b', 'A-02', 3)]);
      const r = await svc.bulkDeleteSlots(['b'], 'u1');
      expect(r.deleted).toEqual([]);
      expect(tx.slot.updateMany).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('stock put away meanwhile → throws inside the transaction (rollback), no audit', async () => {
      const { tx, svc } = makePrisma();
      tx.slot.findMany.mockResolvedValue([slotRow('a', 'A-01', 0), slotRow('c', 'A-03', 0)]);
      tx.slot.updateMany.mockResolvedValue({ count: 1 }); // one slot got stock between read and write
      await expect(svc.bulkDeleteSlots(['a', 'c'], 'u1')).rejects.toBeInstanceOf(ConflictException);
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('a slot in a warehouse outside the caller scope refuses the whole request', async () => {
      const { tx, svc } = makePrisma();
      tx.slot.findMany.mockResolvedValue([slotRow('a', 'A-01', 0, 'w1'), slotRow('z', 'Z-01', 0, 'w2')]);
      await expect(svc.bulkDeleteSlots(['a', 'z'], 'u1', false, { roleKey: null, warehouseIds: ['w1'] }))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.slot.updateMany).not.toHaveBeenCalled();
    });

    it('unrestricted user (no assigned warehouse) may delete in any warehouse', async () => {
      const { tx, svc } = makePrisma();
      tx.slot.findMany.mockResolvedValue([slotRow('z', 'Z-01', 0, 'w2')]);
      tx.slot.updateMany.mockResolvedValue({ count: 1 });
      const r = await svc.bulkDeleteSlots(['z'], 'u1', false, { roleKey: null, warehouseIds: [] });
      expect(r.deleted).toHaveLength(1);
    });
  });

  describe('deleteSlot (single, same rule)', () => {
    const live = { id: 's1', code: 'A-01', isDeleted: false, rack: { warehouseId: 'w1' } };

    it('deletes a slot that only has stock history', async () => {
      const { prisma, tx, svc } = makePrisma();
      prisma.slot.findFirst.mockResolvedValue(live);
      prisma.stockItem.count.mockResolvedValue(0);
      tx.slot.updateMany.mockResolvedValue({ count: 1 });
      await expect(svc.deleteSlot('s1', 'u1')).resolves.toEqual({ success: true, id: 's1' });
      expect(prisma.stockItem.count).toHaveBeenCalledWith({ where: { slotId: 's1', status: { notIn: NOT_IN_LOCATION } } });
      expect(tx.slot.updateMany.mock.calls[0][0].where).toMatchObject({ id: 's1', isDeleted: false });
      const audit = tx.auditLog.create.mock.calls[0][0].data; audit.changes = JSON.parse(audit.detail);
      expect(audit.action).toBe('SLOT_DELETED');
      expect(audit.changes.before).not.toHaveProperty('rack');
    });

    it('refuses a slot with stock in it now', async () => {
      const { prisma, tx, svc } = makePrisma();
      prisma.slot.findFirst.mockResolvedValue(live);
      prisma.stockItem.count.mockResolvedValue(1);
      await expect(svc.deleteSlot('s1', 'u1')).rejects.toBeInstanceOf(ConflictException);
      expect(tx.slot.updateMany).not.toHaveBeenCalled();
    });

    it('stock arrived after the check → conflict, no audit', async () => {
      const { prisma, tx, svc } = makePrisma();
      prisma.slot.findFirst.mockResolvedValue(live);
      tx.slot.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.deleteSlot('s1', 'u1')).rejects.toBeInstanceOf(ConflictException);
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('unknown / already deleted slot → 404; out of scope → 403', async () => {
      const { prisma, svc } = makePrisma();
      prisma.slot.findFirst.mockResolvedValue(null);
      await expect(svc.deleteSlot('s1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
      prisma.slot.findFirst.mockResolvedValue({ ...live, rack: { warehouseId: 'w2' } });
      await expect(svc.deleteSlot('s1', 'u1', { roleKey: null, warehouseIds: ['w1'] })).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
