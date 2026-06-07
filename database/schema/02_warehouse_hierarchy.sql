-- =============================================================================
-- FILE: 02_warehouse_hierarchy.sql
-- PURPOSE: Physical warehouse structure.
--          Hierarchy: Organization → Warehouse → Zone → Aisle → Rack → Slot → Bin
--          The existing system has: Warehouse → Rack → Slot (no bin level).
--          Bin is added as the atomic storage unit for precise pick/put-away.
--          Legacy rack_id / slot_id integer FKs are preserved via legacy_id columns.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Warehouses
-- ---------------------------------------------------------------------------
CREATE TABLE warehouses (
    id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id   INTEGER         UNIQUE,
    org_id      UUID            NOT NULL REFERENCES organizations(id),
    code        d_code          NOT NULL,
    name        VARCHAR(100)    NOT NULL,
    address     TEXT,
    city        VARCHAR(100),
    country     CHAR(2),                              -- ISO-3166 alpha-2
    timezone    VARCHAR(60)     NOT NULL DEFAULT 'UTC',
    is_active   BOOLEAN         NOT NULL DEFAULT TRUE,
    is_default  BOOLEAN         NOT NULL DEFAULT FALSE,
    settings    JSONB           NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ,
    UNIQUE (org_id, code)
);

CREATE TRIGGER trg_warehouses_updated_at
    BEFORE UPDATE ON warehouses
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Only one default warehouse per org
CREATE UNIQUE INDEX idx_warehouses_default
    ON warehouses (org_id)
    WHERE is_default = TRUE AND deleted_at IS NULL;

CREATE INDEX idx_warehouses_org ON warehouses (org_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Zones  (e.g., "Dry Storage", "Cold Chain", "Hazmat", "Staging")
-- ---------------------------------------------------------------------------
CREATE TABLE zones (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id    UUID            NOT NULL REFERENCES warehouses(id),
    code            d_code          NOT NULL,
    name            VARCHAR(100)    NOT NULL,
    zone_type       e_location_type NOT NULL DEFAULT 'storage',
    temperature_min NUMERIC(5,2),                     -- °C, for cold chain
    temperature_max NUMERIC(5,2),
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    UNIQUE (warehouse_id, code)
);

CREATE TRIGGER trg_zones_updated_at
    BEFORE UPDATE ON zones
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_zones_warehouse ON zones (warehouse_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Aisles  (optional level – can be skipped with aisle code = 'A00')
-- ---------------------------------------------------------------------------
CREATE TABLE aisles (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id     UUID        NOT NULL REFERENCES zones(id),
    code        d_code      NOT NULL,
    name        VARCHAR(100),
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ,
    UNIQUE (zone_id, code)
);

CREATE TRIGGER trg_aisles_updated_at
    BEFORE UPDATE ON aisles
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- Racks  (matches legacy racks table)
-- ---------------------------------------------------------------------------
CREATE TABLE racks (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id   INTEGER     UNIQUE,
    aisle_id    UUID        NOT NULL REFERENCES aisles(id),
    code        d_code      NOT NULL,
    name        VARCHAR(100),
    max_weight_kg NUMERIC(10,2),
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ,
    UNIQUE (aisle_id, code)
);

CREATE TRIGGER trg_racks_updated_at
    BEFORE UPDATE ON racks
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_racks_aisle ON racks (aisle_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Slots  (a row/level on a rack — matches legacy slots table)
-- ---------------------------------------------------------------------------
CREATE TABLE slots (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id   INTEGER     UNIQUE,
    rack_id     UUID        NOT NULL REFERENCES racks(id),
    code        d_code      NOT NULL,
    name        VARCHAR(100),
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ,
    UNIQUE (rack_id, code)
);

CREATE TRIGGER trg_slots_updated_at
    BEFORE UPDATE ON slots
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_slots_rack ON slots (rack_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Bins  (atomic storage unit — deepest addressable location)
-- A slot may have multiple bins (e.g. A, B, C positions within one shelf slot).
-- For warehouses without bin-level tracking, one implicit bin per slot is created.
-- ---------------------------------------------------------------------------
CREATE TABLE bins (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id         UUID            NOT NULL REFERENCES slots(id),
    code            d_code          NOT NULL,
    name            VARCHAR(100),
    location_type   e_location_type NOT NULL DEFAULT 'storage',
    max_capacity    d_qty,                            -- volume/unit cap, optional
    current_qty     d_qty           NOT NULL DEFAULT 0,  -- denormalized counter
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    is_pickable     BOOLEAN         NOT NULL DEFAULT TRUE,
    is_puttable     BOOLEAN         NOT NULL DEFAULT TRUE,
    barcode         VARCHAR(100)    UNIQUE,            -- physical bin barcode
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    UNIQUE (slot_id, code)
);

CREATE TRIGGER trg_bins_updated_at
    BEFORE UPDATE ON bins
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_bins_slot     ON bins (slot_id)    WHERE deleted_at IS NULL;
CREATE INDEX idx_bins_barcode  ON bins (barcode)    WHERE barcode IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Convenience view: full location path as a single string
-- Used in pick/pack/shipment documents for human-readable addresses.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_bin_full_path AS
SELECT
    b.id            AS bin_id,
    w.code          AS warehouse_code,
    w.name          AS warehouse_name,
    z.code          AS zone_code,
    ai.code         AS aisle_code,
    r.code          AS rack_code,
    s.code          AS slot_code,
    b.code          AS bin_code,
    w.code || '-' || z.code || '-' || ai.code || '-' ||
        r.code || '-' || s.code || '-' || b.code  AS full_path
FROM bins b
JOIN slots      s   ON s.id = b.slot_id
JOIN racks      r   ON r.id = s.rack_id
JOIN aisles     ai  ON ai.id = r.aisle_id
JOIN zones      z   ON z.id = ai.zone_id
JOIN warehouses w   ON w.id = z.warehouse_id;
