-- Rollback for 42_shipment_logistics.sql
--
-- Drops the three outbound logistics fields. Anything typed into them is lost;
-- nothing else on a shipment is touched.

ALTER TABLE "Shipment" DROP COLUMN IF EXISTS "awbNumber";
ALTER TABLE "Shipment" DROP COLUMN IF EXISTS "warehouseNumber";
ALTER TABLE "Shipment" DROP COLUMN IF EXISTS "carrierBrand";
