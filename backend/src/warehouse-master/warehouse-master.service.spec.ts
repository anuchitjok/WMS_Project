import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { WarehouseMasterService } from './warehouse-master.service';

const STD = { id: 't1', code: 'STD-250', category: 'STANDARD_RACK', lengthCm: 250, widthCm: 100, heightCm: 250, levels: 5, columns: 5, slotCapacity: 3 };
const PLT = { id: 't2', code: 'PLT-1210', category: 'PALLET_ON_FLOOR', lengthCm: 120, widthCm: 100, heightCm: 180, levels: 1, columns: 1, slotCapacity: 1 };

function makePrisma() {
  const tx = {
    slot: { createMany: jest.fn().mockResolvedValue({ count: 0 }), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    rack: { findFirst: jest.fn(), findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn((a) => ({ id: 'r1', ...a.data })), update: jest.fn((a) => ({ id: 'r1', ...a.data })) },
    slot: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
    warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'w1' }), findMany: jest.fn().mockResolvedValue([]) },
    stockItem: { groupBy: jest.fn().mockResolvedValue([]) },
    rackTypeMaster: { findUnique: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((fn) => fn(tx)),
  };
  return { prisma, tx };
}

describe('WarehouseMasterService', () => {
  describe('generateSlots', () => {
    it('preview lists codes and existing ones without writing anything', async () => {
      const { prisma, tx } = makePrisma();
      prisma.rack.findFirst.mockResolvedValue({ id: 'r1', code: 'A01', rackType: 'STANDARD', levels: 2, columns: 2, lengthCm: null, widthCm: null, heightCm: null, rackTypeMaster: STD });
      prisma.slot.findMany.mockResolvedValue([{ code: 'A01-01-02' }]);
      const svc = new WarehouseMasterService(prisma);
      const r = await svc.generateSlots('r1', { levels: 2, columns: 2, preview: true }, 'u1');
      expect(r).toMatchObject({ total: 4, existing: 1, toCreate: 3, created: 0, preview: true, slotType: 'STANDARD', capacity: 3 });
      expect(r.slots.find((s) => s.code === 'A01-01-02')!.exists).toBe(true);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.slot.createMany).not.toHaveBeenCalled();
    });

    it('commit creates only missing slots in one transaction, with rack-derived size and one audit entry', async () => {
      const { prisma, tx } = makePrisma();
      prisma.rack.findFirst.mockResolvedValue({ id: 'r1', code: 'A01', rackType: 'STANDARD', levels: 5, columns: 5, lengthCm: 250, widthCm: 100, heightCm: 250, rackTypeMaster: STD });
      prisma.slot.findMany.mockResolvedValue([{ code: 'A01-01-01' }]);
      tx.slot.createMany.mockResolvedValue({ count: 24 });
      const svc = new WarehouseMasterService(prisma);
      const r = await svc.generateSlots('r1', { levels: 5, columns: 5 }, 'u1');
      expect(r.created).toBe(24);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const data = tx.slot.createMany.mock.calls[0][0].data;
      expect(data).toHaveLength(24);
      expect(data.map((d: any) => d.code)).not.toContain('A01-01-01');
      expect(data[0]).toMatchObject({ rackId: 'r1', code: 'A01-01-02', level: 1, column: 2, slotType: 'STANDARD', capacity: 3, lengthCm: 50, widthCm: 100, heightCm: 50 });
      expect(tx.slot.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
      expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
      expect(tx.auditLog.create.mock.calls[0][0].data.action).toBe('SLOTS_GENERATED');
    });

    it('legacy pallet rack without template → PALLET slots, capacity 1, no size', async () => {
      const { prisma, tx } = makePrisma();
      prisma.rack.findFirst.mockResolvedValue({ id: 'r1', code: 'P01', rackType: 'PALLET', levels: 1, columns: 2, lengthCm: null, widthCm: null, heightCm: null, rackTypeMaster: null });
      tx.slot.createMany.mockResolvedValue({ count: 2 });
      await new WarehouseMasterService(prisma).generateSlots('r1', { levels: 1, columns: 2 }, 'u1');
      expect(tx.slot.createMany.mock.calls[0][0].data[1]).toMatchObject({ code: 'P01-01-02', slotType: 'PALLET', capacity: 1, lengthCm: null });
    });

    it('nothing missing → no transaction', async () => {
      const { prisma } = makePrisma();
      prisma.rack.findFirst.mockResolvedValue({ id: 'r1', code: 'A', rackType: 'STANDARD', levels: 1, columns: 1, rackTypeMaster: null });
      prisma.slot.findMany.mockResolvedValue([{ code: 'A-01-01' }]);
      const r = await new WarehouseMasterService(prisma).generateSlots('r1', { levels: 1, columns: 1 }, 'u1');
      expect(r.toCreate).toBe(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('bulkUpdateSlots', () => {
    it('updates non-deleted slots in one transaction with one audit entry', async () => {
      const { prisma, tx } = makePrisma();
      tx.slot.updateMany.mockResolvedValue({ count: 2 });
      const r = await new WarehouseMasterService(prisma).bulkUpdateSlots(['a', 'b', 'a'], { capacity: 4 }, 'u1');
      expect(r).toEqual({ updated: 2 });
      expect(tx.slot.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b'] }, isDeleted: false }, data: { capacity: 4 } });
      expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    });
    it('refuses an empty change set', async () => {
      const { prisma } = makePrisma();
      await expect(new WarehouseMasterService(prisma).bulkUpdateSlots(['a'], {}, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('rack legacy enum', () => {
    it('template category decides the stored rackType (PALLET_ON_FLOOR → PALLET)', async () => {
      const { prisma } = makePrisma();
      prisma.rackTypeMaster.findUnique.mockResolvedValue(PLT);
      const rack = await new WarehouseMasterService(prisma).createRack({ warehouseId: 'w1', code: ' P01 ', rackTypeId: 't2', levels: 1, columns: 4 }, 'u1');
      expect(rack).toMatchObject({ code: 'P01', rackType: 'PALLET', rackTypeId: 't2', columns: 4 });
    });
    it('a legacy rackType like DRIVE_IN is stored as STANDARD', async () => {
      const { prisma } = makePrisma();
      const rack = await new WarehouseMasterService(prisma).createRack({ warehouseId: 'w1', code: 'A', rackType: 'DRIVE_IN' as any }, 'u1');
      expect(rack.rackType).toBe('STANDARD');
    });
    it('updating other fields leaves rackType untouched', async () => {
      const { prisma } = makePrisma();
      prisma.rack.findFirst.mockResolvedValue({ id: 'r1', rackType: 'CANTILEVER', rackTypeId: null });
      await new WarehouseMasterService(prisma).updateRack('r1', { zone: 'Z' }, 'u1');
      expect(prisma.rack.update.mock.calls[0][0].data).toEqual({ zone: 'Z' });
    });
  });

  describe('space summary scope', () => {
    it('refuses a warehouse outside the caller scope', async () => {
      const { prisma } = makePrisma();
      await expect(new WarehouseMasterService(prisma).getSpaceSummary({ roleKey: null, warehouseIds: ['w1'] }, 'w9')).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('limits the warehouse query to the caller scope', async () => {
      const { prisma } = makePrisma();
      await new WarehouseMasterService(prisma).getSpaceSummary({ roleKey: null, warehouseIds: ['w1', 'w2'] });
      expect(prisma.warehouse.findMany.mock.calls[0][0].where).toEqual({ isDeleted: false, id: { in: ['w1', 'w2'] } });
    });
  });
});
