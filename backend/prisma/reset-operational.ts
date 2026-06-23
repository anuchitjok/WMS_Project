/**
 * Full operational data reset — wipes ALL transaction + master data,
 * KEEPS identity & config (Users, RBAC, Approval rules, Settings, Templates).
 *
 *   Dry-run (counts only, no deletes):   npx ts-node -r tsconfig-paths/register prisma/reset-operational.ts
 *   Apply (actually deletes):            npx ts-node -r tsconfig-paths/register prisma/reset-operational.ts --apply
 *
 * Deletion runs in FK-safe order (children before parents).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes('--apply');

// FK-safe order: children → parents. Warehouse delete cascades UserWarehouse.
const STEPS: { name: string; del: () => Promise<{ count: number }>; count: () => Promise<number> }[] = [
  { name: 'shipmentTimeline',     del: () => prisma.shipmentTimeline.deleteMany({}),     count: () => prisma.shipmentTimeline.count() },
  { name: 'shipment',             del: () => prisma.shipment.deleteMany({}),             count: () => prisma.shipment.count() },
  { name: 'carton',               del: () => prisma.carton.deleteMany({}),               count: () => prisma.carton.count() },
  { name: 'packingSession',       del: () => prisma.packingSession.deleteMany({}),       count: () => prisma.packingSession.count() },
  { name: 'fulfillmentTimeline',  del: () => prisma.fulfillmentTimeline.deleteMany({}),  count: () => prisma.fulfillmentTimeline.count() },
  { name: 'fulfillmentTaskItem',  del: () => prisma.fulfillmentTaskItem.deleteMany({}),  count: () => prisma.fulfillmentTaskItem.count() },
  { name: 'fulfillmentTask',      del: () => prisma.fulfillmentTask.deleteMany({}),      count: () => prisma.fulfillmentTask.count() },
  { name: 'approvalInstanceStep', del: () => prisma.approvalInstanceStep.deleteMany({}), count: () => prisma.approvalInstanceStep.count() },
  { name: 'approvalInstance',     del: () => prisma.approvalInstance.deleteMany({}),     count: () => prisma.approvalInstance.count() },
  { name: 'withdrawalRequestItem',del: () => prisma.withdrawalRequestItem.deleteMany({}),count: () => prisma.withdrawalRequestItem.count() },
  { name: 'withdrawalRequest',    del: () => prisma.withdrawalRequest.deleteMany({}),    count: () => prisma.withdrawalRequest.count() },
  { name: 'receivingDiscrepancy', del: () => prisma.receivingDiscrepancy.deleteMany({}), count: () => prisma.receivingDiscrepancy.count() },
  { name: 'goodsReceivingItem',   del: () => prisma.goodsReceivingItem.deleteMany({}),   count: () => prisma.goodsReceivingItem.count() },
  { name: 'goodsReceiving',       del: () => prisma.goodsReceiving.deleteMany({}),       count: () => prisma.goodsReceiving.count() },
  { name: 'rtvCase',              del: () => prisma.rTVCase.deleteMany({}),              count: () => prisma.rTVCase.count() },
  { name: 'scrapCase',            del: () => prisma.scrapCase.deleteMany({}),            count: () => prisma.scrapCase.count() },
  { name: 'stockAdjustment',      del: () => prisma.stockAdjustment.deleteMany({}),      count: () => prisma.stockAdjustment.count() },
  { name: 'stockTransfer',        del: () => prisma.stockTransfer.deleteMany({}),        count: () => prisma.stockTransfer.count() },
  { name: 'cycleCountLine',       del: () => prisma.cycleCountLine.deleteMany({}),       count: () => prisma.cycleCountLine.count() },
  { name: 'cycleCountSession',    del: () => prisma.cycleCountSession.deleteMany({}),    count: () => prisma.cycleCountSession.count() },
  { name: 'scanEvent',            del: () => prisma.scanEvent.deleteMany({}),            count: () => prisma.scanEvent.count() },
  { name: 'stockItem',            del: () => prisma.stockItem.deleteMany({}),            count: () => prisma.stockItem.count() },
  { name: 'product',              del: () => prisma.product.deleteMany({}),              count: () => prisma.product.count() },
  { name: 'slot',                 del: () => prisma.slot.deleteMany({}),                 count: () => prisma.slot.count() },
  { name: 'rack',                 del: () => prisma.rack.deleteMany({}),                 count: () => prisma.rack.count() },
  { name: 'warehouse',            del: () => prisma.warehouse.deleteMany({}),            count: () => prisma.warehouse.count() },
  { name: 'brand',                del: () => prisma.brand.deleteMany({}),                count: () => prisma.brand.count() },
  { name: 'vendor',               del: () => prisma.vendor.deleteMany({}),               count: () => prisma.vendor.count() },
  { name: 'notification',         del: () => prisma.notification.deleteMany({}),         count: () => prisma.notification.count() },
  { name: 'loginHistory',         del: () => prisma.loginHistory.deleteMany({}),         count: () => prisma.loginHistory.count() },
  { name: 'auditLog',             del: () => prisma.auditLog.deleteMany({}),             count: () => prisma.auditLog.count() },
];

async function main() {
  if (!APPLY) {
    console.log('🔍 DRY-RUN — rows that WOULD be deleted (no changes made):\n');
    let total = 0;
    for (const s of STEPS) { const c = await s.count(); total += c; console.log(`   ${s.name.padEnd(24)} ${c}`); }
    console.log(`\n   TOTAL: ${total} rows`);
    // Show what is preserved
    const [users, roles, perms, settings, rules] = await Promise.all([
      prisma.user.count(), prisma.role.count(), prisma.permission.count(),
      prisma.setting.count(), prisma.approvalRule.count(),
    ]);
    console.log(`\n🔒 KEPT: users=${users} roles=${roles} permissions=${perms} settings=${settings} approvalRules=${rules}`);
    console.log('\n👉 Re-run with --apply to actually delete.');
    return;
  }

  console.log('🗑️  APPLYING reset — deleting operational data…\n');
  const report: Record<string, number> = {};
  for (const s of STEPS) {
    const r = await s.del();
    report[s.name] = r.count;
    console.log(`   ${s.name.padEnd(24)} -${r.count}`);
  }
  const total = Object.values(report).reduce((a, b) => a + b, 0);
  console.log(`\n✅ Done. Deleted ${total} rows across ${STEPS.length} tables.`);
  const [users, roles] = await Promise.all([prisma.user.count(), prisma.role.count()]);
  console.log(`🔒 Preserved: users=${users} roles=${roles}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
