import { Test } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { WarehouseLayoutService } from './warehouse-layout.service';
import { PrismaService } from '../prisma/prisma.service';
import { LayoutObjectType, StockStatus } from '@prisma/client';

// Sprint 6: linking a drawing to a WMS location, and the live occupancy rollup.
//
// THE GATE for this sprint: the layout module must never write Slot, Rack or
// StockItem. The mock below gives those three models READ methods only — no
// create/update/delete/updateMany exists on them — so any attempt to write would
// throw "is not a function" and fail the suite.

const LAYOUT = { id: 'lay_1', warehouseId: 'wh_1', isDeleted: false, version: 3 };

function makePrisma() {
  const p: any = {
    warehouseLayout: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    layoutObject: {
      findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(),
      count: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
    },
    // READ-ONLY on purpose. Adding a write method here would defeat the gate.
    slot: { findFirst: jest.fn(), findMany: jest.fn() },
    rack: { findFirst: jest.fn(), findMany: jest.fn() },
    stockItem: { findMany: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  p.$transaction = jest.fn((arg: any) => (typeof arg === 'function' ? arg(p) : Promise.all(arg)));
  return p;
}

const BIN = { id: 'obj_bin', layoutId: 'lay_1', objectType: LayoutObjectType.BIN, isDeleted: false, slotId: null, rackId: null };
const RACK_OBJ = { id: 'obj_rack', layoutId: 'lay_1', objectType: LayoutObjectType.RACK, isDeleted: false, slotId: null, rackId: null };
const AISLE = { id: 'obj_aisle', layoutId: 'lay_1', objectType: LayoutObjectType.AISLE, isDeleted: false, slotId: null, rackId: null };

describe('WarehouseLayoutService — linking & occupancy', () => {
  let service: WarehouseLayoutService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    const mod = await Test.createTestingModule({
      providers: [WarehouseLayoutService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(WarehouseLayoutService);
  });

  describe('the gate — inventory is never written', () => {
    it('exposes no write surface on Slot, Rack or StockItem', () => {
      for (const model of ['slot', 'rack', 'stockItem'] as const) {
        for (const method of ['create', 'update', 'delete', 'updateMany', 'deleteMany', 'upsert']) {
          expect((prisma as any)[model][method]).toBeUndefined();
        }
      }
    });

    it('links by writing only the LayoutObject row', async () => {
      prisma.layoutObject.findFirst
        .mockResolvedValueOnce(BIN)   // getObjectOrThrow
        .mockResolvedValueOnce(null); // no other object holds the slot
      prisma.warehouseLayout.findFirst.mockResolvedValue({ warehouseId: 'wh_1' });
      prisma.slot.findFirst.mockResolvedValue({ id: 'slot_1', code: 'A-01', rack: { warehouseId: 'wh_1' } });
      prisma.layoutObject.update.mockResolvedValue({ ...BIN, slotId: 'slot_1' });

      await service.linkObject('obj_bin', { slotId: 'slot_1' }, 'u1');

      expect(prisma.layoutObject.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'obj_bin' }, data: { slotId: 'slot_1', rackId: null } }),
      );
    });

    it('unlinks without touching the Slot', async () => {
      prisma.layoutObject.findFirst.mockResolvedValue({ ...BIN, slotId: 'slot_1' });
      prisma.layoutObject.update.mockResolvedValue({ ...BIN, slotId: null });

      await service.unlinkObject('obj_bin', 'u1');

      expect(prisma.layoutObject.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { slotId: null, rackId: null } }),
      );
      // Nothing was even read from slot here, let alone written.
      expect(prisma.slot.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('linkObject validation', () => {
    it('refuses a physical-only object type', async () => {
      prisma.layoutObject.findFirst.mockResolvedValue(AISLE);
      await expect(service.linkObject('obj_aisle', { slotId: 's1' }, 'u1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a bin pointed at a rack', async () => {
      prisma.layoutObject.findFirst.mockResolvedValue(BIN);
      await expect(service.linkObject('obj_bin', { rackId: 'rack_1' }, 'u1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('requires exactly one target', async () => {
      prisma.layoutObject.findFirst.mockResolvedValue(BIN);
      await expect(service.linkObject('obj_bin', {}, 'u1')).rejects.toBeInstanceOf(BadRequestException);
      prisma.layoutObject.findFirst.mockResolvedValue(BIN);
      await expect(service.linkObject('obj_bin', { slotId: 's', rackId: 'r' }, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a slot from a different warehouse', async () => {
      prisma.layoutObject.findFirst.mockResolvedValue(BIN);
      prisma.warehouseLayout.findFirst.mockResolvedValue({ warehouseId: 'wh_1' });
      prisma.slot.findFirst.mockResolvedValue({ id: 's1', code: 'A-01', rack: { warehouseId: 'wh_OTHER' } });

      await expect(service.linkObject('obj_bin', { slotId: 's1' }, 'u1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.layoutObject.update).not.toHaveBeenCalled();
    });

    it('refuses a slot already drawn elsewhere', async () => {
      prisma.layoutObject.findFirst
        .mockResolvedValueOnce(BIN)
        .mockResolvedValueOnce({ id: 'other', name: 'Bin 4' });
      prisma.warehouseLayout.findFirst.mockResolvedValue({ warehouseId: 'wh_1' });
      prisma.slot.findFirst.mockResolvedValue({ id: 's1', code: 'A-01', rack: { warehouseId: 'wh_1' } });

      await expect(service.linkObject('obj_bin', { slotId: 's1' }, 'u1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('404s on a soft-deleted slot', async () => {
      prisma.layoutObject.findFirst.mockResolvedValue(BIN);
      prisma.warehouseLayout.findFirst.mockResolvedValue({ warehouseId: 'wh_1' });
      prisma.slot.findFirst.mockResolvedValue(null);
      await expect(service.linkObject('obj_bin', { slotId: 's1' }, 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('occupancy', () => {
    it('derives available and committed by bucketing StockStatus', async () => {
      prisma.warehouseLayout.findFirst.mockResolvedValue({ id: 'lay_1' });
      prisma.layoutObject.findMany.mockResolvedValue([{ id: 'o1', slotId: 'slot_1' }]);
      prisma.slot.findMany.mockResolvedValue([
        { id: 'slot_1', code: 'A-01', name: 'Bin', capacity: 4, status: 'EMPTY', isDeleted: false },
      ]);
      prisma.stockItem.findMany.mockResolvedValue([
        { slotId: 'slot_1', productId: 'p1', quantity: 3, status: StockStatus.AVAILABLE, updatedAt: new Date('2026-08-01') },
        { slotId: 'slot_1', productId: 'p2', quantity: 2, status: StockStatus.RESERVED, updatedAt: new Date('2026-08-05') },
        { slotId: 'slot_1', productId: 'p1', quantity: 1, status: StockStatus.PICKING, updatedAt: new Date('2026-08-03') },
      ]);

      const [row] = await service.occupancy('wh_1');

      expect(row.quantity).toBe(6);
      expect(row.available).toBe(3);
      expect(row.committed).toBe(3); // RESERVED 2 + PICKING 1
      expect(row.skuCount).toBe(2);
      expect(row.items).toBe(3);
      expect(row.utilizationPct).toBe(75); // 3 items / capacity 4
      expect(row.lastActivityAt).toEqual(new Date('2026-08-05'));
    });

    it('excludes stock that has left the building', async () => {
      prisma.warehouseLayout.findFirst.mockResolvedValue({ id: 'lay_1' });
      prisma.layoutObject.findMany.mockResolvedValue([{ id: 'o1', slotId: 'slot_1' }]);
      prisma.slot.findMany.mockResolvedValue([{ id: 'slot_1', code: 'A-01', name: null, capacity: 4, status: 'EMPTY', isDeleted: false }]);
      prisma.stockItem.findMany.mockResolvedValue([]);

      await service.occupancy('wh_1');

      const where = prisma.stockItem.findMany.mock.calls[0][0].where;
      expect(where.status.notIn).toEqual(
        expect.arrayContaining([StockStatus.SHIPPED, StockStatus.CLOSED, StockStatus.CANCELLED, StockStatus.CONSUMED]),
      );
    });

    it('flags a link pointing at a soft-deleted slot as orphaned', async () => {
      prisma.warehouseLayout.findFirst.mockResolvedValue({ id: 'lay_1' });
      prisma.layoutObject.findMany.mockResolvedValue([{ id: 'o1', slotId: 'gone' }]);
      prisma.slot.findMany.mockResolvedValue([
        { id: 'gone', code: 'A-09', name: null, capacity: 1, status: 'EMPTY', isDeleted: true },
      ]);
      prisma.stockItem.findMany.mockResolvedValue([]);

      const [row] = await service.occupancy('wh_1');
      expect(row.orphaned).toBe(true);
    });

    it('returns nothing when the warehouse has no layout', async () => {
      prisma.warehouseLayout.findFirst.mockResolvedValue(null);
      await expect(service.occupancy('wh_1')).resolves.toEqual([]);
      expect(prisma.stockItem.findMany).not.toHaveBeenCalled();
    });

    it('reports 100% for an over-capacity or zero-capacity slot that holds stock', async () => {
      prisma.warehouseLayout.findFirst.mockResolvedValue({ id: 'lay_1' });
      prisma.layoutObject.findMany.mockResolvedValue([{ id: 'o1', slotId: 's1' }]);
      prisma.slot.findMany.mockResolvedValue([{ id: 's1', code: 'A-01', name: null, capacity: 0, status: 'EMPTY', isDeleted: false }]);
      prisma.stockItem.findMany.mockResolvedValue([
        { slotId: 's1', productId: 'p1', quantity: 1, status: StockStatus.AVAILABLE, updatedAt: new Date() },
      ]);

      const [row] = await service.occupancy('wh_1');
      expect(row.utilizationPct).toBe(100);
    });
  });

  describe('generateBinsFromRack', () => {
    it('refuses a non-rack object', async () => {
      prisma.layoutObject.findFirst.mockResolvedValue(BIN);
      await expect(service.generateBinsFromRack('obj_bin', 'u1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a rack object that is not linked yet', async () => {
      prisma.layoutObject.findFirst.mockResolvedValue(RACK_OBJ);
      await expect(service.generateBinsFromRack('obj_rack', 'u1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('draws one bin per slot, links each, and creates no Slot rows', async () => {
      prisma.layoutObject.findFirst.mockResolvedValue({
        ...RACK_OBJ, rackId: 'rack_1', x: 10, y: 10, width: 12, height: 4, zIndex: 2,
      });
      prisma.slot.findMany.mockResolvedValue([
        { id: 's1', code: 'R-A-A01', name: null, level: 1, column: 1, capacity: 4 },
        { id: 's2', code: 'R-A-A02', name: null, level: 1, column: 2, capacity: 4 },
        { id: 's3', code: 'R-A-B01', name: null, level: 2, column: 1, capacity: 4 },
      ]);
      prisma.layoutObject.findMany.mockResolvedValue([]); // none drawn yet
      let i = 0;
      prisma.layoutObject.create.mockImplementation((args: any) => Promise.resolve({ id: `b${++i}`, ...args.data }));
      prisma.warehouseLayout.update.mockResolvedValue(LAYOUT);

      const res = await service.generateBinsFromRack('obj_rack', 'u1');

      expect(res.created).toBe(3);
      const rows = prisma.layoutObject.create.mock.calls.map((c: any) => c[0].data);
      expect(rows.every((r: any) => r.objectType === LayoutObjectType.BIN)).toBe(true);
      expect(rows.map((r: any) => r.slotId)).toEqual(['s1', 's2', 's3']);
      expect(rows.every((r: any) => r.parentObjectId === 'obj_rack')).toBe(true);
      // Level 1 is the bottom of a rack, so it draws lower on the canvas than level 2.
      const lvl1 = rows.find((r: any) => r.slotId === 's1');
      const lvl2 = rows.find((r: any) => r.slotId === 's3');
      expect(lvl1.y).toBeGreaterThan(lvl2.y);
    });

    it('skips slots that are already drawn', async () => {
      prisma.layoutObject.findFirst.mockResolvedValue({
        ...RACK_OBJ, rackId: 'rack_1', x: 0, y: 0, width: 4, height: 2, zIndex: 0,
      });
      prisma.slot.findMany.mockResolvedValue([
        { id: 's1', code: 'A', name: null, level: 1, column: 1, capacity: 1 },
        { id: 's2', code: 'B', name: null, level: 1, column: 2, capacity: 1 },
      ]);
      prisma.layoutObject.findMany.mockResolvedValue([{ slotId: 's1' }]);
      prisma.layoutObject.create.mockImplementation((args: any) => Promise.resolve({ id: 'x', ...args.data }));
      prisma.warehouseLayout.update.mockResolvedValue(LAYOUT);

      const res = await service.generateBinsFromRack('obj_rack', 'u1');

      expect(res.created).toBe(1);
      expect(res.skipped).toBe(1);
      expect(prisma.layoutObject.create.mock.calls[0][0].data.slotId).toBe('s2');
    });
  });
});
