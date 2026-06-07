-- =============================================================================
-- FILE: 07_approval_workflow_engine.sql
-- PURPOSE: Generic multi-step approval workflow engine.
--          Any document type (withdrawal request, RMA, RTV, adjustment) can
--          attach to a workflow instance.  Approvers can be named users,
--          role groups, or dynamic (e.g., "requester's department head").
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Workflow Templates  (define the steps and rules once, reuse many times)
-- ---------------------------------------------------------------------------
CREATE TABLE workflow_templates (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID        NOT NULL REFERENCES organizations(id),
    code            d_code      NOT NULL,
    name            VARCHAR(100) NOT NULL,
    entity_type     VARCHAR(50) NOT NULL,   -- 'withdrawal_request' | 'rma' | 'rtv' | 'adjustment'
    description     TEXT,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    auto_approve_threshold NUMERIC(18,4),  -- auto-approve if total_value < this
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    UNIQUE (org_id, code)
);

CREATE TRIGGER trg_wf_templates_updated_at
    BEFORE UPDATE ON workflow_templates
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- Workflow Steps  (ordered sequence within a template)
-- ---------------------------------------------------------------------------
CREATE TABLE workflow_steps (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id         UUID        NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
    step_order          SMALLINT    NOT NULL,
    name                VARCHAR(100) NOT NULL,
    description         TEXT,

    -- Who can approve this step
    approver_role       e_user_role,             -- any user with this role
    approver_user_id    UUID        REFERENCES users(id),   -- specific user
    approver_dynamic    VARCHAR(50),             -- 'dept_head' | 'warehouse_manager' | etc.

    -- Escalation
    escalate_after_hours SMALLINT  DEFAULT 48,
    escalate_to_user_id  UUID      REFERENCES users(id),

    -- Policy
    requires_all        BOOLEAN     NOT NULL DEFAULT FALSE, -- TRUE = all approvers must sign
    can_self_approve    BOOLEAN     NOT NULL DEFAULT FALSE,
    is_optional         BOOLEAN     NOT NULL DEFAULT FALSE,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (template_id, step_order)
);

-- ---------------------------------------------------------------------------
-- Workflow Instances  (one per document that enters the workflow)
-- ---------------------------------------------------------------------------
CREATE TABLE workflow_instances (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id     UUID        NOT NULL REFERENCES workflow_templates(id),
    entity_type     VARCHAR(50) NOT NULL,
    entity_id       UUID        NOT NULL,           -- ID of the document

    current_step    SMALLINT    NOT NULL DEFAULT 1,
    status          e_approval_decision NOT NULL DEFAULT 'pending',

    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    due_at          TIMESTAMPTZ,

    initiated_by    UUID        NOT NULL REFERENCES users(id),
    notes           TEXT,

    UNIQUE (entity_type, entity_id)                -- one active workflow per document
);

CREATE INDEX idx_wf_inst_entity   ON workflow_instances (entity_type, entity_id);
CREATE INDEX idx_wf_inst_status   ON workflow_instances (status) WHERE status = 'pending';
CREATE INDEX idx_wf_inst_template ON workflow_instances (template_id);

-- ---------------------------------------------------------------------------
-- Workflow Approvals  (one row per step per instance — decision record)
-- ---------------------------------------------------------------------------
CREATE TABLE workflow_approvals (
    id              UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id     UUID                NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
    step_id         UUID                NOT NULL REFERENCES workflow_steps(id),
    step_order      SMALLINT            NOT NULL,

    approver_id     UUID                REFERENCES users(id),
    decision        e_approval_decision NOT NULL DEFAULT 'pending',
    decided_at      TIMESTAMPTZ,
    due_at          TIMESTAMPTZ,

    comments        TEXT,
    delegated_to    UUID                REFERENCES users(id),
    notified_at     TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wf_appr_instance  ON workflow_approvals (instance_id);
CREATE INDEX idx_wf_appr_approver  ON workflow_approvals (approver_id)
    WHERE decision = 'pending';

-- ---------------------------------------------------------------------------
-- Helper function: advance workflow instance to next step or complete it
-- Called by application layer after recording an approval decision.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_advance_workflow(
    p_instance_id UUID,
    p_approver_id UUID,
    p_decision    e_approval_decision,
    p_comments    TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_instance  workflow_instances%ROWTYPE;
    v_step      workflow_steps%ROWTYPE;
    v_max_step  SMALLINT;
BEGIN
    SELECT * INTO v_instance FROM workflow_instances WHERE id = p_instance_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Workflow instance % not found', p_instance_id; END IF;
    IF v_instance.status <> 'pending' THEN
        RAISE EXCEPTION 'Workflow instance % is not in pending state', p_instance_id;
    END IF;

    -- Record the approval decision
    UPDATE workflow_approvals
    SET decision   = p_decision,
        decided_at = NOW(),
        comments   = p_comments,
        approver_id = p_approver_id
    WHERE instance_id = p_instance_id
      AND step_order  = v_instance.current_step
      AND decision    = 'pending';

    IF p_decision = 'rejected' THEN
        UPDATE workflow_instances
        SET status = 'rejected', completed_at = NOW()
        WHERE id = p_instance_id;
        RETURN;
    END IF;

    -- Approved: check if more steps remain
    SELECT MAX(step_order) INTO v_max_step
    FROM workflow_steps
    WHERE template_id = v_instance.template_id;

    IF v_instance.current_step >= v_max_step THEN
        UPDATE workflow_instances
        SET status = 'approved', completed_at = NOW()
        WHERE id = p_instance_id;
    ELSE
        UPDATE workflow_instances
        SET current_step = current_step + 1
        WHERE id = p_instance_id;
    END IF;
END;
$$;
