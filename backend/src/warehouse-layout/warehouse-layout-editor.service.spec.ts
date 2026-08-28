import { Test } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { WarehouseLayoutService } from './warehouse-layout.service';
import { PrismaService } from '../prisma/prisma.service';
import { LayoutObjectType } from '@prisma/client';

// Sprint 5 editor writes: batch save (optimistic lock, cascade, resulting-tree
// validation) and duplicate (link and code must never be inherited).
// Prisma is mocked; no database required.

const LAYOUT = { id: 'lay_1', warehouseId: 'wh_1', isDeleted: false, version: 3 };

const baseObject = {
  objectType: LayoutObjectType.BIN,
  name: 'Bin A-01-01',
  x: 0, y: 0, width: 1, height: 1,
};

function makePrisma() {
  const p: any = {
    warehouse: { findFirst: jest.fn() },
    warehouseLayout: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    layoutObject: {
      findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(),
      count: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  // batchSave/duplicate use the INTERACTIVE form, so the callback gets a tx client.
  p.$transaction = jest.fn((arg: any) => (typeof arg === 'function' ? arg(p) : Promise.all(arg)));
  return p;
}

describe('WarehouseLayoutService — editor writes', () => {
  let service: WarehouseLayoutService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    const mod = await Test.createTestingModule({
      providers: [WarehouseLayoutService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(WarehouseLayoutService);
  });

  describe('batchSave', () => {
    it('refuses a stale version instead of clobbering a concurrent save', async () => {
      prisma.warehouseLayout.findFirst.mockResolvedValue({ ...LAYOUT, version: 9 });

      await expect(
        service.batchSave('lay_1', { version: 3, upserts: [], deletes: [] }, 'u1'),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.layoutObject.update).not.toHaveBeenCalled();
      expect(prisma.warehouseLayout.update).not.toHaveBeenCalled();
    });

    it('rejects an upsert referencing an object from another layout', async () => {
      prisma.warehouseLayout.findFirst.mockResolvedValue(LAYOUT);
      prisma.layoutObject.findMany.mockResolvedValue([]); // ownership lookup finds nothing

      await expect(
        service.batchSave('lay_1', { version: 3, upserts: [{ id: 'foreign', ...baseObject }], deletes: [] }, 'u1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rolls the whole flush back when the resulting tree contains a cycle', async () => {
      prisma.warehouseLayout.findFirst.mockResolvedValue(LAYOUT);
      prisma.layoutObject.findMany
        .mockResolvedValueOnce([{ id: 'A' }, { id: 'B' }])   // ownership check
        .mockResolvedValueOnce([                              // post-apply tree: A→B→A
          { id: 'A', parentObjectId: 'B' },
          { id: 'B', parentObjectId: 'A' },
        ]);
      prisma.layoutObject.update.mockResolvedValue({});

      await expect(
        service.batchSave('lay_1', {
          version: 3,
          upserts: [{ id: 'A', ...baseObject }, { id: 'B', ...baseObject }],
          deletes: [],
        }, 'u1'),
      ).rejects.toBeInstanceOf(ConflictException);

      // The version is bumped only after validation passes, so a rejected batch
      // leaves it untouched.
      expect(prisma.warehouseLayout.update).not.toHaveBeenCalled();
    });

    it('rejects a surviving object whose parent is not in the layout', async () => {
      prisma.warehouseLayout.findFirst.mockResolvedValue(LAYOUT);
      prisma.layoutObject.findMany
        .mockResolvedValueOnce([{ id: 'A' }])
        .mockResolvedValueOnce([{ id: 'A', parentObjectId: 'ghost' }]);
      prisma.layoutObject.update.mockResolvedValue({});

      await expect(
        service.batchSave('lay_1', { version: 3, upserts: [{ id: 'A', ...baseObject }], deletes: [] }, 'u1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('applies creates, updates and cascading deletes, then bumps the version once', async () => {
      prisma.warehouseLayout.findFirst.mockResolvedValue(LAYOUT);
      prisma.layoutObject.findMany
        .mockResolvedValueOnce([{ id: 'A' }, { id: 'D' }])   // ownership check
        .mockResolvedValueOnce([{ id: 'D1' }])               // collectSubtree: children of D
        .mockResolvedValueOnce([])                           // children of D1
        .mockResolvedValueOnce([])                           // post-apply tree (empty = valid)
        .mockResolvedValueOnce([{ id: 'A' }]);               // final object list
      prisma.layoutObject.update.mockResolvedValue({});
      prisma.layoutObject.create.mockResolvedValue({ id: 'new_1' });
      prisma.layoutObject.updateMany.mockResolvedValue({ count: 2 });
      prisma.warehouseLayout.update.mockResolvedValue({ ...LAYOUT, version: 4 });

      const res = await service.batchSave('lay_1', {
        version: 3,
        upserts: [{ id: 'A', ...baseObject }, { ...baseObject, name: 'brand new' }],
        deletes: ['D'],
      }, 'u1');

      expect(res.version).toBe(4);
      expect(prisma.layoutObject.create).toHaveBeenCalledTimes(1);
      expect(prisma.layoutObject.update).toHaveBeenCalledTimes(1);
      // D's descendant D1 goes with it
      expect(prisma.layoutObject.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['D', 'D1'] } } }),
      );
      expect(prisma.warehouseLayout.update).toHaveBeenCalledTimes(1);
    });

    it('lets a delete win when the same object is also upserted in one batch', async () => {
      prisma.warehouseLayout.findFirst.mockResolvedValue(LAYOUT);
      prisma.layoutObject.findMany
        .mockResolvedValueOnce([{ id: 'A' }])   // ownership check
        .mockResolvedValueOnce([])              // children of A
        .mockResolvedValueOnce([])              // post-apply tree
        .mockResolvedValueOnce([]);             // final list
      prisma.layoutObject.updateMany.mockResolvedValue({ count: 1 });
      prisma.warehouseLayout.update.mockResolvedValue({ ...LAYOUT, version: 4 });

      await service.batchSave('lay_1', {
        version: 3,
        upserts: [{ id: 'A', ...baseObject }],
        deletes: ['A'],
      }, 'u1');

      expect(prisma.layoutObject.update).not.toHaveBeenCalled();
      expect(prisma.layoutObject.updateMany).toHaveBeenCalled();
    });
  });

  describe('duplicateObject', () => {
    it('drops the WMS link and the location code on the copy', async () => {
      prisma.layoutObject.findFirst.mockResolvedValue({ id: 'A', layoutId: 'lay_1', isDeleted: false });
      prisma.layoutObject.findMany.mockResolvedValue([{
        id: 'A', layoutId: 'lay_1', parentObjectId: null, objectType: 'BIN', name: 'Bin 1',
        code: 'R-A-A01', x: 5, y: 5, width: 2, height: 2, rotation: 0, zIndex: 0, displayOrder: 0,
        slotId: 'slot_1', rackId: null, capacity: 4, color: null, status: 'ACTIVE', metadata: null,
      }]);
      prisma.layoutObject.create.mockImplementation((args: any) => Promise.resolve({ id: 'copy_1', ...args.data }));
      prisma.warehouseLayout.update.mockResolvedValue(LAYOUT);

      const res = await service.duplicateObject('A', {}, 'u1');

      const data = prisma.layoutObject.create.mock.calls[0][0].data;
      expect(data.slotId).toBeNull();
      expect(data.rackId).toBeNull();
      expect(data.code).toBeNull();
      expect(data.name).toBe('Bin 1 copy');
      expect(data.x).toBe(7); // default offset of 2
      expect(res).toHaveLength(1);
    });

    it('rewires child parents to the copied parent when duplicating a subtree', async () => {
      prisma.layoutObject.findFirst.mockResolvedValue({ id: 'A', layoutId: 'lay_1', isDeleted: false });
      prisma.layoutObject.findMany
        .mockResolvedValueOnce([{ id: 'B' }])  // collectSubtree: children of A
        .mockResolvedValueOnce([])             // children of B
        .mockResolvedValueOnce([
          { id: 'A', layoutId: 'lay_1', parentObjectId: null, objectType: 'RACK', name: 'Rack A', code: 'R-A', x: 0, y: 0, width: 4, height: 2, rotation: 0, zIndex: 0, displayOrder: 0, slotId: null, rackId: 'rack_a', capacity: null, color: null, status: 'ACTIVE', metadata: null },
          { id: 'B', layoutId: 'lay_1', parentObjectId: 'A', objectType: 'BIN', name: 'Bin', code: null, x: 1, y: 1, width: 1, height: 1, rotation: 0, zIndex: 1, displayOrder: 0, slotId: null, rackId: null, capacity: null, color: null, status: 'ACTIVE', metadata: null },
        ]);
      let seq = 0;
      prisma.layoutObject.create.mockImplementation((args: any) => Promise.resolve({ id: `copy_${++seq}`, ...args.data }));
      prisma.warehouseLayout.update.mockResolvedValue(LAYOUT);

      await service.duplicateObject('A', { includeChildren: true }, 'u1');

      const calls = prisma.layoutObject.create.mock.calls.map((c: any) => c[0].data);
      expect(calls).toHaveLength(2);
      expect(calls[0].parentObjectId).toBeNull();     // root keeps its original parent
      expect(calls[1].parentObjectId).toBe('copy_1'); // child points at the NEW parent
      expect(calls[0].rackId).toBeNull();             // link dropped on the rack copy too
    });

    it('never lets an offset push a copy off the canvas origin', async () => {
      prisma.layoutObject.findFirst.mockResolvedValue({ id: 'A', layoutId: 'lay_1', isDeleted: false });
      prisma.layoutObject.findMany.mockResolvedValue([{
        id: 'A', layoutId: 'lay_1', parentObjectId: null, objectType: 'BIN', name: 'B', code: null,
        x: 1, y: 1, width: 1, height: 1, rotation: 0, zIndex: 0, displayOrder: 0,
        slotId: null, rackId: null, capacity: null, color: null, status: 'ACTIVE', metadata: null,
      }]);
      prisma.layoutObject.create.mockImplementation((args: any) => Promise.resolve({ id: 'c', ...args.data }));
      prisma.warehouseLayout.update.mockResolvedValue(LAYOUT);

      await service.duplicateObject('A', { offsetX: -50, offsetY: -50 }, 'u1');

      const data = prisma.layoutObject.create.mock.calls[0][0].data;
      expect(data.x).toBe(0);
      expect(data.y).toBe(0);
    });
  });
});
