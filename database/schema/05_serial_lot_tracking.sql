-- =============================================================================
-- FILE: 05_serial_lot_tracking.sql
-- PURPOSE: Serial number lifecycle tracking and barcode support.
--          A serial number has exactly one current bin at any point.
--          History is maintained via serial_movements (append-only).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Serial Numbers  (one row per unique serial number ever seen in the system)
-- ---------------------------------------------------------------------------
CREATE TABLE serial_numbers (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID            NOT NULL REFERENCES products(id),
    serial_number   VARCHAR(100)    NOT NULL,
    lot_id          UUID            REFERENCES lots(id),

    -- Current location (denormalized for fast lookup)
    current_bin_id  UUID            REFERENCES bins(id),
    current_status  e_stock_status  NOT NULL DEFAULT 'pending_receiving',
    ownership_type  e_ownership_type NOT NULL DEFAULT 'own',

    -- Provenance
    received_date   TIMESTAMPTZ,
    expiry_date     DATE,
    manufacture_date DATE,
    vendor_id       UUID            REFERENCES vendors(id),
    grn_id          UUID,           -- FK resolved in 06_receiving.sql

    -- Lifecycle flags
    is_serialized   BOOLEAN         NOT NULL DEFAULT TRUE,
    is_consumable   BOOLEAN         NOT NULL DEFAULT FALSE,
    warranty_expires DATE,

    notes           TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,

    UNIQUE (product_id, serial_number)
);

CREATE TRIGGER trg_serial_numbers_updated_at
    BEFORE UPDATE ON serial_numbers
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Now add the FK from inventory_transactions.serial_id that was deferred
ALTER TABLE inventory_transactions
    ADD CONSTRAINT fk_invtxn_serial
    FOREIGN KEY (serial_id) REFERENCES serial_numbers(id)
    ON DELETE SET NULL;

CREATE INDEX idx_serial_product   ON serial_numbers (product_id);
CREATE INDEX idx_serial_bin       ON serial_numbers (current_bin_id) WHERE current_bin_id IS NOT NULL;
CREATE INDEX idx_serial_status    ON serial_numbers (current_status);
CREATE INDEX idx_serial_grn       ON serial_numbers (grn_id)         WHERE grn_id IS NOT NULL;
-- Trigram for partial serial search ("contains ABCD")
CREATE INDEX idx_serial_sn_trgm   ON serial_numbers USING gin (serial_number gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Serial Barcodes  (a serial can have multiple barcodes: its own SN, GS1, etc.)
-- Stored in the shared barcodes table (entity_type = 'serial')
-- This view makes lookups convenient.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_serial_barcodes AS
SELECT
    sn.id               AS serial_id,
    sn.serial_number,
    p.code              AS product_code,
    p.name              AS product_name,
    bc.barcode_value,
    bc.barcode_type,
    bc.is_primary,
    sn.current_status,
    fp.full_path        AS current_location
FROM serial_numbers sn
JOIN products       p   ON p.id  = sn.product_id
LEFT JOIN barcodes  bc  ON bc.entity_type = 'serial' AND bc.entity_id = sn.id
LEFT JOIN v_bin_full_path fp ON fp.bin_id = sn.current_bin_id;

-- ---------------------------------------------------------------------------
-- Serial Movement History  (append-only audit trail for each serial)
-- ---------------------------------------------------------------------------
CREATE TABLE serial_movements (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    serial_id       UUID            NOT NULL REFERENCES serial_numbers(id),
    moved_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    from_bin_id     UUID            REFERENCES bins(id),
    to_bin_id       UUID            REFERENCES bins(id),
    from_status     e_stock_status,
    to_status       e_stock_status  NOT NULL,

    txn_type        e_inv_txn_type  NOT NULL,
    txn_ref         VARCHAR(50),    -- links to the parent workflow document ref

    -- Workflow linkage (mirrors inventory_transactions)
    grn_id          UUID,
    request_id      UUID,
    pick_order_id   UUID,
    shipment_id     UUID,
    rma_id          UUID,
    rtv_id          UUID,

    moved_by        UUID            NOT NULL REFERENCES users(id),
    notes           TEXT
);

-- Append-only: no UPDATE/DELETE trigger
CREATE INDEX idx_smov_serial    ON serial_movements (serial_id, moved_at DESC);
CREATE INDEX idx_smov_to_bin    ON serial_movements (to_bin_id)   WHERE to_bin_id IS NOT NULL;
CREATE INDEX idx_smov_txn_ref   ON serial_movements (txn_ref)     WHERE txn_ref IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Trigger: Keep serial_numbers.current_bin_id / current_status in sync
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_update_serial_current_location()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    UPDATE serial_numbers
    SET current_bin_id   = NEW.to_bin_id,
        current_status   = NEW.to_status,
        updated_at       = NOW()
    WHERE id = NEW.serial_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_serial_movement_sync
    AFTER INSERT ON serial_movements
    FOR EACH ROW EXECUTE FUNCTION fn_update_serial_current_location();
