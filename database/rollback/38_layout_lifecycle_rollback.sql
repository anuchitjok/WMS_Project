-- 38_layout_lifecycle_rollback.sql
--
-- Undoes 38_layout_lifecycle.sql.
--
-- Dropping these columns throws away who approved which plan and when. The
-- approval chains themselves live in ApprovalInstance (entityType =
-- 'WarehouseLayout') and are NOT touched here, so the history of decisions
-- survives even after a rollback.
--
-- Run this only after the API that reads the columns has been rolled back.

BEGIN;

ALTER TABLE "WarehouseLayout" DROP COLUMN IF EXISTS "rejectedReason";
ALTER TABLE "WarehouseLayout" DROP COLUMN IF EXISTS "publishedById";
ALTER TABLE "WarehouseLayout" DROP COLUMN IF EXISTS "publishedAt";
ALTER TABLE "WarehouseLayout" DROP COLUMN IF EXISTS "submittedById";
ALTER TABLE "WarehouseLayout" DROP COLUMN IF EXISTS "submittedAt";
ALTER TABLE "WarehouseLayout" DROP COLUMN IF EXISTS "status";

-- The type is dropped last and only if nothing else uses it.
DROP TYPE IF EXISTS "LayoutStatus";

COMMIT;
