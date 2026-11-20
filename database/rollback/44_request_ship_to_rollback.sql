-- ═══════════════════════════════════════════════════════════════════════════
-- 44_request_ship_to_rollback.sql
--
-- Undoes 44_request_ship_to.sql. THIS DROPS DELIVERY ADDRESSES: every SHIP
-- request that has one loses it, and there is no way back. Take a copy first
-- if any request has been raised since the migration was applied:
--
--   SELECT "refNumber", "shipToName", "shipToPhone", "shipToAddress",
--          "shipToTambon", "shipToDistrict", "shipToProvince", "shipToPostCode",
--          "shipToNote"
--   FROM "WithdrawalRequest"
--   WHERE "shipToName" IS NOT NULL OR "shipToAddress" IS NOT NULL;
--
-- Deploy the API that no longer writes these columns BEFORE running this.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE "WithdrawalRequest" DROP COLUMN IF EXISTS "shipToName";
ALTER TABLE "WithdrawalRequest" DROP COLUMN IF EXISTS "shipToPhone";
ALTER TABLE "WithdrawalRequest" DROP COLUMN IF EXISTS "shipToAddress";
ALTER TABLE "WithdrawalRequest" DROP COLUMN IF EXISTS "shipToTambonId";
ALTER TABLE "WithdrawalRequest" DROP COLUMN IF EXISTS "shipToTambon";
ALTER TABLE "WithdrawalRequest" DROP COLUMN IF EXISTS "shipToDistrict";
ALTER TABLE "WithdrawalRequest" DROP COLUMN IF EXISTS "shipToProvince";
ALTER TABLE "WithdrawalRequest" DROP COLUMN IF EXISTS "shipToPostCode";
ALTER TABLE "WithdrawalRequest" DROP COLUMN IF EXISTS "shipToNote";

COMMIT;
