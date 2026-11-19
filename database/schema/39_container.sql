-- 39_container.sql
--
-- P7 / RQ17 + RQ18: a physical box, crate, tote or pallet with its own code and
-- QR label.
--
--   "Container"            : code (BOX-000123), type, status, where it is, and
--                            which container it sits inside.
--   "Container.splitFromId": the box this one was split out of — the paper
--                            trail RQ18 asks for.
--   "StockItem.containerId": the box a stock row is packed in. The slot columns
--                            on StockItem stay the single source of WHERE the
--                            stock is; a container move writes both together.
--
-- Additive and idempotent. No existing row changes: every StockItem starts with
-- containerId NULL, which means "not in a box" — the way the whole warehouse
-- works today.
--
-- ORDER: run this BEFORE deploying the API that reads these tables.
-- Rollback: database/rollback/39_container_rollback.sql (drops the table and the
-- column; stock rows are untouched apart from losing the link).

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContainerType') THEN
    CREATE TYPE "ContainerType" AS ENUM ('BOX', 'CARTON', 'CRATE', 'TOTE', 'PALLET');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContainerStatus') THEN
    CREATE TYPE "ContainerStatus" AS ENUM ('OPEN', 'CLOSED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "Container" (
  "id"                TEXT NOT NULL,
  "code"              TEXT NOT NULL,
  "name"              TEXT,
  "type"              "ContainerType"   NOT NULL DEFAULT 'BOX',
  "status"            "ContainerStatus" NOT NULL DEFAULT 'OPEN',
  "notes"             TEXT,
  "parentContainerId" TEXT,
  "warehouseId"       TEXT,
  "rackId"            TEXT,
  "slotId"            TEXT,
  "splitFromId"       TEXT,
  "isDeleted"         BOOLEAN NOT NULL DEFAULT false,
  "deletedAt"         TIMESTAMP(3),
  "deletedBy"         TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Container_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Container_code_key"              ON "Container"("code");
CREATE INDEX        IF NOT EXISTS "Container_slotId_idx"            ON "Container"("slotId");
CREATE INDEX        IF NOT EXISTS "Container_parentContainerId_idx" ON "Container"("parentContainerId");
CREATE INDEX        IF NOT EXISTS "Container_warehouseId_idx"       ON "Container"("warehouseId");

-- Foreign keys, added one at a time so a re-run does not fail on an existing one.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Container_parentContainerId_fkey') THEN
    ALTER TABLE "Container" ADD CONSTRAINT "Container_parentContainerId_fkey"
      FOREIGN KEY ("parentContainerId") REFERENCES "Container"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Container_splitFromId_fkey') THEN
    ALTER TABLE "Container" ADD CONSTRAINT "Container_splitFromId_fkey"
      FOREIGN KEY ("splitFromId") REFERENCES "Container"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Container_warehouseId_fkey') THEN
    ALTER TABLE "Container" ADD CONSTRAINT "Container_warehouseId_fkey"
      FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Container_rackId_fkey') THEN
    ALTER TABLE "Container" ADD CONSTRAINT "Container_rackId_fkey"
      FOREIGN KEY ("rackId") REFERENCES "Rack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Container_slotId_fkey') THEN
    ALTER TABLE "Container" ADD CONSTRAINT "Container_slotId_fkey"
      FOREIGN KEY ("slotId") REFERENCES "Slot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

ALTER TABLE "StockItem" ADD COLUMN IF NOT EXISTS "containerId" TEXT;
CREATE INDEX IF NOT EXISTS "StockItem_containerId_idx" ON "StockItem"("containerId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockItem_containerId_fkey') THEN
    ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_containerId_fkey"
      FOREIGN KEY ("containerId") REFERENCES "Container"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

COMMIT;

-- Check (expect 0 containers and every stock row unpacked):
--   SELECT count(*) FROM "Container";
--   SELECT count(*) FROM "StockItem" WHERE "containerId" IS NOT NULL;
