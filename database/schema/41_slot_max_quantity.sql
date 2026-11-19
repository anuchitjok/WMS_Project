-- 41_slot_max_quantity.sql
--
-- Requirement 32 (New Relocation Request), step 3: "Display only locations with
-- available storage capacity … Display the maximum quantity that can be
-- relocated. Do not allow selection of full or unavailable locations."
--
-- To answer "how many pieces fit here?" a slot needs a ceiling in pieces.
-- "Slot"."capacity" is NOT that ceiling and is not changed here: everything in
-- the system reads it as a number of PLACES (stock rows / pallets), including
-- the planning space engine (palletSlotFreeCapacity = Σ max(0, capacity − rows
-- in the slot)) and the printed location label. Redefining it would silently
-- move those numbers.
--
-- So a second, separate ceiling is added:
--
--   "Slot"."maxQuantity"  NULL  = no piece ceiling; only the places limit applies
--                         N     = the slot holds at most N pieces in total
--
-- Nullable with no default, so every existing slot keeps behaving exactly as it
-- does today until someone enters a figure. Additive and idempotent.

ALTER TABLE "Slot" ADD COLUMN IF NOT EXISTS "maxQuantity" INTEGER;

COMMENT ON COLUMN "Slot"."maxQuantity" IS
  'Requirement 32: most pieces this slot may hold in total. NULL = no piece ceiling. Separate from "capacity", which counts places (stock rows), not pieces.';
