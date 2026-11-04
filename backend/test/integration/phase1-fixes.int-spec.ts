import { FulfillmentStatus, StockStatus, UserRole } from '@prisma/client';
import { Fixture, TestUser, expectStatus } from './harness';

// Phase 1 fixes (WMS improvement roadmap):
//  1. Available stock is counted in units (summed quantity), not stock rows.
//  2. The request shows the stage derived from its fulfillment task; a task
//     cancelled on its own sends the request back to APPROVED for re-allocation.
//  3. Packing and dispatch never confirm picks on the picker's behalf.
//  4. Putaway requires a slot (covered in stock-writes / scan specs).
//  5. The reservation wording comes from the running mode, not a fixed string.

describe('Phase 1 fixes', () => {
  let fx: Fixture;
  let requester: TestUser, manager: TestUser, staff: TestUser;

  beforeAll(async () => {
    fx = await Fixture.start();
    requester = await fx.user(UserRole.REQUESTER, 'REQUESTER');
    manager = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WAREHOUSE_MANAGER');
    staff = await fx.user(UserRole.WAREHOUSE_STAFF);
  });
  afterAll(async () => { await fx.stop(); });

  /** A submitted (not yet approved) request — what the approver's stock check runs on. */
  async function submittedRequest(lines: Array<{ productId: string; quantity: number }>) {
    const created = await fx.as(requester).post('/requests', { rmaCaseNumber: fx.uid('RMA'), items: lines });
    expectStatus(created, 201);
    expectStatus(await fx.as(requester).patch(`/requests/${created.body.id}/submit`), 200);
    return created.body as { id: string };
  }

  describe('1. available stock in units', () => {
    it('request form, approver check and dashboard all count a bulk row of 20 as 20', async () => {
      const healthBefore = (await fx.as(manager).get('/dashboard/inventory-health')).body;

      const product = await fx.product();
      await fx.stock(product.id, 1, { quantity: 20, serial: false }); // one bulk row
      await fx.stock(product.id, 1, { quantity: 3, serial: false, status: StockStatus.RESERVED }); // not requestable

      // Request form (New Request → SKU dropdown)
      const products = await fx.as(requester).get('/requests/products-available');
      expectStatus(products, 200);
      expect(products.body.find((p: { id: string }) => p.id === product.id).availableQty).toBe(20);

      // Approver's stock check: 2 of 20 is fine, 25 of 20 is a shortage
      const ok = await submittedRequest([{ productId: product.id, quantity: 2 }]);
      const short = await submittedRequest([{ productId: product.id, quantity: 25 }]);
      const list = await fx.as(manager).get('/requests?limit=100');
      expectStatus(list, 200);
      const row = (id: string) => list.body.data.find((r: { id: string }) => r.id === id);
      expect(row(ok.id)).toMatchObject({ stockOk: true, stockShortages: [] });
      expect(row(short.id).stockOk).toBe(false);
      expect(row(short.id).stockShortages[0]).toMatchObject({ requested: 25, available: 20 });

      // Dashboard Inventory Status: +20 available, +3 reserved (units, not +1 row each)
      const healthAfter = (await fx.as(manager).get('/dashboard/inventory-health')).body;
      expect(healthAfter.available - healthBefore.available).toBe(20);
      expect(healthAfter.reserved - healthBefore.reserved).toBe(3);
    });

    it('a request for 2 of a 20-unit bulk row approves and allocates exactly 2 units', async () => {
      const product = await fx.product();
      const [bulk] = await fx.stock(product.id, 1, { quantity: 20, serial: false });
      const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 2 }]);
      const task = await fx.allocatedTask(req.id, staff);
      const taken = task.items.reduce((s, i) => s + i.qtyRequested, 0);
      expect(taken).toBe(2);
      const products = await fx.as(requester).get('/requests/products-available');
      expect(products.body.find((p: { id: string }) => p.id === product.id).availableQty).toBe(18);
      expect((await fx.prisma.stockItem.aggregate({ where: { productId: product.id }, _sum: { quantity: true } }))._sum.quantity).toBe(20);
      expect(bulk.id).toBeDefined();
    });
  });

  describe('2. request stage and re-allocation', () => {
    it('a request whose task is CLOSED shows stage CLOSED and is found by the CLOSED filter, not IN_FULFILLMENT', async () => {
      const product = await fx.product();
      await fx.stock(product.id, 1);
      const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
      const task = await fx.allocatedTask(req.id, staff);
      await fx.packedTask(task.id, staff);
      const sh = await fx.as(staff).post(`/fulfillment/${task.id}/shipment`, {});
      expectStatus(await fx.as(staff).post(`/fulfillment/shipments/${sh.body.id}/dispatch`), 201);
      expectStatus(await fx.as(staff).patch(`/fulfillment/${task.id}/advance`), 200); // SHIPPED → DELIVERED
      expectStatus(await fx.as(staff).patch(`/fulfillment/${task.id}/advance`), 200); // DELIVERED → CLOSED

      // The stored status is the legacy PICKING (never written after allocation) …
      expect((await fx.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('PICKING');
      // … but what the API shows is the derived stage.
      const detail = await fx.as(manager).get(`/requests/${req.id}`);
      expect(detail.body).toMatchObject({ stage: 'CLOSED', fulfillmentStatus: 'CLOSED' });

      const closed = await fx.as(manager).get('/requests?stage=CLOSED&limit=100');
      expect(closed.body.data.map((r: { id: string }) => r.id)).toContain(req.id);
      const inFlight = await fx.as(manager).get('/requests?stage=IN_FULFILLMENT&limit=100');
      expect(inFlight.body.data.map((r: { id: string }) => r.id)).not.toContain(req.id);
      await fx.as(manager).get('/requests?stage=NOT_A_STAGE').expect(400);
    });

    it('cancelling only the task sends the request back to APPROVED and lets it be allocated again', async () => {
      const product = await fx.product();
      await fx.stock(product.id, 2);
      const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
      const task = await fx.allocatedTask(req.id, staff);
      expectStatus(await fx.as(staff).patch(`/fulfillment/${task.id}/exception`, { status: 'CANCELLED', reason: 'wrong bin' }), 200);

      expect((await fx.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('APPROVED');
      expect((await fx.as(manager).get(`/requests/${req.id}`)).body.stage).toBe('APPROVED');
      expect(await fx.prisma.auditLog.count({ where: { action: 'REQUEST_REOPENED', entityId: req.id } })).toBe(1);
      const allocatable = await fx.as(staff).get('/fulfillment/allocatable-requests');
      expect(allocatable.body.map((r: { id: string }) => r.id)).toContain(req.id);

      const again = await fx.allocatedTask(req.id, staff);
      expect(again.status).toBe(FulfillmentStatus.ALLOCATED);
      expect(again.items.reduce((s, i) => s + i.qtyRequested, 0)).toBe(1);
    });

    it('re-allocation after a cancelled task never takes units another approved request reserved', async () => {
      const product = await fx.product();
      await fx.stock(product.id, 3);
      const reqA = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
      const taskA = await fx.allocatedTask(reqA.id, staff);
      expectStatus(await fx.as(staff).patch(`/fulfillment/${taskA.id}/exception`, { status: 'CANCELLED', reason: 'x' }), 200);

      // B reserves two units at approval; only the first is linked to its line.
      const reqB = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 2 }]);
      const reservedForB = (await fx.prisma.stockItem.findMany({ where: { productId: product.id, status: 'RESERVED' } })).map((s) => s.id);
      expect(reservedForB).toHaveLength(2);

      const taskA2 = await fx.allocatedTask(reqA.id, staff);
      const takenByA = taskA2.items.map((i) => i.stockItemId);
      expect(takenByA.some((id) => reservedForB.includes(id!))).toBe(false);

      // B still allocates both of its own units.
      const taskB = await fx.allocatedTask(reqB.id, staff);
      expect(taskB.items.map((i) => i.stockItemId).sort()).toEqual([...reservedForB].sort());
    });

    it('legacy: a request left at PICKING behind a task cancelled before the fix is shown APPROVED and re-allocates once', async () => {
      const product = await fx.product();
      await fx.stock(product.id, 3);
      const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
      const task = await fx.allocatedTask(req.id, staff);
      expectStatus(await fx.as(staff).patch(`/fulfillment/${task.id}/exception`, { status: 'CANCELLED', reason: 'x' }), 200);
      // Shape the row like pre-fix production data: the request was never reopened.
      await fx.prisma.withdrawalRequest.update({ where: { id: req.id }, data: { status: 'PICKING' } });
      const availableBefore = await fx.prisma.stockItem.count({ where: { productId: product.id, status: 'AVAILABLE' } });

      expect((await fx.as(manager).get(`/requests/${req.id}`)).body.stage).toBe('APPROVED');
      const allocatable = await fx.as(staff).get('/fulfillment/allocatable-requests');
      expect(allocatable.body.map((r: { id: string }) => r.id)).toContain(req.id);

      const again = await fx.allocatedTask(req.id, staff);
      expect(again.items).toHaveLength(1);
      expect(await fx.prisma.stockItem.count({ where: { productId: product.id, status: 'AVAILABLE' } })).toBe(availableBefore - 1);
      // Now it has a live task: no longer offered, and a second allocate is refused.
      const after = await fx.as(staff).get('/fulfillment/allocatable-requests');
      expect(after.body.map((r: { id: string }) => r.id)).not.toContain(req.id);
      expectStatus(await fx.as(staff).post(`/fulfillment/allocate/${req.id}`), 409);
    });

    it('legacy: a PICKING request with no cancelled task is not re-allocated (its reservation may still be held)', async () => {
      const product = await fx.product();
      await fx.stock(product.id, 2);
      const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
      await fx.prisma.withdrawalRequest.update({ where: { id: req.id }, data: { status: 'PICKING' } });
      const reservedBefore = await fx.prisma.stockItem.count({ where: { productId: product.id, status: 'RESERVED' } });

      const allocatable = await fx.as(staff).get('/fulfillment/allocatable-requests');
      expect(allocatable.body.map((r: { id: string }) => r.id)).not.toContain(req.id);
      expectStatus(await fx.as(staff).post(`/fulfillment/allocate/${req.id}`), 409);
      expect(await fx.prisma.stockItem.count({ where: { productId: product.id, status: 'RESERVED' } })).toBe(reservedBefore);
    });

    it('a request whose task was RETURNED is not offered for allocation (allocate would refuse it)', async () => {
      const product = await fx.product();
      await fx.stock(product.id, 1);
      const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
      const task = await fx.allocatedTask(req.id, staff);
      await fx.prisma.fulfillmentTask.update({ where: { id: task.id }, data: { status: FulfillmentStatus.RETURNED } });
      await fx.prisma.withdrawalRequest.update({ where: { id: req.id }, data: { status: 'APPROVED' } });

      const allocatable = await fx.as(staff).get('/fulfillment/allocatable-requests');
      expect(allocatable.body.map((r: { id: string }) => r.id)).not.toContain(req.id);
      expectStatus(await fx.as(staff).post(`/fulfillment/allocate/${req.id}`), 409);
    });
  });

  describe('3. no automatic pick confirmation', () => {
    async function allocatedWithUnpickedLine() {
      const product = await fx.product();
      const [unit] = await fx.stock(product.id, 1);
      const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
      const task = await fx.allocatedTask(req.id, staff);
      return { unit, task };
    }

    it('completing packing with a never-picked line is refused and the stock stays reserved', async () => {
      const { unit, task } = await allocatedWithUnpickedLine();
      // Simulate a task advanced before pick tracking existed (the only way to reach PACKING unpicked).
      await fx.prisma.fulfillmentTask.update({ where: { id: task.id }, data: { status: FulfillmentStatus.PACKING } });
      await fx.prisma.packingSession.create({ data: { taskId: task.id, packedById: staff.id, cartonCount: 1 } });

      const res = await fx.as(staff).post(`/fulfillment/${task.id}/packing/complete`);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/no confirmed pick/);
      expect(await fx.statuses([unit.id])).toEqual([StockStatus.RESERVED]);
      expect((await fx.prisma.fulfillmentTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('PACKING');
      expect(await fx.prisma.auditLog.count({ where: { action: 'STOCK_PICKED', entityId: unit.id } })).toBe(0);
    });

    it('dispatch with a never-picked line is refused: no goods issue, shipment stays undispatched', async () => {
      const { unit, task } = await allocatedWithUnpickedLine();
      await fx.prisma.fulfillmentTask.update({ where: { id: task.id }, data: { status: FulfillmentStatus.READY_TO_SHIP } });
      const sh = await fx.prisma.shipment.create({ data: { refNumber: fx.uid('SHP'), taskId: task.id, handoverById: staff.id } });

      const res = await fx.as(staff).post(`/fulfillment/shipments/${sh.id}/dispatch`);
      expect(res.status).toBe(409);
      expect(await fx.statuses([unit.id])).toEqual([StockStatus.RESERVED]);
      expect((await fx.prisma.shipment.findUniqueOrThrow({ where: { id: sh.id } })).shippedAt).toBeNull();
      expect((await fx.prisma.fulfillmentTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('READY_TO_SHIP');
      expect(await fx.prisma.auditLog.count({ where: { action: 'GOODS_ISSUED', entityId: unit.id } })).toBe(0);

      // The way out still works: cancelling the task releases the unit.
      expectStatus(await fx.as(staff).post(`/fulfillment/${task.id}/cancel`, { reason: 'legacy task' }), 201);
      expect(await fx.statuses([unit.id])).toEqual([StockStatus.AVAILABLE]);
    });

    it('the normal picked path still packs and dispatches', async () => {
      const { unit, task } = await allocatedWithUnpickedLine();
      await fx.packedTask(task.id, staff); // Next ×4 confirms the picks explicitly at PICKING
      const sh = await fx.as(staff).post(`/fulfillment/${task.id}/shipment`, {});
      expectStatus(await fx.as(staff).post(`/fulfillment/shipments/${sh.body.id}/dispatch`), 201);
      expect(await fx.statuses([unit.id])).toEqual([StockStatus.SHIPPED]);
    });
  });

  describe('5. reservation wording follows the running mode', () => {
    it('reports approval-time reservation when ENABLE_UNIFIED_RESERVATION is off (harness default)', async () => {
      const mode = await fx.as(staff).get('/fulfillment/reservation-mode');
      expectStatus(mode, 200);
      expect(mode.body.mode).toBe('APPROVAL');
      expect(mode.body.summary).toMatch(/reserved when the request is approved/);

      const settings = await fx.as(manager).get('/settings');
      const card = settings.body.find((s: { key: string }) => s.key === 'stock.reservation');
      expect(card.description).toMatch(/reserved when the request is approved/);
    });
  });
});
