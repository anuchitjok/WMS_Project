-- =============================================================================
-- FILE: 15_stock_items_compat.sql
-- PURPOSE: Legacy stock_items table compatibility layer.
--          The legacy app reads/writes stock_items directly.
--          This file creates the PostgreSQL version of that table and wires it
--          into the new schema via FK constraints and triggers that keep
--          inventory_balance consistent.
--
--          Migration path:
--            1. Run all 00–14 scripts.
--            2. Run this script.
--            3. Run the data migration script (see MIGRATION_NOTES below).
--            4. Point the FastAPI app at PostgreSQL.
--            5. Deprecate direct stock_items writes in favour of the ledger.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Stock Items  (maps to legacy stock_items, now backed by PostgreSQL)
-- ---------------------------------------------------------------------------
CREATE TABLE stock_items (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id       INTEGER         UNIQUE,

    product_id      UUID            NOT NULL REFERENCES products(id),
    serial_number   VARCHAR(100),
    serial_id       UUID            REFERENCES serial_numbers(id),
    batch_number    VARCHAR(100),
    lot_id          UUID            REFERENCES lots(id),

    quantity        NUMERIC(18,4)   NOT NULL DEFAULT 1,
    status          e_stock_status  NOT NULL DEFAULT 'available',
    ownership_type  e_ownership_type NOT NULL DEFAULT 'own',

    -- Location (warehouse + bin preferred; legacy rack/slot kept for compat)
    warehouse_id    UUID            REFERENCES warehouses(id),
    bin_id          UUID            REFERENCES bins(id),
    rack_id         UUID            REFERENCES racks(id),       -- legacy compat
    slot_id         UUID            REFERENCES slots(id),       -- legacy compat

    received_date   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    expiry_date     TIMESTAMPTZ,
    unit_cost       d_money         NOT NULL DEFAULT 0,
    notes           TEXT,

    created_by      UUID            REFERENCES users(id),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TRIGGER trg_stock_items_updated_at
    BEFORE UPDATE ON stock_items
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_audit_stock_items
    AFTER INSERT OR UPDATE OR DELETE ON stock_items
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

CREATE INDEX idx_si_product   ON stock_items (product_id);
CREATE INDEX idx_si_serial    ON stock_items (serial_number) WHERE serial_number IS NOT NULL;
CREATE INDEX idx_si_status    ON stock_items (status)        WHERE deleted_at IS NULL;
CREATE INDEX idx_si_warehouse ON stock_items (warehouse_id)  WHERE deleted_at IS NULL;
CREATE INDEX idx_si_bin       ON stock_items (bin_id)        WHERE bin_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Legacy GoodsReceiving tables (backward compatible names)
-- ---------------------------------------------------------------------------
CREATE TABLE goods_receiving (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id       INTEGER     UNIQUE,
    grn_id          UUID        REFERENCES goods_receiving_notes(id),  -- links to new schema
    ref_number      VARCHAR(50) NOT NULL UNIQUE,
    source_type     VARCHAR(50),
    source_ref      VARCHAR(100),
    received_by     UUID        REFERENCES users(id),
    received_date   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status          VARCHAR(50) NOT NULL DEFAULT 'pending_inspection',
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_gr_updated_at
    BEFORE UPDATE ON goods_receiving
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- MIGRATION_NOTES (as SQL comments for the DBA)
-- ---------------------------------------------------------------------------

/*
MIGRATION STEPS (SQLite → PostgreSQL):

1. Export SQLite data:
     sqlite3 wms.db .dump > wms_dump.sql

2. Transform integer PKs → UUIDs:
     Run build_vault.py migration mode (to be implemented), or use:
     INSERT INTO users (legacy_id, ...) SELECT id, ... FROM <imported_table>
     and let gen_random_uuid() assign new UUIDs.

3. Resolve warehouse hierarchy:
   - Create one default org row.
   - Create one default zone per warehouse (code='MAIN').
   - Create one default aisle per zone (code='A00').
   - Migrate racks: rack.aisle_id = the default aisle for its warehouse.
   - Migrate slots: slot.rack_id = matching rack by legacy_id.
   - Create one bin per slot (code='A', barcode = slot legacy code).
   - Set stock_items.bin_id by joining through slot → bin.

4. Build inventory_balance from stock_items:
     INSERT INTO inventory_balance (warehouse_id, bin_id, product_id, ...)
     SELECT warehouse_id, bin_id, product_id, SUM(quantity), ...
     FROM stock_items
     WHERE deleted_at IS NULL AND status = 'available'
     GROUP BY warehouse_id, bin_id, product_id, ...;

5. Set app.current_user_id in session:
     In FastAPI dependency, run:
       await db.execute(text("SET LOCAL app.current_user_id = :uid"), {"uid": str(user.id)})
     before any DML so audit triggers capture the right user.
*/
