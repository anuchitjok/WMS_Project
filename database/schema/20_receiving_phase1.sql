-- ═══════════════════════════════════════════════════════════════
-- 20_receiving_phase1.sql
-- Goods Receiving Refactor — Phase 1 (Additive Safety Layer)
-- Additive & idempotent only. No drops, no resets, no destructive changes.
-- ═══════════════════════════════════════════════════════════════

-- ── ReceivingStatus enum (create only if missing) ───────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReceivingStatus') THEN
    CREATE TYPE "ReceivingStatus" AS ENUM (
      'DRAFT','RECEIVING','QC_PENDING','QC_HOLD','PUTAWAY_PENDING',
      'COMPLETED','PARTIAL','REJECTED','CANCELLED'
    );
  END IF;
END $$;

-- ── GoodsReceiving: shadow status enum + supplier/PO/expected date ───────────
ALTER TABLE "GoodsReceiving"
  ADD COLUMN IF NOT EXISTS "statusEnum"   "ReceivingStatus",
  ADD COLUMN IF NOT EXISTS "poNumber"     TEXT,
  ADD COLUMN IF NOT EXISTS "supplierId"   TEXT,
  ADD COLUMN IF NOT EXISTS "expectedDate" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "GoodsReceiving_createdAt_idx"  ON "GoodsReceiving" ("createdAt");
CREATE INDEX IF NOT EXISTS "GoodsReceiving_statusEnum_idx" ON "GoodsReceiving" ("statusEnum");

-- ── GoodsReceivingItem: lot / expiry / manufacture date ─────────────────────
ALTER TABLE "GoodsReceivingItem"
  ADD COLUMN IF NOT EXISTS "batchNumber"     TEXT,
  ADD COLUMN IF NOT EXISTS "expiryDate"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "manufactureDate" TIMESTAMP(3);

-- ── Product: batch-controlled flag ──────────────────────────────────────────
ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "batchControlled" BOOLEAN NOT NULL DEFAULT false;
