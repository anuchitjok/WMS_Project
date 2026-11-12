-- 34_location_relocation.sql
--
-- PR7 Location Relocation Request: move stock between slots of one warehouse
-- with approval. Two NEW tables and one NEW enum; no existing table or row is
-- changed. Stock rows change location only through the API when an approved
-- request is completed.
--
--   RelocationRequest  document header (warehouse, status, requester, approver, …)
--   RelocationLine     one stock row → destination slot, quantity
--
-- Also adds two permission codes to the catalogue (no role is granted anything
-- here; SUPER_ADMIN has them implicitly). Role grants are a business decision:
-- see database/previews/34_relocation_role_grants.sql.
--
-- Additive and safe to run twice. Matches backend/prisma/schema.prisma at this change.
-- ORDER: run this BEFORE deploying the API that uses these tables. Apply on STAGING first.
-- Do NOT use `prisma db push` against shared databases.

BEGIN;

DO $$ BEGIN
  CREATE TYPE "RelocationStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "RelocationRequest" (
    "id" TEXT NOT NULL,
    "refNumber" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" "RelocationStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "reason" TEXT,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RelocationRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RelocationLine" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "fromSlotId" TEXT NOT NULL,
    "toSlotId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "remainderStockItemId" TEXT,
    CONSTRAINT "RelocationLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RelocationRequest_refNumber_key" ON "RelocationRequest"("refNumber");
CREATE INDEX IF NOT EXISTS "RelocationRequest_warehouseId_status_idx" ON "RelocationRequest"("warehouseId", "status");
CREATE INDEX IF NOT EXISTS "RelocationRequest_status_idx" ON "RelocationRequest"("status");
CREATE INDEX IF NOT EXISTS "RelocationLine_requestId_idx" ON "RelocationLine"("requestId");
CREATE INDEX IF NOT EXISTS "RelocationLine_stockItemId_idx" ON "RelocationLine"("stockItemId");

DO $$ BEGIN
  ALTER TABLE "RelocationRequest" ADD CONSTRAINT "RelocationRequest_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RelocationRequest" ADD CONSTRAINT "RelocationRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RelocationRequest" ADD CONSTRAINT "RelocationRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RelocationRequest" ADD CONSTRAINT "RelocationRequest_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RelocationLine" ADD CONSTRAINT "RelocationLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RelocationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RelocationLine" ADD CONSTRAINT "RelocationLine_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RelocationLine" ADD CONSTRAINT "RelocationLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RelocationLine" ADD CONSTRAINT "RelocationLine_fromSlotId_fkey" FOREIGN KEY ("fromSlotId") REFERENCES "Slot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RelocationLine" ADD CONSTRAINT "RelocationLine_toSlotId_fkey" FOREIGN KEY ("toSlotId") REFERENCES "Slot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Permission catalogue (no role is granted anything here)
INSERT INTO "Permission" ("id", "code", "module", "action", "description") VALUES
  ('perm_relocation_request', 'relocation.request', 'relocation', 'request', 'Create relocation requests and confirm approved moves'),
  ('perm_relocation_approve', 'relocation.approve', 'relocation', 'approve', 'Approve or reject relocation requests')
ON CONFLICT ("code") DO NOTHING;

COMMIT;
