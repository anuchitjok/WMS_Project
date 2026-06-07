-- =============================================================================
-- FILE: 04_inventory_ledger.sql
-- PURPOSE: Inventory balance (current state) and inventory transaction ledger
--          (immutable append-only history).  These two tables are the financial
--          centre of the WMS — all stock movements write here.
--
-- Design principles:
--   1. inventory_balance  = current on-hand + reserved per (bin, product, lot)
--   2. inventory_transactions = double-entry append-only ledger (never UPDATE/DELETE)
--   3. A trigger keeps inventory_balance in sync with every ledger insert.
--   4. inventory_transactions is RANGE-partitioned by txn_date (monthly).
--   5. Negative balance prevention at DB level via CHECK on inventory_balance.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Lot / Batch master  (see also 05_serial_lot_tracking.sql for serial detail)
-- ---------------------------------------------------------------------------
CREATE TABLE lots (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID        NOT NULL REFERENCES products(id),
    lot_number      VARCHAR(100) NOT NULL,
    manufacture_date DATE,
    expiry_date     DATE,
    vendor_id       UUID        REFERENCES vendors(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (product_id, lot_number)
);

CREATE INDEX idx_lots_product    ON lots (product_id);
CREATE INDEX idx_lots_expiry     ON lots (expiry_date) WHERE expiry_date IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Inventory Balance  (one row per bin × product × lot × ownership)
-- This is the CURRENT STATE table — read performance is critical.
-- ---------------------------------------------------------------------------
CREATE TABLE inventory_balance (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id    UUID            NOT NULL REFERENCES warehouses(id),
    bin_id          UUID            NOT NULL REFERENCES bins(id),
    product_id      UUID            NOT NULL REFERENCES products(id),
    lot_id          UUID            REFERENCES lots(id),
    ownership_type  e_ownership_type NOT NULL DEFAULT 'own',

    -- Quantity breakdown
    qty_on_hand     d_qty           NOT NULL DEFAULT 0,   -- physical stock present
    qty_reserved    d_qty           NOT NULL DEFAULT 0,   -- soft-reserved for pending picks
    qty_available   d_qty GENERATED ALWAYS AS
                        (qty_on_hand - qty_reserved) STORED,   -- computed

    uom_id          UUID            NOT NULL REFERENCES uom(id),
    unit_cost       d_money         NOT NULL DEFAULT 0,

    last_movement_at TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    UNIQUE (bin_id, product_id, lot_id, ownership_type),

    -- No bin can hold negative physical stock
    CONSTRAINT chk_inv_qty_on_hand  CHECK (qty_on_hand  >= 0),
    CONSTRAINT chk_inv_qty_reserved CHECK (qty_reserved >= 0),
    CONSTRAINT chk_inv_reserved_lte_onhand
        CHECK (qty_reserved <= qty_on_hand)
);

CREATE TRIGGER trg_inventory_balance_updated_at
    BEFORE UPDATE ON inventory_balance
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Performance indexes — these are the hottest read paths
CREATE INDEX idx_invbal_bin         ON inventory_balance (bin_id);
CREATE INDEX idx_invbal_product     ON inventory_balance (product_id);
CREATE INDEX idx_invbal_warehouse   ON inventory_balance (warehouse_id);
CREATE INDEX idx_invbal_lot         ON inventory_balance (lot_id) WHERE lot_id IS NOT NULL;
CREATE INDEX idx_invbal_available   ON inventory_balance (product_id, warehouse_id)
    WHERE qty_available > 0;

-- ---------------------------------------------------------------------------
-- Inventory Transactions Ledger  (IMMUTABLE — never UPDATE or DELETE rows)
-- Partitioned by txn_date RANGE (monthly partitions).
-- Reference table for all physical and logical stock movements.
-- ---------------------------------------------------------------------------
CREATE TABLE inventory_transactions (
    id              UUID            NOT NULL DEFAULT gen_random_uuid(),
    org_id          UUID            NOT NULL REFERENCES organizations(id),
    txn_date        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),   -- partition key
    txn_type        e_inv_txn_type  NOT NULL,
    txn_ref         VARCHAR(50)     NOT NULL,                 -- human-readable ref

    -- Source and destination (NULL for single-location txns)
    src_bin_id      UUID            REFERENCES bins(id),
    dst_bin_id      UUID            REFERENCES bins(id),
    warehouse_id    UUID            NOT NULL REFERENCES warehouses(id),

    product_id      UUID            NOT NULL REFERENCES products(id),
    lot_id          UUID            REFERENCES lots(id),
    serial_id       UUID,           -- FK resolved after serial table is created
    ownership_type  e_ownership_type NOT NULL DEFAULT 'own',
    uom_id          UUID            NOT NULL REFERENCES uom(id),

    -- Quantity: ALWAYS positive; sign is implied by txn_type
    qty             NUMERIC(18,4)   NOT NULL CHECK (qty > 0),
    unit_cost       d_money         NOT NULL DEFAULT 0,
    total_cost      d_money GENERATED ALWAYS AS (qty * unit_cost) STORED,

    -- Workflow linkage (any one may be set)
    grn_id          UUID,           -- goods receiving note
    request_id      UUID,           -- withdrawal request
    pick_order_id   UUID,
    pack_order_id   UUID,
    shipment_id     UUID,
    rma_id          UUID,
    rtv_id          UUID,
    adjustment_id   UUID,

    notes           TEXT,
    created_by      UUID            NOT NULL REFERENCES users(id),

    PRIMARY KEY (id, txn_date)   -- both needed for partitioning
) PARTITION BY RANGE (txn_date);

