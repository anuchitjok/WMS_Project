-- Rollback for 29_warehouse_space.sql
--
-- ORDER: first redeploy the previous API (it does not use these columns), then run this.
-- WARNING: discards warehouse/rack sizes and rack type templates entered since
-- migration 29. Stock, slots and racks themselves are untouched. Export first if needed:
--   COPY (SELECT "id","code","lengthCm","widthCm","heightCm","usableAreaPct" FROM "Warehouse") TO STDOUT WITH CSV HEADER;
--   COPY (SELECT * FROM "RackTypeMaster") TO STDOUT WITH CSV HEADER;

BEGIN;

ALTER TABLE "Rack" DROP CONSTRAINT IF EXISTS "Rack_rackTypeId_fkey";
ALTER TABLE "Rack" DROP COLUMN IF EXISTS "rackTypeId";
ALTER TABLE "Rack" DROP COLUMN IF EXISTS "lengthCm";
ALTER TABLE "Rack" DROP COLUMN IF EXISTS "widthCm";
ALTER TABLE "Rack" DROP COLUMN IF EXISTS "heightCm";

DROP TABLE IF EXISTS "RackTypeMaster";

ALTER TABLE "Warehouse" DROP COLUMN IF EXISTS "lengthCm";
ALTER TABLE "Warehouse" DROP COLUMN IF EXISTS "widthCm";
ALTER TABLE "Warehouse" DROP COLUMN IF EXISTS "heightCm";
ALTER TABLE "Warehouse" DROP COLUMN IF EXISTS "usableAreaPct";

COMMIT;
