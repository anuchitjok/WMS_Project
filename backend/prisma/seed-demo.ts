import 'dotenv/config';
import { PrismaClient, UserRole, ProductType, StockStatus, RequestStatus, FulfillmentStatus, OwnershipType, RTVStatus, ReceivingStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { resetDemoData } from './demo-cleanup';
import {
  DEMO_USERS, DEMO_BRANDS, DEMO_VENDORS, DEMO_CATEGORIES, DEMO_UNITS, DEMO_MODELS,
  DEMO_DEPARTMENTS, DEMO_WAREHOUSE, r, pad,
} from './demo-data';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

// Headline targets
const N_PRODUCTS = 100, N_RECEIVING = 50, N_REQUESTS = 30, N_SHIPPED = 20, N_ACTIVE = 4, N_RMA = 5;

async function main() {
  console.log('🌱 Seeding DEMO data… (resetting existing DEMO- records first)');
  const reset = await resetDemoData(prisma);
  console.log('   reset:', JSON.stringify(reset));

  // ── Users ──
  for (const u of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(u.password, 12);
    await prisma.user.upsert({
      where: { username: u.username },
      update: { passwordHash, role: u.role as UserRole, fullName: u.fullName, department: u.department, isActive: true },
      create: { username: u.username, fullName: u.fullName, email: `${u.username}@hsnt-demo.local`, passwordHash, role: u.role as UserRole, department: u.department },
    });
  }
  const operator = await prisma.user.findUnique({ where: { username: 'demo_operator' } });
  const requester = await prisma.user.findUnique({ where: { username: 'demo_requester' } });
  const manager = await prisma.user.findUnique({ where: { username: 'demo_manager' } });

  // ── Brands / Vendors ──
  const brands: { id: string; name: string }[] = [];
  for (const b of DEMO_BRANDS) brands.push(await prisma.brand.create({ data: b }));
  const vendors: { id: string; name: string }[] = [];
  for (const v of DEMO_VENDORS) vendors.push(await prisma.vendor.create({ data: v }));

  // ── Warehouse + Racks + Slots ──
  const wh = await prisma.warehouse.create({ data: DEMO_WAREHOUSE });
  const slots: { id: string; rackId: string }[] = [];
  for (let ri = 1; ri <= 4; ri++) {
    const rack = await prisma.rack.create({ data: { warehouseId: wh.id, code: `DEMO-R${ri}`, name: `Demo Rack ${ri}`, zone: `Z${ri}`, capacity: 50, levels: 5, columns: 5 } });
    for (let si = 1; si <= 5; si++) {
      const slot = await prisma.slot.create({ data: { rackId: rack.id, code: `DEMO-R${ri}-S${si}`, level: si, column: si, status: 'OCCUPIED' as any } });
      slots.push({ id: slot.id, rackId: rack.id });
    }
  }
  const loc = () => { const s = r.pick(slots); return { warehouseId: wh.id, rackId: s.rackId, slotId: s.id }; };

  // ── Products (100) ──
  const productData = Array.from({ length: N_PRODUCTS }, (_, i) => {
    const n = i + 1;
    const cat = r.pick(DEMO_CATEGORIES);
    const brand = r.pick(brands);
    return {
      code: `DEMO-P${pad(n)}`,
      name: `${brand.name.replace(' (Demo)', '')} ${cat} ${r.pick(DEMO_MODELS)}`,
      partNumber: `DEMO-PN-${pad(n)}`,
      productType: r.chance(0.25) ? ProductType.FINISHED_GOODS : ProductType.SPARE_PART,
      brandId: brand.id,
      category: cat,
      unit: r.pick(DEMO_UNITS),
      unitCost: r.int(50, 5000),
      minStock: r.int(2, 20),
      serialControlled: r.chance(0.2),
      batchControlled: r.chance(0.15),
    };
  });
  await prisma.product.createMany({ data: productData });
  const products = await prisma.product.findMany({ where: { code: { startsWith: 'DEMO-P' } } });
  const prod = () => r.pick(products);

  // ── Stock pool via 50 receivings (statuses populate inventory health) ──
  const STOCK_DIST: StockStatus[] = [
    ...Array(11).fill(StockStatus.AVAILABLE),
    ...Array(4).fill(StockStatus.PENDING_INSPECTION),
    ...Array(2).fill(StockStatus.QUARANTINE),
    ...Array(2).fill(StockStatus.DAMAGED),
    ...Array(1).fill(StockStatus.RESERVED),
  ];
  let availableStock: string[] = [];
  for (let i = 1; i <= N_RECEIVING; i++) {
    const isToday = i <= 5;
    const completed = r.chance(0.7);
    const when = isToday ? r.today() : r.daysAgo(r.int(1, 60));
    const vendor = r.pick(vendors);
    const itemCount = r.int(1, 3);
    const items: any[] = [];
    for (let k = 0; k < itemCount; k++) {
      const p = prod();
      const status = completed ? r.pick(STOCK_DIST) : StockStatus.PENDING_RECEIVING;
      const st = await prisma.stockItem.create({
        data: {
          productId: p.id, quantity: r.int(1, 10), status, ownershipType: OwnershipType.OWN,
          ...loc(), receivedDate: when, createdById: operator?.id,
          serialNumber: p.serialControlled ? `DEMO-SN-${i}-${k}-${r.int(1000, 9999)}` : null,
          batchNumber: p.batchControlled ? `DEMO-LOT-${i}${k}` : null,
          expiryDate: p.batchControlled ? r.daysAgo(-r.int(180, 540)) : null,
        },
      });
      if (status === StockStatus.AVAILABLE) availableStock.push(st.id);
      items.push({ productId: p.id, quantity: st.quantity, condition: status === StockStatus.DAMAGED ? 'damaged' : 'good', stockItemId: st.id, batchNumber: st.batchNumber, expiryDate: st.expiryDate });
    }
    await prisma.goodsReceiving.create({
      data: {
        refNumber: `DEMO-GR-${pad(i)}`, sourceType: 'Vendor', sourceRef: `${vendor.name}`,
        poNumber: `DEMO-PO-${pad(i)}`, supplierId: vendor.id, receivedById: operator?.id,
        status: completed ? 'completed' : 'pending_inspection',
        statusEnum: completed ? ReceivingStatus.COMPLETED : ReceivingStatus.QC_PENDING,
        receivedDate: when, createdAt: when, expectedDate: when,
        items: { create: items },
      },
    });
  }

  // ── Requests (30): 6 pending-approval + 24 approved ──
  const approvedReqs: { id: string; ref: string; items: { productId: string; qty: number }[] }[] = [];
  for (let i = 1; i <= N_REQUESTS; i++) {
    const pending = i <= 6;
    const itemCount = r.int(1, 3);
    const reqItems = Array.from({ length: itemCount }, () => ({ productId: prod().id, qty: r.int(1, 5) }));
    const created = r.daysAgo(r.int(0, 30));
    const wr = await prisma.withdrawalRequest.create({
      data: {
        refNumber: `DEMO-WR-${pad(i)}`, requesterId: requester!.id, department: r.pick(DEMO_DEPARTMENTS),
        purpose: 'Demo withdrawal', rmaCaseNumber: r.chance(0.4) ? `RMA-DEMO-${pad(i)}` : null,
        status: pending ? RequestStatus.PENDING_APPROVAL : RequestStatus.APPROVED,
        approverId: pending ? null : manager!.id, approvedAt: pending ? null : created,
        createdAt: created, version: pending ? 1 : 2,
        items: { create: reqItems.map((it) => ({ productId: it.productId, quantityRequested: it.qty, quantityApproved: pending ? null : it.qty })) },
      },
    });
    if (!pending) approvedReqs.push({ id: wr.id, ref: wr.refNumber, items: reqItems });
  }

  // ── Fulfillment tasks (24): 20 shipped (+shipment) + 4 active ──
  let taskN = 0, shipN = 0;
  for (const req of approvedReqs) {
    taskN++;
    const shipped = taskN <= N_SHIPPED;
    const active = !shipped && taskN <= N_SHIPPED + N_ACTIVE;
    if (!shipped && !active) break;
    const status = shipped
      ? (r.chance(0.5) ? FulfillmentStatus.DELIVERED : FulfillmentStatus.SHIPPED)
      : r.pick([FulfillmentStatus.ALLOCATED, FulfillmentStatus.PICKING, FulfillmentStatus.PACKING]);
    const stockStatus = shipped ? StockStatus.SHIPPED : (status === FulfillmentStatus.PICKING ? StockStatus.PICKED : StockStatus.RESERVED);
    const taskItems: any[] = [];
    for (const it of req.items) {
      const st = await prisma.stockItem.create({ data: { productId: it.productId, quantity: it.qty, status: stockStatus, ownershipType: OwnershipType.OWN, ...loc(), createdById: operator?.id } });
      taskItems.push({ productId: it.productId, stockItemId: st.id, qtyRequested: it.qty, qtyPicked: shipped || status !== FulfillmentStatus.ALLOCATED ? it.qty : 0 });
    }
    const created = r.daysAgo(r.int(0, 20));
    const task = await prisma.fulfillmentTask.create({
      data: {
        refNumber: `DEMO-FT-${pad(taskN)}`,
        requestId: req.id, requestRef: req.ref, status, warehouseId: wh.id,
        allocatedById: operator?.id, progressPct: shipped ? 100 : (status === FulfillmentStatus.ALLOCATED ? 0 : 60),
        createdAt: created, items: { create: taskItems },
      },
    });
    if (shipped) {
      shipN++;
      const shippedAt = shipN <= 5 ? r.today() : r.daysAgo(r.int(1, 15));
      await prisma.shipment.create({
        data: {
          refNumber: `DEMO-SHP-${pad(shipN)}`, taskId: task.id, carrier: r.pick(['DHL', 'FedEx', 'J&T', 'Kerry']),
          trackingNumber: `DEMO-TRK-${r.int(100000, 999999)}`, receiverName: 'Demo Receiver', handoverById: operator?.id,
          shippedAt, dispatchedById: operator?.id,
          deliveredAt: status === FulfillmentStatus.DELIVERED ? shippedAt : null,
          createdAt: shippedAt,
          timeline: { create: { status: 'SHIPPED', description: 'Demo dispatched', actorId: operator?.id } },
        },
      });
    }
  }

  // ── RMA (5) ──
  for (let i = 1; i <= N_RMA; i++) {
    const sid = availableStock[i];
    if (!sid) break;
    await prisma.stockItem.update({ where: { id: sid }, data: { status: StockStatus.RTV_PENDING } });
    await prisma.rTVCase.create({
      data: { refNumber: `DEMO-RTV-${pad(i)}`, stockItemId: sid, reason: r.pick(['doa', 'defective']), description: 'Demo RTV case', status: RTVStatus.RTV_REQUIRED, vendorId: r.pick(vendors).id, rtvOfficerId: manager?.id },
    });
  }

  // ── Summary ──
  const c = async (t: string, w: any) => (prisma as any)[t].count({ where: w });
  console.log('\n✅ DEMO seed complete:');
  console.log('   products  :', await c('product', { code: { startsWith: 'DEMO-P' } }));
  console.log('   stock     :', await c('stockItem', { warehouseId: wh.id }));
  console.log('   receiving :', await c('goodsReceiving', { refNumber: { startsWith: 'DEMO-' } }));
  console.log('   requests  :', await c('withdrawalRequest', { refNumber: { startsWith: 'DEMO-' } }));
  console.log('   tasks     :', await c('fulfillmentTask', { refNumber: { startsWith: 'DEMO-' } }));
  console.log('   shipments :', await c('shipment', { refNumber: { startsWith: 'DEMO-' } }));
  console.log('   rma       :', await c('rTVCase', { refNumber: { startsWith: 'DEMO-' } }));
  console.log('   users     :', DEMO_USERS.length);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
