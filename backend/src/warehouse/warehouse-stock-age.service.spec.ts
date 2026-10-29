import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { StockStatus } from '@prisma/client';
import { WarehouseService } from './warehouse.service';
import { PrismaService } from '../prisma/prisma.service';

// GET /warehouse/:id/slot-stock-age — the 3D view's Stock age mode.
// Pins: warehouse scoping, 404, the in-location presence rule, and the shape.

function makePrisma() {
  return {
    warehouse: { findUnique: jest.fn().mockResolvedValue({ id: 'wh_1' }) },
    stockItem: { groupBy: jest.fn().mockResolvedValue([]) },
  } as any;
}

describe('WarehouseService.getSlotStockAge', () => {
  let service: WarehouseService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    const mod = await Test.createTestingModule({
      providers: [WarehouseService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(WarehouseService);
  });

  it('refuses a warehouse outside the caller scope, before any query', async () => {
    await expect(
      service.getSlotStockAge('wh_1', { roleKey: 'ADMIN', warehouseIds: ['wh_OTHER'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.warehouse.findUnique).not.toHaveBeenCalled();
    expect(prisma.stockItem.groupBy).not.toHaveBeenCalled();
  });

  it('404s an unknown warehouse', async () => {
    prisma.warehouse.findUnique.mockResolvedValue(null);
    await expect(service.getSlotStockAge('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('aggregates only stock still in an active slot of this warehouse', async () => {
    await service.getSlotStockAge('wh_1', { roleKey: 'ADMIN', warehouseIds: ['wh_1'] });
    const arg = prisma.stockItem.groupBy.mock.calls[0][0];
    expect(arg.by).toEqual(['slotId']);
    expect(arg.where.slotId).toEqual({ not: null });
    expect(arg.where.slot).toEqual({ isActive: true, rack: { warehouseId: 'wh_1' } });
    // Shipped / consumed / closed / cancelled rows keep their slotId but are gone.
    expect(arg.where.status.notIn).toEqual(
      expect.arrayContaining([StockStatus.SHIPPED, StockStatus.CONSUMED, StockStatus.CLOSED, StockStatus.CANCELLED]),
    );
    expect(arg._min).toEqual({ receivedDate: true });
  });

  it('returns the oldest received date per slot as ISO strings', async () => {
    prisma.stockItem.groupBy.mockResolvedValue([
      { slotId: 's1', _min: { receivedDate: new Date('2026-09-01T00:00:00Z') }, _count: { _all: 3 } },
      { slotId: 's2', _min: { receivedDate: new Date('2026-10-20T08:30:00Z') }, _count: { _all: 1 } },
      { slotId: null, _min: { receivedDate: new Date() }, _count: { _all: 9 } },
    ]);
    const res = await service.getSlotStockAge('wh_1');
    expect(res.warehouseId).toBe('wh_1');
    expect(typeof res.asOf).toBe('string');
    expect(res.slots).toEqual([
      { slotId: 's1', oldestReceivedDate: '2026-09-01T00:00:00.000Z', items: 3 },
      { slotId: 's2', oldestReceivedDate: '2026-10-20T08:30:00.000Z', items: 1 },
    ]);
  });
});
