import { StockStatus, UserRole } from '@prisma/client';
import { Fixture, TestUser, expectStatus } from './harness';

// Receiving-to-RMA outbound chain through the real API, including the concurrent
// double-clicks that used to double-reserve, double-allocate and double-issue.

describe('Outbound flow: approve → allocate → pick → pack → ship → handover → usage', () => {
  let fx: Fixture;
  let requester: TestUser, otherRequester: TestUser, manager: TestUser, staff: TestUser;

  beforeAll(async () => {
    fx = await Fixture.start();
    requester = await fx.user(UserRole.REQUESTER, 'REQUESTER');
    otherRequester = await fx.user(UserRole.REQUESTER, 'REQUESTER');
    manager = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WAREHOUSE_MANAGER');
    staff = await fx.user(UserRole.WAREHOUSE_STAFF); // legacy role only
  });
  afterAll(async () => { await fx.stop(); });

  it('runs the full chain without skipping a stock movement or double-posting', async () => {
    const product = await fx.product({ serialControlled: true });
    const units = await fx.stock(product.id, 3);
    const unitIds = units.map((u) => u.id);

    // Request qty 2
    const created = await fx.as(requester).post('/requests', { rmaCaseNumber: 'RMA-1', items: [{ productId: product.id, quantity: 2 }] });
    expectStatus(created, 201);
    const requestId = created.body.id;
    await fx.as(otherRequester).patch(`/requests/${requestId}/submit`).expect(403);
    expectStatus(await fx.as(requester).patch(`/requests/${requestId}/submit`), 200);
    // Re-submitting is refused (used to re-open approval)
    await fx.as(requester).patch(`/requests/${requestId}/submit`).expect(409);

    // Two approvers click Approve at the same time
    const approvals = await Promise.all([
      fx.as(manager).patch(`/requests/${requestId}/approve`, { approved: true }),
      fx.as(manager).patch(`/requests/${requestId}/approve`, { approved: true }),
    ]);
    expect(approvals.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await fx.prisma.stockItem.count({ where: { productId: product.id, status: 'RESERVED' } })).toBe(2);

    // Two operators allocate at the same time
    const allocations = await Promise.all([
      fx.as(staff).post(`/fulfillment/allocate/${requestId}`),
      fx.as(staff).post(`/fulfillment/allocate/${requestId}`),
    ]);
    expect(allocations.map((r) => r.status).sort()).toEqual([201, 409]);
    const task = await fx.prisma.fulfillmentTask.findFirstOrThrow({ where: { requestId }, include: { items: true } });
    expect(await fx.prisma.fulfillmentTask.count({ where: { requestId } })).toBe(1);
    // One task line per reserved unit — both units approval reserved, no third one
    const taskUnits = task.items.map((i) => i.stockItemId);
    expect(new Set(taskUnits).size).toBe(2);
    expect(await fx.prisma.stockItem.count({ where: { productId: product.id, status: 'RESERVED' } })).toBe(2);
    expect(await fx.prisma.stockItem.count({ where: { productId: product.id, status: 'AVAILABLE' } })).toBe(1);

    // Board "Next": ALLOCATED → PICKING, then PICKING → PICKED confirms the picks
    expectStatus(await fx.as(staff).patch(`/fulfillment/${task.id}/advance`), 200);
    const picks = await Promise.all([
      fx.as(staff).patch(`/fulfillment/${task.id}/advance`),
      fx.as(staff).patch(`/fulfillment/${task.id}/advance`),
    ]);
    expect(picks.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await fx.statuses(taskUnits as string[])).toEqual([StockStatus.PICKED, StockStatus.PICKED]);

    // PICKED → PACKING → PACKED
    expectStatus(await fx.as(staff).patch(`/fulfillment/${task.id}/advance`), 200);
    expectStatus(await fx.as(staff).patch(`/fulfillment/${task.id}/advance`), 200);
    expect((await fx.prisma.fulfillmentTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('PACKED');

    // "Next" can no longer skip the goods issue
    await fx.as(staff).patch(`/fulfillment/${task.id}/advance`).expect(400);
    await fx.as(staff).patch(`/fulfillment/${task.id}/advance`).expect(400);
    expect((await fx.prisma.fulfillmentTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('PACKED');

    // Ship: create shipment, then two dispatch clicks
    const shipment = await fx.as(staff).post(`/fulfillment/${task.id}/shipment`, { carrier: 'DHL' });
    expectStatus(shipment, 201);
    const dispatches = await Promise.all([
      fx.as(staff).post(`/fulfillment/shipments/${shipment.body.id}/dispatch`),
      fx.as(staff).post(`/fulfillment/shipments/${shipment.body.id}/dispatch`),
    ]);
    expect(dispatches.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await fx.statuses(taskUnits as string[])).toEqual([StockStatus.SHIPPED, StockStatus.SHIPPED]);
    expect(await fx.prisma.auditLog.count({ where: { action: 'GOODS_ISSUED', entityId: { in: taskUnits as string[] } } })).toBe(2);
    const line = await fx.prisma.withdrawalRequestItem.findFirstOrThrow({ where: { requestId } });
    expect(line.quantityIssued).toBe(2);
    expect(taskUnits).toContain(line.shippedStockItemId);

    // Handover to RMA
    expectStatus(await fx.as(staff).post(`/fulfillment/${task.id}/handover/rma`, { receiver: 'Tech A' }), 201);
    expect((await fx.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('ISSUED_TO_RMA');

    // Usage: only the requester (or an approver), once, for every issued unit
    await fx.as(otherRequester).patch(`/rma/${requestId}/usage`, { usage: 'USED' }).expect(403);
    expectStatus(await fx.as(requester).patch(`/rma/${requestId}/usage`, { usage: 'USED' }), 200);
    expect(await fx.statuses(taskUnits as string[])).toEqual([StockStatus.CONSUMED, StockStatus.CONSUMED]);
    await fx.as(requester).patch(`/rma/${requestId}/usage`, { usage: 'DOA' }).expect(409);
    expect(await fx.prisma.rTVCase.count({ where: { stockItemId: { in: unitIds } } })).toBe(0);

    // The untouched unit is still available
    const spare = unitIds.find((id) => !taskUnits.includes(id))!;
    expect(await fx.statuses([spare])).toEqual([StockStatus.AVAILABLE]);
  });

  it('the Fulfillment board buttons (Next, Pack dialog, Ship dialog) and the Handover page still work end to end', async () => {
    const product = await fx.product({ serialControlled: true });
    const [unit] = await fx.stock(product.id, 1);
    const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
    const task = await fx.allocatedTask(req.id, staff);

    // "Next →" twice: ALLOCATED → PICKING → PICKED
    expectStatus(await fx.as(staff).patch(`/fulfillment/${task.id}/advance`, {}), 200);
    expectStatus(await fx.as(staff).patch(`/fulfillment/${task.id}/advance`, {}), 200);
    // Pack dialog: startPacking → updatePacking → completePacking (outbound/fulfillment/page.tsx confirmPack)
    expectStatus(await fx.as(staff).post(`/fulfillment/${task.id}/packing/start`), 201);
    expectStatus(await fx.as(staff).patch(`/fulfillment/${task.id}/packing`, { cartonCount: 2, totalWeight: 1.5, notes: 'fragile' }), 200);
    expectStatus(await fx.as(staff).post(`/fulfillment/${task.id}/packing/complete`), 201);
    // Ship dialog: createShipment → confirmDispatch (confirmShip)
    const sh = await fx.as(staff).post(`/fulfillment/${task.id}/shipment`, { carrier: 'Kerry', trackingNumber: 'TRK1', receiverName: 'Tech', notes: '' });
    expectStatus(sh, 201);
    expectStatus(await fx.as(staff).post(`/fulfillment/shipments/${sh.body.id}/dispatch`), 201);
    // Handover page: issueToRma
    expectStatus(await fx.as(staff).post(`/fulfillment/${task.id}/handover/rma`, { receiver: 'Tech' }), 201);

    expect(await fx.statuses([unit.id])).toEqual([StockStatus.SHIPPED]);
    const session = await fx.prisma.packingSession.findUniqueOrThrow({ where: { taskId: task.id } });
    expect(session).toMatchObject({ cartonCount: 2, totalWeight: 1.5 });
    expect((await fx.prisma.fulfillmentTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('CLOSED');
  });

  it('refuses warehouse execution to a requester, with a real JWT', async () => {
    const product = await fx.product();
    await fx.stock(product.id, 1);
    const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
    await fx.as(requester).post(`/fulfillment/allocate/${req.id}`).expect(403);
    const picker = await fx.user(UserRole.REQUESTER, 'PICKER'); // DB role decides, not the legacy enum
    expectStatus(await fx.as(picker).post(`/fulfillment/allocate/${req.id}`), 201);
    const disabled = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WAREHOUSE_MANAGER', { roleActive: false });
    const task = await fx.prisma.fulfillmentTask.findFirstOrThrow({ where: { requestId: req.id } });
    await fx.as(disabled).patch(`/fulfillment/${task.id}/advance`).expect(403);
  });
});
