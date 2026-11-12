import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { RelocationStatus, SlotStatus, StockStatus } from '@prisma/client';
import { RelocationService, type Principal } from './relocation.service';

// PR7 Location Relocation Request. A small in-memory store stands in for Prisma so
// the rules run against real state: rows really move, split and conflict. The real
// database path (row locks, rollback) is covered by the local API run (testenv/test-pr7.mjs).

type Row = {
  id: string;
  productId: string;
  warehouseId: string | null;
  rackId: string | null;
  slotId: string | null;
  status: StockStatus;
  quantity: number;
  serialNumber: string | null;
  [k: string]: any;
};
type Req = {
  id: string;
  refNumber: string;
  warehouseId: string;
  status: RelocationStatus;
  requestedById: string;
  [k: string]: any;
};
type Line = {
  id: string;
  requestId: string;
  stockItemId: string;
  productId: string;
  fromSlotId: string;
  toSlotId: string;
  quantity: number;
  remainderStockItemId?: string | null;
};

const WH = 'wh1',
  OTHER_WH = 'wh2';
const SLOTS = [
  {
    id: 's1',
    code: 'A-01',
    rackId: 'r1',
    status: SlotStatus.OCCUPIED,
    capacity: 5,
  },
  {
    id: 's2',
    code: 'A-02',
    rackId: 'r1',
    status: SlotStatus.EMPTY,
    capacity: 1,
  },
  {
    id: 's3',
    code: 'B-01',
    rackId: 'r2',
    status: SlotStatus.BLOCKED,
    capacity: 5,
  },
  {
    id: 'x1',
    code: 'X-01',
    rackId: 'rx',
    status: SlotStatus.EMPTY,
    capacity: 5,
  },
];
const RACKS = [
  { id: 'r1', warehouseId: WH },
  { id: 'r2', warehouseId: WH },
  { id: 'rx', warehouseId: OTHER_WH },
];

const maker: Principal = {
  id: 'u-maker',
  role: 'WAREHOUSE_STAFF',
};
const checker: Principal = {
  id: 'u-checker',
  role: 'WAREHOUSE_MANAGER',
};
const staff2: Principal = {
  id: 'u-staff2',
  role: 'WAREHOUSE_STAFF',
};

