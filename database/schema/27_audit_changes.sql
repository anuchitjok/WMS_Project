-- ═══════════════════════════════════════════════════════════════════════════
-- 27_audit_changes.sql
-- Phase 3: old → new values on audit entries (Nov 2026)
--
-- ADDITIVE and IDEMPOTENT: adds one NULLABLE JSONB column to "AuditLog" and
-- to "AuditLogArchive". No existing row is changed; old entries keep
-- "changes" = NULL and still show their "detail" text. Safe to run twice.
--
-- Shape written by the API: { "<field>": { "from": <old>, "to": <new> } }
-- (role permission edits use { "permissions": { "added": [...], "removed": [...] } }).
--
-- Apply BEFORE deploying the API that writes the column (the API selects it).
-- Run on staging / a copy first. Rollback: database/rollback/27_audit_changes_rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE "AuditLog"        ADD COLUMN IF NOT EXISTS "changes" JSONB;
ALTER TABLE "AuditLogArchive" ADD COLUMN IF NOT EXISTS "changes" JSONB;

COMMIT;

-- Verify (read-only):
-- SELECT table_name, column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE column_name = 'changes' AND table_name IN ('AuditLog', 'AuditLogArchive');
