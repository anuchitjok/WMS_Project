import { StockStatus, UserRole } from '@prisma/client';
import { Fixture, TestUser, expectStatus } from './harness';

// /warehouse (Warehouse Operations Control Center):
//  P1-1 occupancy counts only stock still in the location, matching the Floor Plan
//  P1-2 rack/slot updates accept only their declared fields
//  P1-3 reads and writes are limited to the caller's warehouses

describe('Warehouse locations (/warehouse)', () => {
  let fx: Fixture;
  let admin: TestUser, manager: TestUser, staffB: TestUser, staffAll: TestUser;
  let B: Awaited<ReturnType<Fixture['location']>>, C: Awaited<ReturnType<Fixture['location']>>;

  beforeAll(async () => {
    fx = await Fixture.start();
    admin = await fx.user(UserRole.SYSTEM_ADMIN, 'SUPER_ADMIN');
    manager = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WAREHOUSE_MANAGER');
    staffB = await fx.user(UserRole.WAREHOUSE_STAFF);
    staffAll = await fx.user(UserRole.WAREHOUSE_STAFF);
    B = await fx.location();
    C = await fx.location();
    await fx.prisma.userWarehouse.create({ data: { userId: staffB.id, warehouseId: B.warehouse.id } });
  });
  afterAll(async () => { await fx.stop(); });

  const slotFrom = (tree: any[], whId: string, slotId: string) =>
    tree.find((w) => w.id === whId)?.racks.flatMap((r: any) => r.slots).find((s: any) => s.id === slotId);

  describe('P1-1 occupancy', () => {
    it('counts only stock still in the slot, the same as the Floor Plan', async () => {
      const product = await fx.product();
      const loc = { warehouseId: B.warehouse.id, rackId: B.rack.id, slotId: B.slot.id };
      await fx.stock(product.id, 1, { ...loc, status: StockStatus.AVAILABLE });
      await fx.stock(product.id, 1, { ...loc, status: StockStatus.RESERVED });
      // Rows that left keep their slotId — they must not count
      for (const status of [StockStatus.SHIPPED, StockStatus.CONSUMED, StockStatus.CLOSED, StockStatus.CANCELLED]) {
        await fx.stock(product.id, 1, { ...loc, status });
      }
      const tree = await fx.as(admin).get('/warehouse');
      expectStatus(tree, 200);
      const slot = slotFrom(tree.body, B.warehouse.id, B.slot.id);
      expect(slot._count.stockItems).toBe(2);
      const rack = tree.body.find((w: any) => w.id === B.warehouse.id).racks[0];
      expect(rack._count.stockItems).toBe(2);

      const detail = await fx.as(admin).get(`/warehouse/slots/${B.slot.id}/detail`);
      expect(detail.body._count.stockItems).toBe(2);
      expect(detail.body.stockItems).toHaveLength(2);

      // The Floor Plan filters with the same NOT_IN_LOCATION constant (common/stock-presence.ts).
    });
  });

  describe('P1-2 update payloads', () => {
    it('rejects fields outside the declared set (isActive, rackId, warehouseId, code)', async () => {
      const s = B.slot.id;
      await fx.as(manager).patch(`/warehouse/slots/${s}`, { isActive: false }).expect(400);
      await fx.as(manager).patch(`/warehouse/slots/${s}`, { rackId: C.rack.id }).expect(400);
      await fx.as(manager).patch(`/warehouse/slots/${s}`, { code: 'HIJACK' }).expect(400);
      await fx.as(manager).patch(`/warehouse/racks/${B.rack.id}`, { isActive: false }).expect(400);
      await fx.as(manager).patch(`/warehouse/racks/${B.rack.id}`, { warehouseId: C.warehouse.id }).expect(400);
      const slot = await fx.prisma.slot.findUniqueOrThrow({ where: { id: s } });
      expect([slot.isActive, slot.rackId]).toEqual([true, B.rack.id]);
      const rack = await fx.prisma.rack.findUniqueOrThrow({ where: { id: B.rack.id } });
      expect([rack.isActive, rack.warehouseId]).toEqual([true, B.warehouse.id]);
    });

    it('rejects invalid values', async () => {
      await fx.as(manager).patch(`/warehouse/slots/${B.slot.id}`, { status: 'GONE' }).expect(400);
      await fx.as(manager).patch(`/warehouse/slots/${B.slot.id}`, { capacity: -1 }).expect(400);
      await fx.as(manager).post('/warehouse/racks', { warehouseId: B.warehouse.id, code: '' }).expect(400);
      await fx.as(manager).post(`/warehouse/racks/${B.rack.id}/slots/bulk`, { levels: 27, columns: 1 }).expect(400);
    });

    it('accepts exactly what the Control Center sends', async () => {
      // Edit dialog
      expectStatus(await fx.as(staffAll).patch(`/warehouse/slots/${B.slot.id}`, { name: 'Bin', slotType: 'PALLET', capacity: 4, status: 'EMPTY' }), 200);
      // Block / unblock
      expectStatus(await fx.as(staffAll).patch(`/warehouse/slots/${B.slot.id}`, { status: 'BLOCKED' }), 200);
      expectStatus(await fx.as(staffAll).patch(`/warehouse/slots/${B.slot.id}`, { status: 'EMPTY' }), 200);
      // Create rack dialog (empty optional strings included)
      const r = await fx.as(manager).post('/warehouse/racks', { code: fx.uid('R'), name: '', zone: '', rackType: 'STANDARD', levels: 5, columns: 10, warehouseId: B.warehouse.id });
      expectStatus(r, 201);
      const bulk = await fx.as(manager).post(`/warehouse/racks/${r.body.id}/slots/bulk`, { levels: 2, columns: 3 });
      expectStatus(bulk, 201);
      expect(bulk.body.created).toBe(6);
    });
  });

  describe('P1-3 warehouse scope', () => {
    it('a user assigned to one warehouse sees only that warehouse', async () => {
      const mine = await fx.as(staffB).get('/warehouse');
      expect(mine.body.map((w: any) => w.id)).toEqual([B.warehouse.id]);
      const all = await fx.as(staffAll).get('/warehouse');
      expect(all.body.map((w: any) => w.id)).toEqual(expect.arrayContaining([B.warehouse.id, C.warehouse.id]));
      await fx.as(staffB).get(`/warehouse/${C.warehouse.id}`).expect(403);
      await fx.as(staffB).get(`/warehouse/slots/${C.slot.id}/detail`).expect(403);
      await fx.as(staffB).get(`/warehouse/stats?warehouseId=${C.warehouse.id}`).expect(403);
    });

    it('cannot block or edit a location in another warehouse', async () => {
      await fx.as(staffB).patch(`/warehouse/slots/${C.slot.id}`, { status: 'BLOCKED' }).expect(403);
      await fx.as(staffB).patch(`/warehouse/racks/${C.rack.id}`, { name: 'x' }).expect(403);
      expect((await fx.prisma.slot.findUniqueOrThrow({ where: { id: C.slot.id } })).status).not.toBe('BLOCKED');
      expectStatus(await fx.as(staffB).patch(`/warehouse/slots/${B.slot.id}`, { status: 'BLOCKED' }), 200);
      expectStatus(await fx.as(staffB).patch(`/warehouse/slots/${B.slot.id}`, { status: 'EMPTY' }), 200);
    });

    it('a scoped manager cannot create or remove structure in another warehouse', async () => {
      const mgrB = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WAREHOUSE_MANAGER');
      await fx.prisma.userWarehouse.create({ data: { userId: mgrB.id, warehouseId: B.warehouse.id } });
      await fx.as(mgrB).post('/warehouse/racks', { warehouseId: C.warehouse.id, code: fx.uid('R') }).expect(403);
      await fx.as(mgrB).post(`/warehouse/racks/${C.rack.id}/slots`, { code: fx.uid('S') }).expect(403);
      await fx.as(mgrB).post(`/warehouse/racks/${C.rack.id}/slots/bulk`, { levels: 1, columns: 1 }).expect(403);
      await fx.as(mgrB).delete(`/warehouse/slots/${C.slot.id}`).expect(403);
      await fx.as(mgrB).delete(`/warehouse/racks/${C.rack.id}`).expect(403);
      expectStatus(await fx.as(mgrB).post('/warehouse/racks', { warehouseId: B.warehouse.id, code: fx.uid('R') }), 201);
    });

    it('super admin is never limited by assignments', async () => {
      const superB = await fx.user(UserRole.SYSTEM_ADMIN, 'SUPER_ADMIN');
      await fx.prisma.userWarehouse.create({ data: { userId: superB.id, warehouseId: B.warehouse.id } });
      const all = await fx.as(superB).get('/warehouse');
      expect(all.body.map((w: any) => w.id)).toEqual(expect.arrayContaining([B.warehouse.id, C.warehouse.id]));
      await fx.as(superB).get(`/warehouse/slots/${C.slot.id}/detail`).expect(200);
    });
  });
});
