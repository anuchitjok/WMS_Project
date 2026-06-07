-- ═══════════════════════════════════════════════════════════════
-- 19_requester_refactor_phase1.sql
-- Requester Module Refactor — Phase 1 (Additive Safety Layer)
-- Additive & idempotent only. No drops, no resets, no destructive changes.
-- ═══════════════════════════════════════════════════════════════

-- ── C3: optimistic locking on WithdrawalRequest ─────────────────────────────
ALTER TABLE "WithdrawalRequest"
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

-- ── Correlation chain (request ↔ task ↔ shipment) ───────────────────────────
ALTER TABLE "WithdrawalRequest"
  ADD COLUMN IF NOT EXISTS "correlationId" TEXT;

-- ── C2: authoritative shipped unit, denormalized at dispatch ────────────────
ALTER TABLE "WithdrawalRequestItem"
  ADD COLUMN IF NOT EXISTS "shippedStockItemId" TEXT;

-- ── Audit ledger: correlation + faster ledger queries ───────────────────────
ALTER TABLE "AuditLog"
  ADD COLUMN IF NOT EXISTS "correlationId" TEXT;

CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx"
  ON "AuditLog" ("action", "createdAt");
