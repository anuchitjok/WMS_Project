import request from 'supertest';
import { StockStatus, UserRole } from '@prisma/client';
import { Fixture, TestUser, expectStatus } from './harness';

// Phase 6 — system setup checklist, imports that follow the screens' rules,
// one import per file (with an explicit re-import), and controlled reversal of
// a mistaken receipt that keeps the original record and its audit trail.
describe('Phase 6 setup checklist, import controls and receipt reversal', () => {
  let fx: Fixture;
  let admin: TestUser,
    manager: TestUser,
    checker: TestUser,
    staff: TestUser,
    requester: TestUser;

  beforeAll(async () => {
    fx = await Fixture.start();
    admin = await fx.user(UserRole.SYSTEM_ADMIN);
    manager = await fx.user(UserRole.WAREHOUSE_MANAGER);
    checker = await fx.user(UserRole.WAREHOUSE_MANAGER);
    staff = await fx.user(UserRole.WAREHOUSE_STAFF);
    requester = await fx.user(UserRole.REQUESTER, 'REQUESTER');
  });
  afterAll(async () => {
    await fx.stop();
  });

  const upload = (
    u: TestUser,
    path: string,
    csv: string,
    name = 'data.csv',
    fields: Record<string, string> = {},
  ) => {
    let r = request(fx.app.getHttpServer())
      .post(`/api${path}`)
      .set('Authorization', `Bearer ${fx.token(u)}`);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r.attach('file', Buffer.from(csv), name);
  };
  const audits = (action: string) =>
    fx.prisma.auditLog.count({ where: { action } });

  describe('one import per file', () => {
    it('master data: the same file (even renamed) is refused until re-import is confirmed', async () => {
      const code = fx.uid('WHI');
      const csv = `warehouseCode,warehouseName,location,rackCode,slotCode\n${code},Import WH,Bldg A,R1,S1\n`;

      const pre = await upload(manager, '/io/import/warehouse/preview', csv);
      expectStatus(pre, 201);
      expect(pre.body.alreadyImported).toBeNull();
      expect(pre.body.fileHash).toMatch(/^[0-9a-f]{64}$/);

      const first = await upload(manager, '/io/import/warehouse/commit', csv);
      expectStatus(first, 201);
      expect(first.body.batch).toMatch(/^IMP-\d{4}-[A-Z0-9_-]{6}$/);
      const before = await audits('BULK_IMPORT');

      // Preview now says so; commit of the same content under another name is refused.
      const again = await upload(
        manager,
        '/io/import/warehouse/preview',
        csv,
        'renamed.csv',
      );
      expect(again.body.alreadyImported).toMatchObject({
        batch: first.body.batch,
      });
      const dup = await upload(
        manager,
        '/io/import/warehouse/commit',
        csv,
        'renamed.csv',
      );
      expectStatus(dup, 409);
      expect(dup.body.message).toContain(first.body.batch);
      expect(await audits('BULK_IMPORT')).toBe(before);

      // Explicit confirmation imports it again and records which batch it repeats.
      const re = await upload(
        manager,
        '/io/import/warehouse/commit?allowReimport=true',
        csv,
      );
      expectStatus(re, 201);
      const log = await fx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'BULK_IMPORT', entityId: re.body.batch },
      });
      expect(log.changes).toMatchObject({
        batch: re.body.batch,
        reimportOf: first.body.batch,
        fileName: 'data.csv',
      });
      expect(await fx.prisma.warehouse.count({ where: { code } })).toBe(1);
    });

    it('two simultaneous uploads of one new file: one imports, the other is refused', async () => {
      const code = fx.uid('WHC');
      const csv = `warehouseCode,warehouseName\n${code},Concurrent WH\n`;
      const both = await Promise.all([
        upload(manager, '/io/import/warehouse/commit', csv),
        upload(manager, '/io/import/warehouse/commit', csv),
      ]);
      expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    });

    it('receiving import: the same file does not receive the same goods twice', async () => {
      const loc = await fx.location();
      const product = await fx.product();
      const csv = `productCode,quantity,warehouseCode\n${product.code},4,${loc.warehouse.code}\n`;
      const header = { sourceType: 'Vendor' };

      const pre = await upload(staff, '/receiving/import/preview', csv);
      expectStatus(pre, 201);
      expect(pre.body.alreadyImported).toBeNull();
      const first = await upload(
        staff,
        '/receiving/import/commit',
        csv,
        'gr.csv',
        header,
      );
      expectStatus(first, 201);
      const units = () =>
        fx.prisma.stockItem.count({ where: { productId: product.id } });
      const after = await units();

      expect(
        (await upload(staff, '/receiving/import/preview', csv)).body
          .alreadyImported,
      ).toMatchObject({ refNumber: first.body.refNumber });
      const dup = await upload(
        staff,
        '/receiving/import/commit',
        csv,
        'gr-copy.csv',
        header,
      );
      expectStatus(dup, 409);
      expect(dup.body.message).toContain(first.body.refNumber);
      expect(await units()).toBe(after);

      const re = await upload(
        staff,
        '/receiving/import/commit',
        csv,
        'gr.csv',
        { ...header, allowReimport: 'true' },
      );
      expectStatus(re, 201);
      expect(await units()).toBeGreaterThan(after);
    });

    it('receiving import follows Receive Goods rules: inactive product, serial with quantity ≠ 1', async () => {
      const inactive = await fx.product();
      await fx.prisma.product.update({
        where: { id: inactive.id },
        data: { isActive: false, productStatus: 'DISCONTINUED' },
      });
      const serial = await fx.product({ serialControlled: true });
      const csv = `productCode,serialNumber,quantity\n${inactive.code},,1\n${serial.code},${fx.uid('SN')},2\n`;
      const pre = await upload(staff, '/receiving/import/preview', csv);
      expectStatus(pre, 201);
      expect(pre.body.summary).toMatchObject({
        total: 2,
        valid: 0,
        invalid: 2,
      });
      expect(pre.body.rows[0].errors.join(' ')).toMatch(
        /discontinued and cannot be received/,
      );
      expect(pre.body.rows[1].errors.join(' ')).toMatch(/quantity must be 1/);
    });
  });

  describe('imports follow the same rules as the screens', () => {
    it('products: unit must be a listed unit of measure, numbers ≥ 0, serialControlled true/false', async () => {
      await fx.prisma.unitOfMeasure.create({
        data: { code: 'EA', name: 'Each' },
      });
      const [a, b, c, d] = [
        fx.uid('P6A'),
        fx.uid('P6B'),
        fx.uid('P6C'),
        fx.uid('P6D'),
      ];
      const csv = [
        'code,name,unit,unitCost,minStock,serialControlled',
        `${a},Good,EA,10,1,true`,
        `${b},Bad unit,boxes,10,1,false`,
        `${c},Negative,EA,-5,-1,false`,
        `${d},Bad flag,EA,1,1,yes`,
      ].join('\n');
      const pre = await upload(manager, '/io/import/products/preview', csv);
      expectStatus(pre, 201);
      const errs = pre.body.rows.map((r: any) => r.errors.join(' | '));
      expect(errs[0]).toBe('');
      expect(errs[1]).toMatch(/unit/i);
      expect(errs[2]).toMatch(/unitCost must be 0 or more/);
      expect(errs[2]).toMatch(/minStock must be 0 or more/);
      expect(errs[3]).toMatch(/serialControlled must be true or false/);

      const commit = await upload(manager, '/io/import/products/commit', csv);
      expectStatus(commit, 201);
      expect(
        await fx.prisma.product.count({
          where: { code: { in: [a, b, c, d] } },
        }),
      ).toBe(1);
    });

    it('users: admin grant, email, department and password policy; no password → change at first sign-in', async () => {
      await fx.prisma.department.create({
        data: { code: 'OPS', name: 'Operations' },
      });
      const taken = await fx.prisma.user.create({
        data: {
          username: fx.uid('mail'),
          fullName: 'x',
          passwordHash: 'x',
          role: UserRole.REQUESTER,
          email: 'taken@example.com',
        },
      });
      expect(taken.email).toBe('taken@example.com');
      const [u1, u2, u3, u4, u5, u6, u7] = Array.from({ length: 7 }, () =>
        fx.uid('imp'),
      );
      const csv = [
        'username,fullName,email,role,department,password',
        `${u1},Admin Grant,,SYSTEM_ADMIN,,`,
        `${u2},Bad Mail,not-an-email,REQUESTER,,`,
        `${u3},Taken Mail,TAKEN@example.com,REQUESTER,,`,
        `${u4},Bad Dept,,REQUESTER,Nowhere,`,
        `${u5},Weak Pw,,REQUESTER,,abc`,
        `${u6},Temp Pw,,REQUESTER,Operations,`,
        `${u7},Own Pw,,REQUESTER,OPS,Str0ng!Passw0rd`,
      ].join('\n');

      const byManager = await upload(manager, '/io/import/users/preview', csv);
      expectStatus(byManager, 201);
      const rows = byManager.body.rows;
      expect(rows[0].errors.join()).toMatch(
        /Only a system administrator can grant the SYSTEM_ADMIN role/,
      );
      expect(rows[1].errors.join()).toMatch(/Invalid email/);
      expect(rows[2].errors.join()).toMatch(/Email already used/);
      expect(rows[3].errors.join()).toMatch(
        /Unknown or inactive department: Nowhere/,
      );
      expect(rows[4].errors.join()).toMatch(/Password must contain/);
      expect(rows[5]).toMatchObject({ valid: true });
      expect(rows[5].notes.join()).toMatch(/must be changed at first sign-in/);
      expect(rows[6]).toMatchObject({ valid: true });

      // A system administrator may grant SYSTEM_ADMIN.
      const byAdmin = await upload(admin, '/io/import/users/preview', csv);
      expect(byAdmin.body.rows[0].errors).toEqual([]);

      const commit = await upload(manager, '/io/import/users/commit', csv);
      expectStatus(commit, 201);
      const created = await fx.prisma.user.findMany({
        where: { username: { in: [u1, u2, u3, u4, u5, u6, u7] } },
        orderBy: { username: 'asc' },
      });
      expect(created.map((u) => u.username).sort()).toEqual([u6, u7].sort());
      const temp = created.find((u) => u.username === u6)!;
      const own = created.find((u) => u.username === u7)!;
      expect(temp).toMatchObject({
        forcePasswordChange: true,
        department: 'OPS',
      });
      expect(own).toMatchObject({
        forcePasswordChange: false,
        department: 'OPS',
      });
    });
  });

  describe('reversing a mistaken receipt', () => {
    async function receipt(by: TestUser, serials: string[]) {
      const loc = await fx.location();
      const product = await fx.product({ serialControlled: true });
      const res = await fx.as(by).post('/receiving', {
        sourceType: 'Vendor',
        items: serials.map((s) => ({
          productId: product.id,
          quantity: 1,
          serialNumber: s,
          warehouseId: loc.warehouse.id,
        })),
      });
      expectStatus(res, 201);
      return {
        gr: res.body as {
          id: string;
          refNumber: string;
          items: Array<{ id: string; stockItemId: string }>;
        },
        product,
        loc,
      };
    }

    it('needs a reason, a supervisor and a second person; keeps the receipt and frees the serials', async () => {
      const serials = [fx.uid('SN-R'), fx.uid('SN-R')];
      const { gr, product, loc } = await receipt(manager, serials);
      const units = gr.items.map((i) => i.stockItemId);

      await fx
        .as(checker)
        .post(`/receiving/${gr.id}/reverse`, { reason: 'x' })
        .expect(400);
      await fx
        .as(staff)
        .post(`/receiving/${gr.id}/reverse`, {
          reason: 'Wrong vendor delivery',
        })
        .expect(403);
      await fx
        .as(manager)
        .post(`/receiving/${gr.id}/reverse`, {
          reason: 'Wrong vendor delivery',
        })
        .expect(403); // maker ≠ checker
      expect(await fx.statuses(units)).toEqual([
        StockStatus.PENDING_RECEIVING,
        StockStatus.PENDING_RECEIVING,
      ]);

      const ok = await fx
        .as(checker)
        .post(`/receiving/${gr.id}/reverse`, {
          reason: 'Wrong vendor delivery',
        });
      expectStatus(ok, 201);
      expect(ok.body).toMatchObject({
        refNumber: gr.refNumber,
        reversedUnits: 2,
      });

      // Original receipt and lines kept; only its status changed.
      const kept = await fx.prisma.goodsReceiving.findUniqueOrThrow({
        where: { id: gr.id },
        include: { items: true },
      });
      expect(kept).toMatchObject({
        statusEnum: 'CANCELLED',
        status: 'cancelled',
        refNumber: gr.refNumber,
      });
      expect(kept.items).toHaveLength(2);
      expect(await fx.statuses(units)).toEqual([
        StockStatus.CANCELLED,
        StockStatus.CANCELLED,
      ]);
      const log = await fx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'RECEIVING_REVERSED', entityId: gr.id },
      });
      expect(log).toMatchObject({ userId: checker.id });
      expect(log.changes).toMatchObject({
        reason: 'Wrong vendor delivery',
        status: { to: 'CANCELLED' },
      });
      expect(
        await fx.prisma.auditLog.count({
          where: { action: 'STOCK_RECEIPT_REVERSED', entityId: { in: units } },
        }),
      ).toBe(2);

      // Once only; a reversed receipt cannot be verified afterwards.
      await fx
        .as(checker)
        .post(`/receiving/${gr.id}/reverse`, {
          reason: 'Wrong vendor delivery',
        })
        .expect(409);
      await fx.as(checker).patch(`/receiving/${gr.id}/verify`).expect(409);
      expect(await fx.statuses(units)).toEqual([
        StockStatus.CANCELLED,
        StockStatus.CANCELLED,
      ]);

      // The serials can be received correctly now.
      const again = await fx.as(manager).post('/receiving', {
        sourceType: 'Vendor',
        items: serials.map((s) => ({
          productId: product.id,
          quantity: 1,
          serialNumber: s,
          warehouseId: loc.warehouse.id,
        })),
      });
      expectStatus(again, 201);
    });

    it('is refused once any unit has been put away, and changes nothing', async () => {
      const { gr } = await receipt(staff, [fx.uid('SN-P'), fx.uid('SN-P')]);
      const [first] = gr.items;
      expectStatus(
        await fx
          .as(staff)
          .patch(`/receiving/${gr.id}/inspect`, {
            items: [
              { itemId: first.id, inspectedQty: 1, inspectionOutcome: 'good' },
            ],
          }),
        200,
      );
      const dest = await fx.location();
      expectStatus(
        await fx
          .as(staff)
          .patch(`/putaway/${first.stockItemId}/confirm`, {
            slotId: dest.slot.id,
          }),
        200,
      );
      const before = await fx.statuses(gr.items.map((i) => i.stockItemId));

      const res = await fx
        .as(manager)
        .post(`/receiving/${gr.id}/reverse`, {
          reason: 'Counted twice by mistake',
        });
      expectStatus(res, 409);
      expect(res.body.message).toMatch(/already moved on/);
      expect(await fx.statuses(gr.items.map((i) => i.stockItemId))).toEqual(
        before,
      );
      expect(
        (
          await fx.prisma.goodsReceiving.findUniqueOrThrow({
            where: { id: gr.id },
          })
        ).statusEnum,
      ).not.toBe('CANCELLED');
    });

    it('reversing an RTV replacement receipt puts the case back to waiting for its replacement', async () => {
      const product = await fx.product({ serialControlled: true });
      const loc = await fx.location();
      const [unit] = await fx.stock(product.id, 1, {
        status: StockStatus.DOA,
        warehouseId: loc.warehouse.id,
      });
      const vendor = await fx.prisma.vendor.create({
        data: { name: fx.uid('Vendor'), code: fx.uid('V') },
      });
      const created = await fx
        .as(manager)
        .post(`/doa/${unit.id}/rtv`, { vendorId: vendor.id });
      expectStatus(created, 201);
      const id = created.body.id as string;
      for (const s of [
        'APPROVED',
        'SHIPPED_TO_VENDOR',
        'VENDOR_RECEIVED',
        'REPLACEMENT_PENDING',
      ]) {
        expectStatus(
          await fx.as(manager).patch(`/rtv/${id}/status`, { status: s }),
          200,
        );
      }
      const repl = await fx
        .as(manager)
        .post(`/rtv/${id}/replacement`, { serialNumber: fx.uid('SN-NEW') });
      expectStatus(repl, 201);

      expectStatus(
        await fx
          .as(checker)
          .post(`/receiving/${repl.body.receiving.id}/reverse`, {
            reason: 'Vendor sent the wrong model',
          }),
        201,
      );
      const c = await fx.prisma.rTVCase.findUniqueOrThrow({ where: { id } });
      expect(c).toMatchObject({
        status: 'REPLACEMENT_PENDING',
        replacementStockId: null,
        resolution: null,
      });
      expect(await audits('RTV_REPLACEMENT_REVERSED')).toBeGreaterThanOrEqual(
        1,
      );
      // …and the correct replacement can be received.
      expectStatus(
        await fx
          .as(manager)
          .post(`/rtv/${id}/replacement`, { serialNumber: fx.uid('SN-NEW') }),
        201,
      );
    });
  });

  describe('system setup checklist', () => {
    it('is read-only, supervisor-only, and every status comes from the data', async () => {
      await fx.as(requester).get('/settings/setup-checklist').expect(403);

      // Problems a person should see: a rack with no slot, a product whose unit is
      // not a unit of measure, a test-looking approval rule (review, never delete).
      const wh = await fx.prisma.warehouse.create({
        data: { code: fx.uid('WHS'), name: 'Setup WH' },
      });
      await fx.prisma.rack.create({
        data: { warehouseId: wh.id, code: 'EMPTY' },
      });
      const p = await fx.product();
      await fx.prisma.product.update({
        where: { id: p.id },
        data: { unit: 'carton' },
      });
      const rule = await fx.prisma.approvalRule.create({
        data: { name: 'UAT test rule', entityType: 'WithdrawalRequest' },
      });
      const before = await fx.prisma.auditLog.count();

      const res = await fx.as(manager).get('/settings/setup-checklist');
      expectStatus(res, 200);
      const step = (k: string) => res.body.steps.find((s: any) => s.key === k);
      expect(res.body.steps.map((s: any) => s.key)).toEqual([
        'company',
        'codes',
        'partners',
        'warehouse',
        'products',
        'access',
        'approvals',
        'settings',
      ]);
      expect(step('company').status).toBe('NOT_STARTED');
      expect(step('warehouse').status).toBe('NEEDS_FIX');
      expect(step('warehouse').issues.join()).toMatch(/EMPTY has no slot/);
      expect(step('products').status).toBe('NEEDS_FIX');
      expect(step('products').issues.join()).toContain(
        `${p.code}: unit "carton"`,
      );
      expect(step('approvals').status).toBe('REVIEW');
      expect(step('approvals').issues.join()).toMatch(
        /UAT test rule.*do not delete/,
      );
      expect(res.body.ready).toBe(false);
      const total = Object.values(
        res.body.counts as Record<string, number>,
      ).reduce((a, b) => a + b, 0);
      expect(total).toBe(8);

      // Read-only: nothing changed, the rule is still there and active.
      expect(await fx.prisma.auditLog.count()).toBe(before);
      expect(
        await fx.prisma.approvalRule.findUniqueOrThrow({
          where: { id: rule.id },
        }),
      ).toMatchObject({ isActive: true });

      // Filling in the company profile moves that step on.
      await fx.prisma.companyProfile.upsert({
        where: { id: 'default' },
        update: { legalName: 'Acme Co., Ltd.' },
        create: { id: 'default', legalName: 'Acme Co., Ltd.' },
      });
      const after = await fx.as(manager).get('/settings/setup-checklist');
      expect(
        after.body.steps.find((s: any) => s.key === 'company'),
      ).toMatchObject({
        status: 'IN_PROGRESS',
        issues: ['Missing address', 'Missing tax ID'],
      });
    });
  });
});
