-- Sprint 2 — Physical Warehouse Layout: additive, idempotent migration.
-- Equivalent to `node prisma/add-layout-tables.js`, for environments where the
-- Node script cannot reach the database (e.g. corporate network blocking 5432).
-- Safe to paste into the Supabase SQL Editor. Safe to re-run.
--
-- Creates: 2 enum types, 2 tables, 6 indexes, 5 foreign keys.
-- Alters:  NOTHING. No existing table gains, loses or retypes a column.
-- DDL is copied verbatim from `prisma migrate diff --from-empty --to-schema`,
-- so it matches exactly what Prisma would generate (no future drift).

BEGIN;

-- ── Enum types ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "LayoutObjectType" AS ENUM ('ZONE', 'RACK', 'SHELF', 'BIN', 'AISLE', 'RECEIVING_AREA', 'SHIPPING_AREA', 'STAGING_AREA', 'QC_AREA', 'WORK_AREA', 'STORAGE_AREA', 'CUSTOM_AREA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "LayoutObjectStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED', 'PLANNED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Tables ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "WarehouseLayout" (
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
);

CREATE TABLE IF NOT EXISTS "LayoutObject" (
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
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "WarehouseLayout_warehouseId_key" ON "WarehouseLayout"("warehouseId");
CREATE INDEX IF NOT EXISTS "LayoutObject_layoutId_idx" ON "LayoutObject"("layoutId");
CREATE INDEX IF NOT EXISTS "LayoutObject_parentObjectId_idx" ON "LayoutObject"("parentObjectId");
CREATE INDEX IF NOT EXISTS "LayoutObject_objectType_idx" ON "LayoutObject"("objectType");
CREATE INDEX IF NOT EXISTS "LayoutObject_rackId_idx" ON "LayoutObject"("rackId");
CREATE UNIQUE INDEX IF NOT EXISTS "LayoutObject_slotId_key" ON "LayoutObject"("slotId");

-- ── Foreign keys (SET NULL into the WMS: deleting a Slot/Rack never erases a drawing) ──
DO $$ BEGIN
  ALTER TABLE "WarehouseLayout" ADD CONSTRAINT "WarehouseLayout_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "LayoutObject" ADD CONSTRAINT "LayoutObject_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "WarehouseLayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "LayoutObject" ADD CONSTRAINT "LayoutObject_parentObjectId_fkey" FOREIGN KEY ("parentObjectId") REFERENCES "LayoutObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "LayoutObject" ADD CONSTRAINT "LayoutObject_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "LayoutObject" ADD CONSTRAINT "LayoutObject_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
-- Run as a separate statement after the migration. Expected: 2 | 2 | 8 | 5 | 0
-- (8 indexes = 6 declared above + the 2 automatic primary-key indexes.)
-- The last column MUST be 0: it proves no existing table was touched.
--
-- SELECT
--   (SELECT count(*) FROM pg_type
--      WHERE typname IN ('LayoutObjectType','LayoutObjectStatus'))            AS enum_types,
--   (SELECT count(*) FROM information_schema.tables
--      WHERE table_schema='public'
--        AND table_name IN ('WarehouseLayout','LayoutObject'))                AS tables,
--   (SELECT count(*) FROM pg_indexes
--      WHERE schemaname='public'
--        AND tablename IN ('WarehouseLayout','LayoutObject'))                 AS indexes,
--   (SELECT count(*) FROM pg_constraint c
--      JOIN pg_class t ON t.oid = c.conrelid
--      JOIN pg_namespace n ON n.oid = t.relnamespace
--     WHERE c.contype='f' AND n.nspname='public'
--       AND t.relname IN ('WarehouseLayout','LayoutObject'))                  AS foreign_keys,
--   (SELECT count(*) FROM information_schema.columns
--      WHERE table_schema='public'
--        AND table_name IN ('Warehouse','Rack','Slot','StockItem')
--        AND column_name IN ('layout','layoutObject','layoutObjects'))        AS leaked_columns;

-- ── Rollback (nothing else references these objects) ────────────────────────
-- DROP TABLE IF EXISTS "LayoutObject";
-- DROP TABLE IF EXISTS "WarehouseLayout";
-- DROP TYPE  IF EXISTS "LayoutObjectType";
-- DROP TYPE  IF EXISTS "LayoutObjectStatus";
