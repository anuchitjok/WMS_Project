-- ═══════════════════════════════════════════════════════════════════════════
-- 29_warehouse_space.sql
-- P1 Warehouse Structure & Space (Nov 2026)
--
-- ADDITIVE and IDEMPOTENT: adds nullable size columns to "Warehouse" and
-- "Rack", one new table "RackTypeMaster" (size templates) and seeds two
-- templates. No existing row is changed: existing warehouses/racks simply have
-- no size yet (NULL) and keep working exactly as before. Safe to run twice.
--
-- Apply BEFORE deploying the API that reads/writes these columns.
-- Rollback: database/rollback/29_warehouse_space_rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "lengthCm"      DOUBLE PRECISION;
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "widthCm"       DOUBLE PRECISION;
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "heightCm"      DOUBLE PRECISION;
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "usableAreaPct" DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS "RackTypeMaster" (
    "id"               TEXT NOT NULL,
    "code"             TEXT NOT NULL,
    "name"             TEXT NOT NULL,
    "category"         TEXT NOT NULL DEFAULT 'STANDARD_RACK',
    "lengthCm"         DOUBLE PRECISION NOT NULL,
    "widthCm"          DOUBLE PRECISION NOT NULL,
    "heightCm"         DOUBLE PRECISION NOT NULL,
    "levels"           INTEGER NOT NULL DEFAULT 1,
    "columns"          INTEGER NOT NULL DEFAULT 1,
    "slotCapacity"     INTEGER NOT NULL DEFAULT 1,
    "maxStackHeightCm" DOUBLE PRECISION,
    "description"      TEXT,
    "isActive"         BOOLEAN NOT NULL DEFAULT true,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RackTypeMaster_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RackTypeMaster_code_key" ON "RackTypeMaster"("code");
CREATE INDEX IF NOT EXISTS "RackTypeMaster_category_idx" ON "RackTypeMaster"("category");

ALTER TABLE "Rack" ADD COLUMN IF NOT EXISTS "rackTypeId" TEXT;
ALTER TABLE "Rack" ADD COLUMN IF NOT EXISTS "lengthCm"   DOUBLE PRECISION;
ALTER TABLE "Rack" ADD COLUMN IF NOT EXISTS "widthCm"    DOUBLE PRECISION;
ALTER TABLE "Rack" ADD COLUMN IF NOT EXISTS "heightCm"   DOUBLE PRECISION;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Rack_rackTypeId_fkey') THEN
    ALTER TABLE "Rack"
      ADD CONSTRAINT "Rack_rackTypeId_fkey"
      FOREIGN KEY ("rackTypeId") REFERENCES "RackTypeMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Two starting templates (editable later in the UI).
INSERT INTO "RackTypeMaster" ("id","code","name","category","lengthCm","widthCm","heightCm","levels","columns","slotCapacity","maxStackHeightCm","description")
VALUES
  ('rtm_standard_250', 'STD-250',  'Standard Rack 250 cm, 5 levels', 'STANDARD_RACK',   250, 100, 250, 5, 5, 1, NULL, 'Shelf rack'),
  ('rtm_pallet_1210',  'PLT-1210', 'Pallet on Floor 120x100 cm',     'PALLET_ON_FLOOR', 120, 100, 180, 1, 1, 1, 180,  'Open floor area for pallets')
ON CONFLICT ("code") DO NOTHING;

COMMIT;
