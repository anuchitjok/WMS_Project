import { FulfillmentStatus, StockStatus, UserRole } from '@prisma/client';
import { Fixture, TestUser, expectStatus } from './harness';

// Scanner workflows go through the same guarded services as the screens.

describe('Scanner workflows: PICK / PUTAWAY / SHIP / COUNT', () => {
  let fx: Fixture;
  let manager: TestUser, staff: TestUser, requester: TestUser;

  beforeAll(async () => {
    fx = await Fixture.start();
    manager = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WAREHOUSE_MANAGER');
    staff = await fx.user(UserRole.WAREHOUSE_STAFF);
    requester = await fx.user(UserRole.REQUESTER, 'REQUESTER');
  });
  afterAll(async () => { await fx.stop(); });

  const scan = (u: TestUser, body: object) => fx.as(u).post('/scan', body);

  async function packedTaskWithShipment() {
    const product = await fx.product({ serialControlled: true });
    const [unit] = await fx.stock(product.id, 1);
    const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
    const task = await fx.allocatedTask(req.id, staff);
    await fx.packedTask(task.id, staff);
    const sh = await fx.as(staff).post(`/fulfillment/${task.id}/shipment`, {});
    expectStatus(sh, 201);
    return { product, unit, task, shipment: sh.body as { id: string; refNumber: string } };
  }

  describe('SHIP', () => {
    it('a barcode that is not that shipment never dispatches some other shipment', async () => {
      const { product, unit, shipment } = await packedTaskWithShipment();
      // The product code resolves to an entity; the old lookup then matched any shipment.
      const res = await scan(staff, { workflow: 'SHIP', rawValue: product.code });
      expectStatus(res, 201);
      expect(res.body.result).toBe('NOT_FOUND');
      expect((await fx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).shippedAt).toBeNull();
      expect(await fx.statuses([unit.id])).toEqual([StockStatus.PICKED]);
    });

    it('scanning the shipment label posts the full goods issue, once', async () => {
      const { unit, task, shipment } = await packedTaskWithShipment();
      const res = await scan(staff, { workflow: 'SHIP', rawValue: `SHP|${shipment.refNumber}` });
      expect(res.body.result).toBe('SUCCESS');
      expect(await fx.statuses([unit.id])).toEqual([StockStatus.SHIPPED]);
      expect((await fx.prisma.fulfillmentTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(FulfillmentStatus.SHIPPED);
      expect(await fx.prisma.auditLog.count({ where: { action: 'GOODS_ISSUED', entityId: unit.id } })).toBe(1);

      const again = await scan(staff, { workflow: 'SHIP', rawValue: `SHP|${shipment.refNumber}` });
      expect(again.body.result).toBe('DUPLICATE');
      // The regular dispatch button is refused too — no second goods issue
      await fx.as(staff).post(`/fulfillment/shipments/${shipment.id}/dispatch`).expect(409);
    });
  });

  describe('PICK', () => {
    it('confirms the task line holding the scanned unit, once', async () => {
      const product = await fx.product({ serialControlled: true });
      const [unit, stranger] = await fx.stock(product.id, 2);
      const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
      const task = await fx.allocatedTask(req.id, staff);
      expect(task.items[0].stockItemId).toBe(unit.id);

      const other = await scan(staff, { workflow: 'PICK', rawValue: `SN|${stranger.serialNumber}`, context: { requestId: req.refNumber } });
      expect(other.body.result).toBe('ERROR');

      const res = await scan(staff, { workflow: 'PICK', rawValue: `SN|${unit.serialNumber}`, context: { requestId: req.refNumber } });
      expect(res.body.result).toBe('SUCCESS');
      expect(await fx.statuses([unit.id])).toEqual([StockStatus.PICKED]);
      const line = await fx.prisma.fulfillmentTaskItem.findUniqueOrThrow({ where: { id: task.items[0].id } });
      expect(line.pickedAt).not.toBeNull();
      expect(line.qtyPicked).toBe(1);
      expect((await fx.prisma.fulfillmentTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(FulfillmentStatus.PICKED);

      const again = await scan(staff, { workflow: 'PICK', rawValue: `SN|${unit.serialNumber}`, context: { requestId: req.refNumber } });
      expect(again.body.result).toBe('ERROR'); // task is no longer open for picking
    });

    it('requires an allocated task', async () => {
      const product = await fx.product({ serialControlled: true });
      const [unit] = await fx.stock(product.id, 1);
      const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
      const res = await scan(staff, { workflow: 'PICK', rawValue: `SN|${unit.serialNumber}`, context: { requestId: req.refNumber } });
      expect(res.body.result).toBe('ERROR');
      expect(await fx.statuses([unit.id])).toEqual([StockStatus.RESERVED]);
    });
  });

  describe('PUTAWAY', () => {
    it('stores inspected stock in the scanned bin; refuses uninspected stock and unknown bins', async () => {
      const loc = await fx.location();
      const product = await fx.product({ serialControlled: true });
      const [received] = await fx.stock(product.id, 1, { status: StockStatus.PENDING_RECEIVING });
      const [inspected] = await fx.stock(product.id, 1, { status: StockStatus.PENDING_INSPECTION });
      const key = `${loc.warehouse.code}|R1|S1`;

      const notInspected = await scan(staff, { workflow: 'PUTAWAY', rawValue: `SN|${received.serialNumber}`, context: { locationKey: key } });
      expect(notInspected.body.result).toBe('ERROR');
      expect(await fx.statuses([received.id])).toEqual([StockStatus.PENDING_RECEIVING]);

      const badBin = await scan(staff, { workflow: 'PUTAWAY', rawValue: `SN|${inspected.serialNumber}`, context: { locationKey: `${loc.warehouse.code}|R1|NOPE` } });
      expect(badBin.body.result).toBe('ERROR');
      expect(await fx.statuses([inspected.id])).toEqual([StockStatus.PENDING_INSPECTION]);

      const ok = await scan(staff, { workflow: 'PUTAWAY', rawValue: `SN|${inspected.serialNumber}`, context: { locationKey: key } });
      expect(ok.body.result).toBe('SUCCESS');
      const row = await fx.prisma.stockItem.findUniqueOrThrow({ where: { id: inspected.id } });
      expect(row).toMatchObject({ status: StockStatus.AVAILABLE, warehouseId: loc.warehouse.id, rackId: loc.rack.id, slotId: loc.slot.id });

      const twice = await scan(staff, { workflow: 'PUTAWAY', rawValue: `SN|${inspected.serialNumber}`, context: { locationKey: key } });
      expect(twice.body.result).toBe('ERROR');
    });

    it('is refused (and logged) for a requester; LOOKUP stays open to everyone', async () => {
      const loc = await fx.location();
      const product = await fx.product({ serialControlled: true });
      const [inspected] = await fx.stock(product.id, 1, { status: StockStatus.PENDING_INSPECTION });
      const res = await scan(requester, { workflow: 'PUTAWAY', rawValue: `SN|${inspected.serialNumber}`, context: { locationKey: `${loc.warehouse.code}|R1|S1` } });
      expect(res.body.result).toBe('FORBIDDEN');
      expect(await fx.statuses([inspected.id])).toEqual([StockStatus.PENDING_INSPECTION]);
      expect(await fx.prisma.scanEvent.count({ where: { userId: requester.id, result: 'FORBIDDEN' } })).toBe(1);

      const lookup = await scan(requester, { workflow: 'LOOKUP', rawValue: `SN|${inspected.serialNumber}` });
      expect(lookup.body.result).toBe('SUCCESS');
    });
  });

  describe('COUNT', () => {
    it('does not record counts on a session that is closed', async () => {
      const loc = await fx.location();
      const product = await fx.product({ serialControlled: true });
      const [unit] = await fx.stock(product.id, 1, { warehouseId: loc.warehouse.id });
      const session = await fx.as(staff).post('/cycle-count', { warehouseId: loc.warehouse.id });
      expectStatus(session, 201);
      expectStatus(await fx.as(manager).post(`/cycle-count/${session.body.id}/cancel`), 201);
      const res = await scan(staff, { workflow: 'COUNT', rawValue: `SN|${unit.serialNumber}`, context: { sessionId: session.body.id, countedQty: 0 } });
      expect(res.body.result).toBe('ERROR');
      expect((await fx.prisma.cycleCountLine.findFirstOrThrow({ where: { sessionId: session.body.id } })).countedQty).toBeNull();
    });
  });
});
