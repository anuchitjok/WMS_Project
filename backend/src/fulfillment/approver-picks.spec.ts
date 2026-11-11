import { approverPickedRows, firstTaskByRequest, openPickRows } from './approver-picks';
import { buildSlipRows } from '../documents/picking-slip-data';

// PR6 "Selected by Approver" label — read-only rule.

const d = (s: string) => new Date(`2026-11-11T${s}Z`);

function db(picks: Array<{ stockItemId: string; releasedAt: Date | null; requestId: string }>, tasks: Array<{ id: string; requestId: string; createdAt: Date }>) {
  return {
    withdrawalRequestPick: {
      findMany: jest.fn(async ({ where }: any) => picks
        .filter((p) => (where.releasedAt === null ? p.releasedAt === null : p.releasedAt !== null))
        .filter((p) => (where.requestItem.requestId.in ? where.requestItem.requestId.in.includes(p.requestId) : where.requestItem.requestId === p.requestId))
        .map((p) => ({ stockItemId: p.stockItemId, releasedAt: p.releasedAt, requestItem: { requestId: p.requestId } }))),
    },
    fulfillmentTask: {
      findMany: jest.fn(async ({ where }: any) => tasks.filter((t) => where.requestId.in.includes(t.requestId))),
    },
  };
}

describe('firstTaskByRequest', () => {
  it('keeps the earliest task per request', () => {
    const m = firstTaskByRequest([
      { id: 'T2', requestId: 'R1', createdAt: d('10:00:00') },
      { id: 'T1', requestId: 'R1', createdAt: d('09:00:00') },
      { id: 'T3', requestId: 'R2', createdAt: d('11:00:00') },
    ]);
    expect(m.get('R1')).toBe('T1');
    expect(m.get('R2')).toBe('T3');
  });
});

describe('approverPickedRows', () => {
  it('marks the rows the approver chose on the first task only', async () => {
    const x = db(
      [{ stockItemId: 'S1', releasedAt: d('09:00:01'), requestId: 'R1' }],
      [{ id: 'T1', requestId: 'R1', createdAt: d('09:00:00') }, { id: 'T2', requestId: 'R1', createdAt: d('12:00:00') }],
    );
    const out = await approverPickedRows(x as any, [{ id: 'T1', requestId: 'R1' }, { id: 'T2', requestId: 'R1' }]);
    expect([...out.get('T1')!]).toEqual(['S1']);
    // A re-allocation after a cancelled task went FIFO, even if it reuses the row.
    expect(out.get('T2')!.size).toBe(0);
  });

  it('FIFO requests are untouched (no task lookup when there are no picks)', async () => {
    const x = db([], [{ id: 'T1', requestId: 'R1', createdAt: d('09:00:00') }]);
    const out = await approverPickedRows(x as any, [{ id: 'T1', requestId: 'R1' }]);
    expect(out.get('T1')!.size).toBe(0);
    expect(x.fulfillmentTask.findMany).not.toHaveBeenCalled();
  });

  it('before allocation, only open picks count', async () => {
    const x = db([
      { stockItemId: 'S1', releasedAt: null, requestId: 'R1' },
      { stockItemId: 'S2', releasedAt: d('09:00:00'), requestId: 'R1' },
    ], []);
    expect([...(await openPickRows(x as any, 'R1'))]).toEqual(['S1']);
  });
});

describe('buildSlipRows selectedByApprover', () => {
  const product = { code: 'P1', name: 'Part' };
  it('is true only for rows the approver chose', () => {
    const rows = buildSlipRows([], [
      { product, qtyRequested: 1, stockItem: { id: 'S1' } },
      { product, qtyRequested: 1, stockItem: { id: 'S2' } },
      { product, qtyRequested: 1, stockItem: null },
    ], new Set(['S1']));
    expect(rows.map((r) => r.selectedByApprover)).toEqual([true, false, false]);
  });

  it('defaults to false (FIFO slips unchanged)', () => {
    const rows = buildSlipRows([{ product, quantityRequested: 2, stockItem: { id: 'S1' } }]);
    expect(rows[0].selectedByApprover).toBe(false);
  });
});
