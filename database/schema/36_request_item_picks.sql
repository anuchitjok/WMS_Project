-- 36_request_item_picks.sql
--
-- PR6 Pick location chosen at approval: the approver may say which stock rows
-- (rack / slot) a request line is taken from. One NEW table; no existing table
-- or row is changed. Requests approved without a choice never write here, so
-- the FIFO path is unchanged.
--
--   WithdrawalRequestPick  one chosen stock row → request line, quantity.
--                          releasedAt is set when allocation uses the row or the
--                          request is cancelled; an open pick (releasedAt NULL)
--                          keeps the row away from other requests' allocation.
--
-- Additive and safe to run twice. Matches backend/prisma/schema.prisma at this change.
-- ORDER: run this BEFORE deploying the API that uses this table. Apply on STAGING first.
-- Do NOT use `prisma db push` against shared databases.

BEGIN;

CREATE TABLE IF NOT EXISTS "WithdrawalRequestPick" (
    "id" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "pickedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    CONSTRAINT "WithdrawalRequestPick_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WithdrawalRequestPick_quantity_check" CHECK ("quantity" > 0)
);

CREATE INDEX IF NOT EXISTS "WithdrawalRequestPick_requestItemId_idx" ON "WithdrawalRequestPick"("requestItemId");
CREATE INDEX IF NOT EXISTS "WithdrawalRequestPick_stockItemId_idx" ON "WithdrawalRequestPick"("stockItemId");

DO $$ BEGIN
  ALTER TABLE "WithdrawalRequestPick" ADD CONSTRAINT "WithdrawalRequestPick_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "WithdrawalRequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "WithdrawalRequestPick" ADD CONSTRAINT "WithdrawalRequestPick_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "WithdrawalRequestPick" ADD CONSTRAINT "WithdrawalRequestPick_pickedById_fkey" FOREIGN KEY ("pickedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
