import { NotFoundException } from '@nestjs/common';
import { PutawayService } from './putaway.service';

// RQ15 at the service seam: which rows are asked for, and how they are turned
// into candidates. The ranking itself is covered by putaway-suggest.spec.ts.

const PRODUCT = { id: 'p1', code: 'SKU-1', name: 'Thing', lengthCm: 40, widthCm: 30, heightCm: 20 };

function make(over: { item?: any; slots?: any[] } = {}) {
  const item = over.item === undefined
    ? { id: 'si1', productId: 'p1', quantity: 12, warehouseId: 'W1', product: PRODUCT }
    : over.item;
  const slots = over.slots ?? [
    {
      id: 's1', code: 'A01-01-01', status: 'EMPTY', capacity: 4, lengthCm: 100, widthCm: 80, heightCm: 60,
      rack: { id: 'r1', code: 'A01', zone: 'Z1', warehouseId: 'W1', warehouse: { code: 'WH-1' } },
      stockItems: [],
    },
    {
      id: 's2', code: 'A01-01-02', status: 'PARTIAL', capacity: 4, lengthCm: 100, widthCm: 80, heightCm: 60,
      rack: { id: 'r1', code: 'A01', zone: 'Z1', warehouseId: 'W1', warehouse: { code: 'WH-1' } },
      stockItems: [{ productId: 'p1' }, { productId: 'p9' }],
    },
  ];
  const prisma: any = {
    stockItem: { findFirst: jest.fn().mockResolvedValue(item) },
    slot: { findMany: jest.fn().mockResolvedValue(slots) },
  };
  const realtime: any = { emit: jest.fn() };
  return { svc: new PutawayService(prisma, realtime), prisma };
}

describe('putaway suggestions — the query', () => {
  it('asks only for live slots in live racks of a live warehouse', async () => {
    const { svc, prisma } = make();
    await svc.suggestions('si1');
    const where = prisma.slot.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ isDeleted: false, isActive: true });
    expect(where.rack).toMatchObject({ isDeleted: false, isActive: true, warehouseId: 'W1' });
    expect(where.rack.warehouse).toMatchObject({ isDeleted: false, isActive: true });
  });

  it('counts only stock that is actually in the location', async () => {
    const { svc, prisma } = make();
    await svc.suggestions('si1');
    const sel = prisma.slot.findMany.mock.calls[0][0].select;
    expect(sel.stockItems.where.status.notIn.length).toBeGreaterThan(0);
  });

  it('searches the warehouse asked for instead of the item\'s own', async () => {
    const { svc, prisma } = make();
    await svc.suggestions('si1', { warehouseId: 'W2' });
    expect(prisma.slot.findMany.mock.calls[0][0].where.rack.warehouseId).toBe('W2');
  });

  it('refuses an item that does not exist', async () => {
    const { svc } = make({ item: null });
    await expect(svc.suggestions('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('putaway suggestions — the answer', () => {
  it('carries the item, its box and the room the quantity needs', async () => {
    const { svc } = make();
    const r: any = await svc.suggestions('si1');
    expect(r.item).toMatchObject({ id: 'si1', quantity: 12, productCode: 'SKU-1' });
    expect(r.item.box).toEqual({ lengthCm: 40, widthCm: 30, heightCm: 20 });
    expect(r.hasProductSize).toBe(true);
    expect(r.need.totalVolumeM3).toBeCloseTo(0.288, 6); // 12 × 0.024 m³
    expect(r.slotsConsidered).toBe(2);
  });

  it('marks the slot that already holds this product and puts it first', async () => {
    const { svc } = make();
    const r: any = await svc.suggestions('si1');
    expect(r.suggestions[0]).toMatchObject({ slotCode: 'A01-01-02', holdsSameProduct: true, reason: 'SAME_PRODUCT', free: 2 });
    expect(r.suggestions[1]).toMatchObject({ slotCode: 'A01-01-01', holdsSameProduct: false, free: 4 });
  });

  it('says the size is missing instead of guessing', async () => {
    const { svc } = make({
      item: { id: 'si2', productId: 'p2', quantity: 3, warehouseId: 'W1', product: { id: 'p2', code: 'SKU-2', name: 'No size', lengthCm: null, widthCm: null, heightCm: null } },
    });
    const r: any = await svc.suggestions('si2');
    expect(r.hasProductSize).toBe(false);
    expect(r.need.totalVolumeM3).toBeNull();
    expect(r.suggestions.every((s: any) => s.fits === null)).toBe(true);
    expect(r.suggestions.length).toBeGreaterThan(0); // still useful: ranked by free space
  });
});
