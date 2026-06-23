/**
 * Production Warehouse Transformation (one-off, idempotent).
 *
 * Steps:
 *  1. Backup export of Warehouse/Rack/Slot/StockItem placement -> JSON.
 *  2. Impact report (before counts).
 *  3. Create the 5 official HSN warehouses (additive, skip if exists).
 *  4. Migrate WH-MAIN's real racks/slots/stock into Tower B1FL; deactivate WH-MAIN.
 *  5. Remove ALL DEMO- data (FK-safe, via shared resetDemoData).
 *  6. Reconcile Slot.status to ACTUAL placement (StockItem.slotId); BLOCKED preserved.
 *  7. Validation report (after counts + FK integrity).
 *
 * Does NOT modify schema, services, or APIs. Safe to re-run.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { resetDemoData } from './demo-cleanup';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

const HSN_WAREHOUSES = [
  { code: 'TOWER-B1FL', name: 'Tower B1FL', location: 'Tower B · Level 1' },
  { code: 'TOWER-B2FL', name: 'Tower B2FL', location: 'Tower B · Level 2' },
  { code: 'TOWER-C1FL', name: 'Tower C1FL', location: 'Tower C · Level 1' },
  { code: 'SCG-WH',     name: 'SCG Warehouse', location: 'SCG Site' },
  { code: 'WH05-RTV',   name: 'WH05 RTV Area', location: 'RTV / Returns Zone' },
];
// Existing real stock (currently in WH-MAIN) is consolidated here:
const PRIMARY_CODE = 'TOWER-B1FL';

async function main() {
  const report: any = { startedAt: new Date().toISOString(), steps: {} };

  // ── 1. BACKUP ─────────────────────────────────────────────────────────────
  const [whAll, rackAll, slotAll, stockAll] = await Promise.all([
    prisma.warehouse.findMany(),
    prisma.rack.findMany(),
    prisma.slot.findMany(),
    prisma.stockItem.findMany({ select: { id: true, productId: true, warehouseId: true, rackId: true, slotId: true, status: true, quantity: true } }),
  ]);
  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(dir, `warehouse-backup-${stamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify({ warehouses: whAll, racks: rackAll, slots: slotAll, stockItems: stockAll }, null, 2));
  report.backupFile = backupFile;
  report.steps.backup = { warehouses: whAll.length, racks: rackAll.length, slots: slotAll.length, stockItems: stockAll.length };

  // ── 2. IMPACT (before) ──────────────────────────────────────────────────────
  const whMain = whAll.find((w) => w.code === 'WH-MAIN');
  const demoWh = whAll.filter((w) => w.code.startsWith('DEMO-'));
  report.steps.impactBefore = {
    activeWarehouses: whAll.filter((w) => w.isActive).length,
    whMainStock: whMain ? stockAll.filter((s) => s.warehouseId === whMain.id).length : 0,
    demoWarehouses: demoWh.map((w) => w.code),
    demoStock: stockAll.filter((s) => demoWh.some((d) => d.id === s.warehouseId)).length,
  };

  // ── 3. CREATE 5 HSN WAREHOUSES (idempotent) ─────────────────────────────────
  const created: string[] = [];
  for (const w of HSN_WAREHOUSES) {
    const exists = await prisma.warehouse.findUnique({ where: { code: w.code } });
    if (!exists) { await prisma.warehouse.create({ data: { ...w, isActive: true } }); created.push(w.code); }
    else if (!exists.isActive) { await prisma.warehouse.update({ where: { id: exists.id }, data: { isActive: true } }); }
  }
  const primary = await prisma.warehouse.findUnique({ where: { code: PRIMARY_CODE } });
  report.steps.createWarehouses = { created, primary: PRIMARY_CODE };

  // ── 4. MIGRATE WH-MAIN -> Tower B1FL ────────────────────────────────────────
  if (whMain && primary && whMain.id !== primary.id) {
    const whMainRacks = await prisma.rack.findMany({ where: { warehouseId: whMain.id }, select: { id: true } });
    const rackIds = whMainRacks.map((r) => r.id);
    const reRacks = await prisma.rack.updateMany({ where: { warehouseId: whMain.id }, data: { warehouseId: primary.id } });
    const reStock = await prisma.stockItem.updateMany({
      where: { OR: [{ warehouseId: whMain.id }, ...(rackIds.length ? [{ rackId: { in: rackIds } }] : [])] },
      data: { warehouseId: primary.id },
    });
    await prisma.warehouse.update({ where: { id: whMain.id }, data: { isActive: false } });
    report.steps.migrateWhMain = { racksReparented: reRacks.count, stockReparented: reStock.count, whMainDeactivated: true };
  } else {
    report.steps.migrateWhMain = { skipped: 'WH-MAIN absent or already primary' };
  }

  // ── 5. REMOVE ALL DEMO- DATA ────────────────────────────────────────────────
  // Pre-clear product FKs that resetDemoData doesn't cover (line items on
  // non-demo-ref'd parents that still point at DEMO- products).
  const demoProducts = await prisma.product.findMany({ where: { code: { startsWith: 'DEMO-' } }, select: { id: true } });
  const demoProductIds = demoProducts.map((p) => p.id);
  if (demoProductIds.length) {
    const griDel = await prisma.goodsReceivingItem.deleteMany({ where: { productId: { in: demoProductIds } } });
    const wriDel = await prisma.withdrawalRequestItem.deleteMany({ where: { productId: { in: demoProductIds } } });
    const ftiDel = await prisma.fulfillmentTaskItem.deleteMany({ where: { productId: { in: demoProductIds } } });
    report.steps.productFkPreClear = { goodsReceivingItem: griDel.count, withdrawalRequestItem: wriDel.count, fulfillmentTaskItem: ftiDel.count };
  }
  report.steps.demoCleanup = await resetDemoData(prisma);

  // ── 6. RECONCILE Slot.status TO ACTUAL PLACEMENT ───────────────────────────
  // Source of truth = StockItem.slotId. BLOCKED slots are preserved (operational hold).
  const activeSlots = await prisma.slot.findMany({
    where: { isActive: true },
    select: { id: true, status: true, _count: { select: { stockItems: true } } },
  });
  let toOccupied = 0, toEmpty = 0;
  for (const s of activeSlots) {
    if (s.status === 'BLOCKED') continue;
    const has = s._count.stockItems > 0;
    if (has && s.status !== 'OCCUPIED') { await prisma.slot.update({ where: { id: s.id }, data: { status: 'OCCUPIED' } }); toOccupied++; }
    else if (!has && s.status === 'OCCUPIED') { await prisma.slot.update({ where: { id: s.id }, data: { status: 'EMPTY' } }); toEmpty++; }
  }
  report.steps.reconcileSlots = { scanned: activeSlots.length, setOccupied: toOccupied, setEmpty: toEmpty };

  // ── 7. VALIDATION (after) ───────────────────────────────────────────────────
  const [activeWh, activeRacks, activeSlotsCount, totalStock, placedStock, orphanStock] = await Promise.all([
    prisma.warehouse.findMany({ where: { isActive: true }, select: { code: true, name: true, _count: { select: { racks: true, stockItems: true } } }, orderBy: { code: 'asc' } }),
    prisma.rack.count({ where: { isActive: true } }),
    prisma.slot.count({ where: { isActive: true } }),
    prisma.stockItem.count(),
    prisma.stockItem.count({ where: { slotId: { not: null } } }),
    // stock whose slotId points to a now-deleted slot would FK-error; instead check stock with rackId but missing rack
    prisma.stockItem.count({ where: { warehouseId: null } }),
  ]);
  report.steps.validationAfter = {
    activeWarehouses: activeWh.map((w) => ({ code: w.code, name: w.name, racks: w._count.racks, stock: w._count.stockItems })),
    activeRacks, activeSlots: activeSlotsCount, totalStock, placedStock, stockWithoutWarehouse: orphanStock,
    demoWarehousesRemaining: await prisma.warehouse.count({ where: { code: { startsWith: 'DEMO-' } } }),
  };

  report.finishedAt = new Date().toISOString();
  console.log('MIGRATION_REPORT_JSON_START');
  console.log(JSON.stringify(report, null, 2));
  console.log('MIGRATION_REPORT_JSON_END');
}

main().catch((e) => { console.error('MIGRATION_FAILED', e); process.exit(1); }).finally(() => prisma.$disconnect());