COMMENT ON TABLE inventory_transactions IS
    'Append-only ledger. Never UPDATE or DELETE. Partitioned monthly.
     Run: SELECT wms_create_monthly_partitions(2024, 2030) after loading.';

-- Partition creation helper function
CREATE OR REPLACE FUNCTION wms_create_monthly_partitions(
    start_year INT,
    end_year   INT
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    y INT; m INT;
    tbl TEXT; d_from TEXT; d_to TEXT;
BEGIN
    FOR y IN start_year..end_year LOOP
        FOR m IN 1..12 LOOP
            tbl    := format('inventory_transactions_%s_%s', y, lpad(m::text, 2, '0'));
            d_from := format('%s-%s-01', y, lpad(m::text, 2, '0'));
            d_to   := format('%s', (DATE d_from + INTERVAL '1 month')::DATE);
            EXECUTE format(
                'CREATE TABLE IF NOT EXISTS %I PARTITION OF inventory_transactions
                 FOR VALUES FROM (%L) TO (%L)',
                tbl, d_from, d_to
            );
        END LOOP;
    END LOOP;
END;
$$;

-- Create partitions for 2024-2030 by default
SELECT wms_create_monthly_partitions(2024, 2030);

-- Indexes on the parent table propagate to all partitions
CREATE INDEX idx_invtxn_product   ON inventory_transactions (product_id, txn_date DESC);
CREATE INDEX idx_invtxn_warehouse ON inventory_transactions (warehouse_id, txn_date DESC);
CREATE INDEX idx_invtxn_ref       ON inventory_transactions (txn_ref);
CREATE INDEX idx_invtxn_type      ON inventory_transactions (txn_type, txn_date DESC);
CREATE INDEX idx_invtxn_src_bin   ON inventory_transactions (src_bin_id) WHERE src_bin_id IS NOT NULL;
CREATE INDEX idx_invtxn_dst_bin   ON inventory_transactions (dst_bin_id) WHERE dst_bin_id IS NOT NULL;
CREATE INDEX idx_invtxn_created_by ON inventory_transactions (created_by, txn_date DESC);

-- ---------------------------------------------------------------------------
-- Trigger: Maintain inventory_balance on every ledger insert
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_update_inventory_balance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_balance_id UUID;
BEGIN
    -- Resolve which bin to credit / debit based on txn_type
    -- Credit types: add to dst_bin
    IF NEW.txn_type IN (
        'receipt', 'transfer_in', 'adjustment_in',
        'rma_receipt', 'rma_restock', 'cycle_count_in'
    ) THEN
        INSERT INTO inventory_balance
            (warehouse_id, bin_id, product_id, lot_id, ownership_type,
             qty_on_hand, uom_id, unit_cost, last_movement_at)
        VALUES
            (NEW.warehouse_id, NEW.dst_bin_id, NEW.product_id, NEW.lot_id,
             NEW.ownership_type, NEW.qty, NEW.uom_id, NEW.unit_cost, NEW.txn_date)
        ON CONFLICT (bin_id, product_id, lot_id, ownership_type)
        DO UPDATE SET
            qty_on_hand      = inventory_balance.qty_on_hand + EXCLUDED.qty_on_hand,
            unit_cost        = EXCLUDED.unit_cost,          -- last-cost valuation
            last_movement_at = EXCLUDED.last_movement_at,
            updated_at       = NOW();

    -- Debit types: remove from src_bin
    ELSIF NEW.txn_type IN (
        'issue', 'transfer_out', 'adjustment_out',
        'rtv_deduction', 'rma_scrap', 'cycle_count_out'
    ) THEN
        UPDATE inventory_balance
        SET
            qty_on_hand      = qty_on_hand - NEW.qty,
            last_movement_at = NEW.txn_date,
            updated_at       = NOW()
        WHERE bin_id        = NEW.src_bin_id
          AND product_id    = NEW.product_id
          AND (lot_id       = NEW.lot_id OR (lot_id IS NULL AND NEW.lot_id IS NULL))
          AND ownership_type= NEW.ownership_type;

        -- Raise if the update would violate the CHECK constraint
        -- (Postgres will raise automatically, this is for clarity in logs)

    -- Reservation: increase reserved qty
    ELSIF NEW.txn_type = 'reservation' THEN
        UPDATE inventory_balance
        SET
            qty_reserved  = qty_reserved + NEW.qty,
            updated_at    = NOW()
        WHERE bin_id       = NEW.src_bin_id
          AND product_id   = NEW.product_id
          AND (lot_id      = NEW.lot_id OR (lot_id IS NULL AND NEW.lot_id IS NULL))
          AND ownership_type= NEW.ownership_type;

    -- Reservation release
    ELSIF NEW.txn_type = 'reservation_release' THEN
        UPDATE inventory_balance
        SET
            qty_reserved  = GREATEST(qty_reserved - NEW.qty, 0),
            updated_at    = NOW()
        WHERE bin_id       = NEW.src_bin_id
          AND product_id   = NEW.product_id
          AND (lot_id      = NEW.lot_id OR (lot_id IS NULL AND NEW.lot_id IS NULL))
          AND ownership_type= NEW.ownership_type;

    -- Full transfer: debit src, credit dst
    ELSIF NEW.txn_type = 'transfer' THEN
        UPDATE inventory_balance
        SET
            qty_on_hand      = qty_on_hand - NEW.qty,
            last_movement_at = NEW.txn_date,
            updated_at       = NOW()
        WHERE bin_id        = NEW.src_bin_id
          AND product_id    = NEW.product_id
          AND (lot_id       = NEW.lot_id OR (lot_id IS NULL AND NEW.lot_id IS NULL))
          AND ownership_type= NEW.ownership_type;

        INSERT INTO inventory_balance
            (warehouse_id, bin_id, product_id, lot_id, ownership_type,
             qty_on_hand, uom_id, unit_cost, last_movement_at)
        VALUES
            (NEW.warehouse_id, NEW.dst_bin_id, NEW.product_id, NEW.lot_id,
             NEW.ownership_type, NEW.qty, NEW.uom_id, NEW.unit_cost, NEW.txn_date)
        ON CONFLICT (bin_id, product_id, lot_id, ownership_type)
        DO UPDATE SET
            qty_on_hand      = inventory_balance.qty_on_hand + EXCLUDED.qty_on_hand,
            last_movement_at = EXCLUDED.last_movement_at,
            updated_at       = NOW();
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_inventory_transaction_balance
    AFTER INSERT ON inventory_transactions
    FOR EACH ROW EXECUTE FUNCTION fn_update_inventory_balance();

-- ---------------------------------------------------------------------------
-- View: Warehouse-level stock summary (for dashboards)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_warehouse_stock_summary AS
SELECT
    w.id        AS warehouse_id,
    w.code      AS warehouse_code,
    w.name      AS warehouse_name,
    p.id        AS product_id,
    p.code      AS product_code,
    p.name      AS product_name,
    b.name      AS brand_name,
    SUM(ib.qty_on_hand)   AS total_on_hand,
    SUM(ib.qty_reserved)  AS total_reserved,
    SUM(ib.qty_available) AS total_available,
    SUM(ib.qty_on_hand * ib.unit_cost) AS stock_value
FROM inventory_balance ib
JOIN warehouses w  ON w.id  = ib.warehouse_id
JOIN products   p  ON p.id  = ib.product_id
LEFT JOIN brands b ON b.id  = p.brand_id
GROUP BY w.id, w.code, w.name, p.id, p.code, p.name, b.name;
