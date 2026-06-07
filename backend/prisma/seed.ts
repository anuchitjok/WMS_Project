import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';

// Prisma 7: driver adapter required
const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL, // use session mode for seed
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Seeding database…');

  // Admin user
  const adminHash = await bcrypt.hash('Admin@123', 12);
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      fullName: 'System Administrator',
      email: 'admin@hsnt-wms.local',
      passwordHash: adminHash,
      role: UserRole.SYSTEM_ADMIN,
      department: 'IT',
    },
  });

  // Warehouse Manager
  const managerHash = await bcrypt.hash('Manager@123', 12);
  await prisma.user.upsert({
    where: { username: 'wm_manager' },
    update: {},
    create: {
      username: 'wm_manager',
      fullName: 'Warehouse Manager',
      email: 'manager@hsnt-wms.local',
      passwordHash: managerHash,
      role: UserRole.WAREHOUSE_MANAGER,
      department: 'Warehouse',
    },
  });

  // Requester
  const requesterHash = await bcrypt.hash('Staff@123', 12);
  await prisma.user.upsert({
    where: { username: 'requester01' },
    update: {},
    create: {
      username: 'requester01',
      fullName: 'IT Requester',
      email: 'requester@hsnt-wms.local',
      passwordHash: requesterHash,
      role: UserRole.REQUESTER,
      department: 'IT Support',
    },
  });

  // Brand
  const brand = await prisma.brand.upsert({
    where: { code: 'CISCO' },
    update: {},
    create: { code: 'CISCO', name: 'Cisco Systems', contact: 'cisco@vendor.com' },
  });

  // Vendor
  await prisma.vendor.upsert({
    where: { code: 'VND001' },
    update: {},
    create: { code: 'VND001', name: 'Tech Supplies Co.', email: 'sales@techsupplies.com' },
  });

  // Warehouse
  const warehouse = await prisma.warehouse.upsert({
    where: { code: 'WH-MAIN' },
    update: {},
    create: { code: 'WH-MAIN', name: 'Main Warehouse', location: 'Building A, Floor 1' },
  });

  // Rack & Slot
  const rack = await prisma.rack.upsert({
    where: { warehouseId_code: { warehouseId: warehouse.id, code: 'R-01' } },
    update: {},
    create: { warehouseId: warehouse.id, code: 'R-01', name: 'Rack 01' },
  });

  const slot = await prisma.slot.upsert({
    where: { rackId_code: { rackId: rack.id, code: 'S-A1' } },
    update: {},
    create: { rackId: rack.id, code: 'S-A1', name: 'Slot A1' },
  });

  // Products
  const products = await Promise.all([
    prisma.product.upsert({
      where: { code: 'SW-C2960X' },
      update: {},
      create: {
        code: 'SW-C2960X',
        name: 'Cisco Catalyst 2960-X 24-Port Switch',
        brandId: brand.id,
        category: 'Network',
        unit: 'unit',
        unitCost: 4500,
        serialControlled: true,
        minStock: 2,
      },
    }),
    prisma.product.upsert({
      where: { code: 'CAB-CAT5E' },
      update: {},
      create: {
        code: 'CAB-CAT5E',
        name: 'Cat5e Patch Cable 1m',
        brandId: brand.id,
        category: 'Cables',
        unit: 'pcs',
        unitCost: 50,
        serialControlled: false,
        minStock: 20,
      },
    }),
  ]);

  // Stock Items
  await prisma.stockItem.createMany({
    data: [
      {
        productId: products[0].id,
        serialNumber: 'CSC-001-2024',
        quantity: 1,
        status: 'AVAILABLE',
        warehouseId: warehouse.id,
        rackId: rack.id,
        slotId: slot.id,
        createdById: admin.id,
      },
      {
        productId: products[1].id,
        batchNumber: 'BATCH-CAT5-001',
        quantity: 50,
        status: 'AVAILABLE',
        warehouseId: warehouse.id,
        rackId: rack.id,
        createdById: admin.id,
      },
    ],
    skipDuplicates: true,
  });

  console.log('✅ Seed complete');
  console.log('');
  console.log('Login credentials:');
  console.log('  admin / Admin@123         (System Admin)');
  console.log('  wm_manager / Manager@123  (Warehouse Manager)');
  console.log('  requester01 / Staff@123   (Requester)');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