function makeDb() {
  let seq = 0;
  const rows: Row[] = [
    {
      id: 'st-avail',
      productId: 'p1',
      warehouseId: WH,
      rackId: 'r1',
      slotId: 's1',
      status: StockStatus.AVAILABLE,
      quantity: 10,
      serialNumber: null,
    },
    {
      id: 'st-serial',
      productId: 'p2',
      warehouseId: WH,
      rackId: 'r1',
      slotId: 's1',
      status: StockStatus.AVAILABLE,
      quantity: 1,
      serialNumber: 'SN1',
    },
    {
      id: 'st-res',
      productId: 'p1',
      warehouseId: WH,
      rackId: 'r1',
      slotId: 's1',
      status: StockStatus.RESERVED,
      quantity: 4,
      serialNumber: null,
    },
    {
      id: 'st-quar',
      productId: 'p3',
      warehouseId: WH,
      rackId: 'r1',
      slotId: 's1',
      status: StockStatus.QUARANTINE,
      quantity: 2,
      serialNumber: null,
    },
    {
      id: 'st-dock',
      productId: 'p1',
      warehouseId: WH,
      rackId: null,
      slotId: null,
      status: StockStatus.AVAILABLE,
      quantity: 3,
      serialNumber: null,
    },
  ];
  const reqs: Req[] = [];
  const lines: Line[] = [];
  const audit: any[] = [];
  const counted = new Set<string>();

  const inIds = (w: any, id: string) =>
    w?.in ? w.in.includes(id) : w === undefined || w === id;
  const statusOk = (w: any, s: string) =>
    w === undefined
      ? true
      : typeof w === 'string'
        ? w === s
        : w.in
          ? w.in.includes(s)
          : w.notIn
            ? !w.notIn.includes(s)
            : true;
  const withLines = (r: Req) => ({
    ...r,
    lines: lines
      .filter((l) => l.requestId === r.id)
      .map((l) => ({ ...l, toSlot: SLOTS.find((s) => s.id === l.toSlotId) })),
  });

  const db: any = {
    rows,
    reqs,
    lines,
    audit,
    counted,
    stockItem: {
      // Copies, like Prisma: callers must not see later writes through a read result.
      findMany: jest.fn(async ({ where }: any) =>
        rows.filter((r) => inIds(where?.id, r.id)).map((r) => ({ ...r })),
      ),
      findUnique: jest.fn(async ({ where }: any) => {
        const r = rows.find((x) => x.id === where.id);
        return r ? { ...r } : null;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = rows.filter(
          (r) =>
            r.id === where.id &&
            (where.quantity === undefined || r.quantity === where.quantity) &&
            (where.slotId === undefined || r.slotId === where.slotId) &&
            statusOk(where.status, r.status),
        );
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
      create: jest.fn(async ({ data }: any) => {
        const r = { id: `st-new-${++seq}`, serialNumber: null, ...data };
        rows.push(r);
        return r;
      }),
      groupBy: jest.fn(async ({ where }: any) => {
        const out = new Map<string, number>();
        for (const r of rows)
          if (
            r.slotId &&
            where.slotId.in.includes(r.slotId) &&
            statusOk(where.status, r.status)
          )
            out.set(r.slotId, (out.get(r.slotId) ?? 0) + 1);
        return [...out].map(([slotId, n]) => ({ slotId, _count: { _all: n } }));
      }),
    },
    relocationRequest: {
      create: jest.fn(async ({ data }: any) => {
        const { lines: ls, ...rest } = data;
        const r: Req = {
          id: `rq-${++seq}`,
          status: RelocationStatus.PENDING_APPROVAL,
          ...rest,
        };
        reqs.push(r);
        for (const l of ls.createMany.data)
          lines.push({ id: `ln-${++seq}`, requestId: r.id, ...l });
        return r;
      }),
      findUnique: jest.fn(async ({ where, include }: any) => {
        const r = reqs.find((x) => x.id === where.id);
        return r ? (include ? withLines(r) : { ...r }) : null;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const r = reqs.find(
          (x) => x.id === where.id && x.status === where.status,
        );
        if (!r) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      }),
    },
    relocationLine: {
      findFirst: jest.fn(async ({ where }: any) => {
        const l = lines.find(
          (x) =>
            where.stockItemId.in.includes(x.stockItemId) &&
            where.request.status.in.includes(
              reqs.find((r) => r.id === x.requestId)!.status,
            ),
        );
        return l
          ? {
              stockItemId: l.stockItemId,
              request: {
                refNumber: reqs.find((r) => r.id === l.requestId)!.refNumber,
              },
            }
          : null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        lines
          .filter((l) => l.requestId === where.requestId)
          .sort((a, b) => a.stockItemId.localeCompare(b.stockItemId)),
      ),
      update: jest.fn(async ({ where, data }: any) =>
        Object.assign(lines.find((l) => l.id === where.id)!, data),
      ),
    },
    slot: {
      findFirst: jest.fn(
        async ({ where }: any) => SLOTS.find((s) => s.id === where.id) ?? null,
      ),
      findUnique: jest.fn(
        async ({ where }: any) => SLOTS.find((s) => s.id === where.id) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        SLOTS.filter((s) => where.id.in.includes(s.id)),
      ),
    },
    rack: {
      findFirst: jest.fn(
        async ({ where }: any) => RACKS.find((r) => r.id === where.id) ?? null,
      ),
    },
    warehouse: {
      findFirst: jest.fn(async ({ where }: any) => ({ id: where.id })),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        audit.push(data);
        return data;
      }),
    },
    // Row locks are a no-op here; the count-lock query returns rows held by a count.
    $queryRaw: jest.fn(
      async (strings: TemplateStringsArray, ...vals: any[]) => {
        if (strings.join('').includes('CycleCountLine')) {
          const ids: string[] = vals[0] ?? [];
          return ids
            .filter((id) => counted.has(id))
            .map((id) => ({ stockItemId: id, refNumber: 'CC-1' }));
        }
        return [];
      },
    ),
  };
  // Roll back on error, like Postgres: a refused step leaves no partial writes.
  db.$transaction = jest.fn(async (fn: any) => {
    const snap = [rows, reqs, lines, audit].map((a) =>
      a.map((x: any) => ({ ...x })),
    );
    try {
      return await fn(db);
    } catch (e) {
      [rows, reqs, lines, audit].forEach((a: any[], i) =>
        a.splice(0, a.length, ...snap[i]),
      );
      throw e;
    }
  });
  return db;
}

describe('RelocationService', () => {
  let db: ReturnType<typeof makeDb>;
  let realtime: { emitInventoryUpdate: jest.Mock };
  let svc: RelocationService;
  beforeEach(() => {
    db = makeDb();
    realtime = { emitInventoryUpdate: jest.fn() };
    svc = new RelocationService(db, realtime as any);
  });
  const create = (
    lines: { stockItemId: string; toSlotId: string; quantity: number }[],
    wh = WH,
  ) => svc.create({ warehouseId: wh, lines }, maker);
  const row = (id: string) => db.rows.find((r: Row) => r.id === id)!;

  describe('create', () => {
    it('opens a pending request without moving any stock', async () => {
      const r = await create([
        { stockItemId: 'st-avail', toSlotId: 's2', quantity: 4 },
      ]);
      expect(r.status).toBe(RelocationStatus.PENDING_APPROVAL);
      expect(r.lines).toHaveLength(1);
      expect(row('st-avail')).toMatchObject({ slotId: 's1', quantity: 10 });
      expect(db.audit.map((a: any) => a.action)).toEqual([
        'RELOCATION_REQUESTED',
      ]);
    });

    it('accepts quarantine stock (on hand, not committed)', async () => {
      await expect(
        create([{ stockItemId: 'st-quar', toSlotId: 's2', quantity: 2 }]),
      ).resolves.toBeTruthy();
    });

    it('refuses reserved stock', async () => {
      await expect(
        create([{ stockItemId: 'st-res', toSlotId: 's2', quantity: 4 }]),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses more than the row holds, zero, and a partial serial row', async () => {
      await expect(
        create([{ stockItemId: 'st-avail', toSlotId: 's2', quantity: 11 }]),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        create([{ stockItemId: 'st-avail', toSlotId: 's2', quantity: 0 }]),
      ).rejects.toBeInstanceOf(BadRequestException);
      db.rows.find((r: Row) => r.id === 'st-serial')!.quantity = 2;
      await expect(
        create([{ stockItemId: 'st-serial', toSlotId: 's2', quantity: 1 }]),
      ).rejects.toThrow(/serial/);
    });

    it('refuses stock not in a slot, a slot in another warehouse, a blocked slot and the same slot', async () => {
      await expect(
        create([{ stockItemId: 'st-dock', toSlotId: 's2', quantity: 1 }]),
      ).rejects.toThrow(/not in a slot/);
      await expect(
        create([{ stockItemId: 'st-avail', toSlotId: 'x1', quantity: 1 }]),
      ).rejects.toThrow(/does not belong/);
      await expect(
        create([{ stockItemId: 'st-avail', toSlotId: 's3', quantity: 1 }]),
      ).rejects.toThrow(/blocked/);
      await expect(
        create([{ stockItemId: 'st-avail', toSlotId: 's1', quantity: 1 }]),
      ).rejects.toThrow(/already in that slot/);
    });

    it('refuses a row already in an open request, and duplicate rows', async () => {
      await create([{ stockItemId: 'st-avail', toSlotId: 's2', quantity: 1 }]);
      await expect(
        create([{ stockItemId: 'st-avail', toSlotId: 's2', quantity: 1 }]),
      ).rejects.toThrow(/already in open relocation/);
      await expect(
        create([
          { stockItemId: 'st-quar', toSlotId: 's2', quantity: 1 },
          { stockItemId: 'st-quar', toSlotId: 's2', quantity: 1 },
        ]),
      ).rejects.toThrow(/only once/);
    });

    it('refuses a warehouse outside the user scope', async () => {
      await expect(
        svc.create(
          {
            warehouseId: WH,
            lines: [{ stockItemId: 'st-avail', toSlotId: 's2', quantity: 1 }],
          },
          { ...maker, warehouseIds: [OTHER_WH] },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('warns (does not block) when the destination goes over capacity', async () => {
      db.rows.push({
        id: 'st-in-s2',
        productId: 'p9',
        warehouseId: WH,
        rackId: 'r1',
        slotId: 's2',
        status: StockStatus.AVAILABLE,
        quantity: 1,
        serialNumber: null,
      });
      const r = await create([
        { stockItemId: 'st-avail', toSlotId: 's2', quantity: 1 },
      ]);
      expect(r.warnings).toEqual([
        {
          kind: 'OVER_CAPACITY',
          slotId: 's2',
          slotCode: 'A-02',
          rows: 2,
          capacity: 1,
        },
      ]);
    });
  });

  describe('approve / reject / cancel', () => {
    it('the requester cannot approve their own request', async () => {
      const r = await create([
        { stockItemId: 'st-avail', toSlotId: 's2', quantity: 1 },
      ]);
      await expect(svc.approve(r.id, maker)).rejects.toThrow(
        /Separation of duties/,
      );
      const ok = await svc.approve(r.id, checker);
      expect(ok).toMatchObject({
        status: RelocationStatus.APPROVED,
        approvedById: checker.id,
      });
    });

    it('reject needs a reason; only pending requests can be decided', async () => {
      const r = await create([
        { stockItemId: 'st-avail', toSlotId: 's2', quantity: 1 },
      ]);
      await expect(svc.reject(r.id, '  ', checker)).rejects.toThrow(/reason/);
      const rej = await svc.reject(r.id, 'Wrong slot', checker);
      expect(rej).toMatchObject({
        status: RelocationStatus.REJECTED,
        rejectReason: 'Wrong slot',
      });
      await expect(svc.approve(r.id, checker)).rejects.toThrow(
        /Cannot approve/,
      );
    });

    it('only the requester or an approver can cancel', async () => {
      const r = await create([
        { stockItemId: 'st-avail', toSlotId: 's2', quantity: 1 },
      ]);
      await expect(svc.cancel(r.id, staff2)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(svc.cancel(r.id, maker)).resolves.toMatchObject({
        status: RelocationStatus.CANCELLED,
      });
      // A cancelled request frees the row for a new one.
      await expect(
        create([{ stockItemId: 'st-avail', toSlotId: 's2', quantity: 1 }]),
      ).resolves.toBeTruthy();
    });
  });

  describe('complete (the only step that moves stock)', () => {
    async function approved(
      lines: { stockItemId: string; toSlotId: string; quantity: number }[],
    ) {
      const r = await create(lines);
      await svc.approve(r.id, checker);
      return r.id;
    }

    it('cannot complete before approval', async () => {
      const r = await create([
        { stockItemId: 'st-avail', toSlotId: 's2', quantity: 10 },
      ]);
      await expect(svc.complete(r.id, maker)).rejects.toThrow(
        /Only an approved/,
      );
      expect(row('st-avail').slotId).toBe('s1');
    });

    it('moves a whole row: same id, new slot and rack, audit + live event', async () => {
      const id = await approved([
        { stockItemId: 'st-avail', toSlotId: 's2', quantity: 10 },
      ]);
      const done = await svc.complete(id, maker);
      expect(done.status).toBe(RelocationStatus.COMPLETED);
      expect(row('st-avail')).toMatchObject({
        slotId: 's2',
        rackId: 'r1',
        quantity: 10,
        status: StockStatus.AVAILABLE,
      });
      expect(
        db.audit.filter((a: any) => a.action === 'STOCK_RELOCATED'),
      ).toHaveLength(1);
      expect(realtime.emitInventoryUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'relocated', warehouseId: WH }),
      );
    });

    it('moves part of a row: the moved part keeps the id, the rest stays behind with the same status', async () => {
      const id = await approved([
        { stockItemId: 'st-quar', toSlotId: 's2', quantity: 0.5 },
      ]);
      await svc.complete(id, maker);
      expect(row('st-quar')).toMatchObject({
        slotId: 's2',
        quantity: 0.5,
        status: StockStatus.QUARANTINE,
      });
      const rest = db.rows.find((r: Row) => r.id.startsWith('st-new-'))!;
      expect(rest).toMatchObject({
        slotId: 's1',
        quantity: 1.5,
        status: StockStatus.QUARANTINE,
      });
      expect(db.lines[0].remainderStockItemId).toBe(rest.id);
    });

    it('refuses when the row became reserved after approval (nothing moves)', async () => {
      const id = await approved([
        { stockItemId: 'st-avail', toSlotId: 's2', quantity: 10 },
      ]);
      row('st-avail').status = StockStatus.RESERVED;
      await expect(svc.complete(id, maker)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(row('st-avail').slotId).toBe('s1');
    });

    it('refuses when the row left its source slot or shrank', async () => {
      const id = await approved([
        { stockItemId: 'st-avail', toSlotId: 's2', quantity: 8 },
      ]);
      row('st-avail').quantity = 5;
      await expect(svc.complete(id, maker)).rejects.toThrow(/holds only 5/);
      row('st-avail').quantity = 10;
      row('st-avail').slotId = 'other';
      await expect(svc.complete(id, maker)).rejects.toThrow(
        /no longer in its source slot/,
      );
    });

    it('refuses while a cycle count holds the row', async () => {
      const id = await approved([
        { stockItemId: 'st-avail', toSlotId: 's2', quantity: 10 },
      ]);
      db.counted.add('st-avail');
      await expect(svc.complete(id, maker)).rejects.toThrow(/being counted/);
      expect(row('st-avail').slotId).toBe('s1');
    });

    it('a second complete is refused (status already claimed)', async () => {
      const id = await approved([
        { stockItemId: 'st-avail', toSlotId: 's2', quantity: 10 },
      ]);
      await svc.complete(id, maker);
      await expect(svc.complete(id, maker)).rejects.toThrow(/Only an approved/);
      expect(
        db.audit.filter((a: any) => a.action === 'STOCK_RELOCATED'),
      ).toHaveLength(1);
    });
  });
});
