-- ═══════════════════════════════════════════════════════════════════════════
-- 44_request_ship_to.sql
-- Where a SHIP request is actually going (Nov 2026)
--
-- Migration 32 added deliveryMethod (COLLECT | SHIP) and deliberately left the
-- address out, "on hold per requirements". The owner has now asked for it: when
-- someone picks Ship on a withdrawal request, they fill the delivery details in
-- there and then, and the shipping label prints the whole address.
--
-- The names are stored as TEXT beside the tambon id ON PURPOSE. The Thai Post
-- list (migration 43) is reference data that can be corrected or renamed later,
-- and an address that has already been shipped must not change underneath the
-- paperwork. The id records which tambon was picked; the text records what was
-- agreed at the time. Nothing here joins to "ThaiTambon", so a tambon can even
-- be deleted without breaking an old request.
--
-- Every column is nullable: the owner's rule is that an incomplete address only
-- warns, it never blocks the request.
--
-- ADDITIVE and IDEMPOTENT. Apply BEFORE deploying the API that writes them.
-- Rollback: database/rollback/44_request_ship_to_rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE "WithdrawalRequest" ADD COLUMN IF NOT EXISTS "shipToName"     TEXT;
ALTER TABLE "WithdrawalRequest" ADD COLUMN IF NOT EXISTS "shipToPhone"    TEXT;
ALTER TABLE "WithdrawalRequest" ADD COLUMN IF NOT EXISTS "shipToAddress"  TEXT;
ALTER TABLE "WithdrawalRequest" ADD COLUMN IF NOT EXISTS "shipToTambonId" VARCHAR(6);
ALTER TABLE "WithdrawalRequest" ADD COLUMN IF NOT EXISTS "shipToTambon"   TEXT;
ALTER TABLE "WithdrawalRequest" ADD COLUMN IF NOT EXISTS "shipToDistrict" TEXT;
ALTER TABLE "WithdrawalRequest" ADD COLUMN IF NOT EXISTS "shipToProvince" TEXT;
ALTER TABLE "WithdrawalRequest" ADD COLUMN IF NOT EXISTS "shipToPostCode" VARCHAR(5);
ALTER TABLE "WithdrawalRequest" ADD COLUMN IF NOT EXISTS "shipToNote"     TEXT;

COMMENT ON COLUMN "WithdrawalRequest"."shipToName" IS
  'Who receives the goods at the far end. Not the requester: a request may be sent to a customer or another site.';
COMMENT ON COLUMN "WithdrawalRequest"."shipToAddress" IS
  'House number, street, building - everything above tambon level, as typed.';
COMMENT ON COLUMN "WithdrawalRequest"."shipToTambonId" IS
  'ThaiTambon.id as picked (migration 43). Deliberately NOT a foreign key: the names beside it are the record of what was agreed.';
COMMENT ON COLUMN "WithdrawalRequest"."shipToNote" IS
  'Instructions for the carrier, e.g. call before delivery.';

COMMIT;
