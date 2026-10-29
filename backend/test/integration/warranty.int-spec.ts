import { UserRole } from '@prisma/client';
import { Fixture, TestUser, expectStatus } from './harness';

// Warranty rules end to end: draft → activate (maker ≠ checker) → lookup →
// versioning → overlap refusal → dates the WMS does not capture → scope.

describe('Warranty (integration)', () => {
  let fx: Fixture;
  let A: Awaited<ReturnType<Fixture['location']>>;
  let B: Awaited<ReturnType<Fixture['location']>>;
  let maker: TestUser, checker: TestUser, viewer: TestUser, viewerB: TestUser;
  let product: { id: string; code: string };
  let serial: string;

  beforeAll(async () => {
    fx = await Fixture.start();
    A = await fx.location();
    B = await fx.location();
    maker = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WARRANTY_ADMIN');
    checker = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WARRANTY_ADMIN');
    viewer = await fx.user(UserRole.RMA_TEAM, 'WARRANTY_VIEWER');
    viewerB = await fx.user(UserRole.RMA_TEAM, 'WARRANTY_VIEWER');
    await fx.prisma.userWarehouse.create({ data: { userId: viewerB.id, warehouseId: B.warehouse.id } });
    product = await fx.product({ serialControlled: true });
    const [unit] = await fx.stock(product.id, 1, { warehouseId: A.warehouse.id });
    await fx.prisma.stockItem.update({ where: { id: unit.id }, data: { receivedDate: new Date('2026-01-31T00:00:00.000Z') } });
    serial = unit.serialNumber!;
  });
  afterAll(() => fx?.stop());

  const lookup = (u: TestUser, s: string, asOf = '2026-06-01') => fx.as(u).get(`/warranty/lookup?serial=${encodeURIComponent(s)}&asOf=${asOf}`);

  it('only managers create rules; drafts do not apply; the author cannot activate', async () => {
    const body = { ruleCode: 'P-12M', name: 'Product 12 months', warrantyType: 'Manufacturer', scopeType: 'PRODUCT', scopeValue: product.id, startBasis: 'RECEIPT_DATE', durationValue: 12, durationUnit: 'MONTHS', effectiveFrom: '2020-01-01' };
    await fx.as(viewer).post('/warranty/rules', body).expect(403);
    await fx.as(maker).post('/warranty/rules', { ...body, scopeValue: 'no-such-product' }).expect(400);
    await fx.as(maker).post('/warranty/rules', { ...body, durationValue: 0 }).expect(400);
    const r = await fx.as(maker).post('/warranty/rules', body);
    expectStatus(r, 201);
    expect(r.body).toMatchObject({ status: 'DRAFT', version: 1 });
    await fx.as(maker).post('/warranty/rules', body).expect(409); // code taken

    expect((await lookup(viewer, serial)).body.results[0].status).toBe('NO_RULE');
    await fx.as(maker).patch(`/warranty/rules/${r.body.id}/activate`).expect(403);
    expectStatus(await fx.as(checker).patch(`/warranty/rules/${r.body.id}/activate`), 200);
  });

  it('lookup: status, dates and the matched rule are returned and logged', async () => {
    const res = await lookup(viewer, serial);
    expectStatus(res, 200);
    const w = res.body.results[0];
    expect(w).toMatchObject({ status: 'ACTIVE', rule: { ruleCode: 'P-12M', version: 1 }, startBasis: 'RECEIPT_DATE' });
    expect(w.startDate.slice(0, 10)).toBe('2026-01-31');
    expect(w.expiryDate.slice(0, 10)).toBe('2027-01-30');
    expect((await lookup(viewer, serial, '2027-02-01')).body.results[0].status).toBe('EXPIRED');
    const log = await fx.prisma.warrantyCheck.findUniqueOrThrow({ where: { id: w.checkId } });
    expect(log).toMatchObject({ ruleCode: 'P-12M', ruleVersion: 1, status: 'ACTIVE', checkedById: viewer.id });
  });

  it('a new version supersedes the old one; history keeps the version used', async () => {
    const v1 = await fx.prisma.warrantyRule.findFirstOrThrow({ where: { ruleCode: 'P-12M', version: 1 } });
    const v2 = await fx.as(maker).post(`/warranty/rules/${v1.id}/new-version`);
    expectStatus(v2, 201);
    expect(v2.body).toMatchObject({ version: 2, status: 'DRAFT', supersedesId: v1.id });
    await fx.as(maker).patch(`/warranty/rules/${v1.id}`, { durationValue: 24 }).expect(409); // active versions are not edited
    expectStatus(await fx.as(maker).patch(`/warranty/rules/${v2.body.id}`, { durationValue: 24, changeNote: 'Extended' }), 200);
    expectStatus(await fx.as(checker).patch(`/warranty/rules/${v2.body.id}/activate`), 200);
    expect((await fx.prisma.warrantyRule.findUniqueOrThrow({ where: { id: v1.id } })).status).toBe('SUPERSEDED');
    const w = (await lookup(viewer, serial, '2027-06-01')).body.results[0];
    expect(w).toMatchObject({ status: 'ACTIVE', rule: { version: 2, durationValue: 24 } });
    const hist = await fx.as(viewer).get(`/warranty/history?serial=${serial}`);
    expect(hist.body.map((h: { ruleVersion: number }) => h.ruleVersion)).toEqual(expect.arrayContaining([1, 2]));
  });

  it('refuses to activate a rule that would tie with an active one', async () => {
    const r = await fx.as(maker).post('/warranty/rules', { ruleCode: 'P-DUP', name: 'dup', warrantyType: 'Vendor', scopeType: 'PRODUCT', scopeValue: product.id, startBasis: 'RECEIPT_DATE', durationValue: 6, durationUnit: 'MONTHS', effectiveFrom: '2021-01-01' });
    await fx.as(checker).patch(`/warranty/rules/${r.body.id}/activate`).expect(409);
    // A different priority resolves the tie.
    expectStatus(await fx.as(maker).patch(`/warranty/rules/${r.body.id}`, { priority: -1 }), 200);
    expectStatus(await fx.as(checker).patch(`/warranty/rules/${r.body.id}/activate`), 200);
    expect((await lookup(viewer, serial, '2027-06-01')).body.results[0].rule.ruleCode).toBe('P-12M');
  });

  it('a start date the WMS does not capture: unknown until recorded', async () => {
    const r = await fx.as(maker).post('/warranty/rules', { ruleCode: 'SN-INST', name: 'Serial from install', warrantyType: 'Service', scopeType: 'SERIAL', scopeValue: serial, startBasis: 'INSTALLATION_DATE', durationValue: 90, durationUnit: 'DAYS', effectiveFrom: '2020-01-01' });
    expectStatus(await fx.as(checker).patch(`/warranty/rules/${r.body.id}/activate`), 200);
    const unknown = (await lookup(viewer, serial)).body.results[0];
    expect(unknown).toMatchObject({ status: 'START_DATE_UNKNOWN', expiryDate: null, rule: { ruleCode: 'SN-INST' } });
    await fx.as(viewer).put('/warranty/dates', { serialNumber: serial, dateType: 'INSTALLATION_DATE', date: '2026-05-01' }).expect(403);
    expectStatus(await fx.as(maker).put('/warranty/dates', { serialNumber: serial, dateType: 'INSTALLATION_DATE', date: '2026-05-01', reference: 'JOB-1' }), 200);
    const known = (await lookup(viewer, serial)).body.results[0];
    expect(known.status).toBe('ACTIVE');
    expect(known.expiryDate.slice(0, 10)).toBe('2026-07-29');
    expect(await fx.prisma.auditLog.count({ where: { action: 'WARRANTY_DATE_RECORDED' } })).toBe(1);
  });

  it('unknown serials and units outside the user\'s warehouses are NOT_FOUND (and logged)', async () => {
    const none = await lookup(viewer, 'NO-SUCH-SERIAL');
    expect(none.body.results).toEqual([]);
    expect(none.body.check.status).toBe('NOT_FOUND');
    expect((await lookup(viewerB, serial)).body.results).toEqual([]);
    const histB = await fx.as(viewerB).get(`/warranty/history?serial=${serial}`);
    // Only their own not-found lookup — nothing about the unit in warehouse A.
    expect(histB.body.length).toBeGreaterThan(0);
    expect(histB.body.every((h: { stockItemId: string | null; checkedById: string }) => h.stockItemId === null && h.checkedById === viewerB.id)).toBe(true);
  });

  it('deactivation stops a rule applying', async () => {
    const sn = await fx.prisma.warrantyRule.findFirstOrThrow({ where: { ruleCode: 'SN-INST' } });
    expectStatus(await fx.as(checker).patch(`/warranty/rules/${sn.id}/deactivate`), 200);
    expect((await lookup(viewer, serial)).body.results[0].rule.ruleCode).toBe('P-12M');
  });
});
