import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { resetDemoData } from './demo-cleanup';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🧹 Removing all DEMO- data…');
  const report = await resetDemoData(prisma);
  console.log('   deleted:', JSON.stringify(report));

  // Verify nothing DEMO- remains
  const remaining = {
    products: await prisma.product.count({ where: { code: { startsWith: 'DEMO-' } } }),
    receiving: await prisma.goodsReceiving.count({ where: { refNumber: { startsWith: 'DEMO-' } } }),
    requests: await prisma.withdrawalRequest.count({ where: { refNumber: { startsWith: 'DEMO-' } } }),
    tasks: await prisma.fulfillmentTask.count({ where: { refNumber: { startsWith: 'DEMO-' } } }),
    shipments: await prisma.shipment.count({ where: { refNumber: { startsWith: 'DEMO-' } } }),
    rtv: await prisma.rTVCase.count({ where: { refNumber: { startsWith: 'DEMO-' } } }),
    brands: await prisma.brand.count({ where: { code: { startsWith: 'DEMO-' } } }),
    vendors: await prisma.vendor.count({ where: { code: { startsWith: 'DEMO-' } } }),
    warehouses: await prisma.warehouse.count({ where: { code: { startsWith: 'DEMO-' } } }),
    users: await prisma.user.count({ where: { username: { startsWith: 'demo_' } } }),
  };
  const total = Object.values(remaining).reduce((a, b) => a + b, 0);
  console.log('   remaining DEMO- records:', JSON.stringify(remaining), '→ total', total);
  console.log(total === 0 ? '✅ All DEMO data removed.' : '⚠️ Some DEMO records remain — review.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
