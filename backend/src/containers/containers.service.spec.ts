import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ContainersService } from './containers.service';

// RQ17 / RQ18 — what a box does.
//
// The rule these tests exist for: a box is a place that moves, so moving it
// rewrites the location of everything inside, in one go. And a split never
// divides a quantity — it moves whole rows into a new box.

const SLOT = {
  id: 'slot1', isDeleted: false, isActive: true,
  rack: { id: 'rack1', warehouseId: 'wh1', isDeleted: false, isActive: true },
};

function make(over: { box?: any; items?: any[]; children?: any[] } = {}) {
  const box = {
    id: 'c1', code: 'BOX-000001', name: null, type: 'BOX', status: 'OPEN',
    warehouseId: 'wh1', rackId: 'rack1', slotId: 'slot1',
    parentContainerId: null, splitFromId: null, isDeleted: false,
    stockItems: over.items ?? [{ id: 'si1' }, { id: 'si2' }],
    children: over.children ?? [],
    ...over.box,
  };
  const calls: any = { containerUpdateMany: [], stockUpdateMany: [], created: [], audits: [] };
  const prisma: any = {
    container: {
      findFirst: jest.fn(async ({ where }: any) => (where.id === 'missing' ? null : { ...box, id: where.id ?? box.id })),
      findMany: jest.fn(async ({ where }: any) => (where?.parentContainerId ? (over.children ?? []) : [{ code: 'BOX-000001' }])),
      create: jest.fn(async ({ data }: any) => { const row = { ...box, id: 'c2', ...data }; calls.created.push(data); return row; }),
      update: jest.fn(async ({ where, data }: any) => ({ ...box, id: where.id, ...data })),
      updateMany: jest.fn(async (a: any) => { calls.containerUpdateMany.push(a); return { count: 1 }; }),
    },
    stockItem: {
      findMany: jest.fn(async () => (over.items ?? [{ id: 'si1' }, { id: 'si2' }]).map((i: any) => ({
        id: i.id, status: i.status ?? 'AVAILABLE', warehouseId: i.warehouseId ?? 'wh1', containerId: i.containerId ?? null,
      }))),
      updateMany: jest.fn(async (a: any) => { calls.stockUpdateMany.push(a); return { count: 2 }; }),
    },
    slot: { findFirst: jest.fn(async () => SLOT) },
    auditLog: { create: jest.fn(async ({ data }: any) => { calls.audits.push(data); return data; }) },
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
  };
  prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
  return { svc: new ContainersService(prisma), prisma, calls, box };
}

const actions = (calls: any) => calls.audits.map((a: any) => a.action);

