-- Rollback for 41_slot_max_quantity.sql
--
-- Drops the piece ceiling. "Slot"."capacity" was never touched, so the places
-- limit and every reader of it are unaffected. Any figures entered are lost.

ALTER TABLE "Slot" DROP COLUMN IF EXISTS "maxQuantity";
