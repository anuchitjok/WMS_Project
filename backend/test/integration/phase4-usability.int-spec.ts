import { StockStatus, UserRole } from '@prisma/client';
import { Fixture, TestUser, expectStatus } from './harness';

// Phase 4 — incomplete receipts are refused before anything is written, and the
// Work Queue lists open work with next action, owner and waiting time.
describe('Phase 4 usability', () => {
  let fx: Fixture;
  let manager: TestUser, staff: TestUser, requester: TestUser;

  beforeAll(async () => {
    fx = await Fixture.start();
    manager = await fx.user(UserRole.WAREHOUSE_MANAGER, 'WAREHOUSE_MANAGER');
    staff = await fx.user(UserRole.WAREHOUSE_STAFF);
    requester = await fx.user(UserRole.REQUESTER, 'REQUESTER');
  });
  afterAll(async () => { await fx.stop(); });

  describe('Receive Goods refuses incomplete lines and writes nothing', () => {
    const receive = (items: object[], extra: object = {}) => fx.as(manager).post('/receiving', { sourceType: 'Vendor', items, ...extra });
    const counts = async () => [await fx.prisma.goodsReceiving.count(), await fx.prisma.stockItem.count()];

    it('unknown product', async () => {
      const before = await counts();
      const res = await receive([{ productId: 'does-not-exist', quantity: 1 }]);
      expectStatus(res, 400);
      expect(res.body.message).toMatch(/does not exist/);
      expect(await counts()).toEqual(before);
    });

    it('inactive product', async () => {
      const p = await fx.product();
      await fx.prisma.product.update({ where: { id: p.id }, data: { productStatus: 'DISCONTINUED', isActive: false } });
      const before = await counts();
      const res = await receive([{ productId: p.id, quantity: 1 }]);
      expectStatus(res, 400);
      expect(res.body.message).toMatch(/discontinued and cannot be received/);
      expect(await counts()).toEqual(before);
    });

    it('a serial number with quantity other than 1', async () => {
      const p = await fx.product({ serialControlled: true });
      const before = await counts();
      const res = await receive([{ productId: p.id, quantity: 3, serialNumber: fx.uid('SN') }]);
      expectStatus(res, 400);
      expect(res.body.message).toMatch(/quantity must be 1/);
      expect(await counts()).toEqual(before);
    });

    it('a vendor reference that is not a real vendor', async () => {
      const p = await fx.product();
      const res = await receive([{ productId: p.id, quantity: 1 }], { supplierId: 'no-such-vendor' });
      expectStatus(res, 400);
      expect(res.body.message).toMatch(/Vendor not found/);
    });

    it('a complete receipt with a real vendor still works and records the vendor', async () => {
      const p = await fx.product({ serialControlled: true });
      const vendor = await fx.prisma.vendor.create({ data: { name: fx.uid('Vendor'), code: fx.uid('V') } });
      const res = await receive([{ productId: p.id, quantity: 1, serialNumber: fx.uid('SN') }], { supplierId: vendor.id });
      expectStatus(res, 201);
      expect((await fx.prisma.goodsReceiving.findUniqueOrThrow({ where: { id: res.body.id } })).supplierId).toBe(vendor.id);
    });
  });

  describe('Work Queue', () => {
    it('lists approvals, allocations, fulfilment, putaway and DOA with next action, owner and waiting time, oldest first', async () => {
      const loc = await fx.location();
      const product = await fx.product();
      await fx.stock(product.id, 3, { warehouseId: loc.warehouse.id, rackId: loc.rack.id, slotId: loc.slot.id });
      const [dock] = await fx.stock(product.id, 1, { status: StockStatus.PENDING_INSPECTION });
      const [doa] = await fx.stock(product.id, 1, { status: StockStatus.DOA, warehouseId: loc.warehouse.id });

      const approved = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
      const withTask = await fx.approvedRequest(requester, manager, [{ productId: product.id, quantity: 1 }]);
      const task = await fx.allocatedTask(withTask.id, staff);

      const res = await fx.as(manager).get('/dashboard/work-queue');
      expectStatus(res, 200);
      const items: any[] = res.body.items;
      const find = (stage: string, ref: string) => items.find((i) => i.stage === stage && i.ref === ref);

      expect(find('Allocate', approved.refNumber)).toMatchObject({ nextAction: 'Allocate to fulfillment', href: '/outbound/fulfillment' });
      expect(find('Allocate', withTask.refNumber)).toBeUndefined(); // tracked by its task instead
      expect(find('Fulfil', task.refNumber)).toMatchObject({ nextAction: 'Start picking' });
      expect(find('Fulfil', task.refNumber).owner).not.toBe('');
      expect(find('Putaway', dock.serialNumber!)).toMatchObject({ nextAction: 'Put away to a slot' });
      expect(find('Return', doa.serialNumber!)).toMatchObject({ nextAction: 'Create RTV', href: '/doa' });
      for (const i of items) {
        expect(i.owner).toBeTruthy();
        expect(new Date(i.waitingSince).getTime()).not.toBeNaN();
      }
      const times = items.map((i) => new Date(i.waitingSince).getTime());
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      expect(res.body.counts.Allocate).toBeGreaterThanOrEqual(1);
    });

    it('is warehouse-scoped like the rest of the dashboard', async () => {
      const A = await fx.location();
      const B = await fx.location();
      const product = await fx.product();
      const [inB] = await fx.stock(product.id, 1, { status: StockStatus.DOA, warehouseId: B.warehouse.id });
      const scoped = await fx.user(UserRole.WAREHOUSE_STAFF);
      await fx.prisma.userWarehouse.create({ data: { userId: scoped.id, warehouseId: A.warehouse.id } });
      const res = await fx.as(scoped).get('/dashboard/work-queue');
      expectStatus(res, 200);
      expect(res.body.items.find((i: any) => i.ref === inB.serialNumber)).toBeUndefined();
    });
  });
});