describe('making a box', () => {
  it('generates the code itself and records where it stands', async () => {
    const { svc, calls } = make();
    await svc.create({ name: 'Spares', slotId: 'slot1' } as any, 'u1');
    expect(calls.created[0]).toMatchObject({ code: 'BOX-000002', name: 'Spares', slotId: 'slot1', rackId: 'rack1', warehouseId: 'wh1' });
    expect(actions(calls)).toContain('CONTAINER_CREATED');
  });

  it('refuses a slot that does not exist', async () => {
    const { svc, prisma } = make();
    prisma.slot.findFirst = jest.fn().mockResolvedValue(null);
    await expect(svc.create({ slotId: 'nope' } as any, 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('moving a box', () => {
  it('takes the stock inside with it, in one transaction', async () => {
    const { svc, prisma, calls } = make();
    await svc.move('c1', { slotId: 'slot1' } as any, 'u1');

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(calls.containerUpdateMany[0].data).toMatchObject({ slotId: 'slot1', rackId: 'rack1', warehouseId: 'wh1' });
    expect(calls.stockUpdateMany[0].data).toMatchObject({ slotId: 'slot1', rackId: 'rack1', warehouseId: 'wh1' });
    expect(actions(calls)).toContain('CONTAINER_MOVED');
  });

  it('never changes a stock status while moving', async () => {
    const { svc, calls } = make();
    await svc.move('c1', { slotId: 'slot1' } as any, 'u1');
    expect(Object.keys(calls.stockUpdateMany[0].data)).toEqual(expect.not.arrayContaining(['status']));
  });

  it('leaves stock that has left the building alone', async () => {
    const { svc, calls } = make();
    await svc.move('c1', { slotId: 'slot1' } as any, 'u1');
    expect(calls.stockUpdateMany[0].where.status.notIn.length).toBeGreaterThan(0);
  });
});

describe('packing and unpacking', () => {
  it('packing gives the rows the box’s location', async () => {
    const { svc, calls } = make();
    await svc.packItems('c1', { stockItemIds: ['si1', 'si2'] } as any, 'u1');
    expect(calls.stockUpdateMany[0].data).toMatchObject({ containerId: 'c1', slotId: 'slot1', rackId: 'rack1', warehouseId: 'wh1' });
    expect(actions(calls)).toContain('CONTAINER_PACKED');
  });

  it('refuses stock that is already in another box', async () => {
    const { svc } = make({ items: [{ id: 'si1', containerId: 'other' }] });
    await expect(svc.packItems('c1', { stockItemIds: ['si1'] } as any, 'u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses stock that has left the building', async () => {
    const { svc } = make({ items: [{ id: 'si1', status: 'SHIPPED' }] });
    await expect(svc.packItems('c1', { stockItemIds: ['si1'] } as any, 'u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('unpacking only drops the link — the stock stays put', async () => {
    const { svc, calls } = make();
    await svc.unpackItems('c1', { stockItemIds: ['si1'] } as any, 'u1');
    expect(calls.stockUpdateMany[0].data).toEqual({ containerId: null });
    expect(actions(calls)).toContain('CONTAINER_UNPACKED');
  });

  it('a closed box refuses both', async () => {
    const { svc } = make({ box: { status: 'CLOSED' } });
    await expect(svc.packItems('c1', { stockItemIds: ['si1'] } as any, 'u1'))
      .rejects.toMatchObject({ response: { code: 'CONTAINER_CLOSED' } });
    await expect(svc.unpackItems('c1', { stockItemIds: ['si1'] } as any, 'u1'))
      .rejects.toMatchObject({ response: { code: 'CONTAINER_CLOSED' } });
  });

  it('asks for at least one row', async () => {
    const { svc } = make();
    await expect(svc.packItems('c1', { stockItemIds: [] } as any, 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('splitting a box', () => {
  it('makes a new box in the same place and remembers where it came from', async () => {
    const { svc, prisma, calls } = make();
    prisma.stockItem.findMany = jest.fn(async () => [{ id: 'si1' }]);

    await svc.split('c1', { stockItemIds: ['si1'], name: 'Half' } as any, 'u1');

    expect(calls.created[0]).toMatchObject({ slotId: 'slot1' });
    expect(prisma.container.update).toHaveBeenCalledWith(expect.objectContaining({ data: { splitFromId: 'c1' } }));
    expect(calls.stockUpdateMany.at(-1).data).toEqual({ containerId: 'c2' });
    expect(actions(calls)).toContain('CONTAINER_SPLIT');
  });

  it('refuses to empty the box unless that was asked for', async () => {
    const { svc, prisma } = make({ items: [{ id: 'si1' }] });
    prisma.stockItem.findMany = jest.fn(async () => [{ id: 'si1' }]);
    await expect(svc.split('c1', { stockItemIds: ['si1'] } as any, 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses rows that are not in the box', async () => {
    const { svc, prisma } = make();
    prisma.stockItem.findMany = jest.fn(async () => []);
    await expect(svc.split('c1', { stockItemIds: ['si9'] } as any, 'u1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('merging', () => {
  it('moves the contents, and the boxes inside, into the target', async () => {
    const { svc, calls } = make();
    await svc.merge('c1', { fromContainerId: 'c9' } as any, 'u1');
    expect(calls.stockUpdateMany[0].data).toMatchObject({ containerId: 'c1', slotId: 'slot1' });
    expect(calls.containerUpdateMany[0].data).toMatchObject({ parentContainerId: 'c1' });
    expect(actions(calls)).toContain('CONTAINER_MERGED');
  });

  it('refuses to merge a box into itself', async () => {
    const { svc } = make();
    await expect(svc.merge('c1', { fromContainerId: 'c1' } as any, 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('retiring a box', () => {
  it('refuses while there is still stock in it', async () => {
    const { svc } = make();
    await expect(svc.remove('c1', 'u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('soft-deletes an empty one', async () => {
    const { svc, prisma, calls } = make({ items: [] });
    await svc.remove('c1', 'u1');
    expect(prisma.container.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isDeleted: true, deletedBy: 'u1' }),
    }));
    expect(actions(calls)).toContain('CONTAINER_DELETED');
  });
});
