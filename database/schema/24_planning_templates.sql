-- ═══════════════════════════════════════════════════════════════════════════
-- 24_planning_templates.sql
-- Project Planning — company-confirmed templates (Oct 2026)
--
-- ADDITIVE and IDEMPOTENT. Safe to run more than once. Run AFTER 23.
--   • New table "PlanningTemplate" (empty — no template or number is seeded;
--     templates are saved from calculated scenarios and confirmed in the app
--     by a second person with planning.approve).
--   • PlanningProject."companyTemplateId" (new nullable column; existing
--     projects get NULL and behave exactly as before).
-- No row is modified or deleted; no permission or role grant changes.
--
-- Apply on production BEFORE merging the backend that uses it (on this repo
-- merging to master deploys immediately).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS "PlanningTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectType" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "basis" TEXT,
    "content" TEXT NOT NULL,
    "sourceProjectId" TEXT,
    "sourceScenarioId" TEXT,
    "sourceRunId" TEXT,
    "replacesId" TEXT,
    "createdById" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "retiredById" TEXT,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PlanningTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlanningTemplate_code_key" ON "PlanningTemplate"("code");
CREATE INDEX IF NOT EXISTS "PlanningTemplate_status_idx" ON "PlanningTemplate"("status");

ALTER TABLE "PlanningProject" ADD COLUMN IF NOT EXISTS "companyTemplateId" TEXT;

COMMIT;

-- ── Verification (read-only) ───────────────────────────────────────────────
-- SELECT
--   (SELECT count(*) FROM information_schema.tables  WHERE table_name = 'PlanningTemplate') AS template_table,
--   (SELECT count(*) FROM information_schema.columns WHERE table_name = 'PlanningProject' AND column_name = 'companyTemplateId') AS project_column,
--   (SELECT count(*) FROM "PlanningTemplate") AS templates;
-- Expected: 1 · 1 · 0
