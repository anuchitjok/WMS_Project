-- ═══════════════════════════════════════════════════════════════════════════
-- 32_request_delivery_method.sql
-- P4 Withdrawal request: Collect / Ship (Nov 2026)
--
-- ADDITIVE and IDEMPOTENT: one nullable column. Existing requests stay NULL,
-- which the API treats as COLLECT (how every request works today).
-- Shipping address fields are deliberately NOT added (on hold per requirements).
--
-- Apply BEFORE deploying the API that reads/writes the column.
-- Rollback: database/rollback/32_request_delivery_method_rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE "WithdrawalRequest" ADD COLUMN IF NOT EXISTS "deliveryMethod" TEXT;

COMMIT;
