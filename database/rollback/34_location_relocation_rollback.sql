-- Rollback for 34_location_relocation.sql
--
-- ORDER: first redeploy the previous API (it does not use these tables), then run this.
-- WARNING: deletes every relocation document and line. Stock rows that were already
-- moved KEEP their new location (the move itself is not undone); the audit log keeps
-- a STOCK_RELOCATED entry per moved row. Export first if needed:
--   COPY (SELECT * FROM "RelocationRequest") TO STDOUT WITH CSV HEADER;
--   COPY (SELECT * FROM "RelocationLine")    TO STDOUT WITH CSV HEADER;

BEGIN;

DELETE FROM "RolePermission" WHERE "permissionId" IN
  (SELECT "id" FROM "Permission" WHERE "code" IN ('relocation.request', 'relocation.approve'));
DELETE FROM "Permission" WHERE "code" IN ('relocation.request', 'relocation.approve');

DROP TABLE IF EXISTS "RelocationLine";
DROP TABLE IF EXISTS "RelocationRequest";
DROP TYPE IF EXISTS "RelocationStatus";

COMMIT;
