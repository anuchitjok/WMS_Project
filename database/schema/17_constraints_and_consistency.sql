-- =============================================================================
-- FILE: 17_constraints_and_consistency.sql
-- PURPOSE: Cross-table consistency rules, advisory lock helpers,
--          inventory transaction validation, and ref-number sequence helpers.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Reference Number Sequences  (human-readable, warehouse-scoped)
-- ---------------------------------------------------------------------------

CREATE TABLE ref_number_sequences (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID        NOT NULL REFERENCES organizations(id),
    prefix      VARCHAR(20) NOT NULL,   -- 'WR', 'GRN', 'PO', 'SHP', 'RMA', 'RTV', 'PKO'
    year        SMALLINT    NOT NULL,
    last_seq    INTEGER     NOT NULL DEFAULT 0,
    UNIQUE (org_id, prefix, year)
);

-- Atomic sequence generator (safe under concurrent requests)
CREATE OR REPLACE FUNCTION fn_next_ref(
    p_org_id UUID,
    p_prefix VARCHAR
) RETURNS VARCHAR LANGUAGE plpgsql AS $$
DECLARE
    v_year SMALLINT := EXTRACT(YEAR FROM NOW())::SMALLINT;
    v_seq  INTEGER;
BEGIN
    INSERT INTO ref_number_sequences (org_id, prefix, year, last_seq)
    VALUES (p_org_id, p_prefix, v_year, 1)
    ON CONFLICT (org_id, prefix, year)
    DO UPDATE SET last_seq = ref_number_sequences.last_seq + 1
    RETURNING last_seq INTO v_seq;

    RETURN p_prefix || '-' || v_year || '-' || lpad(v_seq::text, 5, '0');
END;
$$;

COMMENT ON FUNCTION fn_next_ref IS
    'Usage: SELECT fn_next_ref(org_id, ''WR'')  → WR-2024-00001
     Uses INSERT...ON CONFLICT for lock-free atomic increment.';

-- ---------------------------------------------------------------------------
-- Inventory Transaction Consistency Constraints
-- ---------------------------------------------------------------------------

-- Rule 1: Transfer transactions must have BOTH src and dst bins
ALTER TABLE inventory_transactions
    ADD CONSTRAINT chk_txn_transfer_bins CHECK (
        txn_type NOT IN ('transfer', 'transfer_in', 'transfer_out')
        OR (src_bin_id IS NOT NULL AND dst_bin_id IS NOT NULL)
        OR (txn_type = 'transfer_out' AND src_bin_id IS NOT NULL)
        OR (txn_type = 'transfer_in'  AND dst_bin_id IS NOT NULL)
    );

-- Rule 2: Receipt/in types must have dst_bin; issue/out types must have src_bin
ALTER TABLE inventory_transactions
    ADD CONSTRAINT chk_txn_receipt_dst CHECK (
        txn_type NOT IN ('receipt', 'adjustment_in', 'rma_receipt', 'rma_restock', 'cycle_count_in')
        OR dst_bin_id IS NOT NULL
    );

ALTER TABLE inventory_transactions
    ADD CONSTRAINT chk_txn_issue_src CHECK (
        txn_type NOT IN ('issue', 'adjustment_out', 'rtv_deduction', 'rma_scrap',
                         'cycle_count_out', 'reservation', 'reservation_release')
        OR src_bin_id IS NOT NULL
    );

-- Rule 3: A serial cannot appear twice in the same transaction
-- (enforced at application layer; DB enforces via unique index on active location)

-- Rule 4: Reservation cannot exceed available qty
-- (enforced by inventory_balance CHECK constraint: qty_reserved <= qty_on_hand)

-- ---------------------------------------------------------------------------
-- Soft-Delete Guard Function
-- Prevents FK violations when deleting parent rows that have active children.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_soft_delete_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Only fires when deleted_at transitions from NULL to a value
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
        -- Check: no active pick orders reference a soft-deleted request
        IF TG_TABLE_NAME = 'withdrawal_requests' THEN
            IF EXISTS (
                SELECT 1 FROM pick_orders
                WHERE request_id = NEW.id
                  AND status NOT IN ('picked', 'cancelled')
                  AND deleted_at IS NULL
            ) THEN
                RAISE EXCEPTION
                    'Cannot soft-delete withdrawal_request % — active pick order exists',
                    NEW.id;
            END IF;
        END IF;

        -- Check: no active inventory transactions reference a soft-deleted product
        IF TG_TABLE_NAME = 'products' THEN
            IF EXISTS (
                SELECT 1 FROM inventory_balance
                WHERE product_id = NEW.id AND qty_on_hand > 0
            ) THEN
                RAISE EXCEPTION
                    'Cannot soft-delete product % — non-zero inventory balance exists',
                    NEW.id;
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_soft_delete_guard_wr
    BEFORE UPDATE ON withdrawal_requests
    FOR EACH ROW EXECUTE FUNCTION fn_soft_delete_guard();

CREATE TRIGGER trg_soft_delete_guard_products
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION fn_soft_delete_guard();

-- ---------------------------------------------------------------------------
-- Advisory Lock Helper  (prevent concurrent stock adjustments on same bin)
-- Application layer should call these before writing inventory_transactions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_lock_bin(p_bin_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    -- Uses hashtext to convert UUID to a 32-bit integer for pg_advisory_xact_lock
    PERFORM pg_advisory_xact_lock(hashtext(p_bin_id::text));
END;
$$;

COMMENT ON FUNCTION fn_lock_bin IS
    'Call within a transaction before writing inventory_transactions to
     prevent two concurrent sessions adjusting the same bin simultaneously.
     Lock is automatically released at transaction end.
     Usage: SELECT fn_lock_bin(''<bin-uuid>'');';

-- ---------------------------------------------------------------------------
-- Constraint: One default warehouse per org (already handled by partial unique
-- index in 02_warehouse_hierarchy.sql — documented here for completeness)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Check: Withdrawal request qty_approved <= qty_requested
-- ---------------------------------------------------------------------------
ALTER TABLE withdrawal_request_items
    ADD CONSTRAINT chk_wri_approved_lte_requested
    CHECK (qty_approved IS NULL OR qty_approved <= qty_requested);

-- ---------------------------------------------------------------------------
-- Check: Carton items qty_packed > 0
-- ---------------------------------------------------------------------------
ALTER TABLE carton_items
    ADD CONSTRAINT chk_citem_qty_positive
    CHECK (qty_packed > 0);

-- ---------------------------------------------------------------------------
-- Check: RMA items qty_received <= qty_expected
-- ---------------------------------------------------------------------------
ALTER TABLE rma_items
    ADD CONSTRAINT chk_rmai_received_lte_expected
    CHECK (qty_received <= qty_expected + 1);   -- allow +1 for over-return tolerance
