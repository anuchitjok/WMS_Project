-- ═══════════════════════════════════════════════════════════════════════════
-- 26_warranty_mrp.sql
-- Warranty rules + material requirements planning (Oct 2026)
--
-- ADDITIVE and IDEMPOTENT: only CREATE TYPE/TABLE/INDEX (guarded) and
-- INSERT ... ON CONFLICT DO NOTHING. No existing table, column or row is
-- changed. Safe to run more than once.
--
-- Seeds NO warranty rule, NO planning parameter, NO supplier price and NO
-- role grant: those are business decisions (docs/WARRANTY_MRP.md, section 9).
-- New permission codes are added to the catalogue only; SUPER_ADMIN has them
-- implicitly, other roles get them through Roles & Permissions.
--
-- Matches backend/prisma/schema.prisma at this change. Apply on STAGING first.
-- Do NOT use `prisma db push` against shared databases.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "WarrantyScope" AS ENUM ('SERIAL', 'PRODUCT', 'PRODUCT_MODEL', 'CATEGORY', 'BRAND', 'VENDOR', 'PRODUCT_TYPE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "WarrantyStartBasis" AS ENUM ('RECEIPT_DATE', 'GOODS_ISSUE_DATE', 'INVOICE_DATE', 'INSTALLATION_DATE', 'ACTIVATION_DATE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "WarrantyDurationUnit" AS ENUM ('DAYS', 'MONTHS', 'YEARS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "WarrantyRuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'SUPERSEDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ReplenishmentMethod" AS ENUM ('PURCHASE', 'TRANSFER', 'NONE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "LotSizingPolicy" AS ENUM ('LOT_FOR_LOT', 'MIN_MAX');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "MaterialCriticality" AS ENUM ('CRITICAL', 'HIGH', 'NORMAL', 'LOW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "InboundSupplyStatus" AS ENUM ('OPEN', 'PARTIAL', 'CLOSED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ForecastOverrideStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "WarrantyRule" (
    "id" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "warrantyType" TEXT NOT NULL,
    "scopeType" "WarrantyScope" NOT NULL,
    "scopeValue" TEXT NOT NULL,
    "startBasis" "WarrantyStartBasis" NOT NULL,
    "durationValue" INTEGER NOT NULL,
    "durationUnit" "WarrantyDurationUnit" NOT NULL,
    "terms" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "WarrantyRuleStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "supersedesId" TEXT,
    "changeNote" TEXT,
    "createdById" TEXT,
    "activatedById" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarrantyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WarrantyDateRecord" (
    "id" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "dateType" "WarrantyStartBasis" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "source" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarrantyDateRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WarrantyCheck" (
    "id" TEXT NOT NULL,
    "serialNumber" TEXT,
    "stockItemId" TEXT,
    "productId" TEXT,
    "ruleId" TEXT,
    "ruleCode" TEXT,
    "ruleVersion" INTEGER,
    "status" TEXT NOT NULL,
    "startBasis" TEXT,
    "startDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "asOf" TIMESTAMP(3) NOT NULL,
    "explanation" JSONB NOT NULL,
    "context" TEXT NOT NULL DEFAULT 'LOOKUP',
    "contextRef" TEXT,
    "checkedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarrantyCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MaterialPlanningParam" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "planningEnabled" BOOLEAN NOT NULL DEFAULT true,
    "replenishmentMethod" "ReplenishmentMethod" NOT NULL DEFAULT 'PURCHASE',
    "lotSizing" "LotSizingPolicy" NOT NULL DEFAULT 'LOT_FOR_LOT',
    "leadTimeDays" INTEGER,
    "leadTimeVariabilityDays" INTEGER,
    "moq" DOUBLE PRECISION,
    "orderMultiple" DOUBLE PRECISION,
    "minStock" DOUBLE PRECISION,
    "maxStock" DOUBLE PRECISION,
    "safetyStock" DOUBLE PRECISION,
    "reorderPoint" DOUBLE PRECISION,
    "targetDaysOfSupply" INTEGER,
    "unitCost" DOUBLE PRECISION,
    "currency" TEXT,
    "costBasis" TEXT,
    "criticality" "MaterialCriticality",
    "forecastMethod" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialPlanningParam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MaterialSupplier" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "supplierPartNumber" TEXT,
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "isApproved" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "leadTimeDays" INTEGER,
    "moq" DOUBLE PRECISION,
    "orderMultiple" DOUBLE PRECISION,
    "unitPrice" DOUBLE PRECISION,
    "currency" TEXT,
    "priceSource" TEXT,
    "priceValidFrom" TIMESTAMP(3),
    "priceValidTo" TIMESTAMP(3),
    "purchaseUom" TEXT,
    "uomConversion" DOUBLE PRECISION,
    "notes" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "InboundSupplyLine" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "lineNumber" TEXT NOT NULL,
    "vendorId" TEXT,
    "vendorName" TEXT,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "orderedQty" DOUBLE PRECISION NOT NULL,
    "receivedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cancelledQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "uom" TEXT,
    "unitCost" DOUBLE PRECISION,
    "currency" TEXT,
    "orderDate" TIMESTAMP(3),
    "expectedDate" TIMESTAMP(3),
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "lastReceiptDate" TIMESTAMP(3),
    "status" "InboundSupplyStatus" NOT NULL DEFAULT 'OPEN',
    "source" TEXT NOT NULL DEFAULT 'IMPORT',
    "importBatchId" TEXT,
    "notes" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundSupplyLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ForecastOverride" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "periodType" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "mode" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "category" TEXT,
    "statisticalQty" DOUBLE PRECISION,
    "statisticalMethod" TEXT,
    "status" "ForecastOverrideStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MrpConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MrpConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MrpRun" (
    "id" TEXT NOT NULL,
    "runNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "asOf" TIMESTAMP(3) NOT NULL,
    "warehouseId" TEXT,
    "scope" JSONB NOT NULL,
    "params" JSONB NOT NULL,
    "configSnapshot" JSONB NOT NULL,
    "configVersion" INTEGER,
    "inputHash" TEXT NOT NULL,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB NOT NULL,
    "warnings" JSONB,
    "note" TEXT,
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "MrpRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MrpRunLine" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "sku" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "planningStatus" TEXT NOT NULL,
    "urgency" INTEGER NOT NULL DEFAULT 0,
    "forecastMethod" TEXT,
    "forecastQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgMonthlyUsage" DOUBLE PRECISION,
    "movementClass" TEXT,
    "onHand" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "available" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "allocated" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "blocked" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "safetyStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "openPoQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "nextInboundDate" TIMESTAMP(3),
    "grossReq" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netReq" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "projectedShortage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "suggestedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "suggestedOrderDate" TIMESTAMP(3),
    "requiredDate" TIMESTAMP(3),
    "leadTimeDays" INTEGER,
    "moq" DOUBLE PRECISION,
    "orderMultiple" DOUBLE PRECISION,
    "vendorId" TEXT,
    "vendorName" TEXT,
    "unitCost" DOUBLE PRECISION,
    "currency" TEXT,
    "costSource" TEXT,
    "estCost" DOUBLE PRECISION,
    "exceptionCodes" TEXT[],
    "detail" JSONB NOT NULL,

    CONSTRAINT "MrpRunLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WarrantyRule_status_scopeType_idx" ON "WarrantyRule"("status", "scopeType");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WarrantyRule_ruleCode_version_key" ON "WarrantyRule"("ruleCode", "version");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WarrantyDateRecord_serialNumber_dateType_key" ON "WarrantyDateRecord"("serialNumber", "dateType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WarrantyCheck_serialNumber_idx" ON "WarrantyCheck"("serialNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WarrantyCheck_stockItemId_idx" ON "WarrantyCheck"("stockItemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WarrantyCheck_createdAt_idx" ON "WarrantyCheck"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MaterialPlanningParam_productId_idx" ON "MaterialPlanningParam"("productId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MaterialSupplier_vendorId_idx" ON "MaterialSupplier"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MaterialSupplier_productId_vendorId_key" ON "MaterialSupplier"("productId", "vendorId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InboundSupplyLine_productId_status_idx" ON "InboundSupplyLine"("productId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "InboundSupplyLine_poNumber_lineNumber_key" ON "InboundSupplyLine"("poNumber", "lineNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ForecastOverride_productId_periodStart_idx" ON "ForecastOverride"("productId", "periodStart");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ForecastOverride_status_idx" ON "ForecastOverride"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MrpConfig_key_key" ON "MrpConfig"("key");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MrpRun_runNumber_key" ON "MrpRun"("runNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MrpRun_startedAt_idx" ON "MrpRun"("startedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MrpRunLine_runId_idx" ON "MrpRunLine"("runId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MrpRunLine_productId_idx" ON "MrpRunLine"("productId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MrpRunLine_runId_fkey') THEN
    ALTER TABLE "MrpRunLine" ADD CONSTRAINT "MrpRunLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MrpRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;


-- Permission catalogue (no role is granted anything here)
INSERT INTO "Permission" ("id", "code", "module", "action", "description") VALUES
  ('perm_mrp_read',              'mrp.read',              'mrp',      'read',              'View material plans, usage and inbound supply'),
  ('perm_mrp_parameters',        'mrp.parameters',        'mrp',      'parameters',        'Manage material planning parameters and approved suppliers'),
  ('perm_mrp_config',            'mrp.config',            'mrp',      'config',            'Configure forecasting methods, horizon and classification thresholds'),
  ('perm_mrp_forecast',          'mrp.forecast',          'mrp',      'forecast',          'Enter manual forecast adjustments'),
  ('perm_mrp_forecastApprove',   'mrp.forecastApprove',   'mrp',      'forecastApprove',   'Approve or reject manual forecast adjustments'),
  ('perm_mrp_run',               'mrp.run',               'mrp',      'run',               'Run MRP calculations'),
  ('perm_mrp_export',            'mrp.export',            'mrp',      'export',            'Export planning results'),
  ('perm_mrp_cost',              'mrp.cost',              'mrp',      'cost',              'See unit costs, prices and replenishment cost'),
  ('perm_mrp_supply',            'mrp.supply',            'mrp',      'supply',            'Import purchase-order lines (inbound supply)'),
  ('perm_warranty_read',         'warranty.read',         'warranty', 'read',              'Look up warranty status and history'),
  ('perm_warranty_manage',       'warranty.manage',       'warranty', 'manage',            'Manage warranty rules and warranty dates')
ON CONFLICT ("code") DO NOTHING;

COMMIT;
