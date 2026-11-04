-- Rollback for 28_issued_unit_usage.sql
--
-- ORDER: first redeploy the previous API (it does not use the table), then run this.
-- WARNING: dropping the table discards the per-unit usage and return records
-- written since migration 28. Stock statuses and audit entries are untouched,
-- but requests that were partly used / partly returned lose the breakdown.
-- Export first if it must be kept:
--   COPY (SELECT * FROM "IssuedUnitUsage") TO STDOUT WITH CSV HEADER;
-- Requests with returns still PENDING should be finished before rolling back:
--   SELECT "requestId", "stockItemId", "usage" FROM "IssuedUnitUsage" WHERE "returnStatus" = 'PENDING';

BEGIN;

DROP TABLE IF EXISTS "IssuedUnitUsage";

COMMIT;
