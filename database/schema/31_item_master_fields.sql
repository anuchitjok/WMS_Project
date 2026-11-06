-- ═══════════════════════════════════════════════════════════════════════════
-- 31_item_master_fields.sql
-- P2/P3 Item master (Acumatica Stock Item fields) + receipt condition (Nov 2026)
--
-- ADDITIVE and IDEMPOTENT: nullable columns only. No existing row is changed.
--   Product: partType, defaultPrice, createdById, updatedById (user ids, no FK),
--            lengthCm/widthCm/heightCm (box size, used by the space simulator)
--   GoodsReceivingItem: itemCondition (NEW | REFURBISH), separate from the QC
--            "condition" column which keeps its current meaning.
-- (Number 30 is intentionally unused: space booking was dropped for a simulator.)
--
-- Apply BEFORE deploying the API that reads/writes these columns.
-- Rollback: database/rollback/31_item_master_fields_rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "partType"     TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "defaultPrice" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "createdById"  TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "updatedById"  TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "lengthCm"     DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "widthCm"      DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "heightCm"     DOUBLE PRECISION;

ALTER TABLE "GoodsReceivingItem" ADD COLUMN IF NOT EXISTS "itemCondition" TEXT;

COMMIT;
