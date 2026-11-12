import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { checkPickPlan, rowProblem, isLockNotAvailable, lockPickRow, PICK_ERR, PickRow } from './request-picks';
import { RequestsService } from './requests.service';
import { ApproveRequestDto } from './dto/approve-request.dto';

// PR6 — pick locations chosen by the approver.

const LINES = [
  { id: 'L1', productId: 'P1', quantityRequested: 5 },
  { id: 'L2', productId: 'P2', quantityRequested: 1 },
];
const row = (id: string, over: Partial<PickRow> = {}): PickRow => ({
  id, productId: 'P1', status: 'AVAILABLE', quantity: 10, warehouseId: 'W1', serialNumber: null, countLocked: false, ...over,
});
const rows = (...rs: PickRow[]) => new Map(rs.map((r) => [r.id, r]));
const msg = (fn: () => unknown) => {
  try { fn(); } catch (e: any) { return { type: e.constructor.name, body: e.getResponse() }; }
  return null;
};

describe('checkPickPlan', () => {
  it('groups picks by line and returns their one warehouse', () => {
    const { byLine, warehouseId } = checkPickPlan(LINES, [
      { itemId: 'L1', stockItemId: 'a', qty: 3 },
      { itemId: 'L1', stockItemId: 'b', qty: 2 },
    ], rows(row('a'), row('b')), null);
    expect(byLine.get('L1')!.map((p) => p.stockItemId)).toEqual(['a', 'b']);
    expect(byLine.has('L2')).toBe(false); // L2 stays FIFO
    expect(warehouseId).toBe('W1');
  });

  it('Q3: a picked line must be covered in full (no silent FIFO top-up)', () => {
    const r = msg(() => checkPickPlan(LINES, [{ itemId: 'L1', stockItemId: 'a', qty: 4 }], rows(row('a')), null));
    expect(r?.type).toBe(BadRequestException.name);
    expect(r?.body).toMatchObject({ message: PICK_ERR.fullQty, picked: 4, approved: 5 });
    const over = msg(() => checkPickPlan(LINES, [{ itemId: 'L1', stockItemId: 'a', qty: 6 }], rows(row('a')), null));
    expect(over?.body).toMatchObject({ message: PICK_ERR.fullQty });
  });

  it('accepts fractional quantities that add up', () => {
    const lines = [{ id: 'L1', productId: 'P1', quantityRequested: 0.3 }];
    expect(() => checkPickPlan(lines, [
      { itemId: 'L1', stockItemId: 'a', qty: 0.1 },
      { itemId: 'L1', stockItemId: 'b', qty: 0.2 },
    ], rows(row('a'), row('b')), null)).not.toThrow();
  });

  it('Q2: refuses picks from two warehouses', () => {
    const r = msg(() => checkPickPlan(LINES, [
      { itemId: 'L1', stockItemId: 'a', qty: 4 },
      { itemId: 'L1', stockItemId: 'b', qty: 1 },
    ], rows(row('a'), row('b', { warehouseId: 'W2' })), null));
    expect(r?.body).toMatchObject({ message: PICK_ERR.oneWarehouse, stockItemId: 'b' });
  });

  it('refuses a line of another request, a row picked twice and a bad quantity', () => {
    expect(msg(() => checkPickPlan(LINES, [{ itemId: 'X', stockItemId: 'a', qty: 5 }], rows(row('a')), null))?.body)
      .toMatchObject({ message: PICK_ERR.unknownLine });
    expect(msg(() => checkPickPlan(LINES, [
      { itemId: 'L1', stockItemId: 'a', qty: 2 }, { itemId: 'L1', stockItemId: 'a', qty: 3 },
    ], rows(row('a')), null))?.body).toMatchObject({ message: PICK_ERR.duplicateRow });
    expect(msg(() => checkPickPlan(LINES, [{ itemId: 'L1', stockItemId: 'a', qty: 0 }], rows(row('a')), null))?.body)
      .toMatchObject({ message: PICK_ERR.badQty });
  });

  it('refuses rows that cannot serve the line, with the reason', () => {
    const cases: Array<[PickRow | null, string]> = [
      [null, 'NOT_FOUND'],
      [row('a', { productId: 'P9' }), 'WRONG_PRODUCT'],
      [row('a', { status: 'RESERVED' }), 'NOT_AVAILABLE'],
      [row('a', { countLocked: true }), 'COUNT_LOCKED'],
      [row('a', { quantity: 4 }), 'NOT_ENOUGH'],
    ];
    for (const [r, reason] of cases) {
      const out = msg(() => checkPickPlan(LINES, [{ itemId: 'L1', stockItemId: 'a', qty: 5 }], r ? rows(r) : rows(), null));
      expect(out?.type).toBe(BadRequestException.name);
      expect(out?.body).toMatchObject({ message: PICK_ERR.rowUnavailable, reason });
    }
  });

  it('checks warehouse scope before telling anything else about the row', () => {
    const scoped = { roleKey: 'WAREHOUSE_MANAGER', warehouseIds: ['W2'] };
    const out = msg(() => checkPickPlan(LINES, [{ itemId: 'L1', stockItemId: 'a', qty: 5 }], rows(row('a', { productId: 'P9' })), scoped));
    expect(out?.type).toBe(ForbiddenException.name);
    expect(out?.body).toMatchObject({ message: PICK_ERR.scope });
    // Unassigned users and SUPER_ADMIN are unrestricted (existing convention).
    expect(() => checkPickPlan(LINES, [{ itemId: 'L1', stockItemId: 'a', qty: 5 }], rows(row('a')), { roleKey: 'SUPER_ADMIN', warehouseIds: ['W2'] })).not.toThrow();
  });
});

