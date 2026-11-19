-- 42_shipment_logistics.sql
--
-- LOG-001: the shipping details the checklist asks for, on the way OUT.
--
-- Goods receiving already keeps "awbNumber", "invoiceNumber" and "gswNumber",
-- so the inbound side was done. A shipment kept only "carrier" and
-- "trackingNumber", which cannot answer "which air waybill was it on?",
-- "which warehouse number did the carrier give us?" or "which carrier brand
-- carried it?" - the last one matters because "carrier" is typed free-text and
-- a company may trade under several brands.
--
--   "Shipment"."awbNumber"        air waybill for this shipment
--   "Shipment"."warehouseNumber"  the number the carrier gives the consignment
--   "Shipment"."carrierBrand"     the carrier's brand, kept apart from the
--                                 company in "carrier"
--
-- All three are nullable text with no default: every shipment already on file
-- keeps reading exactly as it does now. Additive and idempotent.

ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "awbNumber" TEXT;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "warehouseNumber" TEXT;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "carrierBrand" TEXT;

COMMENT ON COLUMN "Shipment"."warehouseNumber" IS
  'LOG-001: the number the carrier gives this consignment. Not the WMS warehouse code.';
COMMENT ON COLUMN "Shipment"."carrierBrand" IS
  'LOG-001: the carrier brand, kept apart from the carrier company in "carrier".';
