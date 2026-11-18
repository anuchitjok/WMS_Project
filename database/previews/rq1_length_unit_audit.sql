-- ===========================================================================
-- rq1_length_unit_audit.sql - READ ONLY. Nothing is written, nothing changed.
--
-- RQ1 sets METRES as the unit people see. The database is NOT converted: every
-- dimension column stays centimetres (lengthCm, widthCm, heightCm) and the screen
-- divides by 100 on the way out. 4000 cm on file is shown as 40 m - the same
-- physical warehouse as before.
--
-- That only holds if what is already stored really is centimetres. This script
-- looks for rows that would mean someone once typed metres into a centimetre
-- column: a warehouse under 1 m, a rack under 10 cm, a slot or product box under
-- 1 cm. Every query should return NO ROWS. Anything it returns must be looked at
-- by hand before the metre display goes live, because those rows will read as
-- absurdly small on screen.
--
-- Run it on production read-only:
--     BEGIN; SET TRANSACTION READ ONLY;  \i rq1_length_unit_audit.sql  ROLLBACK;
-- or paste the queries into the Supabase SQL editor.
-- ===========================================================================

-- 1. Warehouses that look like metres in a centimetre column (under 100 cm).
SELECT 'warehouse' AS kind, code, name, "lengthCm", "widthCm", "heightCm"
FROM "Warehouse"
WHERE "isDeleted" = false
  AND (("lengthCm" IS NOT NULL AND "lengthCm" < 100)
    OR ("widthCm"  IS NOT NULL AND "widthCm"  < 100)
    OR ("heightCm" IS NOT NULL AND "heightCm" < 100))
ORDER BY code;

-- 2. Racks under 10 cm on any side.
SELECT 'rack' AS kind, code, name, "lengthCm", "widthCm", "heightCm"
FROM "Rack"
WHERE "isDeleted" = false
  AND (("lengthCm" IS NOT NULL AND "lengthCm" < 10)
    OR ("widthCm"  IS NOT NULL AND "widthCm"  < 10)
    OR ("heightCm" IS NOT NULL AND "heightCm" < 10))
ORDER BY code;

-- 3. Rack types under 10 cm on any side (they fill in a rack's missing size).
SELECT 'rackType' AS kind, code, name, "lengthCm", "widthCm", "heightCm"
FROM "RackTypeMaster"
WHERE "lengthCm" < 10 OR "widthCm" < 10 OR "heightCm" < 10
ORDER BY code;

-- 4. Slots under 1 cm on any side.
SELECT 'slot' AS kind, code, "lengthCm", "widthCm", "heightCm"
FROM "Slot"
WHERE "isDeleted" = false
  AND (("lengthCm" IS NOT NULL AND "lengthCm" < 1)
    OR ("widthCm"  IS NOT NULL AND "widthCm"  < 1)
    OR ("heightCm" IS NOT NULL AND "heightCm" < 1))
ORDER BY code;

-- 5. Product boxes under 1 cm on any side.
SELECT 'product' AS kind, code, name, "lengthCm", "widthCm", "heightCm"
FROM "Product"
WHERE (("lengthCm" IS NOT NULL AND "lengthCm" < 1)
    OR ("widthCm"  IS NOT NULL AND "widthCm"  < 1)
    OR ("heightCm" IS NOT NULL AND "heightCm" < 1))
ORDER BY code;

-- 6. The other direction: values so large they look like millimetres in a
--    centimetre column (a warehouse over 1 km, a rack over 100 m).
SELECT 'warehouse-too-big' AS kind, code, name, "lengthCm", "widthCm", "heightCm"
FROM "Warehouse"
WHERE "isDeleted" = false AND ("lengthCm" > 100000 OR "widthCm" > 100000 OR "heightCm" > 10000)
UNION ALL
SELECT 'rack-too-big', code, name, "lengthCm", "widthCm", "heightCm"
FROM "Rack"
WHERE "isDeleted" = false AND ("lengthCm" > 10000 OR "widthCm" > 10000 OR "heightCm" > 10000);

-- 7. Reference: the magnitudes actually in use, to eyeball the scale.
SELECT 'warehouse' AS kind, count(*) AS rows_with_size,
       min("lengthCm") AS min_length_cm, max("lengthCm") AS max_length_cm,
       round(avg("lengthCm")::numeric, 1) AS avg_length_cm
FROM "Warehouse" WHERE "isDeleted" = false AND "lengthCm" IS NOT NULL
UNION ALL
SELECT 'rack', count(*), min("lengthCm"), max("lengthCm"), round(avg("lengthCm")::numeric, 1)
FROM "Rack" WHERE "isDeleted" = false AND "lengthCm" IS NOT NULL
UNION ALL
SELECT 'slot', count(*), min("lengthCm"), max("lengthCm"), round(avg("lengthCm")::numeric, 1)
FROM "Slot" WHERE "isDeleted" = false AND "lengthCm" IS NOT NULL
UNION ALL
SELECT 'product', count(*), min("lengthCm"), max("lengthCm"), round(avg("lengthCm")::numeric, 1)
FROM "Product" WHERE "lengthCm" IS NOT NULL;
