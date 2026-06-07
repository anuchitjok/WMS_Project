-- =============================================================================
-- FILE: 14_audit_logging.sql
-- PURPOSE: Append-only audit log for compliance and forensics.
--          - Partitioned by created_at (monthly) for long retention.
--          - Captures old/new JSONB snapshots for UPDATE events.
--          - Triggered automatically via fn_audit_trigger() on key tables.
--          - Manual entries for business events (login, approve, export).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Audit Logs  (IMMUTABLE — never UPDATE or DELETE)
-- Partitioned monthly, same as inventory_transactions.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id              UUID            NOT NULL DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),   -- partition key

    org_id          UUID            REFERENCES organizations(id),
    user_id         UUID            REFERENCES users(id),
    action          e_audit_action  NOT NULL,

    entity_type     VARCHAR(50),    -- table name: 'withdrawal_requests', 'rtv_orders', etc.
    entity_id       UUID,           -- PK of the affected row (UUID)
    entity_legacy_id INTEGER,       -- legacy integer PK for backward compat

    -- Before/after snapshots (NULL for create / delete)
    old_data        JSONB,
    new_data        JSONB,
    changed_fields  TEXT[],         -- list of field names that changed

    -- Context
    ip_address      INET,
    user_agent      TEXT,
    session_id      VARCHAR(100),
    request_id      VARCHAR(100),   -- HTTP request correlation ID
    detail          TEXT,           -- human-readable summary

    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

COMMENT ON TABLE audit_logs IS
    'Append-only compliance log. Never UPDATE or DELETE.
     Partitioned monthly. Retain at least 7 years for financial audit.';

