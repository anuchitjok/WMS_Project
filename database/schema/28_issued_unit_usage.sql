-- ═══════════════════════════════════════════════════════════════════════════
-- 28_issued_unit_usage.sql
-- Phase 5: per-unit usage of issued goods — partial use / partial return (Nov 2026)
--
-- ADDITIVE and IDEMPOTENT: creates one new table "IssuedUnitUsage". No existing
-- table or row is changed. Requests confirmed before this migration keep their
-- WithdrawalRequestItem."usageStatus" and are handled exactly as before.
-- Safe to run twice.
--
-- One row per (request, issued unit). The unique key stops a repeated submit
-- from recording the same unit twice. Returnable usages (UNUSED / WRONG_ITEM)
-- carry "returnStatus": PENDING → RECEIVED (unit sent to the putaway queue) or
-- → DOA (unit sent to RTV).
--
-- Apply BEFORE deploying the API that reads/writes the table.
-- Rollback: database/rollback/28_issued_unit_usage_rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS "IssuedUnitUsage" (
    "id"            TEXT NOT NULL,
    "requestId"     TEXT NOT NULL,
    "requestItemId" TEXT,
    "stockItemId"   TEXT NOT NULL,
    "quantity"      DOUBLE PRECISION NOT NULL,
    "usage"         TEXT NOT NULL,
    "notes"         TEXT,
    "recordedById"  TEXT,
    "recordedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnStatus"  TEXT,
    "returnedAt"    TIMESTAMP(3),
    "returnedById"  TEXT,
    CONSTRAINT "IssuedUnitUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "IssuedUnitUsage_returnStatus_idx" ON "IssuedUnitUsage"("returnStatus");
CREATE UNIQUE INDEX IF NOT EXISTS "IssuedUnitUsage_requestId_stockItemId_key" ON "IssuedUnitUsage"("requestId", "stockItemId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IssuedUnitUsage_requestId_fkey') THEN
    ALTER TABLE "IssuedUnitUsage"
      ADD CONSTRAINT "IssuedUnitUsage_requestId_fkey"
      FOREIGN KEY ("requestId") REFERENCES "WithdrawalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
