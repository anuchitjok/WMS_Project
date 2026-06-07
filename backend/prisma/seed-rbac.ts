import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

// ── Permission catalogue (module.action) ────────────────────────────────────
const PERMISSIONS: { code: string; module: string; action: string; description: string }[] = [
  { code: 'inventory.read', module: 'inventory', action: 'read', description: 'View inventory' },
  { code: 'inventory.create', module: 'inventory', action: 'create', description: 'Create stock items' },
  { code: 'inventory.adjust', module: 'inventory', action: 'adjust', description: 'Adjust stock quantity' },
  { code: 'inventory.transfer', module: 'inventory', action: 'transfer', description: 'Transfer stock' },
  { code: 'request.read', module: 'request', action: 'read', description: 'View requests' },
  { code: 'request.create', module: 'request', action: 'create', description: 'Create withdrawal requests' },
  { code: 'request.approve', module: 'request', action: 'approve', description: 'Approve/reject requests' },
  { code: 'request.cancel', module: 'request', action: 'cancel', description: 'Cancel requests' },
  { code: 'receiving.manage', module: 'receiving', action: 'manage', description: 'Goods receiving' },
  { code: 'putaway.manage', module: 'putaway', action: 'manage', description: 'Putaway operations' },
  { code: 'fulfillment.manage', module: 'fulfillment', action: 'manage', description: 'Pick/pack/ship' },
  { code: 'rma.manage', module: 'rma', action: 'manage', description: 'RMA usage / DOA' },
  { code: 'rtv.manage', module: 'rtv', action: 'manage', description: 'RTV cases' },
  { code: 'product.manage', module: 'product', action: 'manage', description: 'Product master' },
  { code: 'warehouse.manage', module: 'warehouse', action: 'manage', description: 'Warehouse/rack/slot' },
  { code: 'user.manage', module: 'user', action: 'manage', description: 'Manage users' },
  { code: 'role.manage', module: 'role', action: 'manage', description: 'Manage roles & permissions' },
  { code: 'settings.manage', module: 'settings', action: 'manage', description: 'System settings' },
  { code: 'report.read', module: 'report', action: 'read', description: 'View reports' },
  { code: 'audit.read', module: 'audit', action: 'read', description: 'View audit trail' },
  { code: 'dataio.manage', module: 'dataio', action: 'manage', description: 'Import/export data' },
];

const ALL = PERMISSIONS.map((p) => p.code);
const READ_ONLY = ALL.filter((c) => c.endsWith('.read'));

// ── Role definitions ────────────────────────────────────────────────────────
const ROLES: { key: string; name: string; description: string; permissions: string[] }[] = [
  { key: 'SUPER_ADMIN', name: 'Super Administrator', description: 'Full unrestricted access', permissions: ALL },
  { key: 'ADMIN', name: 'Administrator', description: 'System administration', permissions: ALL.filter((c) => c !== 'role.manage') },
  {
    key: 'WAREHOUSE_MANAGER', name: 'Warehouse Manager', description: 'Full warehouse operations + approval',
    permissions: ['inventory.read', 'inventory.create', 'inventory.adjust', 'inventory.transfer',
      'request.read', 'request.approve', 'request.cancel', 'receiving.manage', 'putaway.manage',
      'fulfillment.manage', 'rma.manage', 'rtv.manage', 'product.manage', 'warehouse.manage',
      'report.read', 'audit.read', 'dataio.manage'],
  },
  {
    key: 'PICKER', name: 'Picker / Warehouse Staff', description: 'Execute pick/pack/putaway',
    permissions: ['inventory.read', 'request.read', 'putaway.manage', 'fulfillment.manage', 'receiving.manage'],
  },
  {
    key: 'REQUESTER', name: 'Requester', description: 'Create and track requests',
    permissions: ['inventory.read', 'request.read', 'request.create', 'request.cancel', 'rma.manage'],
  },
  { key: 'AUDITOR', name: 'Auditor', description: 'Read-only audit + reports', permissions: [...READ_ONLY, 'audit.read', 'report.read'] },
  {
    key: 'INVENTORY_CONTROL', name: 'Inventory Control', description: 'Inventory + stock control',
    permissions: ['inventory.read', 'inventory.create', 'inventory.adjust', 'inventory.transfer',
      'product.manage', 'warehouse.manage', 'report.read', 'dataio.manage', 'receiving.manage', 'putaway.manage'],
  },
];

async function main() {
  console.log('🔐 Seeding RBAC...');

  // permissions
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({ where: { code: p.code }, update: { module: p.module, action: p.action, description: p.description }, create: p });
  }
  const permRows = await prisma.permission.findMany();
  const permId = new Map(permRows.map((p) => [p.code, p.id]));

  // roles + matrix
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { key: r.key },
      update: { name: r.name, description: r.description, isSystem: true },
      create: { key: r.key, name: r.name, description: r.description, isSystem: true },
    });
    // reset matrix then re-apply
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: r.permissions.map((code) => ({ roleId: role.id, permissionId: permId.get(code)! })).filter((x) => x.permissionId),
      skipDuplicates: true,
    });
  }
  console.log(`  ✓ ${PERMISSIONS.length} permissions, ${ROLES.length} roles`);

  // map existing seeded users to dynamic roles
  const roleByKey = new Map((await prisma.role.findMany()).map((r) => [r.key, r.id]));
  const mapping: Record<string, string> = {
    admin: 'SUPER_ADMIN',
    wm_manager: 'WAREHOUSE_MANAGER',
    requester01: 'REQUESTER',
  };
  for (const [username, roleKey] of Object.entries(mapping)) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (user) await prisma.user.update({ where: { id: user.id }, data: { roleId: roleByKey.get(roleKey) } });
  }

  // assign all warehouses to admin + manager; main to requester
  const warehouses = await prisma.warehouse.findMany({ select: { id: true, code: true } });
  const admin = await prisma.user.findUnique({ where: { username: 'admin' } });
  const mgr = await prisma.user.findUnique({ where: { username: 'wm_manager' } });
  const reqr = await prisma.user.findUnique({ where: { username: 'requester01' } });
  for (const u of [admin, mgr]) {
    if (!u) continue;
    for (const w of warehouses) {
      await prisma.userWarehouse.upsert({ where: { userId_warehouseId: { userId: u.id, warehouseId: w.id } }, update: {}, create: { userId: u.id, warehouseId: w.id } });
    }
  }
  if (reqr && warehouses[0]) {
    await prisma.userWarehouse.upsert({ where: { userId_warehouseId: { userId: reqr.id, warehouseId: warehouses[0].id } }, update: {}, create: { userId: reqr.id, warehouseId: warehouses[0].id } });
  }

  console.log('  ✓ Mapped users → roles + warehouse access');
  console.log('✅ RBAC seed complete');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
