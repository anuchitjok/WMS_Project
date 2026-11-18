import { RequestStatus } from '@prisma/client';
import { RmaService } from './rma.service';
import { ACCESS, hasAccess } from '../auth/access';

// RQ23 "My Issued Items shows nothing". The queue read is a rule, not a query:
// who it covers must not change, and an empty list has to say which empty it is.
// Prisma and the access helper are mocked — no database is needed.

jest.mock('../auth/access', () => {
  const actual = jest.requireActual('../auth/access');
  return { ...actual, hasAccess: jest.fn(() => false) };
});

const access = hasAccess as unknown as jest.Mock;

const THREE = [RequestStatus.ISSUED_TO_RMA, RequestStatus.SHIPPED, RequestStatus.READY_FOR_PICKUP];
const USER = { id: 'u1', role: 'REQUESTER' };
const ROW = { id: 'R1', refNumber: 'WR-2026-0001', status: RequestStatus.ISSUED_TO_RMA };

function db(rows: any[], othersPending = 0) {
  return {
    withdrawalRequest: {
      findMany: jest.fn(async () => rows),
      count: jest.fn(async () => othersPending),
    },
  };
}

const svc = (prisma: any) => new RmaService(prisma as any, { emitRequestUpdate: jest.fn() } as any);
const whereOf = (prisma: any) => prisma.withdrawalRequest.findMany.mock.calls[0][0].where;

beforeEach(() => {
  access.mockReset();
  access.mockReturnValue(false);
});

describe('pendingUsage — scope', () => {
  it('reads every requester when the viewer may confirm on behalf of others', async () => {
    access.mockReturnValue(true);
    const prisma = db([ROW]);
    const res = await svc(prisma).pendingUsage(USER);

    expect(access).toHaveBeenCalledWith(USER, ACCESS.rmaUsageOnBehalf);
    expect(res.scope).toBe('all');
    expect(whereOf(prisma)).not.toHaveProperty('requesterId');
    expect(res.rows).toEqual([ROW]);
  });

  it('reads only the viewer’s own requests without that access', async () => {
    const prisma = db([ROW]);
    const res = await svc(prisma).pendingUsage(USER);

    expect(res.scope).toBe('own');
    expect(whereOf(prisma).requesterId).toBe('u1');
  });

  it('reads every requester for an internal call with no principal', async () => {
    const prisma = db([]);
    const res = await svc(prisma).pendingUsage();

    expect(res.scope).toBe('all');
    expect(whereOf(prisma)).not.toHaveProperty('requesterId');
    expect(prisma.withdrawalRequest.count).not.toHaveBeenCalled();
  });
});

describe('pendingUsage — status filter', () => {
  it.each([
    ['all', true],
    ['own', false],
  ])('covers exactly the three awaiting-usage statuses (scope %s)', async (_scope, onBehalf) => {
    access.mockReturnValue(onBehalf);
    const prisma = db([ROW]);
    await svc(prisma).pendingUsage(USER);

    expect(whereOf(prisma).status).toEqual({ in: THREE });
    expect(whereOf(prisma).status.in).toHaveLength(3);
  });
});

describe('pendingUsage — empty-case signal', () => {
  it('says others are waiting when the viewer’s own list is empty but the system is not', async () => {
    const prisma = db([], 2);
    const res = await svc(prisma).pendingUsage(USER);

    expect(res.scope).toBe('own');
    expect(res.pendingElsewhere).toBe(true);
    expect(prisma.withdrawalRequest.count).toHaveBeenCalledWith({
      where: { status: { in: THREE }, requesterId: { not: 'u1' } },
    });
  });

  it('says nobody is waiting when neither the viewer nor anyone else has any', async () => {
    const prisma = db([], 0);
    const res = await svc(prisma).pendingUsage(USER);

    expect(res.pendingElsewhere).toBe(false);
  });

  it('leaves the signal undetermined when the viewer’s own list is not empty', async () => {
    const prisma = db([ROW]);
    const res = await svc(prisma).pendingUsage(USER);

    expect(res.pendingElsewhere).toBeNull();
    expect(prisma.withdrawalRequest.count).not.toHaveBeenCalled();
  });

  it('leaves the signal undetermined for an on-behalf viewer — their empty list is the whole system', async () => {
    access.mockReturnValue(true);
    const prisma = db([]);
    const res = await svc(prisma).pendingUsage(USER);

    expect(res.scope).toBe('all');
    expect(res.pendingElsewhere).toBeNull();
    expect(prisma.withdrawalRequest.count).not.toHaveBeenCalled();
  });
});
