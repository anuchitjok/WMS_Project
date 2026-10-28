import {
  FulfillmentStatus,
  RequestStatus,
  StockStatus,
  UserRole,
} from '@prisma/client';
import { Fixture, TestUser, expectStatus } from './harness';
import { SystemSettingsService } from '../../src/settings/system-settings.service';
import { NotificationsService } from '../../src/notifications/notifications.service';

// Phases 3–6: settings with real effects, master data, audit retention,
// notification templates, cycle-count stock lock, serial race, quantity-aware
// approval, stalled-request recovery.

describe('System control', () => {
  let fx: Fixture;
  let admin: TestUser,
    manager: TestUser,
    manager2: TestUser,
    staff: TestUser,
    requester: TestUser;

  const setSetting = (key: string, value: string) =>
    fx.prisma.setting.upsert({
      where: { key },
      update: { value, isActive: true },
      create: { key, label: key, value },
    });

  beforeAll(async () => {
    fx = await Fixture.start();
    admin = await fx.user(UserRole.SYSTEM_ADMIN, 'SUPER_ADMIN');
    manager = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WAREHOUSE_MANAGER');
    manager2 = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WAREHOUSE_MANAGER');
    staff = await fx.user(UserRole.WAREHOUSE_STAFF);
    requester = await fx.user(UserRole.REQUESTER, 'REQUESTER');
  });
  afterAll(async () => {
    await fx.stop();
  });

  // ── 4. Settings ────────────────────────────────────────────────────────────
  describe('settings', () => {
    it('validates values per key, refuses informational keys, and only admins may edit', async () => {
      await fx.as(admin).get('/settings').expect(200); // seeds defaults
      await fx
        .as(admin)
        .patch('/settings/stock.lowThreshold', { value: 'abc' })
        .expect(400);
      await fx
        .as(admin)
        .patch('/settings/stock.lowThreshold', { value: '0' })
        .expect(400);
      await fx
        .as(admin)
        .patch('/settings/serial.duplicate', { value: 'off' })
        .expect(400);
      await fx
        .as(admin)
        .patch('/settings/serial.duplicate', { value: 'disabled' })
        .expect(400);
      await fx
        .as(admin)
        .patch('/settings/approval.workflow', { value: 'disabled' })
        .expect(400);
      await fx.as(admin).patch('/settings/nope', { value: '1' }).expect(404);
      await fx
        .as(manager)
        .patch('/settings/stock.lowThreshold', { value: '3' })
        .expect(403);
      expectStatus(
        await fx
          .as(admin)
          .patch('/settings/cycleCount.frequency', { value: 'weekly' }),
        200,
      );
      const list = await fx.as(admin).get('/settings');
      const cc = list.body.find((s: any) => s.key === 'cycleCount.frequency');
      expect([cc.state, cc.value, cc.effect]).toEqual([
        'configured',
        'weekly',
        'enforced',
      ]);
      expect(
        list.body.find((s: any) => s.key === 'approval.workflow').editable,
      ).toBe(false);
    });

    it('distinguishes missing, disabled, invalid and configured values', async () => {
      const svc = fx.app.get(SystemSettingsService);
      await fx.prisma.setting.deleteMany({ where: { key: 'rtv.agingSla' } });
      expect(await svc.get('rtv.agingSla')).toEqual({ state: 'missing' });
      await setSetting('rtv.agingSla', 'disabled');
      expect(await svc.get('rtv.agingSla')).toEqual({ state: 'disabled' });
      await setSetting('rtv.agingSla', 'seven');
      expect((await svc.get('rtv.agingSla')).state).toBe('invalid');
      expect(await svc.rtvAgingSlaDays()).toBeNull();
      await setSetting('rtv.agingSla', '7');
      expect(await svc.rtvAgingSlaDays()).toBe(7);
    });

    it('low-stock threshold: default applies to products without their own minimum; disabled restores old behaviour', async () => {
      const loc = await fx.location();
      const noMin = await fx.product();
      const withMin = await fx.prisma.product.create({
        data: { code: fx.uid('MIN'), name: 'with min', minStock: 2 },
      });
      await fx.stock(noMin.id, 1, {
        quantity: 3,
        serial: false,
        warehouseId: loc.warehouse.id,
      });
      await fx.stock(withMin.id, 1, {
        quantity: 3,
        serial: false,
        warehouseId: loc.warehouse.id,
      });
      const codes = async () =>
        (
          await fx
            .as(manager)
            .get(`/reports/summary?warehouseId=${loc.warehouse.id}`)
        ).body.lowStockItems.map((p: any) => p.code);

      await setSetting('stock.lowThreshold', '5');
      expect(await codes()).toEqual([noMin.code]); // withMin uses its own minimum (3 ≥ 2)
      await setSetting('stock.lowThreshold', 'disabled');
      expect(await codes()).toEqual([]);
      await fx.prisma.setting.deleteMany({
        where: { key: 'stock.lowThreshold' },
      });
      expect(await codes()).toEqual([]); // missing = no default
    });

    it('low stock counts available units, not rows', async () => {
      const loc = await fx.location();
      const p = await fx.prisma.product.create({
        data: { code: fx.uid('BULK'), name: 'bulk', minStock: 10 },
      });
      await fx.stock(p.id, 1, {
        quantity: 50,
        serial: false,
        warehouseId: loc.warehouse.id,
      });
      const low = (
        await fx
          .as(manager)
          .get(`/reports/summary?warehouseId=${loc.warehouse.id}`)
      ).body.lowStockItems;
      expect(low.find((x: any) => x.code === p.code)).toBeUndefined();
    });

    it('RTV aging SLA marks old open cases overdue', async () => {
      await setSetting('rtv.agingSla', '7');
      const product = await fx.product();
      const [doa] = await fx.stock(product.id, 1, { status: StockStatus.DOA });
      const rtv = await fx
        .as(admin)
        .post('/rtv', { stockItemId: doa.id, reason: 'doa' });
      expectStatus(rtv, 201);
      await fx.prisma.rTVCase.update({
        where: { id: rtv.body.id },
        data: { createdAt: new Date(Date.now() - 8 * 86_400_000) },
      });
      const one = await fx.as(admin).get(`/rtv/${rtv.body.id}`);
      expect([one.body.ageDays, one.body.slaDays, one.body.overdue]).toEqual([
        8,
        7,
        true,
      ]);
      const overdue = await fx.as(admin).get('/rtv?overdue=true');
      expect(overdue.body.map((r: any) => r.id)).toContain(rtv.body.id);
      expect(
        (await fx.as(admin).get('/dashboard/kpis')).body.rtvOverdue,
      ).toBeGreaterThanOrEqual(1);
      await setSetting('rtv.agingSla', 'disabled');
      expect(
        (await fx.as(admin).get(`/rtv/${rtv.body.id}`)).body.overdue,
      ).toBeNull();
      expect(
        (await fx.as(admin).get('/dashboard/kpis')).body.rtvOverdue,
      ).toBeNull();
    });

    it('cycle-count frequency drives due/overdue per warehouse without creating anything', async () => {
      const loc = await fx.location();
      await setSetting('cycleCount.frequency', 'weekly');
      const before = await fx.prisma.cycleCountSession.count();
      let sched = (await fx.as(admin).get('/cycle-count/schedule')).body;
      expect(sched.periodDays).toBe(7);
      expect(
        sched.warehouses.find((w: any) => w.id === loc.warehouse.id).status,
      ).toBe('due');
      await fx.prisma.cycleCountSession.create({
        data: {
          refNumber: fx.uid('CC'),
          warehouseId: loc.warehouse.id,
          status: 'APPROVED',
          closedAt: new Date(Date.now() - 10 * 86_400_000),
        },
      });
      sched = (await fx.as(admin).get('/cycle-count/schedule')).body;
      expect(
        sched.warehouses.find((w: any) => w.id === loc.warehouse.id).status,
      ).toBe('overdue');
      await setSetting('cycleCount.frequency', 'monthly');
      sched = (await fx.as(admin).get('/cycle-count/schedule')).body;
      expect(
        sched.warehouses.find((w: any) => w.id === loc.warehouse.id).status,
      ).toBe('ok');
      await setSetting('cycleCount.frequency', 'disabled');
      sched = (await fx.as(admin).get('/cycle-count/schedule')).body;
      expect(
        sched.warehouses.find((w: any) => w.id === loc.warehouse.id).status,
      ).toBe('not_scheduled');
      expect(await fx.prisma.cycleCountSession.count()).toBe(before + 1); // only the one inserted above
    });
  });

  // ── 6. Master data ─────────────────────────────────────────────────────────
  describe('master data', () => {
    it('reason codes: managed, required once configured, history readable after deactivation', async () => {
      await fx
        .as(staff)
        .post('/master-data/reason-codes', {
          category: 'SCRAP',
          code: 'EOL',
          description: 'End of life',
        })
        .expect(403);
      const rc = await fx
        .as(admin)
        .post('/master-data/reason-codes', {
          category: 'SCRAP',
          code: 'eol',
          description: 'End of life',
        });
      expectStatus(rc, 201);
      expect(rc.body.code).toBe('EOL');
      await fx
        .as(admin)
        .post('/master-data/reason-codes', {
          category: 'SCRAP',
          code: 'EOL',
          description: 'dup',
        })
        .expect(409);
      await fx
        .as(admin)
        .post('/master-data/reason-codes', {
          category: 'NOPE',
          code: 'X',
          description: 'x',
        })
        .expect(400);

      const product = await fx.product();
      const [u1, u2] = await fx.stock(product.id, 2);
      await fx
        .as(manager)
        .post('/scrap', { stockItemId: u1.id, reason: 'whatever I like' })
        .expect(400); // free text no longer accepted
      const ok = await fx
        .as(manager)
        .post('/scrap', { stockItemId: u1.id, reasonCode: 'EOL' });
      expectStatus(ok, 201);
      expect([ok.body.reasonCode, ok.body.reason]).toEqual([
        'EOL',
        'End of life',
      ]);
      // Old clients sending the label text still work
      expectStatus(
        await fx
          .as(manager)
          .post('/scrap', { stockItemId: u2.id, reason: 'End of life' }),
        201,
      );

      expectStatus(
        await fx
          .as(admin)
          .patch(`/master-data/reason-codes/${rc.body.id}`, {
            isActive: false,
          }),
        200,
      );
      const [u3] = await fx.stock(product.id, 1);
      await fx
        .as(manager)
        .post('/scrap', { stockItemId: u3.id, reasonCode: 'EOL' })
        .expect(400);
      const hist = await fx.as(manager).get(`/scrap/${ok.body.id}`);
      expect([hist.body.reasonCode, hist.body.reason]).toEqual([
        'EOL',
        'End of life',
      ]);
    });

    it('system reason codes cannot be deactivated', async () => {
      const sys = await fx.prisma.reasonCode.create({
        data: {
          category: 'ADJUSTMENT',
          code: 'CYCLE_COUNT',
          description: 'Cycle count variance',
          isSystem: true,
        },
      });
      await fx
        .as(admin)
        .patch(`/master-data/reason-codes/${sys.id}`, { isActive: false })
        .expect(400);
    });

    it('departments: validated on new users and requests once managed; existing values preserved', async () => {
      const legacy = await fx.user(UserRole.REQUESTER, 'REQUESTER');
      await fx.prisma.user.update({
        where: { id: legacy.id },
        data: { department: 'Old Dept' },
      });
      await fx.prisma.department.create({
        data: { code: 'RMA', name: 'RMA Service' },
      });

      const body = (department: string) => ({
        username: fx.uid('d'),
        fullName: 'D',
        password: 'Passw0rd!',
        role: 'REQUESTER',
        department,
      });
      await fx.as(admin).post('/auth/register', body('Made Up')).expect(400);
      expectStatus(await fx.as(admin).post('/auth/register', body('RMA')), 201);
      // Unchanged legacy department does not block an unrelated edit
      expectStatus(
        await fx
          .as(admin)
          .patch(`/users/${legacy.id}`, {
            fullName: 'Renamed',
            department: 'Old Dept',
          }),
        200,
      );
      await fx
        .as(admin)
        .patch(`/users/${legacy.id}`, { department: 'Made Up' })
        .expect(400);

      const product = await fx.product();
      await fx.stock(product.id, 1);
      await fx
        .as(requester)
        .post('/requests', {
          rmaCaseNumber: fx.uid('RMA'),
          department: 'Made Up',
          items: [{ productId: product.id, quantity: 1 }],
        })
        .expect(400);
      expectStatus(
        await fx
          .as(requester)
          .post('/requests', {
            rmaCaseNumber: fx.uid('RMA'),
            department: 'RMA Service',
            items: [{ productId: product.id, quantity: 1 }],
          }),
        201,
      );
    });

    it('units of measure: product unit validated once managed, no conversion', async () => {
      await fx.prisma.unitOfMeasure.create({
        data: { code: 'pcs', name: 'Pieces' },
      });
      await fx
        .as(admin)
        .post('/products', { code: fx.uid('U'), name: 'u', unit: 'crate' })
        .expect(400);
      const ok = await fx
        .as(admin)
        .post('/products', { code: fx.uid('U'), name: 'u', unit: 'pcs' });
      expectStatus(ok, 201);
      expect(ok.body.unit).toBe('pcs');
      const uoms = await fx.as(staff).get('/master-data/uoms');
      expect(uoms.body.map((u: any) => u.code)).toContain('pcs');
    });
  });

  // ── 4.3 Audit retention ────────────────────────────────────────────────────
  describe('audit retention', () => {
    it('refuses when not configured, previews, archives idempotently, never touches security entries', async () => {
      await setSetting('audit.retention', 'disabled');
      await fx.as(admin).get('/audit/retention/preview').expect(400);
      await setSetting('audit.retention', '365');
      const old = new Date(Date.now() - 400 * 86_400_000);
      const op = await fx.prisma.auditLog.create({
        data: {
          action: 'STOCK_RELOCATED',
          entityType: 'StockItem',
          createdAt: old,
        },
      });
      const sec = await fx.prisma.auditLog.create({
        data: { action: 'LOGIN', entityType: 'User', createdAt: old },
      });
      const recent = await fx.prisma.auditLog.create({
        data: { action: 'STOCK_RELOCATED', entityType: 'StockItem' },
      });

      await fx.as(manager).get('/audit/retention/preview').expect(403);
      const preview = await fx.as(admin).get('/audit/retention/preview');
      expectStatus(preview, 200);
      expect(preview.body.eligible).toBe(1);
      expect(preview.body.protectedOlderThanCutoff).toBeGreaterThanOrEqual(1);
      expect(await fx.prisma.auditLog.count({ where: { id: op.id } })).toBe(1); // dry run changed nothing

      await fx.as(admin).post('/audit/retention/archive', {}).expect(400); // needs confirm
      const run = await fx
        .as(admin)
        .post('/audit/retention/archive', { confirm: true });
      expectStatus(run, 201);
      expect(run.body.moved).toBe(1);
      expect(await fx.prisma.auditLog.count({ where: { id: op.id } })).toBe(0);
      expect(
        await fx.prisma.auditLogArchive.count({ where: { id: op.id } }),
      ).toBe(1);
      expect(
        await fx.prisma.auditLog.count({
          where: { id: { in: [sec.id, recent.id] } },
        }),
      ).toBe(2);

      const again = await fx
        .as(admin)
        .post('/audit/retention/archive', { confirm: true });
      expect(again.body.moved).toBe(0);
      expect(
        await fx.prisma.auditLog.count({ where: { action: 'AUDIT_ARCHIVED' } }),
      ).toBe(2);
    });
  });

  // ── 4.7 Notification templates ─────────────────────────────────────────────
  describe('notification templates', () => {
    it('validates variables, overrides the default, resets, and reports email status without values', async () => {
      await fx.as(manager).get('/notifications/templates').expect(403);
      const list = await fx.as(admin).get('/notifications/templates');
      expectStatus(list, 200);
      expect(
        list.body.find((t: any) => t.type === 'LOW_STOCK').variables,
      ).toContain('productCode');

      await fx
        .as(admin)
        .put('/notifications/templates/LOW_STOCK', {
          title: 'Low {{bogus}}',
          body: 'x',
        })
        .expect(400);
      await fx
        .as(admin)
        .put('/notifications/templates/LOW_STOCK', {
          title: 'Low {{productCode',
          body: 'x',
        })
        .expect(400);
      await fx
        .as(admin)
        .put('/notifications/templates/LOW_STOCK', { title: '', body: 'x' })
        .expect(400);
      await fx
        .as(admin)
        .put('/notifications/templates/NOPE', { title: 't', body: 'b' })
        .expect(400);
      expectStatus(
        await fx
          .as(admin)
          .put('/notifications/templates/LOW_STOCK', {
            title: 'Reorder {{productCode}}',
            body: '{{productCode}} at {{onHand}} (min {{minStock}})',
          }),
        200,
      );

      const target = await fx.user(
        UserRole.WAREHOUSE_MANAGER,
        'WAREHOUSE_MANAGER',
      );
      await fx.app
        .get(NotificationsService)
        .send({
          type: 'LOW_STOCK',
          userIds: [target.id],
          title: 'ignored',
          message: 'ignored',
          metadata: { productCode: 'SKU-9', onHand: 1, minStock: 5 },
        });
      const n = await fx.prisma.notification.findFirstOrThrow({
        where: { userId: target.id },
      });
      expect([n.title, n.message]).toEqual([
        'Reorder SKU-9',
        'SKU-9 at 1 (min 5)',
      ]);

      expectStatus(
        await fx.as(admin).delete('/notifications/templates/LOW_STOCK'),
        200,
      );
      expect(
        (await fx.as(admin).get('/notifications/templates')).body.find(
          (t: any) => t.type === 'LOW_STOCK',
        ).custom,
      ).toBeNull();

      const status = await fx.as(admin).get('/notifications/delivery-status');
      expectStatus(status, 200);
      expect(status.body.email.configured).toBe(false);
      expect(status.body.email.missing).toContain('SMTP_HOST');
      expect(JSON.stringify(status.body)).not.toMatch(/pass(word)?":/i);
    });
  });

  // ── 5. Cycle-count stock lock ──────────────────────────────────────────────
  describe('cycle-count stock lock', () => {
    it('counted rows are skipped by approval-time reservation and refuse movements until the count ends', async () => {
      const loc = await fx.location();
      const other = await fx.location();
      const product = await fx.product({ serialControlled: true });
      const [counted] = await fx.stock(product.id, 1, {
        warehouseId: loc.warehouse.id,
        rackId: loc.rack.id,
        slotId: loc.slot.id,
      });
      const session = await fx
        .as(staff)
        .post('/cycle-count', { warehouseId: loc.warehouse.id });
      expectStatus(session, 201);
      // A second active count in the same warehouse is refused
      await fx
        .as(staff)
        .post('/cycle-count', { warehouseId: loc.warehouse.id })
        .expect(409);

      // Movements are refused while counting
      await fx
        .as(manager)
        .patch(`/inventory/${counted.id}/status`, { status: 'QUARANTINE' })
        .expect(409);
      await fx
        .as(manager)
        .patch(`/inventory/${counted.id}/location`, {
          warehouseId: other.warehouse.id,
          rackId: other.rack.id,
          slotId: other.slot.id,
        })
        .expect(409);
      await fx.prisma.reasonCode.upsert({
        where: {
          category_code: { category: 'ADJUSTMENT', code: 'CORRECTION' },
        },
        update: { isActive: true },
        create: {
          category: 'ADJUSTMENT',
          code: 'CORRECTION',
          description: 'Data correction',
        },
      });
      const adj = await fx
        .as(manager)
        .post('/adjustment', {
          stockItemId: counted.id,
          productLabel: 'x',
          reasonCode: 'CORRECTION',
          quantityBefore: 1,
          quantityAfter: 0,
        });
      expectStatus(adj, 201);
      await fx
        .as(manager2)
        .patch(`/adjustment/${adj.body.id}/approve`)
        .expect(409);
      const trf = await fx
        .as(manager)
        .post('/transfer', {
          stockItemId: counted.id,
          productLabel: 'x',
          quantity: 1,
          fromLocation: 'a',
          toLocation: 'b',
        });
      await fx
        .as(manager)
        .patch(`/transfer/${trf.body.id}/complete`, {
          warehouseId: other.warehouse.id,
          rackId: other.rack.id,
          slotId: other.slot.id,
        })
        .expect(409);

      // Reservation skips the counted row (it is the only stock) → insufficient
      const req = await fx
        .as(requester)
        .post('/requests', {
          rmaCaseNumber: fx.uid('RMA'),
          items: [{ productId: product.id, quantity: 1 }],
        });
      expectStatus(
        await fx.as(requester).patch(`/requests/${req.body.id}/submit`),
        200,
      );
      await fx
        .as(manager)
        .patch(`/requests/${req.body.id}/approve`, { approved: true })
        .expect(400);

      // Cancel releases the lock
      expectStatus(
        await fx.as(manager).post(`/cycle-count/${session.body.id}/cancel`),
        201,
      );
      expectStatus(
        await fx
          .as(manager)
          .patch(`/requests/${req.body.id}/approve`, { approved: true }),
        200,
      );
      expect(
        (
          await fx.prisma.stockItem.findUniqueOrThrow({
            where: { id: counted.id },
          })
        ).status,
      ).toBe(StockStatus.RESERVED);
    });

    it('approval releases the lock; a stock row that left AVAILABLE is excluded on recount', async () => {
      const loc = await fx.location();
      const product = await fx.product();
      const [a, b] = await fx.stock(product.id, 2, {
        quantity: 4,
        serial: false,
        warehouseId: loc.warehouse.id,
      });
      const s = await fx
        .as(staff)
        .post('/cycle-count', { warehouseId: loc.warehouse.id });
      for (const line of s.body.lines) {
        expectStatus(
          await fx
            .as(staff)
            .patch(`/cycle-count/${s.body.id}/lines/${line.id}/count`, {
              countedQty: 4,
            }),
          200,
        );
      }
      expectStatus(
        await fx.as(staff).post(`/cycle-count/${s.body.id}/submit`),
        201,
      );
      // Simulate a movement that bypassed the lock: b is now reserved elsewhere
      await fx.prisma.stockItem.update({
        where: { id: b.id },
        data: { status: StockStatus.RESERVED },
      });
      const refused = await fx
        .as(manager)
        .post(`/cycle-count/${s.body.id}/approve`);
      expectStatus(refused, 409);
      const flagged = await fx.prisma.cycleCountLine.findMany({
        where: { sessionId: s.body.id, conflictReason: { not: null } },
      });
      expect(flagged.map((l) => l.stockItemId)).toEqual([b.id]);

      const reset = await fx
        .as(manager)
        .post(`/cycle-count/${s.body.id}/recount-conflicts`);
      expect([reset.body.recount, reset.body.excluded]).toEqual([0, 1]);
      expectStatus(
        await fx.as(staff).post(`/cycle-count/${s.body.id}/submit`),
        201,
      );
      expectStatus(
        await fx.as(manager).post(`/cycle-count/${s.body.id}/approve`),
        201,
      );
      // Lock released: a's status can change again
      await fx.prisma.stockItem.update({
        where: { id: b.id },
        data: { status: StockStatus.AVAILABLE },
      });
      expectStatus(
        await fx
          .as(manager)
          .patch(`/inventory/${a.id}/status`, { status: 'QUARANTINE' }),
        200,
      );
    });
  });

  // ── 4.4 Serial duplicates ──────────────────────────────────────────────────
  describe('serial duplicate control', () => {
    it('two concurrent receipts of one serial: exactly one succeeds', async () => {
      const product = await fx.product({ serialControlled: true });
      const serial = fx.uid('RACE-SN');
      const body = {
        sourceType: 'vendor',
        items: [{ productId: product.id, quantity: 1, serialNumber: serial }],
      };
      const [r1, r2] = await Promise.all([
        fx.as(staff).post('/receiving', body),
        fx.as(staff).post('/receiving', body),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([201, 409]);
      expect(
        await fx.prisma.stockItem.count({ where: { serialNumber: serial } }),
      ).toBe(1);
    });

    it('manual stock creation refuses an active duplicate', async () => {
      const product = await fx.product({ serialControlled: true });
      const [unit] = await fx.stock(product.id, 1);
      await fx
        .as(manager)
        .post('/inventory', {
          productId: product.id,
          serialNumber: unit.serialNumber,
        })
        .expect(409);
    });
  });

  // ── 7.3 Quantity-aware approval ────────────────────────────────────────────
  describe('quantity-aware approval (bulk products)', () => {
    it('reserves exactly the approved units, splitting a larger bulk row', async () => {
      const product = await fx.product();
      const [big] = await fx.stock(product.id, 1, {
        quantity: 100,
        serial: false,
      });
      const req = await fx.approvedRequest(requester, manager, [
        { productId: product.id, quantity: 5 },
      ]);
      const rows = await fx.prisma.stockItem.findMany({
        where: { productId: product.id },
        orderBy: { quantity: 'asc' },
      });
      expect(rows.map((r) => [r.status, r.quantity])).toEqual([
        [StockStatus.RESERVED, 5],
        [StockStatus.AVAILABLE, 95],
      ]);
      expect(rows[0].id).toBe(big.id); // the reserved part keeps the row id
      const line = await fx.prisma.withdrawalRequestItem.findFirstOrThrow({
        where: { requestId: req.id },
      });
      expect([line.stockItemId, line.quantityApproved]).toEqual([big.id, 5]);
    });

    it('covers a request across several rows and fails cleanly when units are short', async () => {
      const product = await fx.product();
      await fx.stock(product.id, 2, { quantity: 3, serial: false });
      await fx.approvedRequest(requester, manager, [
        { productId: product.id, quantity: 4 },
      ]);
      const reserved = await fx.prisma.stockItem.aggregate({
        where: { productId: product.id, status: StockStatus.RESERVED },
        _sum: { quantity: true },
      });
      expect(reserved._sum.quantity).toBe(4);

      const short = await fx
        .as(requester)
        .post('/requests', {
          rmaCaseNumber: fx.uid('RMA'),
          items: [{ productId: product.id, quantity: 3 }],
        });
      expectStatus(
        await fx.as(requester).patch(`/requests/${short.body.id}/submit`),
        200,
      );
      await fx
        .as(manager)
        .patch(`/requests/${short.body.id}/approve`, { approved: true })
        .expect(400);
      // Nothing half-reserved by the failed approval
      const after = await fx.prisma.stockItem.aggregate({
        where: { productId: product.id, status: StockStatus.RESERVED },
        _sum: { quantity: true },
      });
      expect(after._sum.quantity).toBe(4);
    });

    it('the split reservation flows through allocation unchanged', async () => {
      const product = await fx.product();
      await fx.stock(product.id, 1, { quantity: 10, serial: false });
      const req = await fx.approvedRequest(requester, manager, [
        { productId: product.id, quantity: 4 },
      ]);
      const task = await fx.allocatedTask(req.id, staff);
      expect(task.items.reduce((n, i) => n + i.qtyRequested, 0)).toBe(4);
      const avail = await fx.prisma.stockItem.aggregate({
        where: { productId: product.id, status: StockStatus.AVAILABLE },
        _sum: { quantity: true },
      });
      expect(avail._sum.quantity).toBe(6);
    });
  });

  // ── 7.2 Stalled request recovery ───────────────────────────────────────────
  describe('stalled request recovery', () => {
    async function stalled() {
      const product = await fx.product();
      const [unit] = await fx.stock(product.id, 1);
      const req = await fx.approvedRequest(requester, manager, [
        { productId: product.id, quantity: 1 },
      ]);
      const task = await fx.allocatedTask(req.id, staff);
      return { req, task, unit };
    }

    it('refuses while stock is still held (the release button covers that case)', async () => {
      const { req, task, unit } = await stalled();
      await fx.prisma.fulfillmentTask.update({
        where: { id: task.id },
        data: { status: FulfillmentStatus.CLOSED },
      });
      await fx.prisma.withdrawalRequest.update({
        where: { id: req.id },
        data: { status: RequestStatus.PICKING },
      });
      const held = await fx
        .as(manager)
        .patch(`/requests/${req.id}/recover`, { reason: 'legacy stuck task' });
      expectStatus(held, 409);
      expect(held.body.message).toContain(unit.id);
    });

    it('recovers a request stuck in PICKING that holds no stock (the WR-2026-JWCK7X pattern)', async () => {
      const { req, task, unit } = await stalled();
      // Reproduce the legacy data: task walked to CLOSED with nothing picked, request
      // left in PICKING, and no unit held any more (no stock link anywhere).
      await fx.prisma.fulfillmentTask.update({
        where: { id: task.id },
        data: { status: FulfillmentStatus.CLOSED },
      });
      await fx.prisma.fulfillmentTaskItem.updateMany({
        where: { taskId: task.id },
        data: { stockItemId: null },
      });
      await fx.prisma.withdrawalRequestItem.updateMany({
        where: { requestId: req.id },
        data: { stockItemId: null },
      });
      await fx.prisma.stockItem.update({
        where: { id: unit.id },
        data: { status: StockStatus.AVAILABLE },
      });
      await fx.prisma.withdrawalRequest.update({
        where: { id: req.id },
        data: { status: RequestStatus.PICKING },
      });

      await fx
        .as(staff)
        .patch(`/requests/${req.id}/recover`, { reason: 'legacy stuck task' })
        .expect(403);
      await fx
        .as(manager)
        .patch(`/requests/${req.id}/recover`, { reason: 'x' })
        .expect(400);
      const ok = await fx
        .as(manager)
        .patch(`/requests/${req.id}/recover`, { reason: 'legacy stuck task' });
      expectStatus(ok, 200);
      expect(ok.body.status).toBe(RequestStatus.CANCELLED);
      expect(
        await fx.prisma.auditLog.count({
          where: { action: 'REQUEST_RECOVERED', entityId: req.id },
        }),
      ).toBe(1);
      // Recovering twice is refused (no longer stalled)
      await fx
        .as(manager)
        .patch(`/requests/${req.id}/recover`, { reason: 'legacy stuck task' })
        .expect(400);
    });

    it('refuses while a task is live, after shipment, or for a request not in a fulfillment status', async () => {
      const { req } = await stalled();
      await fx.prisma.withdrawalRequest.update({
        where: { id: req.id },
        data: { status: RequestStatus.PICKING },
      });
      await fx
        .as(manager)
        .patch(`/requests/${req.id}/recover`, { reason: 'try while live' })
        .expect(409);

      const product = await fx.product();
      await fx.stock(product.id, 1);
      const approved = await fx.approvedRequest(requester, manager, [
        { productId: product.id, quantity: 1 },
      ]);
      await fx
        .as(manager)
        .patch(`/requests/${approved.id}/recover`, { reason: 'not stalled' })
        .expect(400);
    });
  });
});
