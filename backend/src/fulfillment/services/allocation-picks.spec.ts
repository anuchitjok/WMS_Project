import { ConflictException } from '@nestjs/common';
import { AllocationService } from './allocation.service';
import { PICK_ERR } from '../../requests/request-picks';

// PR6 Q5 — allocation stops when a row chosen at approval is no longer what was reserved.

function svc(row: Record<string, unknown> | undefined) {
  const tx: any = { $queryRaw: jest.fn().mockResolvedValue(row ? [row] : []) };
  const s = new AllocationService({} as any, {} as any, {} as any);
  const lock = (picks: Array<{ stockItemId: string; quantity: number }>) => (s as any).lockChosenRows(tx, 'R1', picks);
  return { lock };
}
const ok = { id: 'a', quantity: 2, status: 'RESERVED', claimed: false };

describe('AllocationService.lockChosenRows (Q5)', () => {
  it('returns the chosen row when it is still reserved for this request', async () => {
    await expect(svc(ok).lock([{ stockItemId: 'a', quantity: 2 }])).resolves.toEqual([{ id: 'a', quantity: 2 }]);
  });

  it.each([
    ['missing', undefined],
    ['now AVAILABLE', { ...ok, status: 'AVAILABLE' }],
    ['held by another task', { ...ok, claimed: true }],
    ['quantity changed (1 ≠ 2)', { ...ok, quantity: 1 }],
  ])('stops with 409 when the row is %s', async (reason, row) => {
    const err = await svc(row as any).lock([{ stockItemId: 'a', quantity: 2 }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ message: PICK_ERR.notHonoured, stockItemId: 'a', reason });
  });
});
