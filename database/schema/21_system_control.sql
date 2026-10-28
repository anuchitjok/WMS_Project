-- ═══════════════════════════════════════════════════════════════════════════
-- 21_system_control.sql
-- System control & security remediation (Oct 2026)
--
-- ADDITIVE and IDEMPOTENT: only ADD COLUMN / CREATE ... IF NOT EXISTS and
-- INSERT ... ON CONFLICT DO NOTHING. Nothing is dropped, renamed or rewritten,
-- and no existing row is modified. Safe to run more than once.
--
-- Matches backend/prisma/schema.prisma at this change. Apply on STAGING first
-- (see docs/SYSTEM_CONTROL.md → "Deployment"). Do NOT use `prisma db push`
-- against shared databases.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Pre-check for the fulfillment guard rail (section 6) ────────────────
-- The unique index fails if duplicate active tasks already exist. Abort with a
-- clear message instead of half-applying.
DO $$
DECLARE dup INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup FROM (
    SELECT "requestId" FROM "FulfillmentTask"
    WHERE status::text NOT IN ('CANCELLED', 'RETURNED')
    GROUP BY "requestId" HAVING COUNT(*) > 1
  ) d;
  IF dup > 0 THEN
    RAISE EXCEPTION 'Found % request(s) with more than one active FulfillmentTask — resolve them before applying 21_system_control.sql', dup;
  END IF;
END $$;

-- ── 1. Cycle-count conflict tracking (count-line stock lock) ───────────────
ALTER TABLE "CycleCountLine" ADD COLUMN IF NOT EXISTS "conflictReason" TEXT;
ALTER TABLE "CycleCountLine" ADD COLUMN IF NOT EXISTS "excludedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "CycleCountLine_stockItemId_idx" ON "CycleCountLine"("stockItemId");

-- ── 2. Reason codes on documents (nullable: legacy rows keep free text) ────
ALTER TABLE "StockAdjustment" ADD COLUMN IF NOT EXISTS "reasonCode" TEXT;
ALTER TABLE "ScrapCase" ADD COLUMN IF NOT EXISTS "reasonCode" TEXT;

-- ── 3. Master data tables ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ReasonCode" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReasonCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ReasonCode_category_isActive_idx" ON "ReasonCode"("category", "isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "ReasonCode_category_code_key" ON "ReasonCode"("category", "code");

CREATE TABLE IF NOT EXISTS "Department" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Department_code_key" ON "Department"("code");

CREATE TABLE IF NOT EXISTS "UnitOfMeasure" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UnitOfMeasure_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UnitOfMeasure_code_key" ON "UnitOfMeasure"("code");

-- ── 4. Audit archive (manual retention job; nothing is deleted outright) ──
CREATE TABLE IF NOT EXISTS "AuditLogArchive" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "detail" TEXT,
    "correlationId" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedById" TEXT,
    CONSTRAINT "AuditLogArchive_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AuditLogArchive_createdAt_idx" ON "AuditLogArchive"("createdAt");
CREATE INDEX IF NOT EXISTS "AuditLogArchive_entityType_entityId_idx" ON "AuditLogArchive"("entityType", "entityId");

-- ── 5. Data migration: seed master data from what is already in use ───────
-- Adjustment reasons: the values documented on StockAdjustment.reason.
-- CYCLE_COUNT is a system code (written by cycle-count approval).
INSERT INTO "ReasonCode" ("id", "category", "code", "description", "isActive", "isSystem", "updatedAt") VALUES
  ('rc_adj_cycle_count', 'ADJUSTMENT', 'CYCLE_COUNT', 'Cycle count variance', true, true,  CURRENT_TIMESTAMP),
  ('rc_adj_found_stock', 'ADJUSTMENT', 'FOUND_STOCK', 'Found stock',          true, false, CURRENT_TIMESTAMP),
  ('rc_adj_damage',      'ADJUSTMENT', 'DAMAGE',      'Damage',               true, false, CURRENT_TIMESTAMP),
  ('rc_adj_loss',        'ADJUSTMENT', 'LOSS',        'Loss',                 true, false, CURRENT_TIMESTAMP),
  ('rc_adj_correction',  'ADJUSTMENT', 'CORRECTION',  'Data correction',      true, false, CURRENT_TIMESTAMP)
ON CONFLICT ("category", "code") DO NOTHING;
-- DOA and SCRAP: no reason list is defined in the requirements, so none is
-- seeded. Selection becomes mandatory for a category once an administrator
-- adds its first active code.

-- Departments: every value already used on users or withdrawal requests, kept
-- verbatim as the code so existing records stay valid.
INSERT INTO "Department" ("id", "code", "name", "isActive", "updatedAt")
SELECT 'dept_' || md5(d.v), d.v, d.v, true, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT btrim("department") AS v FROM "User" WHERE "department" IS NOT NULL AND btrim("department") <> ''
  UNION
  SELECT DISTINCT btrim("department") FROM "WithdrawalRequest" WHERE btrim("department") <> ''
) d
ON CONFLICT ("code") DO NOTHING;

-- Units of measure: every Product.unit already in use, kept verbatim.
INSERT INTO "UnitOfMeasure" ("id", "code", "name", "isActive", "updatedAt")
SELECT 'uom_' || md5(u.v), u.v, u.v, true, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT btrim("unit") AS v FROM "Product" WHERE "unit" IS NOT NULL AND btrim("unit") <> '') u
ON CONFLICT ("code") DO NOTHING;

-- ── 6. Fulfillment guard rails (schema-drift fix) ──────────────────────────
-- Already created by 18_fulfillment_guard_rails.sql on existing databases;
-- now also declared in schema.prisma. IF NOT EXISTS makes this a no-op there.
CREATE UNIQUE INDEX IF NOT EXISTS ux_fulfillment_task_request_active
  ON "FulfillmentTask" ("requestId")
  WHERE status NOT IN ('CANCELLED', 'RETURNED');
CREATE INDEX IF NOT EXISTS idx_ft_request_id ON "FulfillmentTask" ("requestId");
CREATE INDEX IF NOT EXISTS idx_ft_warehouse_status ON "FulfillmentTask" ("warehouseId", status);

COMMIT;

-- ── Verification (read-only) ───────────────────────────────────────────────
-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'FulfillmentTask';
-- SELECT category, code, "isActive" FROM "ReasonCode" ORDER BY category, code;
-- SELECT COUNT(*) FROM "Department"; SELECT COUNT(*) FROM "UnitOfMeasure";
