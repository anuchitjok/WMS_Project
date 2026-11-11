-- 35_layout_meters_per_unit.sql
--
-- PR5 / F6: racks dragged in the 3D view are saved on the Floor Plan in metres.
--
--   "metersPerUnit" : how many metres one Floor Plan unit is.
--                     New plans saved from 3D use 1 (1 unit = 1 m).
--                     An older plan gets the factor the 3D view already used for
--                     it, on its first 3D save. Its objects are not rewritten.
--                     NULL = not recorded yet (3D keeps its old fitting rule).
--   "floorOriginX/Z": where the warehouse floor's top-left corner sits on the
--                     plan, in metres, so the floor does not move when racks move.
--
-- Additive, nullable, safe to run twice. No existing data is changed.
-- ORDER: run this BEFORE deploying the API that reads these columns.

BEGIN;

ALTER TABLE "WarehouseLayout" ADD COLUMN IF NOT EXISTS "metersPerUnit" DOUBLE PRECISION;
ALTER TABLE "WarehouseLayout" ADD COLUMN IF NOT EXISTS "floorOriginX"  DOUBLE PRECISION;
ALTER TABLE "WarehouseLayout" ADD COLUMN IF NOT EXISTS "floorOriginZ"  DOUBLE PRECISION;

COMMIT;
