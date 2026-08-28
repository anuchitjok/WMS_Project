import { Test } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { WarehouseLayoutService } from './warehouse-layout.service';
import { PrismaService } from '../prisma/prisma.service';
import { LayoutObjectType } from '@prisma/client';

// Unit-level cover for the rules a compiler cannot check: tree integrity,
// cascade refusal, metadata validation and canvas version bumping.
// Prisma is mocked — these tests need no database.

const LAYOUT = { id: 'lay_1', warehouseId: 'wh_1', isDeleted: false, version: 3 };
const WAREHOUSE = { id: 'wh_1', code: 'WH-01', name: 'Main', isActive: true, isDeleted: false };

function makePrisma() {
  return {
    warehouse: { findFirst: jest.fn() },
    warehouseLayout: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    layoutObject: {
      findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(),
      count: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

describe('WarehouseLayoutService', () => {
  let service: WarehouseLayoutService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    const mod = await Test.createTestingModule({
      providers: [WarehouseLayoutService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(WarehouseLayoutService);
  });

  const baseObject = {
    objectType: LayoutObjectType.BIN,
    name: 'Bin A-01-01',
    x: 0, y: 0, width: 1, height: 1,
  };

  describe('getByWarehouse', () => {
    it('returns layout:null for a warehouse with no layout yet (not an error)', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(WAREHOUSE);
      prisma.warehouseLayout.findFirst.mockResolvedValue(null);

      const res = await service.getByWarehouse('wh_1');

      expect(res.layout).toBeNull();
      expect(res.objects).toEqual([]);
      expect(prisma.layoutObject.findMany).not.toHaveBeenCalled();
    });

    it('404s on an unknown or soft-deleted warehouse', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(null);
      await expect(service.getByWarehouse('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('excludes soft-deleted objects', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(WAREHOUSE);
      prisma.warehouseLayout.findFirst.mockResolvedValue(LAYOUT);
      prisma.layoutObject.findMany.mockResolvedValue([]);

      await service.getByWarehouse('wh_1');

      expect(prisma.layoutObject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { layoutId: 'lay_1', isDeleted: false } }),
      );
    });
  });

  describe('createLayout', () => {
    it('rejects a second layout for the same warehouse', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(WAREHOUSE);
      prisma.warehouseLayout.findUnique.mockResolvedValue(LAYOUT);
      await expect(service.createLayout('wh_1', {}, 'u1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('revives a soft-deleted layout instead of colliding on the unique key', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(WAREHOUSE);
      prisma.warehouseLayout.findUnique.mockResolvedValue({ ...LAYOUT, isDeleted: true });
      prisma.warehouseLayout.update.mockResolvedValue({ ...LAYOUT, isDeleted: false });

      await service.createLayout('wh_1', {}, 'u1');

      expect(prisma.warehouseLayout.create).not.toHaveBeenCalled();
      expect(prisma.warehouseLayout.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isDeleted: false, deletedAt: null }) }),
      );
    });
  });

  describe('createObject', () => {
    it('rejects metadata that is not valid JSON', async () => {
      prisma.warehouseLayout.findFirst.mockResolvedValue(LAYOUT);
      await expect(
        service.createObject('lay_1', { ...baseObject, metadata: '{not json' }, 'u1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.layoutObject.create).not.toHaveBeenCalled();
    });

    it('rejects a parent belonging to a different layout', async () => {
      prisma.warehouseLayout.findFirst.mockResolvedValue(LAYOUT);
      prisma.layoutObject.findFirst.mockResolvedValue({ id: 'other', layoutId: 'lay_2' });
      await expect(
        service.createObject('lay_1', { ...baseObject, parentObjectId: 'other' }, 'u1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('bumps the canvas version and writes an audit row', async () => {
      prisma.warehouseLayout.findFirst.mockResolvedValue(LAYOUT);
      prisma.layoutObject.create.mockResolvedValue({ id: 'obj_1', ...baseObject });
      prisma.warehouseLayout.update.mockResolvedValue(LAYOUT);

      await service.createObject('lay_1', baseObject, 'u1');

      expect(prisma.warehouseLayout.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { version: { increment: 1 } } }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'LAYOUT_OBJECT_CREATED', entityType: 'LayoutObject' }),
        }),
      );
    });
  });

  describe('updateObject — tree integrity', () => {
    it('rejects an object being made its own parent', async () => {
      prisma.layoutObject.findFirst.mockResolvedValueOnce({ id: 'A', layoutId: 'lay_1', isDeleted: false });
      prisma.layoutObject.findFirst.mockResolvedValueOnce({ id: 'A', layoutId: 'lay_1' });
      await expect(
        service.updateObject('A', { parentObjectId: 'A' }, 'u1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects reparenting onto a descendant (A → C where C is under B under A)', async () => {
      // getObjectOrThrow(A), then validateParent finds C
      prisma.layoutObject.findFirst
        .mockResolvedValueOnce({ id: 'A', layoutId: 'lay_1', isDeleted: false })
        .mockResolvedValueOnce({ id: 'C', layoutId: 'lay_1' });
      // parent chain walk: C → B → A
      prisma.layoutObject.findUnique
        .mockResolvedValueOnce({ parentObjectId: 'B' })
        .mockResolvedValueOnce({ parentObjectId: 'A' });

      await expect(
        service.updateObject('A', { parentObjectId: 'C' }, 'u1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.layoutObject.update).not.toHaveBeenCalled();
    });

    it('allows reparenting onto an unrelated branch', async () => {
      prisma.layoutObject.findFirst
        .mockResolvedValueOnce({ id: 'A', layoutId: 'lay_1', isDeleted: false })
        .mockResolvedValueOnce({ id: 'Z', layoutId: 'lay_1' });
      prisma.layoutObject.findUnique.mockResolvedValueOnce({ parentObjectId: null });
      prisma.layoutObject.update.mockResolvedValue({ id: 'A', parentObjectId: 'Z' });
      prisma.warehouseLayout.update.mockResolvedValue(LAYOUT);

      const res = await service.updateObject('A', { parentObjectId: 'Z' }, 'u1');
      expect(res.parentObjectId).toBe('Z');
    });
  });

  describe('deleteObject', () => {
    it('refuses to delete a parent with live children when cascade is off', async () => {
      prisma.layoutObject.findFirst.mockResolvedValue({ id: 'A', layoutId: 'lay_1', isDeleted: false });
      prisma.layoutObject.count.mockResolvedValue(2);

      await expect(service.deleteObject('A', false, 'u1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.layoutObject.updateMany).not.toHaveBeenCalled();
    });

    it('soft-deletes the whole subtree when cascade is on', async () => {
      prisma.layoutObject.findFirst.mockResolvedValue({ id: 'A', layoutId: 'lay_1', isDeleted: false });
      prisma.layoutObject.count.mockResolvedValue(1);
      prisma.layoutObject.findMany
        .mockResolvedValueOnce([{ id: 'B' }])   // children of A
        .mockResolvedValueOnce([{ id: 'C' }])   // children of B
        .mockResolvedValueOnce([]);             // children of C
      prisma.layoutObject.updateMany.mockResolvedValue({ count: 3 });
      prisma.warehouseLayout.update.mockResolvedValue(LAYOUT);

      const res = await service.deleteObject('A', true, 'u1');

      expect(res.deletedIds).toEqual(['A', 'B', 'C']);
      expect(prisma.layoutObject.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['A', 'B', 'C'] } },
          data: expect.objectContaining({ isDeleted: true, deletedBy: 'u1' }),
        }),
      );
    });

    it('never hard-deletes — only updateMany is used', async () => {
      prisma.layoutObject.findFirst.mockResolvedValue({ id: 'A', layoutId: 'lay_1', isDeleted: false });
      prisma.layoutObject.count.mockResolvedValue(0);
      prisma.layoutObject.updateMany.mockResolvedValue({ count: 1 });
      prisma.warehouseLayout.update.mockResolvedValue(LAYOUT);

      await service.deleteObject('A', false, 'u1');

      expect(prisma.layoutObject.updateMany).toHaveBeenCalled();
      expect((prisma.layoutObject as any).delete).toBeUndefined();
    });
  });

  it('touches no Slot, Rack or StockItem at all in the CRUD paths', () => {
    // The mock exposes no stockItem/slot/rack surface whatsoever, so any access
    // from the methods above would have thrown. (Sprint 6 adds read-only access
    // for linking and occupancy — see warehouse-layout-linking.service.spec.ts,
    // which asserts those models are readable but never written.)
    expect((prisma as any).stockItem).toBeUndefined();
    expect((prisma as any).slot).toBeUndefined();
    expect((prisma as any).rack).toBeUndefined();
  });
});
