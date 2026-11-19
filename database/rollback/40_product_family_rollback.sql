-- Rollback for 40_product_family.sql.
--
-- Drops the family link and the table. Products keep every other field; they
-- only lose which group they were put in, and "Product.category" — which this
-- migration never touched — still reads exactly as before.

BEGIN;

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_productFamilyId_fkey";
DROP INDEX IF EXISTS "Product_productFamilyId_idx";
ALTER TABLE "Product" DROP COLUMN IF EXISTS "productFamilyId";

DROP TABLE IF EXISTS "ProductFamily";

COMMIT;
