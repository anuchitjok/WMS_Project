import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { WarehouseLayoutService } from './warehouse-layout.service';

// RQ13 — a floor plan is signed off before it counts as the agreed plan.
//
//   DRAFT     the working state: edits allowed
//   PENDING   waiting for a decision: edits refused
//   PUBLISHED approved; changing it drops it back to DRAFT
//
// The chain itself belongs to the shared approval engine (entityType
// 'WarehouseLayout'), which already refuses self-approval and may hold a plan at
// PENDING when a rule has more than one step. These tests pin the layout side of
// that contract: what the plan's own row ends up saying, and what is refused.

interface PlanRow {
  id: string; warehouseId: string; isDeleted: boolean; status: string;
  submittedAt: Date | null; submittedById: string | null;
  publishedAt: Date | null; publishedById: string | null; rejectedReason: string | null;
}

const LAYOUT: PlanRow = {
  id: 'L1', warehouseId: 'W1', isDeleted: false, status: 'DRAFT',
  submittedAt: null, submittedById: null, publishedAt: null, publishedById: null, rejectedReason: null,
};

function make(layout: Partial<PlanRow> = {}, approvalResult: any = { status: 'APPROVED' }, objectCount = 3) {
  const row = { ...LAYOUT, ...layout };
  const updates: any[] = [];
  const audits: any[] = [];
  const prisma: any = {
    warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'W1', code: 'WH-1', name: 'One', isActive: true }) },
    warehouseLayout: {
      findFirst: jest.fn().mockResolvedValue(row),
      update: jest.fn(async ({ data }: any) => { updates.push(data); return { ...row, ...data }; }),
    },
    layoutObject: { count: jest.fn().mockResolvedValue(objectCount), findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn(async ({ data }: any) => { audits.push(data); return data; }) },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  };
  const approval: any = {
    ensurePendingInstance: jest.fn().mockResolvedValue({ id: 'AI1', currentStep: 1, steps: [{ stepOrder: 1, status: 'PENDING' }] }),
    decide: jest.fn().mockResolvedValue(approvalResult),
    getByEntity: jest.fn().mockResolvedValue({ id: 'AI1', status: 'PENDING' }),
  };
  return { svc: new WarehouseLayoutService(prisma, approval), prisma, approval, updates, audits, row };
}

const actionsOf = (audits: any[]) => audits.map((a) => a.action);

