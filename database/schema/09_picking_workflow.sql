-- =============================================================================
-- FILE: 09_picking_workflow.sql
-- PURPOSE: Pick order and pick task management.
--          One withdrawal request may generate one pick order.
--          A pick order is split into pick tasks assigned to warehouse staff.
--          Pick tasks direct staff to specific bin locations.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Pick Orders  (one per withdrawal request, can cover multiple lines)
-- ---------------------------------------------------------------------------
CREATE TABLE pick_orders (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID            NOT NULL REFERENCES organizations(id),
    ref_number      VARCHAR(50)     NOT NULL UNIQUE,        -- PO-2024-00001
    warehouse_id    UUID            NOT NULL REFERENCES warehouses(id),

    request_id      UUID            NOT NULL REFERENCES withdrawal_requests(id),

    status          e_pick_status   NOT NULL DEFAULT 'pending',
    priority        e_priority      NOT NULL DEFAULT 'normal',

    assigned_to     UUID            REFERENCES users(id),   -- picker
    assigned_at     TIMESTAMPTZ,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    due_at          TIMESTAMPTZ,

    -- Optimized pick route (ordered list of bin_ids)
    pick_route      UUID[]          DEFAULT '{}',

    notes           TEXT,
    created_by      UUID            NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TRIGGER trg_pick_orders_updated_at
    BEFORE UPDATE ON pick_orders
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_po_request     ON pick_orders (request_id);
CREATE INDEX idx_po_warehouse   ON pick_orders (warehouse_id);
CREATE INDEX idx_po_status      ON pick_orders (status) WHERE deleted_at IS NULL;
CREATE INDEX idx_po_assigned    ON pick_orders (assigned_to) WHERE assigned_to IS NOT NULL;

-- Back-fill FK in withdrawal_requests
ALTER TABLE withdrawal_requests
    ADD CONSTRAINT fk_wr_pick_order
    FOREIGN KEY (pick_order_id) REFERENCES pick_orders(id)
    ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Pick Tasks  (line-level instructions — one per product×bin combination)
-- ---------------------------------------------------------------------------
CREATE TABLE pick_tasks (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    pick_order_id   UUID            NOT NULL REFERENCES pick_orders(id) ON DELETE CASCADE,
    line_no         SMALLINT        NOT NULL,

    request_item_id UUID            NOT NULL REFERENCES withdrawal_request_items(id),
    product_id      UUID            NOT NULL REFERENCES products(id),
    lot_id          UUID            REFERENCES lots(id),
    serial_id       UUID            REFERENCES serial_numbers(id),

    -- Source location
    src_bin_id      UUID            NOT NULL REFERENCES bins(id),

    qty_to_pick     d_qty           NOT NULL,
    qty_picked      d_qty           NOT NULL DEFAULT 0,
    uom_id          UUID            REFERENCES uom(id),

    status          e_pick_status   NOT NULL DEFAULT 'pending',
    picked_by       UUID            REFERENCES users(id),
    picked_at       TIMESTAMPTZ,

    -- Short-pick reason
    short_pick_reason TEXT,

    -- Scan verification
    barcode_scanned VARCHAR(200),
    scanned_at      TIMESTAMPTZ,

    notes           TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    UNIQUE (pick_order_id, line_no)
);

CREATE TRIGGER trg_pick_tasks_updated_at
    BEFORE UPDATE ON pick_tasks
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_ptask_order    ON pick_tasks (pick_order_id);
CREATE INDEX idx_ptask_product  ON pick_tasks (product_id);
CREATE INDEX idx_ptask_src_bin  ON pick_tasks (src_bin_id);
CREATE INDEX idx_ptask_status   ON pick_tasks (status);
CREATE INDEX idx_ptask_serial   ON pick_tasks (serial_id) WHERE serial_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Trigger: On pick task completion, update inventory_balance.qty_reserved
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_pick_task_complete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- When all tasks for a pick order are 'picked', advance pick order status
    IF NEW.status = 'picked' AND OLD.status <> 'picked' THEN
        UPDATE inventory_balance
        SET qty_reserved  = GREATEST(qty_reserved - NEW.qty_picked, 0),
            updated_at    = NOW()
        WHERE bin_id       = NEW.src_bin_id
          AND product_id   = NEW.product_id
          AND (lot_id      = NEW.lot_id OR (lot_id IS NULL AND NEW.lot_id IS NULL));

        -- Auto-advance pick order if all tasks complete
        IF NOT EXISTS (
            SELECT 1 FROM pick_tasks
            WHERE pick_order_id = NEW.pick_order_id
              AND status NOT IN ('picked', 'cancelled')
              AND id <> NEW.id
        ) THEN
            UPDATE pick_orders
            SET status = 'picked', completed_at = NOW()
            WHERE id = NEW.pick_order_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pick_task_complete
    AFTER UPDATE ON pick_tasks
    FOR EACH ROW
    WHEN (NEW.status = 'picked' AND OLD.status <> 'picked')
    EXECUTE FUNCTION fn_pick_task_complete();
