import { FulfillmentStatus, StockStatus, UserRole } from '@prisma/client';
import { Fixture, TestUser, expectStatus } from './harness';

// Reservation ownership, release on cancel, exception handling, quantity-aware
// splits, and tasks that were already in flight before these fixes.

describe('Reservation, release and goods-issue integrity', () => {
  let fx: Fixture;
  let requester: TestUser, manager: TestUser, staff: TestUser;

  beforeAll(async () => {
    fx = await Fixture.start();
    requester = await fx.user(UserRole.REQUESTER, 'REQUESTER');
    manager = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WAREHOUSE_MANAGER');
    staff = await fx.user(UserRole.WAREHOUSE_STAFF);
  });
  afterAll(async () => { await fx.stop(); });

  const countStatus = (productId: string, status: StockStatus) =>
    fx.prisma.stockItem.count({ where: { productId, status } });

  it('cancelling an approved request releases every unit approval reserved (not just the first)', async () => {
    const product = await fx.product({ serialControlled: true });
    await fx.stock(product.id, 3);
    const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 3 }]);
    expect(await countStatus(product.id, StockStatus.RESERVED)).toBe(3);

    expectStatus(await fx.as(requester).patch(`/requests/${req.id}/cancel`), 200);
    expect(await countStatus(product.id, StockStatus.RESERVED)).toBe(0);
    expect(await countStatus(product.id, StockStatus.AVAILABLE)).toBe(3);
    // No double rollback
    await fx.as(requester).patch(`/requests/${req.id}/cancel`).expect(400);
  });

  it("only the requester or an approver may cancel a request", async () => {
    const product = await fx.product();
    await fx.stock(product.id, 1);
    const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
    const stranger = await fx.user(UserRole.REQUESTER, 'REQUESTER');
    await fx.as(stranger).patch(`/requests/${req.id}/cancel`).expect(403);
    expectStatus(await fx.as(manager).patch(`/requests/${req.id}/cancel`), 200);
  });

  it("allocation takes the request's own reserved unit, never another approved request's", async () => {
    const product = await fx.product({ serialControlled: true });
    const [older, newer] = await fx.stock(product.id, 2);
    const reqA = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
    const reqB = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
    const lineA = await fx.prisma.withdrawalRequestItem.findFirstOrThrow({ where: { requestId: reqA.id } });
    const lineB = await fx.prisma.withdrawalRequestItem.findFirstOrThrow({ where: { requestId: reqB.id } });
    expect(lineA.stockItemId).toBe(older.id);
    expect(lineB.stockItemId).toBe(newer.id);

    // B is allocated first; FIFO alone would have taken A's (older) unit.
    const taskB = await fx.allocatedTask(reqB.id, staff);
    const taskA = await fx.allocatedTask(reqA.id, staff);
    expect(taskB.items.map((i) => i.stockItemId)).toEqual([newer.id]);
    expect(taskA.items.map((i) => i.stockItemId)).toEqual([older.id]);
  });

  it('cancelling a request after picking cancels the task and releases the picked units', async () => {
    const product = await fx.product({ serialControlled: true });
    await fx.stock(product.id, 2);
    const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 2 }]);
    const task = await fx.allocatedTask(req.id, staff);
    expectStatus(await fx.as(staff).patch(`/fulfillment/${task.id}/advance`), 200); // PICKING
    expectStatus(await fx.as(staff).patch(`/fulfillment/${task.id}/advance`), 200); // PICKED
    expect(await countStatus(product.id, StockStatus.PICKED)).toBe(2);

    expectStatus(await fx.as(requester).patch(`/requests/${req.id}/cancel`), 200);
    expect((await fx.prisma.fulfillmentTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(FulfillmentStatus.CANCELLED);
    expect(await countStatus(product.id, StockStatus.AVAILABLE)).toBe(2);
  });

  it('a request whose goods were issued cannot be cancelled, and a shipped task cannot be cancelled', async () => {
    const product = await fx.product();
    await fx.stock(product.id, 1);
    const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
    const task = await fx.allocatedTask(req.id, staff);
    await fx.packedTask(task.id, staff);
    const sh = await fx.as(staff).post(`/fulfillment/${task.id}/shipment`, {});
    expectStatus(await fx.as(staff).post(`/fulfillment/shipments/${sh.body.id}/dispatch`), 201);

    await fx.as(manager).patch(`/requests/${req.id}/cancel`).expect(400);
    await fx.as(staff).post(`/fulfillment/${task.id}/cancel`).expect(409);
    await fx.as(staff).patch(`/fulfillment/${task.id}/exception`, { status: 'CANCELLED' }).expect(409);
    expect(await countStatus(product.id, StockStatus.SHIPPED)).toBe(1);
    // A shipped task blocks re-allocation of the same request
    await fx.as(staff).post(`/fulfillment/allocate/${req.id}`).expect(409);
  });

  it('exception CANCELLED releases stock; RETURNED is refused before goods issue; HOLD then cancel releases', async () => {
    const product = await fx.product();
    await fx.stock(product.id, 2);
    const reqA = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
    const taskA = await fx.allocatedTask(reqA.id, staff);
    await fx.as(staff).patch(`/fulfillment/${taskA.id}/exception`, { status: 'RETURNED' }).expect(409);
    expectStatus(await fx.as(staff).patch(`/fulfillment/${taskA.id}/exception`, { status: 'CANCELLED', reason: 'x' }), 200);
    expect(await fx.statuses([taskA.items[0].stockItemId!])).toEqual([StockStatus.AVAILABLE]);

    const reqB = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
    const taskB = await fx.allocatedTask(reqB.id, staff);
    expectStatus(await fx.as(staff).patch(`/fulfillment/${taskB.id}/exception`, { status: 'HOLD' }), 200);
    expectStatus(await fx.as(staff).post(`/fulfillment/${taskB.id}/cancel`, { reason: 'stock issue' }), 201);
    expect(await fx.statuses([taskB.items[0].stockItemId!])).toEqual([StockStatus.AVAILABLE]);
  });

  it('a shipment whose dispatch failed can be retried instead of dead-ending', async () => {
    const product = await fx.product();
    await fx.stock(product.id, 1);
    const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
    const task = await fx.allocatedTask(req.id, staff);
    await fx.packedTask(task.id, staff);
    const first = await fx.as(staff).post(`/fulfillment/${task.id}/shipment`, { carrier: 'A' });
    const retry = await fx.as(staff).post(`/fulfillment/${task.id}/shipment`, { carrier: 'B' });
    expectStatus(first, 201);
    expectStatus(retry, 201);
    expect(retry.body.id).toBe(first.body.id);
    expectStatus(await fx.as(staff).post(`/fulfillment/shipments/${retry.body.id}/dispatch`), 201);
  });

  it('RMA handover of a task that was never dispatched performs the goods issue', async () => {
    const product = await fx.product({ serialControlled: true });
    await fx.stock(product.id, 1);
    const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
    const task = await fx.allocatedTask(req.id, staff);
    await fx.packedTask(task.id, staff);
    expectStatus(await fx.as(staff).post(`/fulfillment/${task.id}/shipment`, {}), 201); // READY_TO_SHIP, not dispatched

    expectStatus(await fx.as(staff).post(`/fulfillment/${task.id}/handover/rma`, { receiver: 'Tech' }), 201);
    expect(await fx.statuses([task.items[0].stockItemId!])).toEqual([StockStatus.SHIPPED]);
    expect((await fx.prisma.fulfillmentTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(FulfillmentStatus.CLOSED);
    expect((await fx.prisma.shipment.findUniqueOrThrow({ where: { taskId: task.id } })).shippedAt).not.toBeNull();
    expect(await fx.prisma.auditLog.count({ where: { action: 'GOODS_ISSUED', entityId: task.items[0].stockItemId! } })).toBe(1);
  });

  it('bulk stock: allocation reserves only the requested quantity and ships only that', async () => {
    const product = await fx.product();
    const [row] = await fx.stock(product.id, 1, { quantity: 10, serial: false });
    const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
    const task = await fx.allocatedTask(req.id, staff);
    expect(task.items).toHaveLength(1);
    expect(task.items[0].stockItemId).toBe(row.id);

    const reserved = await fx.prisma.stockItem.findUniqueOrThrow({ where: { id: row.id } });
    expect(reserved.quantity).toBe(1);
    expect(reserved.status).toBe(StockStatus.RESERVED);
    const remainder = await fx.prisma.stockItem.findFirstOrThrow({ where: { productId: product.id, id: { not: row.id } } });
    expect(remainder.quantity).toBe(9);
    expect(remainder.status).toBe(StockStatus.AVAILABLE);

    await fx.packedTask(task.id, staff);
    const sh = await fx.as(staff).post(`/fulfillment/${task.id}/shipment`, {});
    expectStatus(await fx.as(staff).post(`/fulfillment/shipments/${sh.body.id}/dispatch`), 201);
    const all = await fx.prisma.stockItem.findMany({ where: { productId: product.id } });
    expect(all.reduce((s, r) => s + r.quantity, 0)).toBe(10);
    expect(all.filter((r) => r.status === 'SHIPPED').reduce((s, r) => s + r.quantity, 0)).toBe(1);
  });

  it('a zero pick is not shipped: its reservation is released at dispatch', async () => {
    const product = await fx.product({ serialControlled: true });
    await fx.stock(product.id, 2);
    const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 2 }]);
    const task = await fx.allocatedTask(req.id, staff);
    const [a, b] = task.items;
    expectStatus(await fx.as(staff).patch(`/fulfillment/${task.id}/items/${a.id}/pick`, { qty: 1 }), 200);
    expectStatus(await fx.as(staff).patch(`/fulfillment/${task.id}/items/${b.id}/pick`, { qty: 0 }), 200);
    await fx.as(staff).patch(`/fulfillment/${task.id}/items/${b.id}/pick`, { qty: 1 }).expect(409); // double pick
    await fx.as(staff).patch(`/fulfillment/${task.id}/items/${a.id}/pick`, { qty: -1 }).expect(400);

    expectStatus(await fx.as(staff).patch(`/fulfillment/${task.id}/advance`), 200); // PICKED → PACKING
    expectStatus(await fx.as(staff).patch(`/fulfillment/${task.id}/advance`), 200); // PACKED
    const sh = await fx.as(staff).post(`/fulfillment/${task.id}/shipment`, {});
    expectStatus(await fx.as(staff).post(`/fulfillment/shipments/${sh.body.id}/dispatch`), 201);
    expect(await fx.statuses([a.stockItemId!, b.stockItemId!])).toEqual([StockStatus.SHIPPED, StockStatus.AVAILABLE]);
  });

  it('a wrong barcode on pick confirmation is rejected', async () => {
    const product = await fx.product({ serialControlled: true });
    const [unit] = await fx.stock(product.id, 1);
    const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
    const task = await fx.allocatedTask(req.id, staff);
    const item = task.items[0];
    await fx.as(staff).patch(`/fulfillment/${task.id}/items/${item.id}/pick`, { qty: 1, barcode: 'SN|WRONG' }).expect(400);
    expectStatus(await fx.as(staff).patch(`/fulfillment/${task.id}/items/${item.id}/pick`, { qty: 1, barcode: `SN|${unit.serialNumber}` }), 200);
  });

  describe('tasks already in flight before the fix (advanced without item picks)', () => {
    async function legacyTask(status: FulfillmentStatus, rowQty: number, lineQty: number) {
      const product = await fx.product();
      const [row] = await fx.stock(product.id, 1, { quantity: rowQty, serial: false, status: StockStatus.RESERVED });
      const req = await fx.prisma.withdrawalRequest.create({
        data: {
          refNumber: fx.uid('WR'), requesterId: requester.id, department: 'x', status: 'PICKING',
          items: { create: [{ productId: product.id, quantityRequested: lineQty, quantityApproved: lineQty, stockItemId: row.id }] },
        },
      });
      const task = await fx.prisma.fulfillmentTask.create({
        data: {
          refNumber: fx.uid('FT'), requestId: req.id, requestRef: req.refNumber, status,
          items: { create: [{ productId: product.id, stockItemId: row.id, qtyRequested: lineQty }] },
        },
      });
      return { product, row, req, task };
    }

    it('completing packing confirms the missing picks', async () => {
      const { row, task } = await legacyTask(FulfillmentStatus.PACKING, 1, 1);
      await fx.prisma.packingSession.create({ data: { taskId: task.id } });
      expectStatus(await fx.as(staff).patch(`/fulfillment/${task.id}/advance`), 200);
      expect((await fx.prisma.fulfillmentTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(FulfillmentStatus.PACKED);
      expect(await fx.statuses([row.id])).toEqual([StockStatus.PICKED]);
    });

    it('dispatch issues the reserved goods and splits a bulk row instead of shipping all of it', async () => {
      const { product, row, task } = await legacyTask(FulfillmentStatus.READY_TO_SHIP, 5, 2);
      const sh = await fx.prisma.shipment.create({ data: { refNumber: fx.uid('SHP'), taskId: task.id } });
      expectStatus(await fx.as(staff).post(`/fulfillment/shipments/${sh.id}/dispatch`), 201);

      const shipped = await fx.prisma.stockItem.findUniqueOrThrow({ where: { id: row.id } });
      expect(shipped).toMatchObject({ status: StockStatus.SHIPPED, quantity: 2 });
      const rest = await fx.prisma.stockItem.findFirstOrThrow({ where: { productId: product.id, id: { not: row.id } } });
      expect(rest).toMatchObject({ status: StockStatus.AVAILABLE, quantity: 3 });
    });
  });
});
