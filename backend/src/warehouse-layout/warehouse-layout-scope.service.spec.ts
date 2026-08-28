import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { WarehouseLayoutService } from './warehouse-layout.service';
import { PrismaService } from '../prisma/prisma.service';
import { LayoutObjectType } from '@prisma/client';

// Sprint 7: per-user warehouse scoping.
//
// The semantics are inherited from inventory.service.findAll, quirks included:
// SUPER_ADMIN bypasses, and a user with NO assigned warehouses is UNRESTRICTED.
// That last rule is surprising, so it is pinned by a test — if someone later
// "fixes" it here without fixing inventory too, the two surfaces would disagree
// about who can see what.

const LAYOUT = { id: 'lay_1', warehouseId: 'wh_1', isDeleted: false, version: 3 };
const OBJ = { id: 'obj_1', layoutId: 'lay_1', objectType: LayoutObjectType.BIN, isDeleted: false, slotId: null, rackId: null };

function makePrisma() {
  const p: any = {
    warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'wh_1', code: 'WH-01', name: 'Main', isActive: true }) },
    warehouseLayout: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    layoutObject: {
      findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
    },
    slot: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    rack: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    stockItem: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  p.$transaction = jest.fn((arg: any) => (typeof arg === 'function' ? arg(p) : Promise.all(arg)));
  return p;
}

describe('WarehouseLayoutService — warehouse scoping', () => {
  let service: WarehouseLayoutService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    const mod = await Test.createTestingModule({
      providers: [WarehouseLayoutService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(WarehouseLayoutService);
    prisma.warehouseLayout.findFirst.mockResolvedValue(LAYOUT);
  });

  describe('warehouse-addressed reads', () => {
    it('blocks a warehouse the user is not assigned to', async () => {
      await expect(
        service.getByWarehouse('wh_1', { roleKey: 'ADMIN', warehouseIds: ['wh_OTHER'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.warehouse.findFirst).not.toHaveBeenCalled();
    });

    it('allows a warehouse the user IS assigned to', async () => {
      await expect(
        service.getByWarehouse('wh_1', { roleKey: 'ADMIN', warehouseIds: ['wh_1', 'wh_2'] }),
      ).resolves.toBeDefined();
    });

    it('lets SUPER_ADMIN through regardless of assignment', async () => {
      await expect(
        service.getByWarehouse('wh_1', { roleKey: 'SUPER_ADMIN', warehouseIds: ['wh_OTHER'] }),
      ).resolves.toBeDefined();
    });

    it('treats a user with NO assigned warehouses as unrestricted (matches inventory.service)', async () => {
      await expect(
        service.getByWarehouse('wh_1', { roleKey: 'ADMIN', warehouseIds: [] }),
      ).resolves.toBeDefined();
    });

    it('scopes the occupancy rollup too', async () => {
      await expect(
        service.occupancy('wh_1', { roleKey: 'ADMIN', warehouseIds: ['wh_OTHER'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.stockItem.findMany).not.toHaveBeenCalled();
    });
  });

  describe('object- and layout-addressed writes', () => {
    // The important case: a scoped user must not reach another warehouse's
    // objects by guessing an id, so the check resolves object → layout →
    // warehouse before doing anything.
    it('blocks updating an object in another warehouse', async () => {
      prisma.layoutObject.findFirst.mockResolvedValue(OBJ);
      await expect(
        service.updateObject('obj_1', { name: 'x' }, 'u1', { roleKey: 'ADMIN', warehouseIds: ['wh_OTHER'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.layoutObject.update).not.toHaveBeenCalled();
    });

    it('blocks deleting an object in another warehouse', async () => {
      prisma.layoutObject.findFirst.mockResolvedValue(OBJ);
      await expect(
        service.deleteObject('obj_1', false, 'u1', { roleKey: 'ADMIN', warehouseIds: ['wh_OTHER'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.layoutObject.updateMany).not.toHaveBeenCalled();
    });

    it('blocks linking an object in another warehouse', async () => {
      prisma.layoutObject.findFirst.mockResolvedValue(OBJ);
      await expect(
        service.linkObject('obj_1', { slotId: 's1' }, 'u1', { roleKey: 'ADMIN', warehouseIds: ['wh_OTHER'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.slot.findFirst).not.toHaveBeenCalled();
    });

    it('blocks a batch save against another warehouse before applying anything', async () => {
      await expect(
        service.batchSave('lay_1', { version: 3, upserts: [], deletes: [] }, 'u1',
          { roleKey: 'ADMIN', warehouseIds: ['wh_OTHER'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.warehouseLayout.update).not.toHaveBeenCalled();
    });

    it('blocks creating a layout for another warehouse', async () => {
      await expect(
        service.createLayout('wh_1', {}, 'u1', { roleKey: 'ADMIN', warehouseIds: ['wh_OTHER'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.warehouseLayout.create).not.toHaveBeenCalled();
    });

    it('allows the same write when the warehouse IS in scope', async () => {
      prisma.layoutObject.findFirst.mockResolvedValue(OBJ);
      prisma.layoutObject.update.mockResolvedValue({ ...OBJ, name: 'x' });
      prisma.warehouseLayout.update.mockResolvedValue(LAYOUT);
      await expect(
        service.updateObject('obj_1', { name: 'x' }, 'u1', { roleKey: 'ADMIN', warehouseIds: ['wh_1'] }),
      ).resolves.toBeDefined();
    });
  });

  it('stays unrestricted when no scope is supplied at all (internal calls)', async () => {
    await expect(service.getByWarehouse('wh_1')).resolves.toBeDefined();
  });
});
