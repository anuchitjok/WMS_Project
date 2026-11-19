-- 38_layout_lifecycle.sql
--
-- P4 / RQ13: a warehouse floor plan is signed off before it counts as the
-- agreed plan.
--
--   "LayoutStatus"   : DRAFT | PENDING | PUBLISHED
--   "status"         : DRAFT while it is being drawn (edits allowed), PENDING
--                      while it waits for approval (edits refused), PUBLISHED
--                      once approved. Editing a PUBLISHED plan drops it back to
--                      DRAFT, so the status never claims more than it should.
--   "submittedAt/ById", "publishedAt/ById" : who asked and who signed off.
--   "rejectedReason" : why the last submission was sent back; cleared on the
--                      next submission.
--
-- Additive and idempotent. No existing row changes meaning: every plan that
-- exists today becomes DRAFT, which is the truth — none of them went through an
-- approval, and DRAFT is the state in which editing is allowed, so nobody is
-- locked out by this migration.
--
-- The approval chain itself is recorded by the existing ApprovalInstance /
-- ApprovalInstanceStep tables with entityType = 'WarehouseLayout'. No new table.
--
-- ORDER: run this BEFORE deploying the API that reads these columns.
-- Unlike 37, the enum here is a brand-new type, so CREATE TYPE and the ALTER
-- TABLEs can share one transaction.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LayoutStatus') THEN
    CREATE TYPE "LayoutStatus" AS ENUM ('DRAFT', 'PENDING', 'PUBLISHED');
  END IF;
END
$$;

ALTER TABLE "WarehouseLayout" ADD COLUMN IF NOT EXISTS "status"         "LayoutStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "WarehouseLayout" ADD COLUMN IF NOT EXISTS "submittedAt"    TIMESTAMP(3);
ALTER TABLE "WarehouseLayout" ADD COLUMN IF NOT EXISTS "submittedById"  TEXT;
ALTER TABLE "WarehouseLayout" ADD COLUMN IF NOT EXISTS "publishedAt"    TIMESTAMP(3);
ALTER TABLE "WarehouseLayout" ADD COLUMN IF NOT EXISTS "publishedById"  TEXT;
ALTER TABLE "WarehouseLayout" ADD COLUMN IF NOT EXISTS "rejectedReason" TEXT;

COMMIT;

-- Check (expect one row per plan, all DRAFT):
--   SELECT "warehouseId", "status", "publishedAt" FROM "WarehouseLayout" WHERE "isDeleted" = false;
