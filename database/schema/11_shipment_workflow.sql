-- =============================================================================
-- FILE: 11_shipment_workflow.sql
-- PURPOSE: Carrier management, shipment creation, and dispatch tracking.
--          A shipment collects one or more pack orders / cartons for dispatch.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Carriers
-- ---------------------------------------------------------------------------
CREATE TABLE carriers (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID        NOT NULL REFERENCES organizations(id),
    code            d_code      NOT NULL,
    name            VARCHAR(100) NOT NULL,
    tracking_url    VARCHAR(300),     -- e.g. "https://track.carrier.com/{tracking_no}"
    contact         VARCHAR(200),
    email           VARCHAR(100),
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    UNIQUE (org_id, code)
);

CREATE TRIGGER trg_carriers_updated_at
    BEFORE UPDATE ON carriers
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- Shipments
-- ---------------------------------------------------------------------------
CREATE TABLE shipments (
    id              UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID                NOT NULL REFERENCES organizations(id),
    ref_number      VARCHAR(50)         NOT NULL UNIQUE,     -- SHP-2024-00001
    warehouse_id    UUID                NOT NULL REFERENCES warehouses(id),

    request_id      UUID                REFERENCES withdrawal_requests(id),
    pack_order_id   UUID                REFERENCES pack_orders(id),

    -- Destination
    recipient_name  VARCHAR(100),
    recipient_dept  VARCHAR(100),
    delivery_address TEXT,

    -- Carrier & tracking
    carrier_id      UUID                REFERENCES carriers(id),
    tracking_number VARCHAR(100),
    service_level   VARCHAR(50),        -- standard | express | overnight

    status          e_shipment_status   NOT NULL DEFAULT 'draft',

    -- Timestamps
    scheduled_dispatch_at TIMESTAMPTZ,
    dispatched_at   TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    estimated_delivery_at TIMESTAMPTZ,

    -- Staff
    dispatched_by   UUID                REFERENCES users(id),
    received_by_name VARCHAR(100),       -- recipient signature/name

    total_cartons   SMALLINT            NOT NULL DEFAULT 0,
    total_weight_kg NUMERIC(10,3),

    proof_of_delivery TEXT,             -- URL or reference to POD document
    notes           TEXT,

    created_by      UUID                NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TRIGGER trg_shipments_updated_at
    BEFORE UPDATE ON shipments
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_shp_request     ON shipments (request_id)  WHERE request_id IS NOT NULL;
CREATE INDEX idx_shp_status      ON shipments (status)      WHERE deleted_at IS NULL;
CREATE INDEX idx_shp_carrier     ON shipments (carrier_id)  WHERE carrier_id IS NOT NULL;
CREATE INDEX idx_shp_tracking    ON shipments (tracking_number) WHERE tracking_number IS NOT NULL;
CREATE INDEX idx_shp_dispatched  ON shipments (dispatched_at DESC) WHERE dispatched_at IS NOT NULL;

-- Back-fill FK in withdrawal_requests
ALTER TABLE withdrawal_requests
    ADD CONSTRAINT fk_wr_shipment
    FOREIGN KEY (shipment_id) REFERENCES shipments(id)
    ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Shipment Packages  (links cartons to a shipment)
-- ---------------------------------------------------------------------------
CREATE TABLE shipment_packages (
    id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id     UUID    NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    carton_id       UUID    NOT NULL REFERENCES cartons(id),
    package_no      SMALLINT NOT NULL,
    tracking_suffix VARCHAR(20),        -- some carriers sub-track packages
    UNIQUE (shipment_id, carton_id)
);

CREATE INDEX idx_spkg_shipment ON shipment_packages (shipment_id);
CREATE INDEX idx_spkg_carton   ON shipment_packages (carton_id);

-- ---------------------------------------------------------------------------
-- Shipment Status History  (append-only event log per shipment)
-- ---------------------------------------------------------------------------
CREATE TABLE shipment_events (
    id              UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id     UUID                NOT NULL REFERENCES shipments(id),
    event_at        TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    status          e_shipment_status   NOT NULL,
    location        VARCHAR(200),
    description     TEXT,
    recorded_by     UUID                REFERENCES users(id),
    source          VARCHAR(50)         DEFAULT 'manual'  -- manual | carrier_webhook | system
);

CREATE INDEX idx_sevt_shipment ON shipment_events (shipment_id, event_at DESC);