describe('RQ13 — submitting a plan for approval', () => {
  it('moves a DRAFT plan to PENDING and starts the approval chain', async () => {
    const { svc, approval, updates, audits } = make();

    const res: any = await svc.submitForApproval('W1', 'u-drawer');

    expect(res.layout.status).toBe('PENDING');
    expect(updates[0]).toMatchObject({ status: 'PENDING', submittedById: 'u-drawer', rejectedReason: null });
    expect(updates[0].submittedAt).toBeInstanceOf(Date);
    expect(approval.ensurePendingInstance).toHaveBeenCalledWith('WarehouseLayout', 'L1', 'u-drawer');
    expect(actionsOf(audits)).toContain('LAYOUT_SUBMITTED');
  });

  it('refuses to send an empty plan', async () => {
    const { svc, approval, prisma } = make({}, undefined, 0);

    await expect(svc.submitForApproval('W1', 'u1')).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.warehouseLayout.update).not.toHaveBeenCalled();
    expect(approval.ensurePendingInstance).not.toHaveBeenCalled();
  });

  it('refuses a second submission while one is waiting', async () => {
    const { svc, prisma } = make({ status: 'PENDING' });
    await expect(svc.submitForApproval('W1', 'u1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.warehouseLayout.update).not.toHaveBeenCalled();
  });

  it('refuses to send an already approved plan — change it first', async () => {
    const { svc, prisma } = make({ status: 'PUBLISHED' });
    await expect(svc.submitForApproval('W1', 'u1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.warehouseLayout.update).not.toHaveBeenCalled();
  });
});

describe('RQ13 — a plan waiting for approval is frozen', () => {
  it('refuses an edit with LAYOUT_PENDING_APPROVAL', async () => {
    const { svc, prisma } = make({ status: 'PENDING' });
    prisma.layoutObject.findFirst = jest.fn().mockResolvedValue({ id: 'O1', layoutId: 'L1', isDeleted: false });

    await expect(svc.updateObject('O1', { name: 'moved' } as any, 'u1'))
      .rejects.toMatchObject({ response: { code: 'LAYOUT_PENDING_APPROVAL' } });
  });

  it('refuses the 3D "save positions" path too', async () => {
    const { svc } = make({ status: 'PENDING' });
    await expect(svc.saveRackPositions('W1', { version: 0, racks: [] } as any, 'u1'))
      .rejects.toBeInstanceOf(ConflictException);
  });
});

describe('RQ13 — editing an approved plan takes it back to DRAFT', () => {
  it('un-publishes on the first edit and says so in the audit log', async () => {
    const { svc, prisma, updates, audits } = make({ status: 'PUBLISHED', publishedById: 'u-boss', publishedAt: new Date() });
    prisma.layoutObject.findFirst = jest.fn().mockResolvedValue({ id: 'O1', layoutId: 'L1', isDeleted: false });
    prisma.layoutObject.update = jest.fn(async ({ data }: any) => ({ id: 'O1', layoutId: 'L1', ...data }));

    await svc.updateObject('O1', { name: 'moved' } as any, 'u1');

    expect(updates[0]).toMatchObject({ status: 'DRAFT', publishedAt: null, publishedById: null });
    expect(actionsOf(audits)).toContain('LAYOUT_UNPUBLISHED');
  });
});

describe('RQ13 — the decision', () => {
  it('publishes the plan when the whole chain is approved', async () => {
    const { svc, approval, updates, audits } = make({ status: 'PENDING', submittedById: 'u-drawer' }, { status: 'APPROVED' });

    const res: any = await svc.decideApproval('W1', true, 'looks right', 'u-boss');

    expect(approval.decide).toHaveBeenCalledWith('AI1', 1, 'u-boss', true, 'looks right', { internal: true });
    expect(res.layout.status).toBe('PUBLISHED');
    expect(updates[0]).toMatchObject({ status: 'PUBLISHED', publishedById: 'u-boss', rejectedReason: null });
    expect(actionsOf(audits)).toContain('LAYOUT_PUBLISHED');
  });

  it('sends a rejected plan back to DRAFT with the reason', async () => {
    const { svc, updates, audits } = make({ status: 'PENDING', submittedById: 'u-drawer' }, { status: 'REJECTED' });

    const res: any = await svc.decideApproval('W1', false, 'aisle too narrow', 'u-boss');

    expect(res.layout.status).toBe('DRAFT');
    expect(updates[0]).toMatchObject({ status: 'DRAFT', submittedAt: null, submittedById: null, rejectedReason: 'aisle too narrow' });
    expect(actionsOf(audits)).toContain('LAYOUT_REJECTED');
  });

  it('records a reason even when the approver gives none', async () => {
    const { svc, updates } = make({ status: 'PENDING' }, { status: 'REJECTED' });
    await svc.decideApproval('W1', false, '   ', 'u-boss');
    expect(updates[0].rejectedReason).toBe('Sent back without a reason');
  });

  it('leaves the plan PENDING when a rule has another step to go', async () => {
    const { svc, prisma } = make({ status: 'PENDING' }, { status: 'PENDING' });

    const res: any = await svc.decideApproval('W1', true, undefined, 'u-boss');

    expect(res.layout.status).toBe('PENDING');
    expect(prisma.warehouseLayout.update).not.toHaveBeenCalled();
  });

  it('refuses a decision on a plan that is not waiting', async () => {
    const { svc, approval } = make({ status: 'DRAFT' });
    await expect(svc.decideApproval('W1', true, undefined, 'u-boss')).rejects.toBeInstanceOf(ConflictException);
    expect(approval.decide).not.toHaveBeenCalled();
  });

  it('lets the engine refuse self-approval and leaves the plan alone', async () => {
    const { svc, prisma, approval } = make({ status: 'PENDING', submittedById: 'u-drawer' });
    approval.decide = jest.fn().mockRejectedValue(new ForbiddenException('You cannot approve an item you requested'));

    await expect(svc.decideApproval('W1', true, undefined, 'u-drawer')).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.warehouseLayout.update).not.toHaveBeenCalled();
  });
});

describe('RQ13 — reading a plan', () => {
  it('carries the approval chain so the screen can name who signed off', async () => {
    const { svc, approval } = make({ status: 'PUBLISHED' });

    const res: any = await svc.getByWarehouse('W1');

    expect(approval.getByEntity).toHaveBeenCalledWith('WarehouseLayout', 'L1');
    expect(res.approval).toMatchObject({ id: 'AI1' });
    expect(res.layout.status).toBe('PUBLISHED');
  });
});
