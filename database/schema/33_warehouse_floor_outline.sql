-- 33_warehouse_floor_outline.sql
--
-- Adds an optional floor outline to Warehouse, so a warehouse can have a
-- non-rectangular floor (L / U / T shape).
--
-- Shape of the JSON (checked by the API, not by the DB):
--   { "version": 1, "unit": "m", "shape": "RECT"|"L"|"U"|"T"|"CUSTOM",
--     "points": [[x, z], ...], "params": {...} }
-- NULL = a plain rectangle from lengthCm × widthCm (all existing warehouses).
--
-- Additive and safe to run twice. No existing data is changed.
-- ORDER: run this BEFORE deploying the API that reads "floorOutline".

BEGIN;

ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "floorOutline" JSONB;

COMMIT;
