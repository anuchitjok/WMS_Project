-- =============================================================================
-- FILE: 06_receiving.sql
-- PURPOSE: Goods Receiving Notes (GRN) — the inbound stock creation workflow.
--          Matches legacy goods_receiving / goods_receiving_items tables,
--          extended with put-away tasks and quality inspection recording.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Goods Receiving Notes  (GRN header)
-- ---------------------------------------------------------------------------
CREATE TABLE goods_receiving_notes (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id       INTEGER     UNIQUE,
    org_id          UUID        NOT NULL REFERENCES organizations(id),
    warehouse_id    UUID        NOT NULL REFERENCES warehouses(id),
    ref_number      VARCHAR(50) NOT NULL UNIQUE,  -- e.g. GRN-2024-00001

    source_type     VARCHAR(50) NOT NULL DEFAULT 'brand',
        -- brand | vendor | rma_return | rtv_replacement | inter_warehouse | other
    source_ref      VARCHAR(100),                 -- PO number, RMA ref, etc.
    supplier_id     UUID        REFERENCES vendors(id),
    brand_id        UUID        REFERENCES brands(id),

    received_by     UUID        NOT NULL REFERENCES users(id),
    received_date   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expected_date   TIMESTAMPTZ,

    status          e_grn_status NOT NULL DEFAULT 'pending_inspection',
    inspector_id    UUID        REFERENCES users(id),
    inspected_at    TIMESTAMPTZ,
    inspection_notes TEXT,

    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TRIGGER trg_grn_updated_at
    BEFORE UPDATE ON goods_receiving_notes
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_grn_warehouse    ON goods_receiving_notes (warehouse_id);
CREATE INDEX idx_grn_status       ON goods_receiving_notes (status) WHERE deleted_at IS NULL;
CREATE INDEX idx_grn_ref          ON goods_receiving_notes (ref_number);

-- ---------------------------------------------------------------------------
-- GRN Line Items
-- ---------------------------------------------------------------------------
CREATE TABLE goods_receiving_items (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id       INTEGER         UNIQUE,
    grn_id          UUID            NOT NULL REFERENCES goods_receiving_notes(id),
    line_no         SMALLINT        NOT NULL DEFAULT 1,

    product_id      UUID            NOT NULL REFERENCES products(id),
    lot_id          UUID            REFERENCES lots(id),
    serial_id       UUID            REFERENCES serial_numbers(id),  -- set after creation

    qty_expected    d_qty           NOT NULL DEFAULT 0,
    qty_received    d_qty           NOT NULL DEFAULT 0,
    qty_accepted    d_qty           NOT NULL DEFAULT 0,
    qty_rejected    d_qty           NOT NULL DEFAULT 0,

    condition       e_item_condition NOT NULL DEFAULT 'good',
    rejection_reason TEXT,

    -- Put-away destination assigned during/after inspection
    put_away_bin_id UUID            REFERENCES bins(id),
    put_away_at     TIMESTAMPTZ,
    put_away_by     UUID            REFERENCES users(id),

    -- Inventory transaction created for this line
    inv_txn_id      UUID,           -- set after insert into inventory_transactions
    uom_id          UUID            REFERENCES uom(id),
    unit_cost       d_money         NOT NULL DEFAULT 0,

    notes           TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    UNIQUE (grn_id, line_no)
);

CREATE TRIGGER trg_grn_items_updated_at
    BEFORE UPDATE ON goods_receiving_items
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_grni_grn      ON goods_receiving_items (grn_id);
CREATE INDEX idx_grni_product  ON goods_receiving_items (product_id);
CREATE INDEX idx_grni_serial   ON goods_receiving_items (serial_id) WHERE serial_id IS NOT NULL;
CREATE INDEX idx_grni_lot      ON goods_receiving_items (lot_id)    WHERE lot_id IS NOT NULL;

-- Now add FK from serial_numbers.grn_id
ALTER TABLE serial_numbers
    ADD CONSTRAINT fk_serial_grn
    FOREIGN KEY (grn_id) REFERENCES goods_receiving_notes(id)
    ON DELETE SET NULL;
