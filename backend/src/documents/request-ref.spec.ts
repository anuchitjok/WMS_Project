import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { decideConfirm, receiptState, resolveRefView } from './request-ref';
import { RequestRefService } from './request-ref.service';

describe('request QR rules (plan P5 5.3)', () => {
  describe('receiptState', () => {
    it.each([
      ['APPROVED', null, 'NOT_READY'],
      ['PICKING', 'PICKING', 'NOT_READY'],
      ['PICKING', 'PACKED', 'NOT_READY'],
      ['PICKING', 'READY_TO_SHIP', 'READY'],
      ['PICKING', 'SHIPPED', 'READY'],
      ['PICKING', 'DELIVERED', 'READY'],
      ['ISSUED_TO_RMA', 'CLOSED', 'RECEIVED'],
      ['COMPLETED', null, 'RECEIVED'],
      ['CANCELLED', 'READY_TO_SHIP', 'CANCELLED'],
      ['REJECTED', null, 'CANCELLED'],
    ])('%s / task %s → %s', (req, task, expected) => {
      expect(receiptState(req, task)).toBe(expected);
    });
  });

  describe('resolveRefView', () => {
    it('warehouse user gets the pick list', () => {
      expect(resolveRefView({ isOwner: false, isWarehouse: true })).toEqual({ view: 'WAREHOUSE', canReceive: false, canPick: true });
    });
    it('owner gets the receipt view', () => {
      expect(resolveRefView({ isOwner: true, isWarehouse: false })).toEqual({ view: 'REQUESTER', canReceive: true, canPick: false });
    });
    it('owner who is also warehouse can do both', () => {
      expect(resolveRefView({ isOwner: true, isWarehouse: true })).toEqual({ view: 'WAREHOUSE', canReceive: true, canPick: true });
    });
    it('anyone else sees nothing', () => {
      expect(resolveRefView({ isOwner: false, isWarehouse: false })).toEqual({ view: 'NONE', canReceive: false, canPick: false });
    });
  });

  describe('decideConfirm', () => {
    const ready = { status: 'READY_TO_SHIP', version: 4 };
    it('owner only', () => {
      expect(decideConfirm({ isOwner: false, requestStatus: 'PICKING', task: ready })).toEqual({ action: 'REJECT', reason: 'NOT_OWNER' });
    });
    it('only when handover is allowed', () => {
      expect(decideConfirm({ isOwner: true, requestStatus: 'PICKING', task: { status: 'PICKING', version: 1 } }))
        .toEqual({ action: 'REJECT', reason: 'NOT_READY' });
      expect(decideConfirm({ isOwner: true, requestStatus: 'APPROVED', task: null })).toEqual({ action: 'REJECT', reason: 'NO_TASK' });
      expect(decideConfirm({ isOwner: true, requestStatus: 'CANCELLED', task: ready })).toEqual({ action: 'REJECT', reason: 'CANCELLED' });
    });
    it('second press is a no-op', () => {
      expect(decideConfirm({ isOwner: true, requestStatus: 'ISSUED_TO_RMA', task: { status: 'CLOSED', version: 6 } })).toEqual({ action: 'ALREADY_DONE' });
    });
    it('optimistic lock on the task version', () => {
      expect(decideConfirm({ isOwner: true, requestStatus: 'PICKING', task: ready, expectedVersion: 3 })).toEqual({ action: 'REJECT', reason: 'STALE' });
      expect(decideConfirm({ isOwner: true, requestStatus: 'PICKING', task: ready, expectedVersion: 4 })).toEqual({ action: 'HANDOVER' });
      expect(decideConfirm({ isOwner: true, requestStatus: 'PICKING', task: ready })).toEqual({ action: 'HANDOVER' });
    });
  });
});