describe('rowProblem', () => {
  it('a serial row is taken whole', () => {
    const serial = row('s', { quantity: 1, serialNumber: 'SN1' });
    expect(rowProblem(serial, 'P1', 1)).toBeNull();
    expect(rowProblem(serial, 'P1', 0.5)).toBe('SERIAL_WHOLE');
  });
});

describe('lockPickRow', () => {
  it('turns a held row (NOWAIT, 55P03) into 409 — never another row', async () => {
    const tx: any = { $queryRaw: jest.fn().mockRejectedValue(Object.assign(new Error('raw query failed'), { meta: { code: '55P03' } })) };
    await expect(lockPickRow(tx, 'a')).rejects.toBeInstanceOf(ConflictException);
    const other: any = { $queryRaw: jest.fn().mockRejectedValue(new Error('boom')) };
    await expect(lockPickRow(other, 'a')).rejects.toThrow('boom');
  });

  it('recognises the lock error in its usual shapes', () => {
    expect(isLockNotAvailable({ code: '55P03' })).toBe(true);
    expect(isLockNotAvailable(new Error('could not obtain lock on row in relation "StockItem"'))).toBe(true);
    expect(isLockNotAvailable(new Error('deadlock'))).toBe(false);
  });
});

describe('ApproveRequestDto picks', () => {
  it('is optional, and each pick needs ids and a positive number', async () => {
    expect(await validate(plainToInstance(ApproveRequestDto, { approved: true }))).toHaveLength(0);
    expect(await validate(plainToInstance(ApproveRequestDto, { approved: true, picks: [{ itemId: 'L1', stockItemId: 'a', qty: 2 }] }))).toHaveLength(0);
    const bad = await validate(plainToInstance(ApproveRequestDto, { approved: true, picks: [{ itemId: 'L1', qty: -1 }] }));
    expect(bad).toHaveLength(1);
  });
});

describe('RequestsService.approve with picks — refused before anything is recorded', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  function make(status = 'SUBMITTED', steps: Array<{ status: string }> = [{ status: 'PENDING' }]) {
    const prisma: any = { $transaction: jest.fn(), withdrawalRequest: { updateMany: jest.fn() } };
    const approval: any = {
      ensurePendingInstance: jest.fn().mockResolvedValue({ id: 'I1', steps }),
      decide: jest.fn(),
    };
    const svc = new RequestsService({} as any, prisma, { emitRequestUpdate: jest.fn() } as any, {} as any, approval, {} as any, {} as any);
    jest.spyOn(svc, 'findOne').mockResolvedValue({
      id: 'R1', status, requesterId: 'U-REQ', refNumber: 'WR-1', items: LINES,
    } as any);
    return { svc, prisma, approval };
  }
  const picks = [{ itemId: 'L1', stockItemId: 'a', qty: 5 }];

  it('rejecting with picks is refused', async () => {
    const { svc, prisma } = make();
    await expect(svc.approve('R1', 'U-APP', false, 'no', { picks })).rejects.toThrow(PICK_ERR.approveOnly);
    expect(prisma.withdrawalRequest.updateMany).not.toHaveBeenCalled();
  });

  it('ALLOCATION mode refuses picks (nothing is reserved at approval)', async () => {
    process.env.ENABLE_UNIFIED_RESERVATION = 'true';
    const { svc, prisma } = make();
    await expect(svc.approve('R1', 'U-APP', true, undefined, { picks })).rejects.toThrow(PICK_ERR.modeOnly);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('Q1: with the approval engine, only the final step may pick — and no step is decided', async () => {
    process.env.ENABLE_UNIFIED_RESERVATION = 'false';
    process.env.ENABLE_APPROVAL_ENGINE = 'true';
    const { svc, approval } = make('SUBMITTED', [{ status: 'PENDING' }, { status: 'PENDING' }]);
    await expect(svc.approve('R1', 'U-APP', true, undefined, { picks })).rejects.toThrow(PICK_ERR.finalStepOnly);
    expect(approval.decide).not.toHaveBeenCalled();
  });

  it('a bad plan is refused before the engine records the decision', async () => {
    process.env.ENABLE_UNIFIED_RESERVATION = 'false';
    process.env.ENABLE_APPROVAL_ENGINE = 'true';
    const { svc, prisma, approval } = make('SUBMITTED', [{ status: 'APPROVED' }, { status: 'PENDING' }]);
    prisma.$queryRaw = jest.fn().mockResolvedValue([{ ...row('a'), quantity: 2 }]);
    await expect(svc.approve('R1', 'U-APP', true, undefined, { picks })).rejects.toThrow(PICK_ERR.rowUnavailable);
    expect(approval.decide).not.toHaveBeenCalled();
  });
});
