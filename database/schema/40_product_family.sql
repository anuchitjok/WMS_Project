-- 40_product_family.sql
--
-- MDM-003 + MDM-004: a master for the groups products belong to.
--
--   "ProductFamily"          : code (PF-0001), name, an optional parent so a
--                              group can sit inside a wider one, and notes.
--   "Product.productFamilyId": the group a product belongs to, or NULL.
--
-- Why a table and not the free-text "Product.category" we have today: a typed
-- group can be renamed in one place, counted, and chosen from a list, so two
-- people cannot spell the same group two ways. The old column is left exactly
-- as it is — nothing reads less than it did, and no row is rewritten. Moving
-- what is in it into families is a separate, deliberate job for the owner.
--
-- Additive and idempotent. Every product starts with productFamilyId NULL,
-- which means "not grouped yet" — the way the catalogue works today.
--
-- ORDER: run this BEFORE deploying the API that reads these tables.
-- Rollback: database/rollback/40_product_family_rollback.sql (drops the table
-- and the column; products are untouched apart from losing the link).

BEGIN;

CREATE TABLE IF NOT EXISTS "ProductFamily" (
  "id"          TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "parentId"    TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductFamily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductFamily_code_key" ON "ProductFamily"("code");
CREATE INDEX IF NOT EXISTS "ProductFamily_parentId_idx" ON "ProductFamily"("parentId");

DO $$
BEGIN
  -- A group inside a group: self-reference, and a parent can only be removed
  -- once nothing points at it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductFamily_parentId_fkey') THEN
    ALTER TABLE "ProductFamily" ADD CONSTRAINT "ProductFamily_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "ProductFamily"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "productFamilyId" TEXT;
CREATE INDEX IF NOT EXISTS "Product_productFamilyId_idx" ON "Product"("productFamilyId");

DO $$
BEGIN
  -- Retiring a family must never take products with it, so the link is cleared
  -- rather than the row refused.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_productFamilyId_fkey') THEN
    ALTER TABLE "Product" ADD CONSTRAINT "Product_productFamilyId_fkey"
      FOREIGN KEY ("productFamilyId") REFERENCES "ProductFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

COMMIT;

-- Check (expect 0 families and every product ungrouped):
--   SELECT count(*) FROM "ProductFamily";
--   SELECT count(*) FROM "Product" WHERE "productFamilyId" IS NOT NULL;
