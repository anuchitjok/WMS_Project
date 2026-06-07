-- =============================================================================
-- FILE: 16_indexes_and_optimization.sql
-- PURPOSE: Supplemental indexes, covering indexes, partial indexes, and
--          performance optimization structures beyond what each module defines.
--          Also documents the partitioning strategy and maintenance schedule.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Covering Indexes  (INCLUDE columns avoid heap fetches for common queries)
-- ---------------------------------------------------------------------------

-- Pick list query: "give me all pending tasks for warehouse X ordered by bin"
CREATE INDEX idx_ptask_pick_list
    ON pick_tasks (pick_order_id, status)
    INCLUDE (src_bin_id, product_id, qty_to_pick, qty_picked)
    WHERE status NOT IN ('picked', 'cancelled');

-- Inventory availability check (hottest read in the system)
CREATE INDEX idx_invbal_avail_lookup
    ON inventory_balance (product_id, warehouse_id, qty_available)
    INCLUDE (bin_id, lot_id, qty_on_hand, qty_reserved, uom_id)
    WHERE qty_available > 0;

-- Request status dashboard
CREATE INDEX idx_wr_dashboard
    ON withdrawal_requests (org_id, status, created_at DESC)
    INCLUDE (ref_number, requester_id, department, priority)
    WHERE deleted_at IS NULL;

-- Serial lookup by bin (for put-away scanning)
CREATE INDEX idx_serial_bin_product
    ON serial_numbers (current_bin_id, product_id)
    INCLUDE (serial_number, current_status, lot_id)
    WHERE current_bin_id IS NOT NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Partial Indexes  (only index rows in specific states — much smaller)
-- ---------------------------------------------------------------------------

-- Only pending approvals (most queries ignore decided rows)
CREATE INDEX idx_wf_appr_pending
    ON workflow_approvals (approver_id, due_at)
    WHERE decision = 'pending';

-- Only open workflow instances
CREATE INDEX idx_wf_inst_open
    ON workflow_instances (entity_type, entity_id)
    WHERE status = 'pending';

-- Only active (non-deleted, non-cancelled) pick orders
CREATE INDEX idx_po_active
    ON pick_orders (warehouse_id, status, priority, created_at)
    WHERE deleted_at IS NULL AND status NOT IN ('picked', 'cancelled');

-- Only serials in active movement states
CREATE INDEX idx_serial_active
    ON serial_numbers (product_id, current_status)
    WHERE current_status NOT IN ('consumed', 'closed', 'cancelled', 'shipped')
      AND deleted_at IS NULL;

-- RTV pending shipment
CREATE INDEX idx_rtv_pending_ship
    ON rtv_orders (vendor_id, status)
    WHERE status IN ('approved', 'pending_shipment')
      AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- BRIN Indexes  (very cheap; good for time-ordered append-only tables)
-- Useful for inventory_transactions and audit_logs since rows are nearly
-- inserted in txn_date / created_at order.
-- ---------------------------------------------------------------------------
CREATE INDEX idx_invtxn_brin ON inventory_transactions USING brin (txn_date)
    WITH (pages_per_range = 128);

CREATE INDEX idx_audit_brin  ON audit_logs USING brin (created_at)
    WITH (pages_per_range = 128);

-- ---------------------------------------------------------------------------
-- Partitioning Maintenance Schedule  (run via pg_cron or external scheduler)
-- ---------------------------------------------------------------------------

/*
PARTITION MANAGEMENT (run monthly, e.g., first day of month):

  -- Add next month's partitions 2 months in advance:
  SELECT wms_create_monthly_partitions(
      EXTRACT(YEAR FROM NOW())::INT,
      EXTRACT(YEAR FROM NOW() + INTERVAL '2 months')::INT
  );
  SELECT wms_create_audit_partitions(
      EXTRACT(YEAR FROM NOW())::INT,
      EXTRACT(YEAR FROM NOW() + INTERVAL '2 months')::INT
  );

PARTITION ARCHIVAL (after retention period, e.g., 13 months for transactions):

  -- Detach old partition:
  ALTER TABLE inventory_transactions DETACH PARTITION inventory_transactions_2023_01;

  -- Move to archive tablespace (cold storage):
  ALTER TABLE inventory_transactions_2023_01 SET TABLESPACE archive_ts;

  -- Or pg_dump the partition and drop:
  -- pg_dump -t inventory_transactions_2023_01 wms_db > archive_2023_01.sql
  -- DROP TABLE inventory_transactions_2023_01;

VACUUM / ANALYZE SCHEDULE:
  - autovacuum handles most tables automatically.
  - For inventory_balance (high UPDATE rate), tune:
      ALTER TABLE inventory_balance SET (
          autovacuum_vacuum_scale_factor = 0.01,
          autovacuum_analyze_scale_factor = 0.005
      );
  - Run VACUUM ANALYZE manually after large bulk loads (GRN, migration).
*/

-- ---------------------------------------------------------------------------
-- Statistics Tuning  (for query planner accuracy on skewed columns)
-- ---------------------------------------------------------------------------

-- status columns have few distinct values but queries are highly selective
ALTER TABLE withdrawal_requests
    ALTER COLUMN status SET STATISTICS 500;

ALTER TABLE pick_tasks
    ALTER COLUMN status SET STATISTICS 500;

ALTER TABLE inventory_transactions
    ALTER COLUMN txn_type SET STATISTICS 200;

-- product_id in inventory tables — very high cardinality, planner needs accuracy
ALTER TABLE inventory_balance
    ALTER COLUMN product_id SET STATISTICS 1000;

ALTER TABLE inventory_transactions
    ALTER COLUMN product_id SET STATISTICS 1000;

-- ---------------------------------------------------------------------------
-- Connection Pooling Recommendation
-- ---------------------------------------------------------------------------
/*
RECOMMENDED: PgBouncer in transaction-mode pooling.

  - Pool size per service = (CPU cores × 2) + disk spindles
    Example: 8-core server → 20 server connections
  - FastAPI SQLAlchemy pool_size = 10, max_overflow = 20
  - PgBouncer max_client_conn = 500

  pgbouncer.ini key settings:
    pool_mode = transaction
    max_client_conn = 500
    default_pool_size = 20
    reserve_pool_size = 5
    reserve_pool_timeout = 3
*/

-- ---------------------------------------------------------------------------
-- Table Storage Parameters for high-write tables
-- ---------------------------------------------------------------------------

ALTER TABLE inventory_transactions SET (
    autovacuum_vacuum_scale_factor   = 0,
    autovacuum_vacuum_threshold      = 10000,
    autovacuum_analyze_scale_factor  = 0,
    autovacuum_analyze_threshold     = 5000,
    fillfactor = 90    -- slight bloat tolerance; rows are append-only
);

ALTER TABLE audit_logs SET (
    autovacuum_vacuum_scale_factor   = 0,
    autovacuum_vacuum_threshold      = 50000,
    fillfactor = 90
);

ALTER TABLE inventory_balance SET (
    autovacuum_vacuum_scale_factor   = 0.01,
    autovacuum_vacuum_threshold      = 100,
    autovacuum_analyze_scale_factor  = 0.005,
    fillfactor = 70    -- many updates; lower fill prevents page splits
);
