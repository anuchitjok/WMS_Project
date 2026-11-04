-- Rollback for 27_audit_changes.sql
--
-- ORDER: first redeploy the previous API (it does not read "changes"), then run this.
-- WARNING: dropping the column discards the old → new values recorded since
-- migration 27. Export them first if they must be kept:
--   COPY (SELECT id, action, "entityType", "entityId", changes, "createdAt"
--         FROM "AuditLog" WHERE changes IS NOT NULL) TO STDOUT WITH CSV HEADER;
-- The "detail" text on every entry is untouched.

BEGIN;

ALTER TABLE "AuditLog"        DROP COLUMN IF EXISTS "changes";
ALTER TABLE "AuditLogArchive" DROP COLUMN IF EXISTS "changes";

COMMIT;
