import { RequestStatus, UserRole } from '@prisma/client';
import { Fixture, TestUser, expectStatus } from './harness';

// Phase 2: separation of duties on every approval, and the approval engine's
// own authorization (step role, order, self/duplicate approval, direct-API bypass).

describe('Separation of duties and approval engine', () => {
  let fx: Fixture;
  let requester: TestUser,
    manager: TestUser,
    manager2: TestUser,
    staff: TestUser,
    superAdmin: TestUser;

  beforeAll(async () => {
    fx = await Fixture.start();
    requester = await fx.user(UserRole.REQUESTER, 'REQUESTER');
    manager = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WAREHOUSE_MANAGER');
    manager2 = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WAREHOUSE_MANAGER');
    staff = await fx.user(UserRole.WAREHOUSE_STAFF);
    superAdmin = await fx.user(UserRole.SYSTEM_ADMIN, 'SUPER_ADMIN');
  });
  afterAll(async () => {
    await fx.stop();
  });

  async function submittedRequest(
    by: TestUser,
    productId: string,
    quantity = 1,
  ) {
    const created = await fx
      .as(by)
      .post('/requests', {
        rmaCaseNumber: fx.uid('RMA'),
        items: [{ productId, quantity }],
      });
    expectStatus(created, 201);
    expectStatus(
      await fx.as(by).patch(`/requests/${created.body.id}/submit`),
      200,
    );
    return created.body.id as string;
  }

  describe('maker ≠ checker', () => {
    it('a requester-approver cannot approve their own withdrawal request, a colleague can', async () => {
      const product = await fx.product();
      await fx.stock(product.id, 1);
      const id = await submittedRequest(manager, product.id);
      await fx
        .as(manager)
        .patch(`/requests/${id}/approve`, { approved: true })
        .expect(403);
      expect(
        (await fx.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id } }))
          .status,
      ).toBe(RequestStatus.SUBMITTED);
      expectStatus(
        await fx
          .as(manager2)
          .patch(`/requests/${id}/approve`, { approved: true }),
        200,
      );
    });

    it('SUPER_ADMIN is not exempt (no self-approval exception is defined)', async () => {
      const product = await fx.product();
      await fx.stock(product.id, 1);
      const id = await submittedRequest(superAdmin, product.id);
      await fx
        .as(superAdmin)
        .patch(`/requests/${id}/approve`, { approved: true })
        .expect(403);
    });

    it('the creator of a stock adjustment cannot approve it', async () => {
      const product = await fx.product();
      const [row] = await fx.stock(product.id, 1, {
        quantity: 5,
        serial: false,
      });
      const adj = await fx
        .as(manager)
        .post('/adjustment', {
          stockItemId: row.id,
          productLabel: 'x',
          reason: 'correction',
          quantityBefore: 5,
          quantityAfter: 4,
        });
      expectStatus(adj, 201);
      await fx
        .as(manager)
        .patch(`/adjustment/${adj.body.id}/approve`)
        .expect(403);
      expect(
        (await fx.prisma.stockItem.findUniqueOrThrow({ where: { id: row.id } }))
          .quantity,
      ).toBe(5);
      expectStatus(
        await fx.as(manager2).patch(`/adjustment/${adj.body.id}/approve`),
        200,
      );
      expect(
        (await fx.prisma.stockItem.findUniqueOrThrow({ where: { id: row.id } }))
          .quantity,
      ).toBe(4);
    });

    it('whoever counted a cycle-count line cannot approve its variances', async () => {
      const loc = await fx.location();
      const product = await fx.product();
      await fx.stock(product.id, 1, {
        quantity: 5,
        serial: false,
        warehouseId: loc.warehouse.id,
        rackId: loc.rack.id,
        slotId: loc.slot.id,
      });
      const created = await fx
        .as(manager)
        .post('/cycle-count', { warehouseId: loc.warehouse.id });
      expectStatus(created, 201);
      for (const line of created.body.lines) {
        expectStatus(
          await fx
            .as(manager)
            .patch(`/cycle-count/${created.body.id}/lines/${line.id}/count`, {
              countedQty: 4,
            }),
          200,
        );
      }
      expectStatus(
        await fx.as(manager).post(`/cycle-count/${created.body.id}/submit`),
        201,
      );
      await fx
        .as(manager)
        .post(`/cycle-count/${created.body.id}/approve`)
        .expect(403);
      expectStatus(
        await fx.as(manager2).post(`/cycle-count/${created.body.id}/approve`),
        201,
      );
    });

    it('the requester of a scrap case cannot approve it', async () => {
      const product = await fx.product();
      const [unit] = await fx.stock(product.id, 1);
      const res = await fx
        .as(manager)
        .post('/scrap', { stockItemId: unit.id, reason: 'broken' });
      expectStatus(res, 201);
      await fx
        .as(manager)
        .patch(`/scrap/${res.body.id}/status`, { status: 'APPROVED' })
        .expect(403);
      expectStatus(
        await fx
          .as(manager2)
          .patch(`/scrap/${res.body.id}/status`, { status: 'APPROVED' }),
        200,
      );
    });
  });

  describe('approval engine (ENABLE_APPROVAL_ENGINE=true)', () => {
    let ruleId: string;
    let approverRole: string;

    beforeAll(async () => {
      process.env.ENABLE_APPROVAL_ENGINE = 'true';
      // Second-step role: holds request.approve, distinct from WAREHOUSE_MANAGER.
      const perm = await fx.prisma.permission.findUniqueOrThrow({
        where: { code: 'request.approve' },
      });
      approverRole = 'DEPT_HEAD';
      await fx.prisma.role.create({
        data: {
          key: approverRole,
          name: 'Dept head',
          permissions: { create: [{ permissionId: perm.id }] },
        },
      });
    });
    afterAll(() => {
      process.env.ENABLE_APPROVAL_ENGINE = 'false';
    });

    it('rule validation rejects unsafe or ambiguous definitions', async () => {
      await fx
        .as(superAdmin)
        .post('/approvals/rules', {
          name: 'x',
          entityType: 'WithdrawalRequest',
          steps: [],
        })
        .expect(400);
      await fx
        .as(superAdmin)
        .post('/approvals/rules', {
          name: 'x',
          entityType: 'Nope',
          steps: [{ roleKey: 'WAREHOUSE_MANAGER', stepName: 'a' }],
        })
        .expect(400);
      await fx
        .as(superAdmin)
        .post('/approvals/rules', {
          name: 'x',
          entityType: 'WithdrawalRequest',
          steps: [{ roleKey: 'NO_SUCH', stepName: 'a' }],
        })
        .expect(400);
      // REQUESTER role lacks request.approve → nobody could ever pass the step
      await fx
        .as(superAdmin)
        .post('/approvals/rules', {
          name: 'x',
          entityType: 'WithdrawalRequest',
          steps: [{ roleKey: 'REQUESTER', stepName: 'a' }],
        })
        .expect(400);
      await fx
        .as(superAdmin)
        .post('/approvals/rules', {
          name: 'x',
          entityType: 'WithdrawalRequest',
          steps: [
            { roleKey: 'WAREHOUSE_MANAGER', stepName: 'a', stepOrder: 1 },
            { roleKey: approverRole, stepName: 'b', stepOrder: 1 },
          ],
        })
        .expect(400);
      await fx
        .as(superAdmin)
        .post('/approvals/rules', {
          name: 'x',
          entityType: 'WithdrawalRequest',
          conditions: { minValue: 1000 },
          steps: [{ roleKey: 'WAREHOUSE_MANAGER', stepName: 'a' }],
        })
        .expect(400);
    });

    it('only rule administrators can create rules', async () => {
      await fx
        .as(manager)
        .post('/approvals/rules', {
          name: 'x',
          entityType: 'WithdrawalRequest',
          steps: [{ roleKey: 'WAREHOUSE_MANAGER', stepName: 'a' }],
        })
        .expect(403);
    });

    it('creates a two-step rule and refuses a second active rule at the same priority', async () => {
      const res = await fx.as(superAdmin).post('/approvals/rules', {
        name: 'Two-step',
        entityType: 'WithdrawalRequest',
        priority: 10,
        steps: [
          { roleKey: 'WAREHOUSE_MANAGER', stepName: 'Warehouse' },
          { roleKey: approverRole, stepName: 'Department' },
        ],
      });
      expectStatus(res, 201);
      ruleId = res.body.id;
      expect(res.body.steps.map((s: any) => s.stepOrder)).toEqual([1, 2]);
      await fx
        .as(superAdmin)
        .post('/approvals/rules', {
          name: 'dup',
          entityType: 'WithdrawalRequest',
          priority: 10,
          steps: [{ roleKey: 'WAREHOUSE_MANAGER', stepName: 'a' }],
        })
        .expect(400);
    });

    it('enforces step role, order, and distinct approvers; direct API decisions are refused', async () => {
      const product = await fx.product();
      await fx.stock(product.id, 1);
      const id = await submittedRequest(requester, product.id);
      const deptHead = await fx.user(UserRole.DEPT_APPROVER, approverRole);

      // Step 1 needs WAREHOUSE_MANAGER: the dept head cannot take it out of order
      await fx
        .as(deptHead)
        .patch(`/requests/${id}/approve`, { approved: true })
        .expect(403);
      expectStatus(
        await fx
          .as(manager)
          .patch(`/requests/${id}/approve`, { approved: true }),
        200,
      );
      expect(
        (await fx.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id } }))
          .status,
      ).toBe(RequestStatus.PENDING_APPROVAL);

      // The same manager cannot also take step 2 (and lacks its role anyway)
      await fx
        .as(manager)
        .patch(`/requests/${id}/approve`, { approved: true })
        .expect(403);

      // Bypass attempt through the generic engine endpoint
      const instance = await fx.prisma.approvalInstance.findFirstOrThrow({
        where: { entityType: 'WithdrawalRequest', entityId: id },
      });
      await fx
        .as(manager)
        .patch(`/approvals/${instance.id}/step/2/decide`, { approved: true })
        .expect(400);
      await fx
        .as(manager)
        .post('/approvals/start', {
          entityType: 'WithdrawalRequest',
          entityId: id,
        })
        .expect(400);

      expectStatus(
        await fx
          .as(deptHead)
          .patch(`/requests/${id}/approve`, { approved: true }),
        200,
      );
      expect(
        (await fx.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id } }))
          .status,
      ).toBe(RequestStatus.APPROVED);
      const steps = await fx.prisma.approvalInstanceStep.findMany({
        where: { instanceId: instance.id },
        orderBy: { stepOrder: 'asc' },
      });
      expect(steps.map((s) => [s.status, s.actorId])).toEqual([
        ['APPROVED', manager.id],
        ['APPROVED', deptHead.id],
      ]);
    });

    it('concurrent decisions on one step: exactly one wins', async () => {
      const product = await fx.product();
      await fx.stock(product.id, 1);
      const id = await submittedRequest(requester, product.id);
      const results = await Promise.all([
        fx.as(manager).patch(`/requests/${id}/approve`, { approved: true }),
        fx.as(manager2).patch(`/requests/${id}/approve`, { approved: true }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409].sort());
      // One live chain, step 1 approved once; any racing duplicate was cancelled.
      const live = await fx.prisma.approvalInstance.findMany({
        where: {
          entityType: 'WithdrawalRequest',
          entityId: id,
          status: 'PENDING',
        },
        include: { steps: true },
      });
      expect(live).toHaveLength(1);
      expect(live[0].steps.find((s) => s.stepOrder === 1)!.status).toBe(
        'APPROVED',
      );
    });

    it('disabling the rule falls back to the single default step', async () => {
      expectStatus(
        await fx
          .as(superAdmin)
          .patch(`/approvals/rules/${ruleId}/active`, { isActive: false }),
        200,
      );
      const product = await fx.product();
      await fx.stock(product.id, 1);
      const id = await submittedRequest(requester, product.id);
      expectStatus(
        await fx
          .as(manager)
          .patch(`/requests/${id}/approve`, { approved: true }),
        200,
      );
      expect(
        (await fx.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id } }))
          .status,
      ).toBe(RequestStatus.APPROVED);
    });
  });

  describe('engine disabled (default)', () => {
    it('legacy single-click approval still works', async () => {
      const product = await fx.product();
      await fx.stock(product.id, 1);
      const id = await submittedRequest(requester, product.id);
      expectStatus(
        await fx
          .as(manager)
          .patch(`/requests/${id}/approve`, { approved: true }),
        200,
      );
      expect(
        await fx.prisma.approvalInstance.count({ where: { entityId: id } }),
      ).toBe(0);
    });
  });
});