describe('RequestRefService.confirmReceipt', () => {
  type Task = { id: string; status: string; version: number };
  function setup(opts: { requesterId?: string; requestStatus?: string; task?: Task | null; handoverError?: Error } = {}) {
    let task: Task | null = opts.task === undefined ? { id: 't1', status: 'READY_TO_SHIP', version: 4 } : opts.task;
    let reqStatus = opts.requestStatus ?? 'PICKING';
    const prisma: any = {
      withdrawalRequest: {
        findUnique: jest.fn(async () => ({
          id: 'r1', refNumber: 'REQ-1', requesterId: opts.requesterId ?? 'u-req', status: reqStatus,
          deliveryMethod: null, department: 'IT', requester: { id: 'u-req', fullName: 'Jane Requester', department: 'IT' },
          approver: null, items: [],
        })),
      },
      fulfillmentTask: {
        findFirst: jest.fn(async () => (task ? { ...task, refNumber: 'FT-1', warehouseId: 'wh1', pickedById: null, items: [] } : null)),
        findUnique: jest.fn(async () => (task ? { status: task.status } : null)),
      },
      stockItem: { findMany: jest.fn(async () => []) },
      user: { findUnique: jest.fn(async () => null) },
    };
    const handover: any = {
      issueToRma: jest.fn(async () => {
        if (opts.handoverError) { task = { ...task!, status: 'CLOSED' }; throw opts.handoverError; }
        task = { ...task!, status: 'CLOSED', version: task!.version + 1 };
        reqStatus = 'ISSUED_TO_RMA';
        return {};
      }),
    };
    return { svc: new RequestRefService(prisma, handover), handover, prisma };
  }
  const requester = { id: 'u-req', fullName: 'Jane Requester', role: 'REQUESTER' };

  it('runs the existing handover once with the requester as receiver', async () => {
    const { svc, handover } = setup();
    await expect(svc.confirmReceipt('REQ-1', requester, 4)).resolves.toEqual({ alreadyConfirmed: false, receiptState: 'RECEIVED' });
    expect(handover.issueToRma).toHaveBeenCalledTimes(1);
    expect(handover.issueToRma).toHaveBeenCalledWith('t1', { receiver: 'Jane Requester' }, 'u-req');
  });

  it('is idempotent: a second press does not hand over again', async () => {
    const { svc, handover } = setup();
    await svc.confirmReceipt('REQ-1', requester);
    await expect(svc.confirmReceipt('REQ-1', requester)).resolves.toEqual({ alreadyConfirmed: true, receiptState: 'RECEIVED' });
    expect(handover.issueToRma).toHaveBeenCalledTimes(1);
  });

  it('a concurrent press that loses the status claim reports already confirmed', async () => {
    const { svc } = setup({ handoverError: new ConflictException('Task is CLOSED') });
    await expect(svc.confirmReceipt('REQ-1', requester)).resolves.toEqual({ alreadyConfirmed: true, receiptState: 'RECEIVED' });
  });

  it('refuses anyone but the requester — even warehouse admins', async () => {
    const { svc, handover } = setup();
    await expect(svc.confirmReceipt('REQ-1', { id: 'admin', roleKey: 'SUPER_ADMIN' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(handover.issueToRma).not.toHaveBeenCalled();
  });

  it('refuses before the items are ready', async () => {
    const { svc, handover } = setup({ task: { id: 't1', status: 'PICKING', version: 1 } });
    await expect(svc.confirmReceipt('REQ-1', requester)).rejects.toBeInstanceOf(BadRequestException);
    expect(handover.issueToRma).not.toHaveBeenCalled();
  });

  it('refuses a stale page (version changed)', async () => {
    const { svc, handover } = setup();
    await expect(svc.confirmReceipt('REQ-1', requester, 2)).rejects.toBeInstanceOf(ConflictException);
    expect(handover.issueToRma).not.toHaveBeenCalled();
  });
});

describe('RequestRefService.view', () => {
  function svcWith(requesterId: string, taskWarehouse = 'wh1') {
    const prisma: any = {
      withdrawalRequest: {
        findUnique: jest.fn(async () => ({
          id: 'r1', refNumber: 'REQ-1', requesterId, status: 'PICKING', deliveryMethod: 'SHIP', department: 'IT',
          createdAt: new Date(), requester: { id: requesterId, fullName: 'Jane', department: 'IT' }, approver: null,
          items: [{ product: { code: 'SKU-1', name: 'Drive' }, quantityRequested: 1, stockItem: null }],
        })),
      },
      fulfillmentTask: {
        findFirst: jest.fn(async () => ({
          id: 't1', refNumber: 'FT-1', status: 'PICKING', version: 2, warehouseId: taskWarehouse, pickedById: 'u-wh',
          items: [{ product: { code: 'SKU-1', name: 'Drive' }, qtyRequested: 1, stockItemId: 's1' }],
        })),
      },
      stockItem: { findMany: jest.fn(async () => [{ id: 's1', serialNumber: 'SN1', warehouse: { id: taskWarehouse, code: 'WH1' }, rack: { code: 'A01' }, slot: { code: 'A01-01-02' }, goodsReceivingItems: [] }]) },
      user: { findUnique: jest.fn(async () => ({ fullName: 'Pete Picker' })) },
    };
    return new RequestRefService(prisma, {} as any);
  }

  it('warehouse staff in scope see locations and the picker', async () => {
    const v: any = await svcWith('someone').view('REQ-1', { id: 'u-wh', role: 'WAREHOUSE_STAFF', warehouseIds: ['wh1'] });
    expect(v.view).toBe('WAREHOUSE');
    expect(v.deliveryMethod).toBe('SHIP');
    expect(v.pickerName).toBe('Pete Picker');
    expect(v.items[0].location).toEqual({ warehouse: 'WH1', bin: 'A01-01-02' });
    expect(v.task).toEqual({ id: 't1', refNumber: 'FT-1', status: 'PICKING', version: 2 });
  });

  it('warehouse staff outside the warehouse scope see nothing', async () => {
    const v: any = await svcWith('someone', 'wh2').view('REQ-1', { id: 'u-wh', role: 'WAREHOUSE_STAFF', warehouseIds: ['wh1'] });
    expect(v).toEqual({ view: 'NONE', canReceive: false, canPick: false, refNumber: 'REQ-1' });
  });

  it('requester sees items without pick locations', async () => {
    const v: any = await svcWith('u-req').view('REQ-1', { id: 'u-req', role: 'REQUESTER' });
    expect(v.view).toBe('REQUESTER');
    expect(v.canReceive).toBe(true);
    expect(v.items[0].location).toBeNull();
    expect(v.receiptState).toBe('NOT_READY');
  });

  it('other users get a NONE view without request data', async () => {
    const v: any = await svcWith('u-req').view('REQ-1', { id: 'other', role: 'REQUESTER' });
    expect(v).toEqual({ view: 'NONE', canReceive: false, canPick: false, refNumber: 'REQ-1' });
  });
});
