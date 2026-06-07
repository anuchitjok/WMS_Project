-- =============================================================================
-- FILE: 08_request_workflow.sql
-- PURPOSE: Withdrawal / Stock Request workflow.
--          Maps to legacy withdrawal_requests / withdrawal_request_items.
--          Extended with approval engine linkage and RMA case association.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Withdrawal Requests  (matches legacy withdrawal_requests)
-- ---------------------------------------------------------------------------
CREATE TABLE withdrawal_requests (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id       INTEGER         UNIQUE,
    org_id          UUID            NOT NULL REFERENCES organizations(id),
    ref_number      VARCHAR(50)     NOT NULL UNIQUE,    -- WR-2024-00001

    requester_id    UUID            NOT NULL REFERENCES users(id),
    department      VARCHAR(100)    NOT NULL,
    rma_case_number VARCHAR(100),                       -- associated RMA case (free text)
    rma_id          UUID            REFERENCES rma_cases(id),  -- FK resolved in 12_rma_workflow.sql
    purpose         TEXT,
    required_date   TIMESTAMPTZ,
    priority        e_priority      NOT NULL DEFAULT 'normal',

    status          e_request_status NOT NULL DEFAULT 'draft',

    -- Approval linkage
    workflow_instance_id UUID        REFERENCES workflow_instances(id),
    approver_id     UUID            REFERENCES users(id),
    approved_at     TIMESTAMPTZ,
    reject_reason   TEXT,

    -- Fulfilment tracking
    warehouse_id    UUID            REFERENCES warehouses(id),
    pick_order_id   UUID,           -- FK resolved in 09_picking_workflow.sql
    pack_order_id   UUID,           -- FK resolved in 10_packing_workflow.sql
    shipment_id     UUID,           -- FK resolved in 11_shipment_workflow.sql

    notes           TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TRIGGER trg_wr_updated_at
    BEFORE UPDATE ON withdrawal_requests
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_wr_requester  ON withdrawal_requests (requester_id);
CREATE INDEX idx_wr_status     ON withdrawal_requests (status) WHERE deleted_at IS NULL;
CREATE INDEX idx_wr_dept       ON withdrawal_requests (department);
CREATE INDEX idx_wr_ref        ON withdrawal_requests (ref_number);
CREATE INDEX idx_wr_created    ON withdrawal_requests (created_at DESC);

-- ---------------------------------------------------------------------------
-- Withdrawal Request Line Items
-- ---------------------------------------------------------------------------
CREATE TABLE withdrawal_request_items (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id           INTEGER     UNIQUE,
    request_id          UUID        NOT NULL REFERENCES withdrawal_requests(id) ON DELETE CASCADE,
    line_no             SMALLINT    NOT NULL DEFAULT 1,

    product_id          UUID        NOT NULL REFERENCES products(id),
    lot_id              UUID        REFERENCES lots(id),
    serial_id           UUID        REFERENCES serial_numbers(id),
    preferred_bin_id    UUID        REFERENCES bins(id),

    qty_requested       d_qty       NOT NULL,
    qty_approved        d_qty,
    qty_picked          d_qty       NOT NULL DEFAULT 0,
    qty_issued          d_qty       NOT NULL DEFAULT 0,

    uom_id              UUID        REFERENCES uom(id),

    -- Post-issuance feedback
    usage_status        VARCHAR(50),
        -- consumed | doa | defective | unused | wrong_item
    usage_notes         TEXT,
    returned_at         TIMESTAMPTZ,

    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (request_id, line_no)
);

CREATE TRIGGER trg_wri_updated_at
    BEFORE UPDATE ON withdrawal_request_items
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_wri_request  ON withdrawal_request_items (request_id);
CREATE INDEX idx_wri_product  ON withdrawal_request_items (product_id);
CREATE INDEX idx_wri_serial   ON withdrawal_request_items (serial_id) WHERE serial_id IS NOT NULL;
