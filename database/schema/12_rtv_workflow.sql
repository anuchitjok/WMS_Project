-- =============================================================================
-- FILE: 12_rtv_workflow.sql
-- PURPOSE: Return-to-Vendor (RTV) workflow.
--          Matches legacy rtv_cases table, extended with:
--          - Multi-item RTV orders (was single stock_item_id)
--          - Approval engine linkage
--          - Resolution tracking (replacement / credit note / repair)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- RTV Orders  (replaces legacy rtv_cases, keeps backward compat via legacy_id)
-- ---------------------------------------------------------------------------
CREATE TABLE rtv_orders (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id           INTEGER         UNIQUE,   -- maps to old rtv_cases.id
    org_id              UUID            NOT NULL REFERENCES organizations(id),
    ref_number          VARCHAR(50)     NOT NULL UNIQUE,     -- RTV-2024-00001

    vendor_id           UUID            NOT NULL REFERENCES vendors(id),
    warehouse_id        UUID            NOT NULL REFERENCES warehouses(id),

    reason              VARCHAR(50)     NOT NULL,
        -- doa | defective | vendor_return | wrong_shipment | expired
    description         TEXT,
    status              e_rtv_status    NOT NULL DEFAULT 'rtv_required',

    -- Approval
    workflow_instance_id UUID           REFERENCES workflow_instances(id),
    rtv_officer_id      UUID            REFERENCES users(id),
    approved_by         UUID            REFERENCES users(id),
    approved_at         TIMESTAMPTZ,
    reject_reason       TEXT,

    -- Shipment details
    shipment_ref        VARCHAR(100),
    carrier_id          UUID            REFERENCES carriers(id),
    tracking_number     VARCHAR(100),
    shipped_date        TIMESTAMPTZ,

    -- Vendor response
    vendor_response     TEXT,
    vendor_received_at  TIMESTAMPTZ,
    resolution          e_rtv_resolution,
    credit_note_ref     VARCHAR(100),
    credit_amount       d_money,

    closed_at           TIMESTAMPTZ,
    notes               TEXT,

    created_by          UUID            NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

CREATE TRIGGER trg_rtv_orders_updated_at
    BEFORE UPDATE ON rtv_orders
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_rtv_vendor   ON rtv_orders (vendor_id);
CREATE INDEX idx_rtv_status   ON rtv_orders (status)   WHERE deleted_at IS NULL;
CREATE INDEX idx_rtv_officer  ON rtv_orders (rtv_officer_id);
CREATE INDEX idx_rtv_ref      ON rtv_orders (ref_number);

-- ---------------------------------------------------------------------------
-- RTV Order Lines  (items being returned — was single FK in legacy)
-- ---------------------------------------------------------------------------
CREATE TABLE rtv_order_items (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    rtv_order_id        UUID        NOT NULL REFERENCES rtv_orders(id) ON DELETE CASCADE,
    line_no             SMALLINT    NOT NULL,

    product_id          UUID        NOT NULL REFERENCES products(id),
    lot_id              UUID        REFERENCES lots(id),
    serial_id           UUID        REFERENCES serial_numbers(id),
    src_bin_id          UUID        REFERENCES bins(id),

    qty                 d_qty       NOT NULL,
    uom_id              UUID        REFERENCES uom(id),
    unit_cost           d_money     NOT NULL DEFAULT 0,

    condition           e_item_condition NOT NULL DEFAULT 'damaged',
    condition_notes     TEXT,

    -- Replacement received for this specific line
    replacement_serial_id UUID      REFERENCES serial_numbers(id),
    replacement_grn_id    UUID      REFERENCES goods_receiving_notes(id),

    -- Inventory transaction deduction
    inv_txn_id          UUID,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (rtv_order_id, line_no)
);

CREATE TRIGGER trg_rtv_items_updated_at
    BEFORE UPDATE ON rtv_order_items
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_rtvi_order   ON rtv_order_items (rtv_order_id);
CREATE INDEX idx_rtvi_product ON rtv_order_items (product_id);
CREATE INDEX idx_rtvi_serial  ON rtv_order_items (serial_id) WHERE serial_id IS NOT NULL;
