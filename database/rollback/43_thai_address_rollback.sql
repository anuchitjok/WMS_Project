-- Rollback for 43_thai_address.sql
--
-- Drops the Thai Post address book. Nothing else refers to these tables, and
-- the data can be loaded again from the same migration, so nothing of the
-- warehouse's own is lost.

DROP TABLE IF EXISTS "ThaiTambon";
DROP TABLE IF EXISTS "ThaiDistrict";
DROP TABLE IF EXISTS "ThaiProvince";
