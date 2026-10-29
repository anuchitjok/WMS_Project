-- ═══════════════════════════════════════════════════════════════════════════
-- 23_planning_sales.sql
-- Project Planning — sales simulation mode (Oct 2026)
--
-- ADDITIVE and IDEMPOTENT. Safe to run more than once.
--   • PlanningProject."purpose" (new column, default 'OPERATIONAL' — every
--     existing project keeps behaving exactly as before)
--   • PlanningProject."warehouseId" becomes optional (a sales simulation does
--     not have to name a warehouse). Existing values are untouched.
-- No other table is altered; no row is modified or deleted; no permission or
-- role grant changes.
--
-- Apply on production BEFORE merging the backend that uses it (on this repo
-- merging to master deploys immediately).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE "PlanningProject" ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'OPERATIONAL';
ALTER TABLE "PlanningProject" ALTER COLUMN "warehouseId" DROP NOT NULL;

COMMIT;

-- ── Verification (read-only) ───────────────────────────────────────────────
-- SELECT column_name, is_nullable, column_default FROM information_schema.columns
--  WHERE table_name = 'PlanningProject' AND column_name IN ('purpose', 'warehouseId');
