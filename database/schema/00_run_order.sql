-- =============================================================================
-- FILE: 00_run_order.sql
-- PURPOSE: Master execution script — run all DDL files in dependency order.
--          Execute as: psql -U wms_owner -d wms_db -f 00_run_order.sql
-- =============================================================================

-- Step 1: Extensions, types, domains, enums
\i 00_extensions_and_types.sql

-- Step 2: RBAC (users, roles, permissions) — required by almost everything
\i 01_rbac.sql

-- Step 3: Physical warehouse hierarchy
\i 02_warehouse_hierarchy.sql

-- Step 4: Master data (products, brands, vendors, barcodes)
\i 03_master_data.sql

-- Step 5: Inventory ledger (lots, balance, transactions, partitions)
\i 04_inventory_ledger.sql

-- Step 6: Serial and lot tracking
\i 05_serial_lot_tracking.sql

-- Step 7: Goods receiving (GRN)
\i 06_receiving.sql

-- Step 8: Approval workflow engine
\i 07_approval_workflow_engine.sql

-- Step 9: Withdrawal / stock request workflow
\i 08_request_workflow.sql

-- Step 10: Picking workflow
\i 09_picking_workflow.sql

-- Step 11: Packing workflow
\i 10_packing_workflow.sql

-- Step 12: Shipment workflow
\i 11_shipment_workflow.sql

-- Step 13: RTV workflow
\i 12_rtv_workflow.sql

-- Step 14: RMA workflow (resolves circular FK with withdrawal_requests)
\i 13_rma_workflow.sql

-- Step 15: Audit logging (partitioned, triggers on all major tables)
\i 14_audit_logging.sql

-- Step 16: Legacy compatibility tables (stock_items, goods_receiving)
\i 15_stock_items_compat.sql

-- Step 17: Supplemental indexes and optimization settings
\i 16_indexes_and_optimization.sql

-- Step 18: Cross-table constraints and consistency rules
\i 17_constraints_and_consistency.sql

-- Verify: count all tables
SELECT
    schemaname,
    COUNT(*) AS table_count
FROM pg_tables
WHERE schemaname = 'public'
GROUP BY schemaname;
