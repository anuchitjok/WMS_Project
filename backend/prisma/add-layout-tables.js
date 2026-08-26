// Sprint 2 — Physical Warehouse Layout: additive, production-safe migration.
//
// Creates 2 enum types + 2 tables (WarehouseLayout, LayoutObject) and nothing else.
// NO existing table is altered: no column is added, dropped or retyped on
// Warehouse / Rack / Slot / StockItem. The script proves that by snapshotting
// those four tables' column signatures before and after, and aborting if they differ.
//
// Every statement is guarded (IF NOT EXISTS / duplicate_object) so the script is
// idempotent and safe to re-run. All DDL runs inside a single transaction.
// A JSON backup is written before anything executes.
//
// The DDL below is copied verbatim from `prisma migrate diff --from-empty
// --to-schema prisma/schema.prisma --script`, so the result is byte-identical to
// what Prisma itself would create — no drift on a future db push.
//
//   Apply:     node prisma/add-layout-tables.js
//   Dry run:   node prisma/add-layout-tables.js --dry-run
//   Rollback:  node prisma/add-layout-tables.js --rollback   (refuses if rows exist)

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DRY_RUN = process.argv.includes('--dry-run');
const ROLLBACK = process.argv.includes('--rollback');
const FORCE = process.argv.includes('--force');

// Tables that MUST come out of this migration untouched.
const PROTECTED = ['Warehouse', 'Rack', 'Slot', 'StockItem'];
const NEW_TABLES = ['WarehouseLayout', 'LayoutObject'];
const NEW_TYPES = ['LayoutObjectType', 'LayoutObjectStatus'];

function connectionString() {
  if (process.env.DIRECT_URL) return process.env.DIRECT_URL;
  const envPath = path.join(__dirname, '..', '.env');
  const env = fs.readFileSync(envPath, 'utf8');
  const m = env.match(/DIRECT_URL\s*=\s*"?([^"\n\r]+)/);
  if (!m) throw new Error('DIRECT_URL not found in backend/.env');
  return m[1];
}

// ── DDL ─────────────────────────────────────────────────────────────────────
// Guarded equivalents of Prisma's generated statements.

const CREATE_TYPES = [
  `DO $$ BEGIN
     CREATE TYPE "LayoutObjectType" AS ENUM ('ZONE', 'RACK', 'SHELF', 'BIN', 'AISLE', 'RECEIVING_AREA', 'SHIPPING_AREA', 'STAGING_AREA', 'QC_AREA', 'WORK_AREA', 'STORAGE_AREA', 'CUSTOM_AREA');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN
     CREATE TYPE "LayoutObjectStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED', 'PLANNED');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
];

const CREATE_TABLES = [
  `CREATE TABLE IF NOT EXISTS "WarehouseLayout" (
     "id" TEXT NOT NULL,
     "warehouseId" TEXT NOT NULL,
     "name" TEXT NOT NULL DEFAULT 'Default Layout',
     "widthUnits" INTEGER NOT NULL DEFAULT 100,
     "heightUnits" INTEGER NOT NULL DEFAULT 60,
     "gridSize" INTEGER NOT NULL DEFAULT 10,
     "unitLabel" TEXT NOT NULL DEFAULT 'm',
     "version" INTEGER NOT NULL DEFAULT 0,
     "notes" TEXT,
     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
     "deletedAt" TIMESTAMP(3),
     "deletedBy" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "WarehouseLayout_pkey" PRIMARY KEY ("id")
   );`,
  `CREATE TABLE IF NOT EXISTS "LayoutObject" (
     "id" TEXT NOT NULL,
     "layoutId" TEXT NOT NULL,
     "parentObjectId" TEXT,
     "objectType" "LayoutObjectType" NOT NULL,
     "name" TEXT NOT NULL,
     "code" TEXT,
     "x" DOUBLE PRECISION NOT NULL,
     "y" DOUBLE PRECISION NOT NULL,
     "width" DOUBLE PRECISION NOT NULL,
     "height" DOUBLE PRECISION NOT NULL,
     "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
     "zIndex" INTEGER NOT NULL DEFAULT 0,
     "displayOrder" INTEGER NOT NULL DEFAULT 0,
     "slotId" TEXT,
     "rackId" TEXT,
     "capacity" INTEGER,
     "color" TEXT,
     "status" "LayoutObjectStatus" NOT NULL DEFAULT 'ACTIVE',
     "metadata" TEXT,
     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
     "deletedAt" TIMESTAMP(3),
     "deletedBy" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "LayoutObject_pkey" PRIMARY KEY ("id")
   );`,
];

const CREATE_INDEXES = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "WarehouseLayout_warehouseId_key" ON "WarehouseLayout"("warehouseId");`,
  `CREATE INDEX IF NOT EXISTS "LayoutObject_layoutId_idx" ON "LayoutObject"("layoutId");`,
  `CREATE INDEX IF NOT EXISTS "LayoutObject_parentObjectId_idx" ON "LayoutObject"("parentObjectId");`,
  `CREATE INDEX IF NOT EXISTS "LayoutObject_objectType_idx" ON "LayoutObject"("objectType");`,
  `CREATE INDEX IF NOT EXISTS "LayoutObject_rackId_idx" ON "LayoutObject"("rackId");`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "LayoutObject_slotId_key" ON "LayoutObject"("slotId");`,
];

// ADD CONSTRAINT has no IF NOT EXISTS — guard on duplicate_object instead.
const FKS = [
  ['WarehouseLayout_warehouseId_fkey', `ALTER TABLE "WarehouseLayout" ADD CONSTRAINT "WarehouseLayout_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`],
  ['LayoutObject_layoutId_fkey', `ALTER TABLE "LayoutObject" ADD CONSTRAINT "LayoutObject_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "WarehouseLayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;`],
  ['LayoutObject_parentObjectId_fkey', `ALTER TABLE "LayoutObject" ADD CONSTRAINT "LayoutObject_parentObjectId_fkey" FOREIGN KEY ("parentObjectId") REFERENCES "LayoutObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;`],
  ['LayoutObject_slotId_fkey', `ALTER TABLE "LayoutObject" ADD CONSTRAINT "LayoutObject_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot"("id") ON DELETE SET NULL ON UPDATE CASCADE;`],
  ['LayoutObject_rackId_fkey', `ALTER TABLE "LayoutObject" ADD CONSTRAINT "LayoutObject_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack"("id") ON DELETE SET NULL ON UPDATE CASCADE;`],
].map(([name, sql]) => `DO $$ BEGIN ${sql} EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);

// ── Helpers ─────────────────────────────────────────────────────────────────

// Column signature of the protected tables — the before/after safety assertion.
async function signature(c) {
  const { rows } = await c.query(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1)
      ORDER BY table_name, column_name`,
    [PROTECTED],
  );
  return rows;
}

