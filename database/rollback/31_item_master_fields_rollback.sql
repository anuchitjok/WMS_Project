-- Rollback for 31_item_master_fields.sql
--
-- ORDER: first redeploy the previous API (it does not use these columns), then run this.
-- WARNING: discards Part Type, Default Price, Created/Modified By, product box
-- sizes and receipt condition (New/Refurbish) entered since migration 31.
-- Export first if needed:
--   COPY (SELECT "id","code","partType","defaultPrice","createdById","updatedById","lengthCm","widthCm","heightCm" FROM "Product") TO STDOUT WITH CSV HEADER;
--   COPY (SELECT "id","itemCondition" FROM "GoodsReceivingItem" WHERE "itemCondition" IS NOT NULL) TO STDOUT WITH CSV HEADER;

BEGIN;

ALTER TABLE "Product" DROP COLUMN IF EXISTS "partType";
ALTER TABLE "Product" DROP COLUMN IF EXISTS "defaultPrice";
ALTER TABLE "Product" DROP COLUMN IF EXISTS "createdById";
ALTER TABLE "Product" DROP COLUMN IF EXISTS "updatedById";
ALTER TABLE "Product" DROP COLUMN IF EXISTS "lengthCm";
ALTER TABLE "Product" DROP COLUMN IF EXISTS "widthCm";
ALTER TABLE "Product" DROP COLUMN IF EXISTS "heightCm";

ALTER TABLE "GoodsReceivingItem" DROP COLUMN IF EXISTS "itemCondition";

COMMIT;
