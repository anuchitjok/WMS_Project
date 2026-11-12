-- Rollback for 35_layout_meters_per_unit.sql
--
-- ORDER: first redeploy the previous API (it does not read these columns), then run this.
-- Rack drawings saved from 3D stay on the Floor Plan as ordinary RACK objects;
-- only the scale and floor anchor are dropped, so 3D falls back to its old fitting rule.

BEGIN;

ALTER TABLE "WarehouseLayout" DROP COLUMN IF EXISTS "floorOriginZ";
ALTER TABLE "WarehouseLayout" DROP COLUMN IF EXISTS "floorOriginX";
ALTER TABLE "WarehouseLayout" DROP COLUMN IF EXISTS "metersPerUnit";

COMMIT;