async function tableExists(c, name) {
  const { rows } = await c.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
    [name],
  );
  return rows.length > 0;
}

async function main() {
  const c = new Client({
    connectionString: connectionString(),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20_000,
  });

  try {
    await c.connect();
  } catch (err) {
    // A paused Supabase project accepts the TCP socket but never completes the
    // Postgres handshake — surfaces here as ECONNRESET or "timeout expired".
    console.error('CONNECT_FAILED', err.code || '', err.message);
    console.error('Hint: if the database is a paused Supabase free-tier project, resume it and re-run.');
    process.exitCode = 1;
    return;
  }

  try {
    // ── Backup (SELECT only) ──
    const dump = {};
    for (const t of PROTECTED) dump[t] = (await c.query(`SELECT * FROM "${t}"`)).rows;
    const before = await signature(c);
    dump.__columnSignature = before;

    const dir = path.join(__dirname, '..', 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `layout-premigration-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(dump, null, 2));
    console.log('BACKUP_FILE', file);
    console.log('BACKUP_ROWS', JSON.stringify(Object.fromEntries(PROTECTED.map((t) => [t, dump[t].length]))));

    // ── Rollback path ──
    if (ROLLBACK) {
      for (const t of NEW_TABLES) {
        if (!(await tableExists(c, t))) continue;
        const { rows } = await c.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
        if (rows[0].n > 0 && !FORCE) {
          throw new Error(`Refusing to drop "${t}" — it holds ${rows[0].n} row(s). Re-run with --force if that is intended.`);
        }
      }
      await c.query('BEGIN');
      await c.query(`DROP TABLE IF EXISTS "LayoutObject";`);
      await c.query(`DROP TABLE IF EXISTS "WarehouseLayout";`);
      for (const t of NEW_TYPES) await c.query(`DROP TYPE IF EXISTS "${t}";`);
      await c.query('COMMIT');
      console.log('ROLLBACK_OK — layout tables and types removed');
      return;
    }

    // ── Report what would change ──
    const present = {};
    for (const t of NEW_TABLES) present[t] = await tableExists(c, t);
    console.log('PRE_STATE', JSON.stringify(present));

    if (DRY_RUN) {
      console.log('DRY_RUN — no DDL executed. Statements that would run:');
      [...CREATE_TYPES, ...CREATE_TABLES, ...CREATE_INDEXES, ...FKS]
        .forEach((s, i) => console.log(`  ${String(i + 1).padStart(2, '0')}. ${s.replace(/\s+/g, ' ').slice(0, 110)}…`));
      return;
    }

    // ── Apply, atomically ──
    await c.query('BEGIN');
    for (const s of [...CREATE_TYPES, ...CREATE_TABLES, ...CREATE_INDEXES, ...FKS]) await c.query(s);

    // ── Safety assertion BEFORE commit: protected tables must be untouched ──
    const after = await signature(c);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      await c.query('ROLLBACK');
      throw new Error('ABORTED — column signature of an existing table changed. Nothing was committed.');
    }
    await c.query('COMMIT');

    // ── Verify ──
    const report = { tables: {}, types: {}, indexes: {}, foreignKeys: {}, protectedTablesUnchanged: true };
    for (const t of NEW_TABLES) {
      const { rows } = await c.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [t]);
      report.tables[t] = { exists: await tableExists(c, t), columns: rows.length };
    }
    for (const t of NEW_TYPES) {
      const { rows } = await c.query(`SELECT 1 FROM pg_type WHERE typname=$1`, [t]);
      report.types[t] = rows.length > 0;
    }
    const idx = await c.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename = ANY($1) ORDER BY indexname`, [NEW_TABLES]);
    report.indexes = idx.rows.map((r) => r.indexname);
    // NB: join pg_class rather than casting conrelid::regclass::text — that cast
    // renders mixed-case identifiers quoted ("LayoutObject") and would never match.
    const fk = await c.query(
      `SELECT c.conname FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.contype='f' AND n.nspname='public'
          AND t.relname = ANY($1) ORDER BY c.conname`, [NEW_TABLES]);
    report.foreignKeys = fk.rows.map((r) => r.conname);

    console.log('MIGRATION_OK', JSON.stringify(report, null, 2));
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch { /* no open transaction */ }
    console.error('MIGRATION_FAILED', err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
