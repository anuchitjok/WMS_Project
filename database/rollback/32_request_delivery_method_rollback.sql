-- Rollback for 32_request_delivery_method.sql
--
-- ORDER: first redeploy the previous API (it does not use the column), then run this.
-- WARNING: discards the Collect / Ship choice on requests created since migration 32.
-- Export first if needed:
--   COPY (SELECT "id","refNumber","deliveryMethod" FROM "WithdrawalRequest" WHERE "deliveryMethod" IS NOT NULL) TO STDOUT WITH CSV HEADER;

BEGIN;

ALTER TABLE "WithdrawalRequest" DROP COLUMN IF EXISTS "deliveryMethod";

COMMIT;
