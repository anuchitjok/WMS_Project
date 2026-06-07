-- =============================================================================
-- FILE: 13_rma_workflow.sql
-- PURPOSE: Return Merchandise Authorization (RMA) workflow.
--          Handles customer/internal field returns coming back into warehouse.
--          Disposition determines whether items are restocked, scrapped,
--          sent to RTV, or quarantined.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- RMA Cases  (return authorization header)
-- ---------------------------------------------------------------------------
CREATE TABLE rma_cases (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID            NOT NULL REFERENCES organizations(id),
    ref_number          VARCHAR(50)     NOT NULL UNIQUE,     -- RMA-2024-00001
    case_number         VARCHAR(100),                        -- customer-facing case ref
    warehouse_id        UUID            NOT NULL REFERENCES warehouses(id),

    -- Source
    source_type         VARCHAR(50)     NOT NULL DEFAULT 'customer',
        -- customer | internal | field_return | warranty_return
    source_name         VARCHAR(200),
    source_contact      VARCHAR(200),
    source_ref          VARCHAR(100),   -- original withdrawal request ref, order ID, etc.
    request_id          UUID,           -- FK resolved after withdrawal_requests exists

    status              e_rma_status    NOT NULL DEFAULT 'open',

    -- Approval
    workflow_instance_id UUID           REFERENCES workflow_instances(id),
    rma_team_id         UUID            REFERENCES users(id),
    approved_by         UUID            REFERENCES users(id),
    approved_at         TIMESTAMPTZ,

    -- Return receipt
    expected_return_date TIMESTAMPTZ,
    received_at         TIMESTAMPTZ,
    received_by         UUID            REFERENCES users(id),
    receiving_grn_id    UUID            REFERENCES goods_receiving_notes(id),

    notes               TEXT,
    created_by          UUID            NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

-- Add FK from withdrawal_requests.rma_id
ALTER TABLE withdrawal_requests
    ADD CONSTRAINT fk_wr_rma
    FOREIGN KEY (rma_id) REFERENCES rma_cases(id)
    ON DELETE SET NULL;

-- Add FK from rma_cases.request_id
ALTER TABLE rma_cases
    ADD CONSTRAINT fk_rma_request
    FOREIGN KEY (request_id) REFERENCES withdrawal_requests(id)
    ON DELETE SET NULL;

CREATE TRIGGER trg_rma_cases_updated_at
    BEFORE UPDATE ON rma_cases
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_rma_status    ON rma_cases (status)   WHERE deleted_at IS NULL;
CREATE INDEX idx_rma_ref       ON rma_cases (ref_number);
CREATE INDEX idx_rma_case_no   ON rma_cases (case_number) WHERE case_number IS NOT NULL;
CREATE INDEX idx_rma_warehouse ON rma_cases (warehouse_id);

-- ---------------------------------------------------------------------------
-- RMA Line Items  (each returned product/serial requiring disposition)
-- ---------------------------------------------------------------------------
CREATE TABLE rma_items (
    id                  UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    rma_id              UUID                NOT NULL REFERENCES rma_cases(id) ON DELETE CASCADE,
    line_no             SMALLINT            NOT NULL,

    product_id          UUID                NOT NULL REFERENCES products(id),
    lot_id              UUID                REFERENCES lots(id),
    serial_id           UUID                REFERENCES serial_numbers(id),

    qty_expected        d_qty               NOT NULL DEFAULT 1,
    qty_received        d_qty               NOT NULL DEFAULT 0,

    condition           e_item_condition    NOT NULL DEFAULT 'good',
    condition_notes     TEXT,

    -- Disposition decision
    disposition         e_rma_disposition   NOT NULL DEFAULT 'pending',
    disposition_by      UUID                REFERENCES users(id),
    disposition_at      TIMESTAMPTZ,
    disposition_notes   TEXT,

    -- Outcomes by disposition type
    restock_bin_id      UUID                REFERENCES bins(id),    -- if disposition = restock
    rtv_order_id        UUID                REFERENCES rtv_orders(id), -- if disposition = return_to_vendor
    scrap_ref           VARCHAR(100),       -- if disposition = scrap

    -- Inventory transaction
    inv_txn_id          UUID,

    uom_id              UUID                REFERENCES uom(id),

    created_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

    UNIQUE (rma_id, line_no)
);

CREATE TRIGGER trg_rma_items_updated_at
    BEFORE UPDATE ON rma_items
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_rmai_rma       ON rma_items (rma_id);
CREATE INDEX idx_rmai_product   ON rma_items (product_id);
CREATE INDEX idx_rmai_serial    ON rma_items (serial_id) WHERE serial_id IS NOT NULL;
CREATE INDEX idx_rmai_disp      ON rma_items (disposition) WHERE disposition = 'pending';
