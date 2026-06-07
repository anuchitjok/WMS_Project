-- =============================================================================
-- FILE: 10_packing_workflow.sql
-- PURPOSE: Pack order, carton/package assignment, and labelling.
--          Triggered after pick order reaches 'picked' status.
--          Output: one or more cartons that feed into a shipment.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Pack Orders  (one per pick order / one per shipment wave)
-- ---------------------------------------------------------------------------
CREATE TABLE pack_orders (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID            NOT NULL REFERENCES organizations(id),
    ref_number      VARCHAR(50)     NOT NULL UNIQUE,    -- PKO-2024-00001
    warehouse_id    UUID            NOT NULL REFERENCES warehouses(id),

    pick_order_id   UUID            NOT NULL REFERENCES pick_orders(id),
    request_id      UUID            NOT NULL REFERENCES withdrawal_requests(id),

    status          e_pack_status   NOT NULL DEFAULT 'pending',
    priority        e_priority      NOT NULL DEFAULT 'normal',

    packing_station VARCHAR(50),    -- physical station ID or code
    assigned_to     UUID            REFERENCES users(id),
    assigned_at     TIMESTAMPTZ,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,

    total_weight_kg NUMERIC(10,3),
    notes           TEXT,

    created_by      UUID            NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TRIGGER trg_pack_orders_updated_at
    BEFORE UPDATE ON pack_orders
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_pko_pick_order ON pack_orders (pick_order_id);
CREATE INDEX idx_pko_request    ON pack_orders (request_id);
CREATE INDEX idx_pko_status     ON pack_orders (status) WHERE deleted_at IS NULL;

-- Back-fill FK in withdrawal_requests
ALTER TABLE withdrawal_requests
    ADD CONSTRAINT fk_wr_pack_order
    FOREIGN KEY (pack_order_id) REFERENCES pack_orders(id)
    ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Cartons  (physical boxes / packages produced during packing)
-- ---------------------------------------------------------------------------
CREATE TABLE cartons (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_order_id   UUID        NOT NULL REFERENCES pack_orders(id) ON DELETE CASCADE,
    carton_no       VARCHAR(50) NOT NULL UNIQUE,    -- human label, e.g. CTN-000001
    sscc_barcode    VARCHAR(30) UNIQUE,             -- GS1 SSCC-18 barcode

    length_cm       NUMERIC(8,2),
    width_cm        NUMERIC(8,2),
    height_cm       NUMERIC(8,2),
    gross_weight_kg NUMERIC(10,3),

    is_sealed       BOOLEAN     NOT NULL DEFAULT FALSE,
    sealed_by       UUID        REFERENCES users(id),
    sealed_at       TIMESTAMPTZ,

    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_cartons_updated_at
    BEFORE UPDATE ON cartons
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_cartons_pack_order ON cartons (pack_order_id);
CREATE INDEX idx_cartons_sscc       ON cartons (sscc_barcode) WHERE sscc_barcode IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Carton Items  (which pick lines / serials are in which carton)
-- ---------------------------------------------------------------------------
CREATE TABLE carton_items (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    carton_id       UUID        NOT NULL REFERENCES cartons(id) ON DELETE CASCADE,
    pick_task_id    UUID        NOT NULL REFERENCES pick_tasks(id),

    product_id      UUID        NOT NULL REFERENCES products(id),
    lot_id          UUID        REFERENCES lots(id),
    serial_id       UUID        REFERENCES serial_numbers(id),
    uom_id          UUID        REFERENCES uom(id),

    qty_packed      d_qty       NOT NULL,
    packed_by       UUID        REFERENCES users(id),
    packed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    notes           TEXT
);

CREATE INDEX idx_citem_carton  ON carton_items (carton_id);
CREATE INDEX idx_citem_product ON carton_items (product_id);
CREATE INDEX idx_citem_serial  ON carton_items (serial_id) WHERE serial_id IS NOT NULL;
