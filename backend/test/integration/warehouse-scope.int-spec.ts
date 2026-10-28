import { StockStatus, UserRole } from '@prisma/client';
import { Fixture, TestUser, expectStatus } from './harness';

// Phase 2.3: warehouse-level authorization, role × warehouse matrix.
//
//                       | own WH (A) | other WH (B) | aggregates
//  manager scoped to A  |  allowed   |   denied     | A only
//  staff scoped to A    |  allowed   |   denied     | A only
//  unscoped manager     |  allowed   |   allowed    | all  (legacy: no assignment = all)
//  SUPER_ADMIN scoped A |  allowed   |   allowed    | all  (super admin is never limited)

describe('Warehouse-level authorization', () => {
  let fx: Fixture;
  let A: Awaited<ReturnType<Fixture['location']>>,
    B: Awaited<ReturnType<Fixture['location']>>;
  let mgrA: TestUser,
    mgrA2: TestUser,
    staffA: TestUser,
    mgrAll: TestUser,
    superA: TestUser;
  let stockA: string, stockB: string, productId: string;

  async function scopeTo(u: TestUser, ...whIds: string[]) {
    for (const warehouseId of whIds)
      await fx.prisma.userWarehouse.create({
        data: { userId: u.id, warehouseId },
      });
  }

  beforeAll(async () => {
    fx = await Fixture.start();
    A = await fx.location();
    B = await fx.location();
    mgrA = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WAREHOUSE_MANAGER');
    mgrA2 = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WAREHOUSE_MANAGER');
    staffA = await fx.user(UserRole.WAREHOUSE_STAFF, 'PICKER');
    mgrAll = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WAREHOUSE_MANAGER');
    superA = await fx.user(UserRole.SYSTEM_ADMIN, 'SUPER_ADMIN');
    await scopeTo(mgrA, A.warehouse.id);
    await scopeTo(mgrA2, A.warehouse.id);
    await scopeTo(staffA, A.warehouse.id);
    await scopeTo(superA, A.warehouse.id);
    const product = await fx.product();
    productId = product.id;
    [{ id: stockA }] = await fx.stock(product.id, 1, {
      quantity: 10,
      serial: false,
      warehouseId: A.warehouse.id,
      rackId: A.rack.id,
      slotId: A.slot.id,
    });
    [{ id: stockB }] = await fx.stock(product.id, 1, {
      quantity: 10,
      serial: false,
      warehouseId: B.warehouse.id,
      rackId: B.rack.id,
      slotId: B.slot.id,
    });
  });
  afterAll(async () => {
    await fx.stop();
  });

  describe('inventory', () => {
    it('item reads: own warehouse allowed, other denied; unscoped and super admin see both', async () => {
      await fx.as(mgrA).get(`/inventory/${stockA}`).expect(200);
      await fx.as(mgrA).get(`/inventory/${stockB}`).expect(403);
      await fx.as(mgrA).get(`/inventory/${stockB}/detail-full`).expect(403);
      await fx.as(mgrAll).get(`/inventory/${stockB}`).expect(200);
      await fx.as(superA).get(`/inventory/${stockB}`).expect(200);
    });

    it('writes on another warehouse are refused (status, location, create)', async () => {
      await fx
        .as(mgrA)
        .patch(`/inventory/${stockB}/status`, { status: 'QUARANTINE' })
        .expect(403);
      await fx
        .as(mgrA)
        .patch(`/inventory/${stockA}/location`, {
          warehouseId: B.warehouse.id,
          rackId: B.rack.id,
          slotId: B.slot.id,
        })
        .expect(403);
      await fx
        .as(mgrA)
        .post('/inventory', { productId, warehouseId: B.warehouse.id })
        .expect(403);
      expect(
        (await fx.prisma.stockItem.findUniqueOrThrow({ where: { id: stockB } }))
          .status,
      ).toBe(StockStatus.AVAILABLE);
    });

    it('cross-warehouse id manipulation in list filters is refused, aggregates are narrowed', async () => {
      await fx
        .as(mgrA)
        .get(`/inventory/kpi?warehouseId=${B.warehouse.id}`)
        .expect(403);
      const all = await fx.as(mgrAll).get('/dashboard/stats');
      const mine = await fx.as(mgrA).get('/dashboard/stats');
      expectStatus(all, 200);
      expectStatus(mine, 200);
      expect(mine.body.totals.totalStock).toBe(1);
      expect(all.body.totals.totalStock).toBeGreaterThanOrEqual(2);
      await fx
        .as(mgrA)
        .get(`/dashboard/kpis?warehouseId=${B.warehouse.id}`)
        .expect(403);
    });
  });

  describe('reports and exports', () => {
    it("report rows and exports only contain the caller's warehouses", async () => {
      const mine = await fx.as(mgrA).get('/reports/balance');
      expectStatus(mine, 200);
      const whs = new Set(mine.body.rows.map((r: any) => r.warehouse));
      expect([...whs]).toEqual([A.warehouse.name]);
      await fx
        .as(mgrA)
        .get(`/reports/balance?warehouseId=${B.warehouse.id}`)
        .expect(403);
      await fx
        .as(mgrA)
        .get(
          `/reports/master-data/export?format=csv&warehouseId=${B.warehouse.id}`,
        )
        .expect(403);
      const csv = await fx
        .as(mgrA)
        .get('/reports/master-data/export?format=csv');
      expectStatus(csv, 200);
      expect(csv.text).not.toContain(B.warehouse.name);
      const inv = await fx.as(mgrA).get('/io/export/inventory?format=csv');
      expectStatus(inv, 200);
      expect(inv.text).toContain(A.warehouse.code);
      expect(inv.text).not.toContain(B.warehouse.code);
    });
  });

  describe('cycle count', () => {
    it('cannot count, list or approve another warehouse', async () => {
      await fx
        .as(staffA)
        .post('/cycle-count', { warehouseId: B.warehouse.id })
        .expect(403);
      const sB = await fx
        .as(mgrAll)
        .post('/cycle-count', { warehouseId: B.warehouse.id });
      expectStatus(sB, 201);
      await fx.as(mgrA).get(`/cycle-count/${sB.body.id}`).expect(403);
      await fx.as(mgrA).post(`/cycle-count/${sB.body.id}/cancel`).expect(403);
      const list = await fx.as(mgrA).get('/cycle-count');
      expect(
        list.body.every((s: any) => s.warehouseId === A.warehouse.id),
      ).toBe(true);
      expectStatus(
        await fx.as(mgrAll).post(`/cycle-count/${sB.body.id}/cancel`),
        201,
      );
    });
  });

  describe('adjustment, transfer, RTV, scrap', () => {
    it('adjustment: create/approve on another warehouse refused; list filtered', async () => {
      await fx
        .as(mgrA)
        .post('/adjustment', {
          stockItemId: stockB,
          productLabel: 'x',
          reason: 'Data correction',
          quantityBefore: 10,
          quantityAfter: 9,
        })
        .expect(403);
      const adjB = await fx
        .as(mgrAll)
        .post('/adjustment', {
          stockItemId: stockB,
          productLabel: 'x',
          reason: 'Data correction',
          quantityBefore: 10,
          quantityAfter: 9,
        });
      expectStatus(adjB, 201);
      await fx
        .as(mgrA)
        .patch(`/adjustment/${adjB.body.id}/approve`)
        .expect(403);
      const list = await fx.as(mgrA).get('/adjustment');
      expect(list.body.find((a: any) => a.id === adjB.body.id)).toBeUndefined();
      expectStatus(
        await fx.as(mgrAll).patch(`/adjustment/${adjB.body.id}/reject`),
        200,
      );
    });

    it('transfer: moving own stock into another warehouse is refused', async () => {
      const trf = await fx
        .as(mgrA)
        .post('/transfer', {
          stockItemId: stockA,
          productLabel: 'x',
          quantity: 1,
          fromLocation: 'A',
          toLocation: 'B',
        });
      expectStatus(trf, 201);
      await fx
        .as(mgrA)
        .patch(`/transfer/${trf.body.id}/complete`, {
          warehouseId: B.warehouse.id,
          rackId: B.rack.id,
          slotId: B.slot.id,
        })
        .expect(403);
      expect(
        (await fx.prisma.stockItem.findUniqueOrThrow({ where: { id: stockA } }))
          .warehouseId,
      ).toBe(A.warehouse.id);
      await fx
        .as(mgrA)
        .post('/transfer', {
          stockItemId: stockB,
          productLabel: 'x',
          quantity: 1,
          fromLocation: 'B',
          toLocation: 'A',
        })
        .expect(403);
    });

    it('RTV and scrap: other warehouse refused, lists filtered', async () => {
      const product = await fx.product();
      const [doaB] = await fx.stock(product.id, 1, {
        status: StockStatus.DOA,
        warehouseId: B.warehouse.id,
      });
      await fx
        .as(mgrA)
        .post('/rtv', { stockItemId: doaB.id, reason: 'doa' })
        .expect(403);
      const rtv = await fx
        .as(mgrAll)
        .post('/rtv', { stockItemId: doaB.id, reason: 'doa' });
      expectStatus(rtv, 201);
      await fx.as(mgrA).get(`/rtv/${rtv.body.id}`).expect(403);
      await fx
        .as(mgrA)
        .patch(`/rtv/${rtv.body.id}/status`, { status: 'PENDING_REVIEW' })
        .expect(403);
      expect(
        (await fx.as(mgrA).get('/rtv')).body.find(
          (r: any) => r.id === rtv.body.id,
        ),
      ).toBeUndefined();
      expect(
        (await fx.as(mgrAll).get('/rtv')).body.find(
          (r: any) => r.id === rtv.body.id,
        ),
      ).toBeDefined();

      const [unitB] = await fx.stock(product.id, 1, {
        warehouseId: B.warehouse.id,
      });
      await fx
        .as(mgrA)
        .post('/scrap', { stockItemId: unitB.id, reason: 'broken' })
        .expect(403);
    });
  });

  describe('receiving and putaway', () => {
    it('cannot receive into or put away into another warehouse', async () => {
      const product = await fx.product();
      await fx
        .as(staffA)
        .post('/receiving', {
          sourceType: 'vendor',
          items: [
            { productId: product.id, quantity: 1, warehouseId: B.warehouse.id },
          ],
        })
        .expect(403);
      const grB = await fx
        .as(mgrAll)
        .post('/receiving', {
          sourceType: 'vendor',
          items: [
            { productId: product.id, quantity: 1, warehouseId: B.warehouse.id },
          ],
        });
      expectStatus(grB, 201);
      await fx.as(staffA).get(`/receiving/${grB.body.id}`).expect(403);
      expect(
        (await fx.as(staffA).get('/receiving')).body.find(
          (g: any) => g.id === grB.body.id,
        ),
      ).toBeUndefined();

      const [pending] = await fx.stock(product.id, 1, {
        status: StockStatus.PENDING_INSPECTION,
      });
      await fx
        .as(staffA)
        .patch(`/putaway/${pending.id}/confirm`, {
          warehouseId: B.warehouse.id,
          rackId: B.rack.id,
          slotId: B.slot.id,
        })
        .expect(403);
      expectStatus(
        await fx
          .as(staffA)
          .patch(`/putaway/${pending.id}/confirm`, {
            warehouseId: A.warehouse.id,
            rackId: A.rack.id,
            slotId: A.slot.id,
          }),
        200,
      );
    });
  });

  describe('legitimate multi-warehouse access', () => {
    it('a user assigned to both warehouses works in both', async () => {
      const both = await fx.user(
        UserRole.WAREHOUSE_MANAGER,
        'WAREHOUSE_MANAGER',
      );
      await scopeTo(both, A.warehouse.id, B.warehouse.id);
      await fx.as(both).get(`/inventory/${stockA}`).expect(200);
      await fx.as(both).get(`/inventory/${stockB}`).expect(200);
      const created = await fx
        .as(both)
        .post('/cycle-count', { warehouseId: A.warehouse.id });
      expectStatus(created, 201);
      expectStatus(
        await fx.as(both).post(`/cycle-count/${created.body.id}/cancel`),
        201,
      );
    });
  });
});
