-- Rollback for 36_request_item_picks.sql
--
-- ORDER: first redeploy the previous API (it does not use this table), then run this.
-- Stock rows reserved through a chosen pick STAY RESERVED; the previous API treats
-- them as ordinary approval reservations (FIFO pool). Only the record of which row
-- the approver chose is lost. Export first if needed:
--   COPY (SELECT * FROM "WithdrawalRequestPick") TO STDOUT WITH CSV HEADER;

BEGIN;

DROP TABLE IF EXISTS "WithdrawalRequestPick";

COMMIT;
