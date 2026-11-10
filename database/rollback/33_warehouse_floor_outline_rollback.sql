-- Rollback for 33_warehouse_floor_outline.sql
--
-- ORDER: first redeploy the previous API (it does not use the column), then run this.
-- WARNING: discards every saved floor shape; those warehouses fall back to a rectangle.
-- Export first if needed:
--   COPY (SELECT "id","code","floorOutline" FROM "Warehouse" WHERE "floorOutline" IS NOT NULL) TO STDOUT WITH CSV HEADER;

BEGIN;

ALTER TABLE "Warehouse" DROP COLUMN IF EXISTS "floorOutline";

COMMIT;
