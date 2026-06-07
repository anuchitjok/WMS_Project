-- ═══════════════════════════════════════════════════════════════
-- 18_fulfillment_guard_rails.sql
-- Enterprise Fulfillment Guard Rails
-- Prevents dual-system conflict between V1 and V2 fulfillment
-- ═══════════════════════════════════════════════════════════════

-- ── 1. UNIQUE active FulfillmentTask per request ─────────────────────────────
-- Only one non-cancelled, non-returned task can exist per request.
-- This is a partial unique index: it excludes terminal statuses.
CREATE UNIQUE INDEX IF NOT EXISTS ux_fulfillment_task_request_active
  ON "FulfillmentTask" ("requestId")
  WHERE status NOT IN ('CANCELLED', 'RETURNED');

-- ── 2. CHECK constraints on inventory_balance (if table exists) ───────────────
-- Prevents negative stock (ghost inventory prevention)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'inventory_balance'
  ) THEN
    ALTER TABLE inventory_balance
      DROP CONSTRAINT IF EXISTS chk_qty_non_negative,
      ADD CONSTRAINT chk_qty_non_negative
        CHECK (qty_on_hand >= 0 AND qty_reserved >= 0 AND qty_reserved <= qty_on_hand);
  END IF;
END $$;

-- ── 3. Add version column for optimistic locking ──────────────────────────────
ALTER TABLE "FulfillmentTask"
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

-- ── 4. Add enterprise tracking columns to Shipment ───────────────────────────
ALTER TABLE "Shipment"
  ADD COLUMN IF NOT EXISTS "dispatchedById" TEXT,
  ADD COLUMN IF NOT EXISTS "podReference"   TEXT;

-- ── 5. Index on FulfillmentTask.warehouseId + status for board queries ─────────
CREATE INDEX IF NOT EXISTS idx_ft_warehouse_status
  ON "FulfillmentTask" ("warehouseId", status);

-- ── 6. Index on FulfillmentTask.requestId ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ft_request_id
  ON "FulfillmentTask" ("requestId");

-- ── 7. Verify no duplicate active tasks exist before constraint ───────────────
-- (Informational — run manually if needed)
-- SELECT "requestId", COUNT(*) FROM "FulfillmentTask"
-- WHERE status NOT IN ('CANCELLED','RETURNED')
-- GROUP BY "requestId" HAVING COUNT(*) > 1;
