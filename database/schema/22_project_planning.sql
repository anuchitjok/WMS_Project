-- ═══════════════════════════════════════════════════════════════════════════
-- 22_project_planning.sql
-- Project Planning & Resource Calculator (Oct 2026)
--
-- ADDITIVE and IDEMPOTENT: three NEW tables, their indexes and foreign keys
-- between themselves, plus four permission codes added to the catalogue.
-- No existing table is altered; no existing row is modified or deleted; no
-- role is granted anything (admins grant planning.* in Roles & Permissions —
-- existing codes warehouse.manage / report.read / product.manage already work).
-- Safe to run more than once.
--
-- Matches backend/prisma/schema.prisma at this change. Apply on STAGING first,
-- then on production BEFORE the backend that uses it is deployed (on this repo
-- merging to master deploys immediately). Do NOT use `prisma db push` against
-- shared databases.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS "PlanningProject" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectType" TEXT NOT NULL,
    "description" TEXT,
    "customer" TEXT,
    "department" TEXT,
    "productId" TEXT,
    "scope" TEXT,
    "warehouseId" TEXT NOT NULL,
    "workLocation" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "ownerId" TEXT,
    "teams" TEXT,
    "plannedStart" TIMESTAMP(3) NOT NULL,
    "targetEnd" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "planStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "approvedRunId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PlanningProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PlanningScenario" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isBaseline" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "inputs" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PlanningScenario_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PlanningRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "runNumber" INTEGER NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "inputHash" TEXT NOT NULL,
    "inputSnapshot" TEXT NOT NULL,
    "dataSnapshot" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "overallStatus" TEXT NOT NULL,
    "flags" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanningRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlanningProject_code_key" ON "PlanningProject"("code");
CREATE INDEX IF NOT EXISTS "PlanningProject_warehouseId_idx" ON "PlanningProject"("warehouseId");
CREATE INDEX IF NOT EXISTS "PlanningProject_planStatus_idx" ON "PlanningProject"("planStatus");
CREATE INDEX IF NOT EXISTS "PlanningScenario_projectId_idx" ON "PlanningScenario"("projectId");
CREATE INDEX IF NOT EXISTS "PlanningRun_projectId_idx" ON "PlanningRun"("projectId");
CREATE UNIQUE INDEX IF NOT EXISTS "PlanningRun_scenarioId_runNumber_key" ON "PlanningRun"("scenarioId", "runNumber");

-- Foreign keys only between the new planning tables (never to operational tables).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlanningScenario_projectId_fkey') THEN
    ALTER TABLE "PlanningScenario" ADD CONSTRAINT "PlanningScenario_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "PlanningProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlanningRun_projectId_fkey') THEN
    ALTER TABLE "PlanningRun" ADD CONSTRAINT "PlanningRun_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "PlanningProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlanningRun_scenarioId_fkey') THEN
    ALTER TABLE "PlanningRun" ADD CONSTRAINT "PlanningRun_scenarioId_fkey"
      FOREIGN KEY ("scenarioId") REFERENCES "PlanningScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Permission catalogue entries (granted to no role by this script).
INSERT INTO "Permission" ("id", "code", "module", "action", "description") VALUES
  ('perm_planning_read',    'planning.read',    'planning', 'read',    'View project plans and calculation results'),
  ('perm_planning_manage',  'planning.manage',  'planning', 'manage',  'Create projects, edit scenarios, run calculations, submit plans'),
  ('perm_planning_approve', 'planning.approve', 'planning', 'approve', 'Approve or reject a submitted project plan (planning only)'),
  ('perm_planning_cost',    'planning.cost',    'planning', 'cost',    'See unit costs, labour rates and project cost estimates')
ON CONFLICT ("code") DO NOTHING;

COMMIT;

-- ── Verification (read-only) ───────────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'Planning%';
-- SELECT code FROM "Permission" WHERE module = 'planning' ORDER BY code;
