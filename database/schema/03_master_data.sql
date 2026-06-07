-- =============================================================================
-- FILE: 03_master_data.sql
-- PURPOSE: Product catalogue, brands, vendors, UOM, and barcode registry.
--          Extends legacy brands/vendors/products tables with full production
--          features: product variants, multi-barcode, UOM conversions.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Units of Measure
-- ---------------------------------------------------------------------------
CREATE TABLE uom (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    code        d_code      NOT NULL UNIQUE,
    name        VARCHAR(100) NOT NULL,
    symbol      VARCHAR(20),
    uom_type    VARCHAR(30) NOT NULL DEFAULT 'quantity',  -- quantity, weight, volume, length
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- UOM conversion factors (e.g. 1 box = 12 units)
CREATE TABLE uom_conversions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    from_uom_id     UUID        NOT NULL REFERENCES uom(id),
    to_uom_id       UUID        NOT NULL REFERENCES uom(id),
    factor          NUMERIC(18,8) NOT NULL CHECK (factor > 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (from_uom_id, to_uom_id),
    CHECK (from_uom_id <> to_uom_id)
);

-- ---------------------------------------------------------------------------
-- Brands  (matches legacy brands table)
-- ---------------------------------------------------------------------------
CREATE TABLE brands (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id   INTEGER     UNIQUE,
    org_id      UUID        NOT NULL REFERENCES organizations(id),
    code        d_code      NOT NULL,
    name        VARCHAR(100) NOT NULL,
    contact     VARCHAR(200),
    website     VARCHAR(300),
    notes       TEXT,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ,
    UNIQUE (org_id, code)
);

CREATE TRIGGER trg_brands_updated_at
    BEFORE UPDATE ON brands
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- Vendors  (matches legacy vendors table)
-- ---------------------------------------------------------------------------
CREATE TABLE vendors (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id       INTEGER     UNIQUE,
    org_id          UUID        NOT NULL REFERENCES organizations(id),
    code            d_code      NOT NULL,
    name            VARCHAR(100) NOT NULL,
    contact_name    VARCHAR(100),
    contact         VARCHAR(200),
    email           VARCHAR(100),
    address         TEXT,
    country         CHAR(2),
    currency_code   CHAR(3)     DEFAULT 'THB',
    payment_terms   VARCHAR(100),
    lead_time_days  SMALLINT    DEFAULT 0,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    UNIQUE (org_id, code)
);

CREATE TRIGGER trg_vendors_updated_at
    BEFORE UPDATE ON vendors
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- Product Categories (hierarchical)
-- ---------------------------------------------------------------------------
CREATE TABLE product_categories (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID        NOT NULL REFERENCES organizations(id),
    parent_id   UUID        REFERENCES product_categories(id),
    code        d_code      NOT NULL,
    name        VARCHAR(100) NOT NULL,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ,
    UNIQUE (org_id, code)
);

CREATE TRIGGER trg_product_categories_updated_at
    BEFORE UPDATE ON product_categories
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- Products  (matches legacy products table)
-- ---------------------------------------------------------------------------
CREATE TABLE products (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id           INTEGER     UNIQUE,
    org_id              UUID        NOT NULL REFERENCES organizations(id),
    code                d_code      NOT NULL,
    name                VARCHAR(200) NOT NULL,
    description         TEXT,
    brand_id            UUID        REFERENCES brands(id),
    category_id         UUID        REFERENCES product_categories(id),
    base_uom_id         UUID        REFERENCES uom(id),      -- stocking UOM
    purchase_uom_id     UUID        REFERENCES uom(id),      -- ordering UOM
    unit_cost           d_money     NOT NULL DEFAULT 0,
    serial_controlled   BOOLEAN     NOT NULL DEFAULT FALSE,  -- track by serial
    lot_controlled      BOOLEAN     NOT NULL DEFAULT FALSE,  -- track by lot/batch
    expiry_tracked      BOOLEAN     NOT NULL DEFAULT FALSE,
    min_stock           NUMERIC(18,4) NOT NULL DEFAULT 0,
    reorder_point       NUMERIC(18,4) DEFAULT 0,
    max_stock           NUMERIC(18,4),
    weight_kg           NUMERIC(10,4),
    dimensions_cm       JSONB,   -- {"l": 10, "w": 5, "h": 3}
    storage_conditions  JSONB,   -- {"temp_min": 2, "temp_max": 8}
    customs_hs_code     VARCHAR(20),
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    created_by          UUID        REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    UNIQUE (org_id, code)
);

CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_products_org       ON products (org_id)    WHERE deleted_at IS NULL;
CREATE INDEX idx_products_brand     ON products (brand_id)  WHERE deleted_at IS NULL;
CREATE INDEX idx_products_category  ON products (category_id);
-- Trigram index for fuzzy name search
CREATE INDEX idx_products_name_trgm ON products USING gin (name gin_trgm_ops);
CREATE INDEX idx_products_code_trgm ON products USING gin (code gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Barcode Registry
-- Multiple barcodes per product/variant (e.g., EAN-13, internal, vendor barcode)
-- Also used for bin barcodes and serial number barcodes.
-- ---------------------------------------------------------------------------
CREATE TABLE barcodes (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    barcode_value   VARCHAR(200)    NOT NULL UNIQUE,
    barcode_type    e_barcode_type  NOT NULL DEFAULT 'code128',
    entity_type     VARCHAR(50)     NOT NULL,   -- 'product', 'bin', 'serial', 'carton'
    entity_id       UUID            NOT NULL,
    is_primary      BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_barcodes_value       ON barcodes (barcode_value);
CREATE INDEX idx_barcodes_entity      ON barcodes (entity_type, entity_id);
CREATE UNIQUE INDEX idx_barcodes_primary
    ON barcodes (entity_type, entity_id)
    WHERE is_primary = TRUE;
