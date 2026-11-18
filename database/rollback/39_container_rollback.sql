-- 39_container_rollback.sql
--
-- Undoes 39_container.sql.
--
-- Dropping the table loses every box and the link from stock to its box. The
-- stock rows themselves are NOT touched: their slot columns always carried the
-- location, so inventory stays exactly where it is. Audit rows about containers
-- stay in AuditLog.
--
-- Run only after the API that reads these tables has been rolled back.

BEGIN;

ALTER TABLE "StockItem" DROP CONSTRAINT IF EXISTS "StockItem_containerId_fkey";
DROP INDEX IF EXISTS "StockItem_containerId_idx";
ALTER TABLE "StockItem" DROP COLUMN IF EXISTS "containerId";

DROP TABLE IF EXISTS "Container";
DROP TYPE  IF EXISTS "ContainerStatus";
DROP TYPE  IF EXISTS "ContainerType";

COMMIT;
