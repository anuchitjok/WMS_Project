import request from 'supertest';
import { StockStatus, UserRole } from '@prisma/client';
import { Fixture, TestUser, expectStatus } from './harness';

// Phase 2 — Step 5 ("Keep stock accurate") is retired. With the rollback switch
// off (default): the write commands answer 410, history stays readable, old
// records are not changed, and Step 2–4 keep moving stock.
describe('Step 5 retirement', () => {
  let fx: Fixture;
  let manager: TestUser, staff: TestUser, requester: TestUser, admin: TestUser;
  let loc: Awaited<ReturnType<Fixture['location']>>;

  beforeAll(async () => {
    delete process.env.ENABLE_STEP5_LEGACY;
    fx = await Fixture.start();
    manager = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WAREHOUSE_MANAGER');
    staff = await fx.user(UserRole.WAREHOUSE_STAFF);
    requester = await fx.user(UserRole.REQUESTER, 'REQUESTER');
    admin = await fx.user(UserRole.SYSTEM_ADMIN, 'SUPER_ADMIN');
    loc = await fx.location();
  });
  afterAll(async () => { await fx.stop(); });

  const gone = (res: { status: number; body: any }, feature: string) => {
    expectStatus(res, 410);
    expect(res.body.retired).toBe(feature);
    expect(res.body.viewAt).toBe('/reports?tab=balance');
  };

  it('Stock Adjustment: create/approve/reject are 410; the completed history (ADJ-2026-DWYA-H shape) stays readable and unchanged', async () => {
    const product = await fx.product();
    const [row] = await fx.stock(product.id, 1, { quantity: 1, serial: false });
    const old = await fx.prisma.stockAdjustment.create({
      data: { refNumber: 'ADJ-2026-DWYA-H', stockItemId: row.id, productLabel: product.code, reason: 'Opening', quantityBefore: 0, quantityAfter: 1, status: 'COMPLETED' },
    });
    gone(await fx.as(manager).post('/adjustment', { stockItemId: row.id, productLabel: 'x', reason: 'count', quantityBefore: 1, quantityAfter: 2 }), 'Stock Adjustment');
    gone(await fx.as(admin).patch(`/adjustment/${old.id}/approve`), 'Stock Adjustment');
    gone(await fx.as(admin).patch(`/adjustment/${old.id}/reject`, { reason: 'x' }), 'Stock Adjustment');

    const list = await fx.as(manager).get('/adjustment');
    expectStatus(list, 200);
    expect(JSON.stringify(list.body)).toContain('ADJ-2026-DWYA-H');
    expect(await fx.prisma.stockAdjustment.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ status: 'COMPLETED', quantityBefore: 0, quantityAfter: 1 });
    expect((await fx.prisma.stockItem.findUniqueOrThrow({ where: { id: row.id } })).quantity).toBe(1);
  });

  it('Stock Transfer: create/complete are 410; list stays readable', async () => {
    const product = await fx.product();
    const [row] = await fx.stock(product.id, 1);
    gone(await fx.as(manager).post('/transfer', { stockItemId: row.id, productLabel: 'x', quantity: 1, fromLocation: 'A', toLocation: 'B' }), 'Stock Transfer');
    gone(await fx.as(manager).patch('/transfer/any/complete', {}), 'Stock Transfer');
    expectStatus(await fx.as(manager).get('/transfer'), 200);
  });

  it('Cycle Count: new sessions and counting are 410; an OPEN legacy count (CC-2026-A3DJNU shape) is readable, still locks its rows, and can be cancelled to release them', async () => {
    const product = await fx.product();
    const [counted, free] = await fx.stock(product.id, 2, { warehouseId: loc.warehouse.id, rackId: loc.rack.id, slotId: loc.slot.id });
    const session = await fx.prisma.cycleCountSession.create({
      data: { refNumber: 'CC-2026-A3DJNU', warehouseId: loc.warehouse.id, status: 'OPEN', type: 'FULL' },
    });
    const line = await fx.prisma.cycleCountLine.create({
      data: { sessionId: session.id, productId: product.id, stockItemId: counted.id, expectedQty: 1 },
    });

    gone(await fx.as(staff).post('/cycle-count', { warehouseId: loc.warehouse.id }), 'Cycle Count');
    gone(await fx.as(staff).patch(`/cycle-count/${session.id}/lines/${line.id}/count`, { countedQty: 1 }), 'Cycle Count');
    gone(await fx.as(staff).post(`/cycle-count/${session.id}/submit`), 'Cycle Count');
    gone(await fx.as(manager).post(`/cycle-count/${session.id}/approve`), 'Cycle Count');
    gone(await fx.as(manager).post(`/cycle-count/${session.id}/recount-conflicts`), 'Cycle Count');
    expectStatus(await fx.as(manager).get(`/cycle-count/${session.id}`), 200);

    // The lock still protects the counted row: approval reserves the free one only.
    const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
    expect(await fx.statuses([counted.id, free.id])).toEqual([StockStatus.AVAILABLE, StockStatus.RESERVED]);
    expect((await fx.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('APPROVED');

    // Cancelling the retired count is still allowed (audited) and releases the lock.
    expectStatus(await fx.as(manager).post(`/cycle-count/${session.id}/cancel`, { reason: 'Cycle Count retired' }), 201);
    expect((await fx.prisma.cycleCountSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('CANCELLED');
    const req2 = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
    expect(await fx.statuses([counted.id])).toEqual([StockStatus.RESERVED]);
    expect(req2.id).toBeTruthy();
  });

  it('direct Inventory edits (create, status, location) are 410; stock reads still work', async () => {
    const product = await fx.product();
    const [row] = await fx.stock(product.id, 1);
    gone(await fx.as(manager).post('/inventory', { productId: product.id }), 'Direct stock editing (Inventory)');
    gone(await fx.as(manager).patch(`/inventory/${row.id}/status`, { status: 'QUARANTINE' }), 'Direct stock editing (Inventory)');
    gone(await fx.as(manager).patch(`/inventory/${row.id}/location`, { slotId: loc.slot.id }), 'Direct stock editing (Inventory)');
    expect(await fx.statuses([row.id])).toEqual([StockStatus.AVAILABLE]);
    expectStatus(await fx.as(manager).get(`/inventory/${row.id}`), 200);
    expectStatus(await fx.as(manager).get(`/inventory/${row.id}/detail-full`), 200);
  });

  it('permission checks still run before the retirement answer (a requester gets 403, not 410)', async () => {
    await fx.as(requester).post('/adjustment', { stockItemId: 'x', productLabel: 'x', reason: 'x', quantityBefore: 0, quantityAfter: 1 }).expect(403);
  });

  it('scan workflows TRANSFER / COUNT / ADJUST answer RETIRED and change nothing', async () => {
    const product = await fx.product({ serialControlled: true });
    const [unit] = await fx.stock(product.id, 1);
    for (const workflow of ['TRANSFER', 'COUNT', 'ADJUST']) {
      const res = await fx.as(manager).post('/scan', { workflow, rawValue: `SN|${unit.serialNumber}` });
      expect(res.body.result).toBe('RETIRED');
    }
    expect(await fx.statuses([unit.id])).toEqual([StockStatus.AVAILABLE]);
  });

  it('Reports → Balance (where /inventory now lands) gives each row its stock id for the read-only detail, without exporting or searching it', async () => {
    const product = await fx.product();
    const [row] = await fx.stock(product.id, 1);
    const res = await fx.as(requester).get('/reports/balance');
    expectStatus(res, 200);
    const mine = res.body.rows.find((r: any) => r.stockId === row.id);
    expect(mine).toBeTruthy();
    expect(res.body.columns.map((c: any) => c.key)).not.toContain('stockId');

    const byId = await fx.as(manager).get(`/reports/balance?q=${row.id}`);
    expectStatus(byId, 200);
    expect(byId.body.rows.find((r: any) => r.stockId === row.id)).toBeUndefined();

    const csv = await fx.as(manager).get('/reports/balance/export?format=csv');
    expectStatus(csv, 200);
    expect(String(csv.text ?? csv.body)).not.toContain(row.id);
    expectStatus(await fx.as(requester).get(`/inventory/${row.id}/detail-full`), 200);
  });

  it('stock imports (inventory, serials) are 410 for preview and commit; master-data imports still preview', async () => {
    const csv = Buffer.from('productCode,quantity\nX,1\n');
    const call = (path: string) =>
      request(fx.app.getHttpServer()).post(`/api${path}`).set('Authorization', `Bearer ${fx.token(admin)}`).attach('file', csv, 'stock.csv');
    gone(await call('/io/import/inventory/preview'), 'Stock import (Inventory / Serials)');
    gone(await call('/io/import/serials/commit'), 'Stock import (Inventory / Serials)');
    const products = await call('/io/import/products/preview');
    expect(products.status).not.toBe(410);
  });
});
