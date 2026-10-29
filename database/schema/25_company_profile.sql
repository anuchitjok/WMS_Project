-- ═══════════════════════════════════════════════════════════════════════════
-- 25_company_profile.sql
-- Company profile / branding for customer proposals (Oct 2026)
--
-- ADDITIVE and IDEMPOTENT. Safe to run more than once. Run AFTER 24.
--   • New table "CompanyProfile" (EMPTY — no company name, address or logo is
--     seeded; an administrator with settings.manage enters them in the app).
--     The logo is stored in the database (bytea, PNG/JPEG, max 1 MB) — no
--     external file storage is used.
--   • PlanningProject."proposal" (new nullable TEXT column for the proposal's
--     deliverables / assumptions / exclusions / terms; existing projects get NULL).
-- No row is modified or deleted; no permission or role grant changes
-- (editing uses the existing settings.manage permission).
--
-- Apply on production BEFORE merging the backend that uses it (on this repo
-- merging to master deploys immediately).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS "CompanyProfile" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "legalName" TEXT,
    "displayName" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "taxId" TEXT,
    "defaultTerms" TEXT,
    "logo" BYTEA,
    "logoMime" TEXT,
    "logoWidth" INTEGER,
    "logoHeight" INTEGER,
    "logoUpdatedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CompanyProfile_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PlanningProject" ADD COLUMN IF NOT EXISTS "proposal" TEXT;

COMMIT;

-- ── Verification (read-only) ───────────────────────────────────────────────
-- SELECT
--   (SELECT count(*) FROM information_schema.tables  WHERE table_name = 'CompanyProfile') AS profile_table,
--   (SELECT count(*) FROM information_schema.columns WHERE table_name = 'PlanningProject' AND column_name = 'proposal') AS proposal_col,
--   (SELECT count(*) FROM "CompanyProfile") AS profiles,
--   (SELECT count(*) FROM "PlanningProject" WHERE "proposal" IS NOT NULL) AS projects_with_proposal;
-- Expected: 1 · 1 · 0 · 0
