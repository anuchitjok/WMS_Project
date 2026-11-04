import { StockStatus, UserRole } from '@prisma/client';
import { Fixture, TestUser, expectStatus } from './harness';

// Phase 5 — partial issue / partial use and return, returns only through
// receipt → putaway, DOA → RTV → replacement link, scrap Approved vs Disposed,
// reason codes, and double-submit protection on each of these writes.
describe('Phase 5 returns, RTV and scrap', () => {
  let fx: Fixture;
  let manager: TestUser,
    staff: TestUser,
    requester: TestUser,
    checker: TestUser;

  beforeAll(async () => {
    fx = await Fixture.start();
    manager = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WAREHOUSE_MANAGER');
    checker = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WAREHOUSE_MANAGER');
    staff = await fx.user(UserRole.WAREHOUSE_STAFF);
    requester = await fx.user(UserRole.REQUESTER, 'REQUESTER');
  });
  afterAll(async () => {
    await fx.stop();
  });

  const stockRow = (id: string) =>
    fx.prisma.stockItem.findUniqueOrThrow({ where: { id } });
  const reqStatus = async (id: string) =>
    (await fx.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id } }))
      .status;

  /** Request for `qty` serial units, picked (optionally short), shipped and handed to RMA. */
  async function issued(qty: number, opts: { shortPick?: number } = {}) {
    const loc = await fx.location();
    const product = await fx.product({ serialControlled: true });
    await fx.stock(product.id, qty, {
      warehouseId: loc.warehouse.id,
      rackId: loc.rack.id,
      slotId: loc.slot.id,
    });
    const req = await fx.approvedRequest(requester, manager, [
      { productId: product.id, quantity: qty },
    ]);
    const task = await fx.allocatedTask(req.id, staff);
    expectStatus(
      await fx.as(staff).patch(`/fulfillment/${task.id}/advance`),
      200,
    ); // → PICKING
    const short = task.items.slice(0, opts.shortPick ?? 0);
    for (const it of task.items) {
      expectStatus(
        await fx
          .as(staff)
          .patch(`/fulfillment/${task.id}/items/${it.id}/pick`, {
            qty: short.includes(it) ? 0 : 1,
          }),
        200,
      );
    }
    expectStatus(
      await fx.as(staff).patch(`/fulfillment/${task.id}/advance`),
      200,
    ); // → PACKING
    expectStatus(
      await fx.as(staff).patch(`/fulfillment/${task.id}/advance`),
      200,
    ); // → PACKED
    const shipment = await fx
      .as(staff)
      .post(`/fulfillment/${task.id}/shipment`, { carrier: 'Own' });
    expectStatus(shipment, 201);
    expectStatus(
      await fx
        .as(staff)
        .post(`/fulfillment/shipments/${shipment.body.id}/dispatch`),
      201,
    );
    expectStatus(
      await fx
        .as(staff)
        .post(`/fulfillment/${task.id}/handover/rma`, { receiver: 'Tech A' }),
      201,
    );
    const units = task.items
      .filter((i) => !short.includes(i))
      .map((i) => i.stockItemId!);
    const unpicked = short.map((i) => i.stockItemId!);
    return { req, product, loc, units, unpicked };
  }

  describe('partial issue', () => {
    it('ships only what was picked; the unpicked unit goes back to Available and is not part of usage', async () => {
      const { req, units, unpicked } = await issued(3, { shortPick: 1 });
      expect(units).toHaveLength(2);
      expect(await fx.statuses(units)).toEqual([
        StockStatus.SHIPPED,
        StockStatus.SHIPPED,
      ]);
      expect(await fx.statuses(unpicked)).toEqual([StockStatus.AVAILABLE]);
      const listed = await fx.as(requester).get(`/rma/${req.id}/units`);
      expectStatus(listed, 200);
      expect(listed.body.units.map((u: any) => u.stockItemId).sort()).toEqual(
        [...units].sort(),
      );
    });
  });

  describe('partial use and partial return', () => {
    it('records usage per unit, once; Available rises only after receipt and putaway', async () => {
      const { req, units, loc } = await issued(3);
      const [used, unused, doa] = units;
      const availableBefore = await fx.prisma.stockItem.count({
        where: { status: StockStatus.AVAILABLE },
      });

      // Requester: one used, one unused (return notice only).
      const first = await fx.as(requester).patch(`/rma/${req.id}/usage`, {
        units: [
          { stockItemId: used, usage: 'USED' },
          { stockItemId: unused, usage: 'UNUSED' },
        ],
      });
      expectStatus(first, 200);
      expect(await fx.statuses([used, unused, doa])).toEqual([
        StockStatus.CONSUMED,
        StockStatus.SHIPPED,
        StockStatus.SHIPPED,
      ]);
      expect(
        await fx.prisma.stockItem.count({
          where: { status: StockStatus.AVAILABLE },
        }),
      ).toBe(availableBefore);
      expect(await reqStatus(req.id)).toBe('ISSUED_TO_RMA');

      // Double submit of the same unit is refused and records nothing new.
      await fx
        .as(requester)
        .patch(`/rma/${req.id}/usage`, {
          units: [{ stockItemId: used, usage: 'USED' }],
        })
        .expect(409);
      await fx
        .as(requester)
        .patch(`/rma/${req.id}/usage`, {
          units: [{ stockItemId: 'not-issued', usage: 'USED' }],
        })
        .expect(400);
      expect(
        await fx.prisma.issuedUnitUsage.count({ where: { requestId: req.id } }),
      ).toBe(2);

      // Third unit: DOA → RTV case, unit RTV_PENDING.
      expectStatus(
        await fx
          .as(requester)
          .patch(`/rma/${req.id}/usage`, {
            units: [{ stockItemId: doa, usage: 'DOA', notes: 'no power' }],
          }),
        200,
      );
      expect((await stockRow(doa)).status).toBe(StockStatus.RTV_PENDING);
      expect(
        await fx.prisma.rTVCase.count({ where: { stockItemId: doa } }),
      ).toBe(1);
      // Whole-request answer after every unit is recorded is refused.
      await fx
        .as(requester)
        .patch(`/rma/${req.id}/usage`, { usage: 'USED' })
        .expect(409);
      const line = await fx.prisma.withdrawalRequestItem.findFirstOrThrow({
        where: { requestId: req.id },
      });
      expect(line.usageStatus).toBe('MIXED');

      // Warehouse returns list shows only the unused unit.
      const pending = await fx.as(staff).get('/unused/pending');
      const row = pending.body.find((r: any) => r.id === req.id);
      expect(row.pendingUnits.map((u: any) => u.stockItemId)).toEqual([unused]);

      // Physical receipt: two clicks, one wins; the unit goes to the putaway queue, not Available.
      const clicks = await Promise.all([
        fx
          .as(staff)
          .patch(`/unused/${req.id}/return`, { stockItemIds: [unused] }),
        fx
          .as(staff)
          .patch(`/unused/${req.id}/return`, { stockItemIds: [unused] }),
      ]);
      expect(clicks.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await stockRow(unused)).toMatchObject({
        status: StockStatus.PENDING_INSPECTION,
        slotId: null,
      });
      expect(
        await fx.prisma.stockItem.count({
          where: { status: StockStatus.AVAILABLE },
        }),
      ).toBe(availableBefore);
      expect(await reqStatus(req.id)).toBe('COMPLETED');
      expect(
        await fx.prisma.auditLog.count({
          where: { action: 'UNUSED_RETURNED_TO_STOCK', entityId: req.id },
        }),
      ).toBe(1);

      // Putaway is what makes it Available.
      const queue = await fx.as(staff).get('/putaway/pending');
      expect(queue.body.some((s: any) => s.id === unused)).toBe(true);
      expectStatus(
        await fx
          .as(staff)
          .patch(`/putaway/${unused}/confirm`, {
            warehouseId: loc.warehouse.id,
            rackId: loc.rack.id,
            slotId: loc.slot.id,
          }),
        200,
      );
      expect((await stockRow(unused)).status).toBe(StockStatus.AVAILABLE);
    });

    it('a whole-request answer still works and stays one-shot', async () => {
      const { req, units } = await issued(2);
      expectStatus(
        await fx
          .as(requester)
          .patch(`/rma/${req.id}/usage`, { usage: 'UNUSED' }),
        200,
      );
      await fx
        .as(requester)
        .patch(`/rma/${req.id}/usage`, { usage: 'UNUSED' })
        .expect(409);
      expect(
        await fx.prisma.auditLog.findFirst({
          where: { action: 'RMA_USAGE_CONFIRMED', entityId: req.id },
        }),
      ).toMatchObject({ detail: 'Usage: UNUSED' });
      // Returned in two goes: one unit defective, one fine.
      expectStatus(
        await fx
          .as(staff)
          .patch(`/unused/${req.id}/doa`, { stockItemIds: [units[0]] }),
        200,
      );
      expect(await reqStatus(req.id)).toBe('ISSUED_TO_RMA');
      expectStatus(await fx.as(staff).patch(`/unused/${req.id}/return`), 200);
      expect(await fx.statuses(units)).toEqual([
        StockStatus.RTV_PENDING,
        StockStatus.PENDING_INSPECTION,
      ]);
      expect(await reqStatus(req.id)).toBe('COMPLETED');
      await fx.as(staff).patch(`/unused/${req.id}/return`).expect(409);
    });

    it('a requester only sees and confirms their own issued goods', async () => {
      const { req } = await issued(1);
      const other = await fx.user(UserRole.REQUESTER, 'REQUESTER');
      expect(
        (await fx.as(other).get('/rma/pending-usage')).body.some(
          (r: any) => r.id === req.id,
        ),
      ).toBe(false);
      expect(
        (await fx.as(requester).get('/rma/pending-usage')).body.some(
          (r: any) => r.id === req.id,
        ),
      ).toBe(true);
      await fx.as(other).get(`/rma/${req.id}/units`).expect(403);
      // Pending returns: a requester sees only their own; the warehouse sees all.
      expectStatus(
        await fx
          .as(requester)
          .patch(`/rma/${req.id}/usage`, { usage: 'UNUSED' }),
        200,
      );
      expect(
        (await fx.as(other).get('/unused/pending')).body.some(
          (r: any) => r.id === req.id,
        ),
      ).toBe(false);
      expect(
        (await fx.as(requester).get('/unused/pending')).body.some(
          (r: any) => r.id === req.id,
        ),
      ).toBe(true);
      expect(
        (await fx.as(staff).get('/unused/pending')).body.some(
          (r: any) => r.id === req.id,
        ),
      ).toBe(true);
    });
  });

  describe('DOA → RTV → replacement', () => {
    async function rtvAtVendor() {
      const loc = await fx.location();
      const product = await fx.product({ serialControlled: true });
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
      for (const s of ['APPROVED', 'SHIPPED_TO_VENDOR', 'VENDOR_RECEIVED']) {
        expectStatus(
          await fx.as(manager).patch(`/rtv/${id}/status`, { status: s }),
          200,
        );
      }
      return { unit, id, product, vendor, loc };
    }

    it('shipping to the vendor takes the unit out of on-hand stock', async () => {
      const { unit } = await rtvAtVendor();
      expect((await stockRow(unit.id)).status).toBe(StockStatus.RTV_SHIPPED);
    });

    it('the replacement is received through Goods Receiving, linked to the case and old serial, once', async () => {
      const { unit, id, vendor } = await rtvAtVendor();
      expectStatus(
        await fx
          .as(manager)
          .patch(`/rtv/${id}/status`, { status: 'REPLACEMENT_PENDING' }),
        200,
      );
      // Cannot close a replacement case without receiving the replacement.
      await fx
        .as(manager)
        .patch(`/rtv/${id}/status`, { status: 'COMPLETED' })
        .expect(400);

      const serial = fx.uid('SN-REPL');
      const both = await Promise.all([
        fx.as(manager).post(`/rtv/${id}/replacement`, { serialNumber: serial }),
        fx
          .as(manager)
          .post(`/rtv/${id}/replacement`, { serialNumber: fx.uid('SN-REPL') }),
      ]);
      expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
      const ok = both.find((r) => r.status === 201)!;
      const c = await fx.prisma.rTVCase.findUniqueOrThrow({ where: { id } });
      expect(c).toMatchObject({ status: 'COMPLETED', resolution: 'REPLACED' });
      expect(c.replacementStockId).toBeTruthy();
      const repl = await stockRow(c.replacementStockId!);
      expect(repl.status).toBe(StockStatus.PENDING_RECEIVING); // inspected and put away like any receipt
      const gr = await fx.prisma.goodsReceiving.findUniqueOrThrow({
        where: { id: ok.body.receiving.id },
      });
      expect(gr).toMatchObject({
        sourceType: 'RTV Replacement',
        sourceRef: c.refNumber,
        supplierId: vendor.id,
      });
      expect(gr.notes).toContain(unit.serialNumber!);
      // Exactly one receipt for this case — the losing click wrote nothing.
      expect(
        await fx.prisma.goodsReceiving.count({
          where: { sourceRef: c.refNumber },
        }),
      ).toBe(1);
      await fx
        .as(manager)
        .post(`/rtv/${id}/replacement`, { serialNumber: fx.uid('SN') })
        .expect(409);
    });

    it('POST /rtv keeps one open case per unit and moves the unit to RTV_PENDING', async () => {
      const product = await fx.product();
      const [unit] = await fx.stock(product.id, 1, { status: StockStatus.DOA });
      const both = await Promise.all([
        fx.as(manager).post('/rtv', { stockItemId: unit.id, reason: 'doa' }),
        fx.as(manager).post('/rtv', { stockItemId: unit.id, reason: 'doa' }),
      ]);
      expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
      expect((await stockRow(unit.id)).status).toBe(StockStatus.RTV_PENDING);
      // Cancelling before shipment puts the unit back on the DOA list; a closed case stays closed.
      const id = both.find((r) => r.status === 201)!.body.id;
      expectStatus(
        await fx
          .as(manager)
          .patch(`/rtv/${id}/status`, { status: 'CANCELLED' }),
        200,
      );
      expect((await stockRow(unit.id)).status).toBe(StockStatus.DOA);
      await fx
        .as(manager)
        .patch(`/rtv/${id}/status`, { status: 'APPROVED' })
        .expect(409);
    });

    it('a credit-note case records its reference', async () => {
      const { id } = await rtvAtVendor();
      expectStatus(
        await fx
          .as(manager)
          .patch(`/rtv/${id}/status`, { status: 'CREDIT_NOTE_PENDING' }),
        200,
      );
      expectStatus(
        await fx
          .as(manager)
          .patch(`/rtv/${id}/status`, {
            status: 'COMPLETED',
            creditNoteRef: 'CN-1001',
          }),
        200,
      );
      expect(
        await fx.prisma.rTVCase.findUniqueOrThrow({ where: { id } }),
      ).toMatchObject({ status: 'COMPLETED', creditNoteRef: 'CN-1001' });
    });
  });

  describe('scrap: Approved is not Disposed', () => {
    async function approved(quantity = 1) {
      const product = await fx.product();
      const [unit] = await fx.stock(product.id, 1);
      const res = await fx
        .as(manager)
        .post('/scrap', { stockItemId: unit.id, reason: 'broken', quantity });
      expectStatus(res, 201);
      expectStatus(
        await fx
          .as(checker)
          .patch(`/scrap/${res.body.id}/status`, { status: 'APPROVED' }),
        200,
      );
      return { unit, id: res.body.id as string };
    }

    it('approval keeps the stock; disposal needs a method and only then deducts', async () => {
      const { unit, id } = await approved();
      expect((await stockRow(unit.id)).status).toBe(StockStatus.AVAILABLE);
      const missing = await fx
        .as(manager)
        .patch(`/scrap/${id}/status`, { status: 'DISPOSED' });
      expectStatus(missing, 400);
      expect(missing.body.message).toMatch(/Disposal method is required/);
      expect((await stockRow(unit.id)).status).toBe(StockStatus.AVAILABLE);
      expectStatus(
        await fx
          .as(manager)
          .patch(`/scrap/${id}/status`, {
            status: 'DISPOSED',
            disposalMethod: 'Recycled',
            notes: 'Cert #77',
          }),
        200,
      );
      expect(
        await fx.prisma.scrapCase.findUniqueOrThrow({ where: { id } }),
      ).toMatchObject({
        status: 'DISPOSED',
        disposalMethod: 'Recycled',
        notes: 'Cert #77',
      });
      expect((await stockRow(unit.id)).status).toBe(StockStatus.CLOSED);
    });

    it('cancelling an approved case leaves the stock exactly as it was', async () => {
      const { unit, id } = await approved();
      expectStatus(
        await fx
          .as(manager)
          .patch(`/scrap/${id}/status`, { status: 'CANCELLED' }),
        200,
      );
      expect(await stockRow(unit.id)).toMatchObject({
        status: StockStatus.AVAILABLE,
        quantity: 1,
      });
    });

    it('two scrap requests for one unit at once open one case', async () => {
      const product = await fx.product();
      const [unit] = await fx.stock(product.id, 1);
      const both = await Promise.all([
        fx
          .as(manager)
          .post('/scrap', { stockItemId: unit.id, reason: 'broken' }),
        fx
          .as(manager)
          .post('/scrap', { stockItemId: unit.id, reason: 'broken' }),
      ]);
      expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        await fx.prisma.scrapCase.count({ where: { stockItemId: unit.id } }),
      ).toBe(1);
    });
  });

  describe('DOA / SCRAP reason codes', () => {
    it('once codes exist, a declaration must use an active code', async () => {
      await fx.prisma.reasonCode.create({
        data: {
          category: 'DOA',
          code: fx.uid('NOPWR').toUpperCase(),
          description: 'No power',
          isActive: true,
        },
      });
      await fx.prisma.reasonCode.create({
        data: {
          category: 'SCRAP',
          code: fx.uid('BRK').toUpperCase(),
          description: 'Broken',
          isActive: true,
        },
      });
      const product = await fx.product();
      const [a, b] = await fx.stock(product.id, 2);
      await fx
        .as(manager)
        .patch(`/doa/${a.id}/declare`, { reason: 'free text' })
        .expect(400);
      const doaCode = (
        await fx.prisma.reasonCode.findFirstOrThrow({
          where: { category: 'DOA' },
        })
      ).code;
      expectStatus(
        await fx
          .as(manager)
          .patch(`/doa/${a.id}/declare`, { reasonCode: doaCode }),
        200,
      );
      expect((await stockRow(a.id)).status).toBe(StockStatus.DOA);
      await fx
        .as(manager)
        .post('/scrap', { stockItemId: b.id, reason: 'free text' })
        .expect(400);
      const scrapCode = (
        await fx.prisma.reasonCode.findFirstOrThrow({
          where: { category: 'SCRAP' },
        })
      ).code;
      const ok = await fx
        .as(manager)
        .post('/scrap', { stockItemId: b.id, reasonCode: scrapCode });
      expectStatus(ok, 201);
      expect(ok.body.reasonCode).toBe(scrapCode);
    });
  });
});
