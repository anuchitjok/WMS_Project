import request from 'supertest';
import { StockStatus, UserRole } from '@prisma/client';
import { Fixture, TestUser, expectStatus } from './harness';

// MRP end to end on a real Postgres engine: data sources, PO import, planning
// parameters, a deterministic run checked against hand-calculated numbers,
// cost redaction, warehouse scope, reproducibility, forecast adjustments and
// the real goods-issue path feeding usage history.

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const AS_OF = '2026-07-01T00:00:00.000Z';

describe('MRP (integration)', () => {
  let fx: Fixture;
  let A: Awaited<ReturnType<Fixture['location']>>;
  let B: Awaited<ReturnType<Fixture['location']>>;
  let admin: TestUser, admin2: TestUser, planner: TestUser, plannerA: TestUser, approver: TestUser, viewer: TestUser;
  let P: { id: string; code: string };
  let vendor: { id: string; code: string };

  const upload = (u: TestUser, path: string, csv: string) =>
    request(fx.app.getHttpServer()).post(`/api${path}`).set('Authorization', `Bearer ${fx.token(u)}`).attach('file', Buffer.from(csv), 'po.csv');

  async function issue(productId: string, warehouseId: string, qty: number, shippedAt: Date) {
    const t = await fx.prisma.fulfillmentTask.create({
      data: {
        refNumber: fx.uid('FT'), requestId: fx.uid('REQ'), requestRef: fx.uid('WR'), status: 'SHIPPED', warehouseId,
        items: { create: { productId, qtyRequested: qty, qtyPicked: qty } },
      },
    });
    await fx.prisma.shipment.create({ data: { refNumber: fx.uid('SH'), taskId: t.id, shippedAt } });
  }

  async function lineFor(u: TestUser, runId: string, sku: string) {
    const res = await fx.as(u).get(`/mrp/runs/${runId}/lines?search=${sku}`);
    expectStatus(res, 200);
    const row = res.body.data.find((l: { sku: string }) => l.sku === sku);
    const detail = await fx.as(u).get(`/mrp/runs/${runId}/lines/${row.id}`);
    expectStatus(detail, 200);
    return { row, detail: detail.body };
  }

  beforeAll(async () => {
    fx = await Fixture.start();
    A = await fx.location();
    B = await fx.location();
    admin = await fx.user(UserRole.SYSTEM_ADMIN, 'SUPER_ADMIN');
    admin2 = await fx.user(UserRole.SYSTEM_ADMIN, 'SUPER_ADMIN');
    planner = await fx.user(UserRole.WAREHOUSE_MANAGER, 'MRP_PLANNER');
    plannerA = await fx.user(UserRole.WAREHOUSE_MANAGER, 'MRP_PLANNER');
    await fx.prisma.userWarehouse.create({ data: { userId: plannerA.id, warehouseId: A.warehouse.id } });
    approver = await fx.user(UserRole.WAREHOUSE_MANAGER, 'MRP_APPROVER');
    viewer = await fx.user(UserRole.MGMT_VIEWER, 'MRP_VIEWER');

    P = await fx.product();
    vendor = await fx.prisma.vendor.create({ data: { code: fx.uid('V'), name: 'Vendor One' } });

    // Stock: A = 10 available + 4 reserved, B = 3 available → network usable 13.
    await fx.stock(P.id, 1, { quantity: 10, serial: false, warehouseId: A.warehouse.id });
    await fx.stock(P.id, 1, { quantity: 4, serial: false, warehouseId: A.warehouse.id, status: StockStatus.RESERVED });
    await fx.stock(P.id, 1, { quantity: 3, serial: false, warehouseId: B.warehouse.id });

    // History (goods issued from A): Apr 9, May 12, Jun 15.
    await issue(P.id, A.warehouse.id, 9, D('2026-04-10'));
    await issue(P.id, A.warehouse.id, 12, D('2026-05-10'));
    await issue(P.id, A.warehouse.id, 15, D('2026-06-10'));

    // Open demand: a submitted request for 5, required 20 Jun (past due at the as-of date).
    const requester = await fx.user(UserRole.REQUESTER, 'REQUESTER');
    await fx.prisma.withdrawalRequest.create({
      data: { refNumber: fx.uid('WR'), requesterId: requester.id, department: 'Service', status: 'SUBMITTED', requiredDate: D('2026-06-20'), items: { create: { productId: P.id, quantityRequested: 5 } } },
    });

    // 8 units already booked in WMS receiving against PO-1.
    await fx.prisma.goodsReceiving.create({ data: { refNumber: fx.uid('GR'), poNumber: 'PO-1', items: { create: { productId: P.id, quantity: 8 } } } });

    // Configuration (short horizon so the numbers can be checked by hand).
    expectStatus(await fx.as(admin).put('/mrp/config', {
      config: { horizonPeriods: 3, historyPeriods: 6, methods: { SMA: { window: 3 }, FMA: { window: 2 }, WMA: { window: 3, weights: [0.5, 0.3, 0.2] }, LINEAR: { window: 6 } } },
    }), 200);
  });
  afterAll(() => fx?.stop());

  it('refuses an invalid configuration and users without mrp.config', async () => {
    await fx.as(admin).put('/mrp/config', { config: { methods: { WMA: { window: 3, weights: [1, 1] } } } }).expect(400);
    await fx.as(planner).put('/mrp/config', { config: { horizonPeriods: 4 } }).expect(403);
  });

  it('imports PO lines: preview writes nothing, invalid rows are rejected', async () => {
    const header = 'poNumber,lineNumber,sku,vendorCode,warehouseCode,orderedQty,receivedQty,cancelledQty,uom,unitCost,currency,orderDate,expectedDate,confirmed,status';
    const csv = [
      header,
      `PO-1,1,${P.code},${vendor.code},${A.warehouse.code},20,0,0,unit,,,2026-05-01,2026-06-25,Y,`,
      `PO-2,1,${P.code},${vendor.code},${A.warehouse.code},50,0,50,unit,,,2026-05-01,2026-07-10,N,CANCELLED`,
      `PO-3,1,${P.code},${vendor.code},${B.warehouse.code},10,3,0,unit,,,2026-06-01,2026-08-15,Y,`,
      `PO-9,1,NO-SUCH-SKU,,,5,0,0,,,,,2026-08-01,,`,
      `PO-9,2,${P.code},,,5,4,3,,,,,2026-08-01,,`,
      `PO-9,3,${P.code},,,5,0,0,,9.99,,,2026-08-01,,`,
    ].join('\n');
    const pre = await upload(planner, '/mrp/supply/import/preview', csv);
    expectStatus(pre, 201);
    expect(pre.body).toMatchObject({ total: 6, valid: 3, invalid: 3 });
    expect(pre.body.rows[3].errors[0]).toMatch(/Unknown SKU/);
    expect(pre.body.rows[4].errors).toContain('receivedQty + cancelledQty exceed orderedQty');
    expect(pre.body.rows[5].errors.join(' ')).toMatch(/currency|permission/);
    expect(await fx.prisma.inboundSupplyLine.count()).toBe(0);

    const commit = await upload(planner, '/mrp/supply/import/commit', csv);
    expectStatus(commit, 201);
    expect(commit.body).toMatchObject({ created: 3, updated: 0, skipped: 3 });
    const po3 = await fx.prisma.inboundSupplyLine.findUniqueOrThrow({ where: { poNumber_lineNumber: { poNumber: 'PO-3', lineNumber: '1' } } });
    expect(po3.status).toBe('PARTIAL');
    // The calendar dates in the file are kept, whatever the server's time zone.
    expect(po3.expectedDate?.toISOString()).toBe('2026-08-15T00:00:00.000Z');
    expect(po3.orderDate?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    await upload(viewer, '/mrp/supply/import/commit', csv).expect(403);
    expect(await fx.prisma.auditLog.count({ where: { action: 'MRP_SUPPLY_IMPORTED' } })).toBe(1);

    // Outstanding uses max(reported, WMS) received — PO-1 has 8 received in the WMS.
    const list = await fx.as(viewer).get(`/mrp/supply?productId=${P.id}`);
    const po1 = list.body.data.find((l: { poNumber: string }) => l.poNumber === 'PO-1');
    expect(po1).toMatchObject({ wmsReceivedQty: 8, outstandingQty: 12, overdue: true });
  });

  it('planning parameters: validated, versioned, cost needs mrp.cost', async () => {
    await fx.as(planner).post('/mrp/parameters', { productId: P.id, minStock: 9, maxStock: 5 }).expect(400);
    await fx.as(planner).post('/mrp/parameters', { productId: P.id, unitCost: 3, currency: 'USD' }).expect(403);
    await fx.as(plannerA).post('/mrp/parameters', { productId: P.id, safetyStock: 1 }).expect(403); // all-warehouse row needs an unrestricted planner
    await fx.as(viewer).post('/mrp/parameters', { productId: P.id, safetyStock: 1 }).expect(403);

    const v1 = await fx.as(planner).post('/mrp/parameters', { productId: P.id, safetyStock: 2, leadTimeDays: 10, effectiveFrom: '2026-01-01' });
    expectStatus(v1, 201);
    const v2 = await fx.as(planner).post('/mrp/parameters', { productId: P.id, safetyStock: 5, leadTimeDays: 30, moq: 10, orderMultiple: 5, criticality: 'HIGH', effectiveFrom: '2026-03-01' });
    expectStatus(v2, 201);
    const closed = await fx.prisma.materialPlanningParam.findUniqueOrThrow({ where: { id: v1.body.row.id } });
    expect(closed.effectiveTo?.toISOString().slice(0, 10)).toBe('2026-03-01');
    await fx.as(planner).post('/mrp/parameters', { productId: P.id, safetyStock: 1, effectiveFrom: '2026-02-01' }).expect(409);

    // Supplier price needs mrp.cost: planner refused, admin allowed.
    await fx.as(planner).post('/mrp/suppliers', { productId: P.id, vendorId: vendor.id, isPreferred: true, unitPrice: 2.5, currency: 'USD' }).expect(403);
    expectStatus(await fx.as(admin).post('/mrp/suppliers', { productId: P.id, vendorId: vendor.id, isPreferred: true, leadTimeDays: 20, unitPrice: 2.5, currency: 'USD', priceSource: 'QUOTE' }), 201);
    expect(await fx.prisma.auditLog.count({ where: { action: { in: ['MRP_PARAMETERS_CREATED', 'MRP_SUPPLIER_CREATED'] } } })).toBe(3);
  });

  let networkRun: { id: string; inputHash: string };

  it('all-warehouse run matches the hand calculation', async () => {
    await fx.as(viewer).post('/mrp/runs', { asOf: AS_OF }).expect(403);
    const res = await fx.as(planner).post('/mrp/runs', { asOf: AS_OF, note: 'test' });
    expectStatus(res, 201);
    networkRun = res.body;
    const { row, detail } = await lineFor(approver, res.body.id, P.code);
    // usable 13; supply PO-1 12 (overdue → first bucket), PO-3 7 (Aug); SMA(9,12,15) = 12/month; open request 5 → gross max(12,5)
    // b0: 13 + 12 − 12 = 13 | b1: 13 + 7 − 12 = 8 | b2: 8 − 12 = −4 → net 9 → MOQ 10 → order 10, arrive 1 Sep, order 2 Aug
    expect(row).toMatchObject({
      onHand: 17, available: 13, allocated: 4, safetyStock: 5, openPoQty: 19, grossReq: 36, netReq: 9, projectedShortage: 4,
      suggestedQty: 10, planningStatus: 'PLANNED', leadTimeDays: 30, moq: 10, orderMultiple: 5, unitCost: 2.5, currency: 'USD', estCost: 25,
    });
    expect(row.suggestedOrderDate.slice(0, 10)).toBe('2026-08-02');
    expect(row.requiredDate.slice(0, 10)).toBe('2026-09-01');
    expect(row.exceptionCodes).toEqual(expect.arrayContaining(['OVERDUE_PO', 'PROJECTED_SHORTAGE']));
    expect(detail.detail.plan.plan.buckets.map((b: { projected: number }) => b.projected)).toEqual([13, 8, 6]);
    expect(detail.detail.plan.demand).toMatchObject({ openQty: 5, pastDue: 5 });
    // First goods issue was in April, so history starts there (Jan–Mar are not zero demand).
    expect(detail.detail.plan.usage.series.points.map((p: { qty: number }) => p.qty)).toEqual([9, 12, 15]);
    expect(detail.detail.plan.usage.series).toMatchObject({ trimmedPeriods: 3, historyStart: '2026-04-10' });
    // Cancelled PO-2 never enters planning.
    expect(detail.detail.plan.supply.lines.map((l: { poNumber: string }) => l.poNumber).sort()).toEqual(['PO-1', 'PO-3']);
    expect(await fx.prisma.auditLog.count({ where: { action: 'MRP_RUN', entityId: res.body.id } })).toBe(1);
  });

  it('hides costs from users without mrp.cost (lines, detail, export)', async () => {
    const { row, detail } = await lineFor(viewer, networkRun.id, P.code);
    expect(row).toMatchObject({ unitCost: null, estCost: null, currency: null });
    expect(detail.detail.plan.cost.unitCost).toBeNull();
    expect(detail.detail.snapshot.supplier.unitPrice).toBeNull();
    await fx.as(viewer).get(`/mrp/runs/${networkRun.id}/export`).expect(403);
    const csv = await fx.as(planner).get(`/mrp/runs/${networkRun.id}/export`);
    expectStatus(csv, 200);
    expect(csv.text).not.toMatch(/Unit cost/);
    const withCost = await fx.as(approver).get(`/mrp/runs/${networkRun.id}/export`);
    expect(withCost.text).toMatch(/Estimated cost/);
  });

  it('is reproducible: verify recalculates identically; same inputs give the same hash', async () => {
    const v = await fx.as(viewer).get(`/mrp/runs/${networkRun.id}/verify`);
    expectStatus(v, 200);
    expect(v.body).toMatchObject({ reproducible: true, inputHashMatches: true, mismatches: [] });
    const again = await fx.as(planner).post('/mrp/runs', { asOf: AS_OF });
    expect(again.body.inputHash).toBe(networkRun.inputHash);
    const cmp = await fx.as(viewer).get(`/mrp/runs/compare?base=${networkRun.id}&target=${again.body.id}`);
    expect(cmp.body).toMatchObject({ sameInputs: true, configChanged: false, changes: [] });
  });

  it('warehouse scope: a planner restricted to A plans A only and cannot see all-warehouse runs', async () => {
    await fx.as(plannerA).post('/mrp/runs', { asOf: AS_OF, warehouseId: B.warehouse.id }).expect(403);
    await fx.as(plannerA).get(`/mrp/runs/${networkRun.id}`).expect(403);
    const res = await fx.as(plannerA).post('/mrp/runs', { asOf: AS_OF });
    expectStatus(res, 201);
    expect(res.body.scope).toEqual([A.warehouse.id]);
    expect(res.body.warnings.join(' ')).toMatch(/withdrawal requests are not included/);
    const { row } = await lineFor(plannerA, res.body.id, P.code);
    // A only: usable 10, PO-1 12 overdue; PO-3 (B) and the request are out.
    // b0: 10 + 12 − 12 = 10 | b1: 10 − 12 = −2 → order 10 (arrive 1 Aug, order 2 Jul) | b2: 8 − 12 → order 10
    expect(row).toMatchObject({ available: 10, openPoQty: 12, suggestedQty: 10, unitCost: null });
    expect(row.suggestedOrderDate.slice(0, 10)).toBe('2026-07-02');
    const runs = await fx.as(plannerA).get('/mrp/runs');
    expect(runs.body.every((r: { scope: string[] | null }) => Array.isArray(r.scope) && r.scope.every((w) => w === A.warehouse.id))).toBe(true);

    // Comparing a one-warehouse run with the network run matches materials, not "removed + added".
    const one = await fx.as(admin).post('/mrp/runs', { asOf: AS_OF, warehouseId: A.warehouse.id });
    expectStatus(one, 201);
    const cmp = await fx.as(admin).get(`/mrp/runs/compare?base=${networkRun.id}&target=${one.body.id}`);
    expectStatus(cmp, 200);
    expect(cmp.body.scopeChanged).toBe(true);
    expect(cmp.body.changes.filter((c: { change: string }) => c.change !== 'CHANGED')).toEqual([]);
  });

  it('forecast adjustments: statistical value kept, approval by someone else, applied in the next run', async () => {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    await fx.as(planner).post('/mrp/overrides', { productId: P.id, periodStart: '2026-01-01', mode: 'REPLACE', quantity: 1, reason: 'past' }).expect(400);
    await fx.as(planner).post('/mrp/overrides', { productId: P.id, periodStart: next.slice(0, 8) + '15', mode: 'REPLACE', quantity: 1, reason: 'mid-month' }).expect(400);
    const created = await fx.as(planner).post('/mrp/overrides', { productId: P.id, periodStart: next, mode: 'REPLACE', quantity: 40, reason: 'Service campaign', category: 'CAMPAIGN' });
    expectStatus(created, 201);
    expect(created.body).toMatchObject({ status: 'PENDING', statisticalMethod: 'SMA' });
    expect(typeof created.body.statisticalQty).toBe('number');

    // Pending adjustments are not used.
    const before = await fx.as(planner).post('/mrp/runs', {});
    const b = await lineFor(planner, before.body.id, P.code);
    expect(b.detail.detail.plan.forecastFinal[1]).toBe(b.detail.detail.plan.forecast.perPeriod[1]);

    await fx.as(planner).patch(`/mrp/overrides/${created.body.id}/decide`, { approve: true }).expect(403); // no approve permission
    const own = await fx.as(admin).post('/mrp/overrides', { productId: P.id, periodStart: next, mode: 'ADD', quantity: 1, reason: 'own' });
    await fx.as(admin).patch(`/mrp/overrides/${own.body.id}/decide`, { approve: true }).expect(403); // maker ≠ checker
    expectStatus(await fx.as(admin2).patch(`/mrp/overrides/${own.body.id}/decide`, { approve: false, note: 'no' }), 200);
    expectStatus(await fx.as(approver).patch(`/mrp/overrides/${created.body.id}/decide`, { approve: true, note: 'ok' }), 200);
    await fx.as(approver).patch(`/mrp/overrides/${created.body.id}/decide`, { approve: true }).expect(409);

    const after = await fx.as(planner).post('/mrp/runs', {});
    const a = await lineFor(planner, after.body.id, P.code);
    expect(a.detail.detail.plan.forecastFinal[1]).toBe(40);
    expect(a.detail.detail.plan.overridesApplied[0]).toMatchObject({ mode: 'REPLACE', quantity: 40 });
    const actions = (await fx.prisma.auditLog.findMany({ where: { entityType: 'ForecastOverride' }, select: { action: true } })).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['MRP_FORECAST_OVERRIDE_CREATED', 'MRP_FORECAST_OVERRIDE_APPROVED', 'MRP_FORECAST_OVERRIDE_REJECTED']));
  });

  it('usage history comes from the real goods-issue (dispatch) path', async () => {
    const staff = await fx.user(UserRole.WAREHOUSE_STAFF, 'WAREHOUSE_MANAGER');
    const requester = await fx.user(UserRole.REQUESTER, 'REQUESTER');
    const Q = await fx.product();
    await fx.stock(Q.id, 1, { quantity: 6, serial: false, warehouseId: A.warehouse.id, rackId: A.rack.id, slotId: A.slot.id });
    const req = await fx.approvedRequest(requester, admin, [{ productId: Q.id, quantity: 2 }]);
    const task = await fx.allocatedTask(req.id, staff);
    await fx.packedTask(task.id, staff);
    const sh = await fx.as(staff).post(`/fulfillment/${task.id}/shipment`, { carrier: 'X' });
    expectStatus(sh, 201);
    expectStatus(await fx.as(staff).post(`/fulfillment/shipments/${sh.body.id}/dispatch`), 201);

    const u = await fx.as(viewer).get(`/mrp/usage/${Q.id}?granularity=DAY&periods=7`);
    expectStatus(u, 200);
    expect(u.body.series.periodToDate).toBe(2); // issued today: the current, incomplete period
    expect(u.body.sources[0]).toMatchObject({ kind: 'ISSUE', qty: 2, warehouseId: A.warehouse.id });
    // Receipts and stock creation are never usage.
    expect(u.body.totals).toMatchObject({ issues: 2, unusedReturns: 0 });
  });

  it('parameter list flags missing data', async () => {
    const res = await fx.as(viewer).get('/mrp/parameters?missing=true');
    expectStatus(res, 200);
    const other = res.body.data.find((r: { product: { id: string } }) => r.product.id !== P.id);
    expect(other.missing).toContain('parameters');
  });
  it('a planner without cost rights keeps the existing cost when adding a parameter version', async () => {
    const Q = await fx.product();
    expectStatus(await fx.as(admin).post('/mrp/parameters', { productId: Q.id, safetyStock: 1, unitCost: 4, currency: 'USD', costBasis: 'Quote', effectiveFrom: '2026-01-01' }), 201);
    const v2 = await fx.as(planner).post('/mrp/parameters', { productId: Q.id, safetyStock: 3, effectiveFrom: '2026-02-01' });
    expectStatus(v2, 201);
    expect(v2.body.row.unitCost).toBeNull(); // hidden from the planner…
    const stored = await fx.prisma.materialPlanningParam.findUniqueOrThrow({ where: { id: v2.body.row.id } });
    expect(stored).toMatchObject({ safetyStock: 3, unitCost: 4, currency: 'USD', costBasis: 'Quote' }); // …but not lost
    const hist = await fx.as(planner).get(`/mrp/parameters/${Q.id}`);
    expect(hist.body.canSeeCost).toBe(false);
    expect(hist.body.rows.every((r: { unitCost: number | null }) => r.unitCost === null)).toBe(true);
  });

  it('history start: the full window when issued before it, in the scope that ran', async () => {
    const R = await fx.product();
    await issue(R.id, B.warehouse.id, 4, D('2025-12-10')); // before the Jan–Jun window, in B only
    await issue(R.id, A.warehouse.id, 6, D('2026-05-10'));
    const series = async (warehouseId?: string) => {
      const run = await fx.as(admin).post('/mrp/runs', { asOf: AS_OF, ...(warehouseId ? { warehouseId } : {}) });
      expectStatus(run, 201);
      return (await lineFor(admin, run.body.id, R.code)).detail.detail.plan.usage.series;
    };
    // Network: issued before the window → all six months count.
    expect(await series()).toMatchObject({ trimmedPeriods: 0, historyStart: null });
    // Warehouse A never issued it before May → history starts in May there.
    const a = await series(A.warehouse.id);
    expect(a.points.map((p: { qty: number }) => p.qty)).toEqual([6, 0]);
    expect(a).toMatchObject({ trimmedPeriods: 4, historyStart: '2026-05-10' });
  });
});
