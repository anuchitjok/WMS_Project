import { StockStatus, UserRole } from '@prisma/client';
import { Fixture, TestUser, expectStatus } from './harness';

// Direct stock writes: status guards, mass-assignment, location hierarchy and
// double-submission on putaway, transfer, inventory, receiving, returns, scrap,
// cycle count, adjustment and DOA.

/** Exactly one success; the loser is refused by the pre-check (400) or the atomic claim (409), depending on timing. */
function expectOneWinner(statuses: number[]) {
  expect(statuses.filter((s) => s === 200)).toHaveLength(1);
  expect([400, 409]).toContain(statuses.find((s) => s !== 200));
}

describe('Stock write integrity', () => {
  let fx: Fixture;
  let manager: TestUser, staff: TestUser, requester: TestUser;

  beforeAll(async () => {
    fx = await Fixture.start();
    manager = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WAREHOUSE_MANAGER');
    staff = await fx.user(UserRole.WAREHOUSE_STAFF);
    requester = await fx.user(UserRole.REQUESTER, 'REQUESTER');
  });
  afterAll(async () => { await fx.stop(); });

  const stockRow = (id: string) => fx.prisma.stockItem.findUniqueOrThrow({ where: { id } });

  describe('putaway confirm', () => {
    it('puts inspected stock away once, into a valid location, with no other fields', async () => {
      const loc = await fx.location();
      const other = await fx.location();
      const product = await fx.product();
      const [unit] = await fx.stock(product.id, 1, { status: StockStatus.PENDING_INSPECTION });
      const body = { warehouseId: loc.warehouse.id, rackId: loc.rack.id, slotId: loc.slot.id };

      await fx.as(staff).patch(`/putaway/${unit.id}/confirm`, { ...body, quantity: 999 }).expect(400);
      await fx.as(staff).patch(`/putaway/${unit.id}/confirm`, { ...body, slotId: other.slot.id }).expect(400);
      expectStatus(await fx.as(staff).patch(`/putaway/${unit.id}/confirm`, body), 200);
      expect(await stockRow(unit.id)).toMatchObject({ status: StockStatus.AVAILABLE, quantity: 1, ...body });
      await fx.as(staff).patch(`/putaway/${unit.id}/confirm`, body).expect(409);
    });

    it('cannot bring shipped, reserved or consumed stock back to AVAILABLE', async () => {
      const product = await fx.product();
      for (const status of [StockStatus.SHIPPED, StockStatus.RESERVED, StockStatus.CONSUMED, StockStatus.PENDING_RECEIVING]) {
        const [unit] = await fx.stock(product.id, 1, { status });
        await fx.as(staff).patch(`/putaway/${unit.id}/confirm`, {}).expect(409);
        expect((await stockRow(unit.id)).status).toBe(status);
      }
    });

    it('is refused to a requester', async () => {
      const product = await fx.product();
      const [unit] = await fx.stock(product.id, 1, { status: StockStatus.PENDING_INSPECTION });
      await fx.as(requester).patch(`/putaway/${unit.id}/confirm`, {}).expect(403);
    });
  });

  describe('transfer complete', () => {
    async function transfer(stockItemId: string) {
      const res = await fx.as(staff).post('/transfer', { stockItemId, productLabel: 'x', quantity: 1, fromLocation: 'A', toLocation: 'B' });
      expectStatus(res, 201);
      return res.body.id as string;
    }

    it('completes once and moves only the location', async () => {
      const loc = await fx.location();
      const product = await fx.product();
      const [unit] = await fx.stock(product.id, 1);
      const id = await transfer(unit.id);
      await fx.as(staff).patch(`/transfer/${id}/complete`, { rackId: loc.rack.id, status: 'SHIPPED' }).expect(400);
      expectStatus(await fx.as(staff).patch(`/transfer/${id}/complete`, { rackId: loc.rack.id }), 200);
      expect(await stockRow(unit.id)).toMatchObject({ status: StockStatus.AVAILABLE, rackId: loc.rack.id, warehouseId: loc.warehouse.id });
      await fx.as(staff).patch(`/transfer/${id}/complete`, { rackId: loc.rack.id }).expect(409);
    });

    it('refuses to relocate issued stock and leaves the transfer open', async () => {
      const loc = await fx.location();
      const product = await fx.product();
      const [unit] = await fx.stock(product.id, 1, { status: StockStatus.SHIPPED });
      const id = await transfer(unit.id);
      await fx.as(staff).patch(`/transfer/${id}/complete`, { slotId: loc.slot.id }).expect(409);
      expect((await fx.prisma.stockTransfer.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING');
    });
  });

  describe('inventory writes', () => {
    it('manual status changes are limited to on-hand holds', async () => {
      const product = await fx.product();
      const [shipped] = await fx.stock(product.id, 1, { status: StockStatus.SHIPPED });
      const [avail] = await fx.stock(product.id, 1);
      await fx.as(staff).patch(`/inventory/${shipped.id}/status`, { status: 'AVAILABLE' }).expect(400);
      await fx.as(staff).patch(`/inventory/${avail.id}/status`, { status: 'RESERVED' }).expect(400);
      expectStatus(await fx.as(staff).patch(`/inventory/${avail.id}/status`, { status: 'QUARANTINE' }), 200);
      expectStatus(await fx.as(staff).patch(`/inventory/${avail.id}/status`, { status: 'AVAILABLE' }), 200);
    });

    it('relocation accepts only a location and validates it', async () => {
      const loc = await fx.location();
      const product = await fx.product();
      const [unit] = await fx.stock(product.id, 1);
      await fx.as(manager).patch(`/inventory/${unit.id}/location`, { slotId: loc.slot.id, quantity: 50 }).expect(400);
      await fx.as(manager).patch(`/inventory/${unit.id}/location`, { slotId: 'nope' }).expect(400);
      expectStatus(await fx.as(manager).patch(`/inventory/${unit.id}/location`, { slotId: loc.slot.id }), 200);
      expect(await stockRow(unit.id)).toMatchObject({ quantity: 1, slotId: loc.slot.id, rackId: loc.rack.id, warehouseId: loc.warehouse.id });
    });

    it('stock cannot be created directly in a workflow status', async () => {
      const product = await fx.product();
      await fx.as(manager).post('/inventory', { productId: product.id, status: 'RESERVED' }).expect(400);
      expectStatus(await fx.as(manager).post('/inventory', { productId: product.id }), 201);
    });
  });

  describe('receiving', () => {
    async function receipt(qty = 1) {
      const loc = await fx.location();
      const product = await fx.product();
      const res = await fx.as(staff).post('/receiving', {
        sourceType: 'Vendor', items: [{ productId: product.id, quantity: qty, warehouseId: loc.warehouse.id }],
      });
      expectStatus(res, 201);
      return res.body as { id: string; items: Array<{ id: string; stockItemId: string }> };
    }

    it('an inspected line cannot be inspected again (put-away stock is not re-routed)', async () => {
      const gr = await receipt();
      const item = gr.items[0];
      const dto = { items: [{ itemId: item.id, inspectedQty: 1, inspectionOutcome: 'good' }] };
      expectStatus(await fx.as(staff).patch(`/receiving/${gr.id}/inspect`, dto), 200);
      expectStatus(await fx.as(staff).patch(`/putaway/${item.stockItemId}/confirm`, {}), 200);

      await fx.as(staff).patch(`/receiving/${gr.id}/inspect`, { items: [{ itemId: item.id, inspectedQty: 1, inspectionOutcome: 'damaged' }] }).expect(409);
      await fx.as(staff).patch(`/receiving/${gr.id}/verify`).expect(409);
      expect(await stockRow(item.stockItemId)).toMatchObject({ status: StockStatus.AVAILABLE, quantity: 1 });
    });

    it('cannot inspect more than was received, and a corrected serial reaches the stock record', async () => {
      const gr = await receipt(2);
      const item = gr.items[0];
      await fx.as(staff).patch(`/receiving/${gr.id}/inspect`, { items: [{ itemId: item.id, inspectedQty: 3, inspectionOutcome: 'good' }] }).expect(400);
      expectStatus(await fx.as(staff).patch(`/receiving/${gr.id}/inspect`, {
        items: [{ itemId: item.id, inspectedQty: 2, inspectionOutcome: 'good', serialNumber: 'SN-CORRECTED' }],
      }), 200);
      expect(await stockRow(item.stockItemId)).toMatchObject({ serialNumber: 'SN-CORRECTED', status: StockStatus.PENDING_INSPECTION });
    });

    it('legacy verify runs once', async () => {
      const gr = await receipt();
      expectStatus(await fx.as(staff).patch(`/receiving/${gr.id}/verify`), 200);
      await fx.as(staff).patch(`/receiving/${gr.id}/verify`).expect(409);
      expect((await stockRow(gr.items[0].stockItemId)).status).toBe(StockStatus.PENDING_INSPECTION);
    });
  });

  describe('unused return', () => {
    async function issuedRequest(unitStatus: StockStatus, usage: string | null) {
      const product = await fx.product();
      const [unit] = await fx.stock(product.id, 1, { status: unitStatus });
      const req = await fx.prisma.withdrawalRequest.create({
        data: {
          refNumber: fx.uid('WR'), requesterId: requester.id, department: 'x', status: 'ISSUED_TO_RMA',
          items: { create: [{ productId: product.id, quantityRequested: 1, stockItemId: unit.id, shippedStockItemId: unit.id, usageStatus: usage }] },
        },
      });
      return { unit, req };
    }

    it('returns issued goods flagged unused, exactly once', async () => {
      const { unit, req } = await issuedRequest(StockStatus.SHIPPED, 'UNUSED');
      await fx.as(requester).patch(`/unused/${req.id}/return`).expect(403);
      expectStatus(await fx.as(staff).patch(`/unused/${req.id}/return`), 200);
      expect((await stockRow(unit.id)).status).toBe(StockStatus.AVAILABLE);
      await fx.as(staff).patch(`/unused/${req.id}/return`).expect(400);
    });

    it('refuses requests not flagged unused and units that were consumed', async () => {
      const notFlagged = await issuedRequest(StockStatus.SHIPPED, null);
      await fx.as(staff).patch(`/unused/${notFlagged.req.id}/return`).expect(400);

      const consumed = await issuedRequest(StockStatus.CONSUMED, 'UNUSED');
      await fx.as(staff).patch(`/unused/${consumed.req.id}/return`).expect(409);
      expect((await stockRow(consumed.unit.id)).status).toBe(StockStatus.CONSUMED);
      expect((await fx.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: consumed.req.id } })).status).toBe('ISSUED_TO_RMA');
    });
  });

  describe('scrap', () => {
    async function scrapCase(stockItemId: string, quantity: number) {
      const res = await fx.as(manager).post('/scrap', { stockItemId, reason: 'broken', quantity });
      expectStatus(res, 201);
      expectStatus(await fx.as(manager).patch(`/scrap/${res.body.id}/status`, { status: 'APPROVED' }), 200);
      return res.body.id as string;
    }

    it('disposal removes the unit from stock, once', async () => {
      const product = await fx.product();
      const [unit] = await fx.stock(product.id, 1);
      const id = await scrapCase(unit.id, 1);
      const both = await Promise.all([
        fx.as(manager).patch(`/scrap/${id}/status`, { status: 'DISPOSED' }),
        fx.as(manager).patch(`/scrap/${id}/status`, { status: 'DISPOSED' }),
      ]);
      expectOneWinner(both.map((r) => r.status));
      expect((await stockRow(unit.id)).status).toBe(StockStatus.CLOSED);
    });

    it('partial disposal of a bulk row deducts only the scrapped quantity', async () => {
      const product = await fx.product();
      const [row] = await fx.stock(product.id, 1, { quantity: 10, serial: false });
      const id = await scrapCase(row.id, 4);
      expectStatus(await fx.as(manager).patch(`/scrap/${id}/status`, { status: 'DISPOSED' }), 200);
      expect(await stockRow(row.id)).toMatchObject({ status: StockStatus.AVAILABLE, quantity: 6 });
    });

    it('committed stock cannot be scrapped, and requesters cannot scrap', async () => {
      const product = await fx.product();
      const [reserved] = await fx.stock(product.id, 1, { status: StockStatus.RESERVED });
      await fx.as(manager).post('/scrap', { stockItemId: reserved.id, reason: 'x' }).expect(400);
      await fx.as(requester).post('/scrap', { stockItemId: reserved.id, reason: 'x' }).expect(403);
    });
  });

  describe('cycle count approval', () => {
    it('applies variances only to stock unchanged since the count', async () => {
      const loc = await fx.location();
      const product = await fx.product();
      const [steady, moved] = await fx.stock(product.id, 2, { quantity: 5, serial: false, warehouseId: loc.warehouse.id });
      const created = await fx.as(staff).post('/cycle-count', { warehouseId: loc.warehouse.id });
      expectStatus(created, 201);
      for (const line of created.body.lines) {
        expectStatus(await fx.as(staff).patch(`/cycle-count/${created.body.id}/lines/${line.id}/count`, { countedQty: 4 }), 200);
      }
      expectStatus(await fx.as(staff).post(`/cycle-count/${created.body.id}/submit`), 201);
      await fx.prisma.stockItem.update({ where: { id: moved.id }, data: { quantity: 7 } }); // stock moved after counting

      await fx.as(staff).post(`/cycle-count/${created.body.id}/approve`).expect(403); // counter's role cannot approve
      const approved = await fx.as(manager).post(`/cycle-count/${created.body.id}/approve`);
      expectStatus(approved, 201);
      expect(approved.body.skippedLineIds).toHaveLength(1);
      expect((await stockRow(steady.id)).quantity).toBe(4);
      expect((await stockRow(moved.id)).quantity).toBe(7);
      await fx.as(manager).post(`/cycle-count/${created.body.id}/approve`).expect(400);
      await fx.as(manager).post(`/cycle-count/${created.body.id}/cancel`).expect(409);
    });
  });

  describe('stock adjustment approval', () => {
    it('is refused when the stock no longer holds quantityBefore, and decided once', async () => {
      const product = await fx.product();
      const [row] = await fx.stock(product.id, 1, { quantity: 10, serial: false });
      const stale = await fx.as(manager).post('/adjustment', { stockItemId: row.id, productLabel: 'x', reason: 'count', quantityBefore: 8, quantityAfter: 9 });
      await fx.as(manager).patch(`/adjustment/${stale.body.id}/approve`).expect(409);
      expect((await stockRow(row.id)).quantity).toBe(10);
      expect((await fx.prisma.stockAdjustment.findUniqueOrThrow({ where: { id: stale.body.id } })).status).toBe('PENDING_APPROVAL');

      const good = await fx.as(manager).post('/adjustment', { stockItemId: row.id, productLabel: 'x', reason: 'count', quantityBefore: 10, quantityAfter: 9 });
      const both = await Promise.all([
        fx.as(manager).patch(`/adjustment/${good.body.id}/approve`),
        fx.as(manager).patch(`/adjustment/${good.body.id}/approve`),
      ]);
      expectOneWinner(both.map((r) => r.status));
      expect((await stockRow(row.id)).quantity).toBe(9);
    });
  });

  describe('DOA', () => {
    it('cannot be declared on stock committed to an outbound task; one open RTV case per unit', async () => {
      const product = await fx.product();
      const [reserved] = await fx.stock(product.id, 1, { status: StockStatus.RESERVED });
      await fx.as(manager).patch(`/doa/${reserved.id}/declare`, { reason: 'dead' }).expect(409);
      await fx.as(requester).patch(`/doa/${reserved.id}/declare`, { reason: 'dead' }).expect(403);

      const [unit] = await fx.stock(product.id, 1);
      expectStatus(await fx.as(manager).patch(`/doa/${unit.id}/declare`, { reason: 'dead' }), 200);
      expectStatus(await fx.as(manager).post(`/doa/${unit.id}/rtv`, {}), 201);
      await fx.as(manager).post(`/doa/${unit.id}/rtv`, {}).expect(409);
      expect(await fx.prisma.rTVCase.count({ where: { stockItemId: unit.id } })).toBe(1);
    });
  });
});