-- Create monthly partitions (reuse the same helper pattern)
CREATE OR REPLACE FUNCTION wms_create_audit_partitions(
    start_year INT,
    end_year   INT
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    y INT; m INT;
    tbl TEXT; d_from TEXT; d_to TEXT;
BEGIN
    FOR y IN start_year..end_year LOOP
        FOR m IN 1..12 LOOP
            tbl    := format('audit_logs_%s_%s', y, lpad(m::text, 2, '0'));
            d_from := format('%s-%s-01', y, lpad(m::text, 2, '0'));
            d_to   := format('%s', (DATE d_from + INTERVAL '1 month')::DATE);
            EXECUTE format(
                'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs
                 FOR VALUES FROM (%L) TO (%L)',
                tbl, d_from, d_to
            );
        END LOOP;
    END LOOP;
END;
$$;

SELECT wms_create_audit_partitions(2024, 2030);

-- Indexes (on parent, inherited by partitions)
CREATE INDEX idx_audit_user      ON audit_logs (user_id,    created_at DESC);
CREATE INDEX idx_audit_entity    ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_action    ON audit_logs (action,     created_at DESC);
CREATE INDEX idx_audit_org       ON audit_logs (org_id,     created_at DESC);
CREATE INDEX idx_audit_created   ON audit_logs (created_at DESC);

-- GIN index for full-text search inside detail column
CREATE INDEX idx_audit_detail_trgm ON audit_logs USING gin (detail gin_trgm_ops)
    WHERE detail IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Generic row-level audit trigger function
-- Attach to any table: CREATE TRIGGER trg_audit_X AFTER INSERT OR UPDATE OR DELETE
--   ON X FOR EACH ROW EXECUTE FUNCTION fn_audit_row('X');
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_audit_row()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_action        e_audit_action;
    v_old           JSONB;
    v_new           JSONB;
    v_changed       TEXT[];
    v_entity_id     UUID;
    v_entity_int_id INTEGER;
BEGIN
    -- Determine action
    IF    TG_OP = 'INSERT' THEN v_action := 'create';
    ELSIF TG_OP = 'DELETE' THEN v_action := 'delete';
    ELSIF TG_OP = 'UPDATE' THEN
        -- Soft-delete detection
        IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
            v_action := 'soft_delete';
        ELSE
            v_action := 'update';
        END IF;
    END IF;

    -- Capture snapshots
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        v_old := to_jsonb(OLD);
        -- Remove password_hash from audit snapshot for security
        v_old := v_old - 'password_hash';
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        v_new := to_jsonb(NEW);
        v_new := v_new - 'password_hash';
    END IF;

    -- Compute changed fields for UPDATE
    IF TG_OP = 'UPDATE' THEN
        SELECT array_agg(key)
        INTO v_changed
        FROM jsonb_each(v_old) o
        WHERE o.value IS DISTINCT FROM (v_new -> o.key);
    END IF;

    -- Extract entity PK (assumes column named 'id' of type UUID)
    BEGIN
        IF TG_OP = 'DELETE' THEN
            v_entity_id := (v_old->>'id')::UUID;
        ELSE
            v_entity_id := (v_new->>'id')::UUID;
        END IF;
    EXCEPTION WHEN others THEN
        v_entity_id := NULL;
    END;

    -- Extract legacy integer PK if present
    BEGIN
        IF TG_OP = 'DELETE' THEN
            v_entity_int_id := (v_old->>'legacy_id')::INTEGER;
        ELSE
            v_entity_int_id := (v_new->>'legacy_id')::INTEGER;
        END IF;
    EXCEPTION WHEN others THEN
        v_entity_int_id := NULL;
    END;

    INSERT INTO audit_logs (
        org_id, user_id, action,
        entity_type, entity_id, entity_legacy_id,
        old_data, new_data, changed_fields
    )
    VALUES (
        NULLIF(current_setting('app.current_org_id',  true), '')::UUID,
        NULLIF(current_setting('app.current_user_id', true), '')::UUID,
        v_action,
        TG_TABLE_NAME,
        v_entity_id,
        v_entity_int_id,
        v_old,
        v_new,
        v_changed
    );

    RETURN NULL;  -- AFTER trigger; return value is ignored
END;
$$;

-- ---------------------------------------------------------------------------
-- Attach audit trigger to core business tables
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_audit_withdrawal_requests
    AFTER INSERT OR UPDATE OR DELETE ON withdrawal_requests
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

CREATE TRIGGER trg_audit_rtv_orders
    AFTER INSERT OR UPDATE OR DELETE ON rtv_orders
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

CREATE TRIGGER trg_audit_rma_cases
    AFTER INSERT OR UPDATE OR DELETE ON rma_cases
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

CREATE TRIGGER trg_audit_pick_orders
    AFTER INSERT OR UPDATE OR DELETE ON pick_orders
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

CREATE TRIGGER trg_audit_pack_orders
    AFTER INSERT OR UPDATE OR DELETE ON pack_orders
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

CREATE TRIGGER trg_audit_shipments
    AFTER INSERT OR UPDATE OR DELETE ON shipments
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

CREATE TRIGGER trg_audit_inventory_balance
    AFTER UPDATE ON inventory_balance
    FOR EACH ROW
    WHEN (
        OLD.qty_on_hand IS DISTINCT FROM NEW.qty_on_hand OR
        OLD.qty_reserved IS DISTINCT FROM NEW.qty_reserved
    )
    EXECUTE FUNCTION fn_audit_row();

CREATE TRIGGER trg_audit_users
    AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

CREATE TRIGGER trg_audit_serial_numbers
    AFTER UPDATE ON serial_numbers
    FOR EACH ROW
    WHEN (OLD.current_status IS DISTINCT FROM NEW.current_status OR
          OLD.current_bin_id IS DISTINCT FROM NEW.current_bin_id)
    EXECUTE FUNCTION fn_audit_row();

-- ---------------------------------------------------------------------------
-- View: Recent audit activity per entity (last 100 events)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_recent_audit AS
SELECT
    al.created_at,
    al.action,
    al.entity_type,
    al.entity_id,
    u.username,
    u.full_name,
    al.changed_fields,
    al.detail,
    al.ip_address
FROM audit_logs al
LEFT JOIN users u ON u.id = al.user_id
ORDER BY al.created_at DESC
LIMIT 100;
