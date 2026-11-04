import { StockStatus, UserRole } from '@prisma/client';
import { Fixture, TestUser, expectStatus } from './harness';

// Phase 3 — audit trail: old → new values on master-data edits, GR + putaway in
// the stock unit's audit, one timeline per reference, notifications kept apart.
describe('Phase 3 audit', () => {
  let fx: Fixture;
  let admin: TestUser, manager: TestUser, requester: TestUser, staff: TestUser;

  beforeAll(async () => {
    fx = await Fixture.start();
    admin = await fx.user(UserRole.SYSTEM_ADMIN, 'SUPER_ADMIN');
    manager = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WAREHOUSE_MANAGER');
    requester = await fx.user(UserRole.REQUESTER, 'REQUESTER');
    staff = await fx.user(UserRole.WAREHOUSE_STAFF);
  });
  afterAll(async () => { await fx.stop(); });

  const lastLog = (entityType: string, entityId: string, action: string) =>
    fx.prisma.auditLog.findFirstOrThrow({ where: { entityType, entityId, action }, orderBy: { createdAt: 'desc' } });

  it('product edit records only the changed fields with old and new values', async () => {
    const p = await fx.product();
    await fx.prisma.product.update({ where: { id: p.id }, data: { minStock: 1, model: 'M-1' } });
    expectStatus(await fx.as(manager).patch(`/products/${p.id}`, { name: 'Renamed', minStock: 5, model: 'M-1' }), 200);
    const log = await lastLog('Product', p.id, 'PRODUCT_UPDATED');
    expect(log.changes).toMatchObject({ name: { from: p.name, to: 'Renamed' }, minStock: { from: 1, to: 5 } });
    expect((log.changes as any).model).toBeUndefined();
    expect(log.detail).toContain('minStock: 1 → 5');

    expectStatus(await fx.as(manager).patch(`/products/${p.id}/status`, { productStatus: 'INACTIVE' }), 200);
    const st = await lastLog('Product', p.id, 'PRODUCT_STATUS_CHANGED');
    expect(st.changes).toMatchObject({ productStatus: { from: 'ACTIVE', to: 'INACTIVE' }, isActive: { from: true, to: false } });
  });

  it('brand edit and deactivation record old → new values', async () => {
    const created = await fx.as(admin).post('/warehouse/brands', { name: 'Brand Old', contact: 'a@x' });
    expectStatus(created, 201);
    const id = created.body.id;
    expectStatus(await fx.as(admin).patch(`/warehouse/brands/${id}`, { name: 'Brand New' }), 200);
    const upd = await lastLog('Brand', id, 'BRAND_UPDATED');
    expect(upd.changes).toEqual({ name: { from: 'Brand Old', to: 'Brand New' } });
    expectStatus(await fx.as(admin).delete(`/warehouse/brands/${id}`), 200);
    expect((await lastLog('Brand', id, 'BRAND_DEACTIVATED')).changes).toEqual({ isActive: { from: true, to: false } });
  });

  it('role permission change records which permissions were added and removed', async () => {
    const role = await fx.prisma.role.create({ data: { key: fx.uid('AUDROLE'), name: 'Audit role', isSystem: false } });
    const perms = await fx.prisma.permission.findMany({ take: 3, orderBy: { code: 'asc' } });
    const [a, b, c] = perms.map((p) => p.code);
    expectStatus(await fx.as(admin).patch(`/roles/${role.id}/permissions`, { permissionCodes: [a, b] }), 200);
    expectStatus(await fx.as(admin).patch(`/roles/${role.id}/permissions`, { permissionCodes: [b, c] }), 200);
    const log = await lastLog('Role', role.id, 'ROLE_PERMISSIONS_UPDATED');
    expect(log.changes).toMatchObject({ permissions: { added: [c], removed: [a] }, count: { from: 2, to: 2 } });
    expect(log.detail).toContain(`added ${c}`);
    expectStatus(await fx.as(admin).patch(`/roles/${role.id}/toggle`), 200);
    expect((await lastLog('Role', role.id, 'ROLE_DISABLED')).changes).toEqual({ isActive: { from: true, to: false } });
  });

  it('a stock unit audit shows its goods receiving and putaway, not notifications', async () => {
    const loc = await fx.location();
    const product = await fx.product({ serialControlled: true });
    const [unit] = await fx.stock(product.id, 1, { status: StockStatus.PENDING_INSPECTION });
    const gr = await fx.prisma.goodsReceiving.create({
      data: { refNumber: fx.uid('GR'), receivedById: admin.id, items: { create: [{ productId: product.id, serialNumber: unit.serialNumber, stockItemId: unit.id }] } },
    });
    await fx.prisma.auditLog.create({ data: { userId: admin.id, action: 'GOODS_RECEIVED', entityType: 'GoodsReceiving', entityId: gr.id, detail: gr.refNumber } });
    await fx.prisma.auditLog.create({ data: { action: 'NOTIFICATION_SENT', entityType: 'StockItem', entityId: unit.id, detail: 'email' } });
    expectStatus(await fx.as(staff).patch(`/putaway/${unit.id}/confirm`, { warehouseId: loc.warehouse.id, rackId: loc.rack.id, slotId: loc.slot.id }), 200);

    const res = await fx.as(manager).get(`/inventory/${unit.id}/detail-full`);
    expectStatus(res, 200);
    const actions = res.body.auditLogs.map((l: any) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['GOODS_RECEIVED', 'PUTAWAY_CONFIRMED']));
    expect(actions).not.toContain('NOTIFICATION_SENT');
  });

  it('timeline: a WR number brings in its task, shipment and stock events in order; a serial finds the same chain', async () => {
    const product = await fx.product({ serialControlled: true });
    const [unit] = await fx.stock(product.id, 1);
    const req = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
    const task = await fx.allocatedTask(req.id, staff);
    const ship = await fx.prisma.shipment.create({ data: { refNumber: fx.uid('SHP'), taskId: task.id, handoverById: manager.id } });
    await fx.prisma.auditLog.create({ data: { userId: manager.id, action: 'SHIPMENT_HANDED_OVER', entityType: 'Shipment', entityId: ship.id, detail: ship.refNumber } });
    await fx.prisma.auditLog.create({ data: { action: 'NOTIFICATION_SENT', entityType: 'WithdrawalRequest', entityId: req.id, detail: 'email' } });

    const byWr = await fx.as(manager).get(`/audit/timeline?ref=${req.refNumber.toLowerCase()}`);
    expectStatus(byWr, 200);
    expect(byWr.body.matches).toEqual([expect.objectContaining({ type: 'WR', ref: req.refNumber })]);
    const types = new Set(byWr.body.events.map((e: any) => e.entityType));
    expect(types).toEqual(new Set(['WithdrawalRequest', 'FulfillmentTask', 'Shipment', ...(types.has('StockItem') ? ['StockItem'] : [])]));
    expect(byWr.body.events.map((e: any) => e.action)).not.toContain('NOTIFICATION_SENT');
    const times = byWr.body.events.map((e: any) => new Date(e.at).getTime());
    expect([...times].sort((x, y) => x - y)).toEqual(times);
    expect(byWr.body.events.find((e: any) => e.entityType === 'Shipment').ref).toBe(ship.refNumber);

    const bySerial = await fx.as(manager).get(`/audit/timeline?ref=${unit.serialNumber}`);
    expect(bySerial.body.matches[0]).toMatchObject({ type: 'Serial' });
    expect(bySerial.body.events.some((e: any) => e.entityType === 'Shipment')).toBe(true);

    const byShip = await fx.as(manager).get(`/audit/timeline?ref=${ship.refNumber}`);
    expect(byShip.body.events.some((e: any) => e.entityType === 'WithdrawalRequest')).toBe(true);

    const none = await fx.as(manager).get('/audit/timeline?ref=NOPE-000');
    expect(none.body).toMatchObject({ matches: [], events: [] });
    expectStatus(await fx.as(manager).get('/audit/timeline?ref=ab'), 400);
    expectStatus(await fx.as(requester).get(`/audit/timeline?ref=${req.refNumber}`), 403);
  });

  it('audit list shows transactions by default; notification sends are a separate view', async () => {
    const marker = fx.uid('NOTE');
    await fx.prisma.auditLog.create({ data: { action: 'NOTIFICATION_SENT', detail: marker } });
    await fx.prisma.auditLog.create({ data: { action: 'PRODUCT_UPDATED', detail: marker } });
    const def = await fx.as(manager).get(`/audit?q=${marker}`);
    expect(def.body.data.map((l: any) => l.action)).toEqual(['PRODUCT_UPDATED']);
    const notes = await fx.as(manager).get(`/audit?q=${marker}&category=notifications`);
    expect(notes.body.data.map((l: any) => l.action)).toEqual(['NOTIFICATION_SENT']);
    const all = await fx.as(manager).get(`/audit?q=${marker}&category=all`);
    expect(all.body.total).toBe(2);
  });

  it('archiving keeps the old → new values', async () => {
    await fx.prisma.setting.upsert({ where: { key: 'audit.retention' }, update: { value: '365', isActive: true }, create: { key: 'audit.retention', label: 'audit.retention', value: '365' } });
    const row = await fx.prisma.auditLog.create({
      data: { action: 'PRODUCT_UPDATED', detail: 'old', changes: { name: { from: 'a', to: 'b' } }, createdAt: new Date('2000-01-01') },
    });
    const res = await fx.as(admin).post('/audit/retention/archive', { confirm: true });
    expectStatus(res, 201);
    const archived = await fx.prisma.auditLogArchive.findUnique({ where: { id: row.id } });
    expect(archived?.changes).toEqual({ name: { from: 'a', to: 'b' } });
  });
});
