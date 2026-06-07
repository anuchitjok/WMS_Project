-- =============================================================================
-- FILE: 01_rbac.sql
-- PURPOSE: Role-Based Access Control — users, roles, permissions, assignments.
-- Extends the flat `role` column in the legacy users table into a full
-- permission matrix while keeping backward compatibility.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Organizations / Tenants  (multi-tenant future-proofing)
-- Single-org deployments use exactly one row with id = default org UUID.
-- ---------------------------------------------------------------------------
CREATE TABLE organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        d_code          NOT NULL UNIQUE,
    name        VARCHAR(200)    NOT NULL,
    settings    JSONB           NOT NULL DEFAULT '{}',
    is_active   BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ     -- soft-delete sentinel
);

COMMENT ON TABLE organizations IS
    'Tenant root. All major entities carry org_id for future multi-tenancy.';

-- ---------------------------------------------------------------------------
-- Users  (extends legacy `users` table)
-- Legacy integer PK preserved via `legacy_id` for FK migration scripts.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id       INTEGER         UNIQUE,           -- maps to old integer PK
    org_id          UUID            NOT NULL REFERENCES organizations(id),
    username        VARCHAR(50)     NOT NULL,
    full_name       VARCHAR(100)    NOT NULL,
    email           VARCHAR(100),
    password_hash   VARCHAR(255)    NOT NULL,         -- bcrypt via pgcrypto
    role            e_user_role     NOT NULL DEFAULT 'requester',  -- legacy flat role kept
    department      VARCHAR(100),
    phone           VARCHAR(30),
    avatar_url      VARCHAR(500),
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    password_changed_at TIMESTAMPTZ,
    failed_login_count  SMALLINT    NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    UNIQUE (org_id, username)
);

COMMENT ON COLUMN users.role IS
    'Legacy flat role for backward compat with FastAPI auth layer.
     Fine-grained permissions are in role_permissions / user_permissions.';

-- ---------------------------------------------------------------------------
-- Permission catalogue
-- ---------------------------------------------------------------------------
CREATE TABLE permissions (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(100) NOT NULL UNIQUE,         -- e.g. 'stock.adjust'
    module      VARCHAR(50)  NOT NULL,                -- e.g. 'stock', 'rtv', 'shipment'
    action      VARCHAR(50)  NOT NULL,                -- e.g. 'read', 'create', 'approve'
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Named roles (separate from the legacy flat e_user_role enum)
-- ---------------------------------------------------------------------------
CREATE TABLE roles (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID        NOT NULL REFERENCES organizations(id),
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    is_system   BOOLEAN     NOT NULL DEFAULT FALSE,   -- system roles cannot be deleted
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ,
    UNIQUE (org_id, name)
);

-- ---------------------------------------------------------------------------
-- Role ↔ Permission matrix
-- ---------------------------------------------------------------------------
CREATE TABLE role_permissions (
    role_id         UUID    NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id   UUID    NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    granted_by      UUID    REFERENCES users(id),
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (role_id, permission_id)
);

-- ---------------------------------------------------------------------------
-- User ↔ Role assignments
-- ---------------------------------------------------------------------------
CREATE TABLE user_roles (
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id     UUID        NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_by UUID        REFERENCES users(id),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ,                          -- time-boxed role assignments
    PRIMARY KEY (user_id, role_id)
);

-- ---------------------------------------------------------------------------
-- Direct user-level permission overrides (grant or revoke beyond role)
-- ---------------------------------------------------------------------------
CREATE TABLE user_permissions (
    id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_id   UUID    NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    is_grant        BOOLEAN NOT NULL DEFAULT TRUE,    -- FALSE = explicit deny
    granted_by      UUID    REFERENCES users(id),
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,
    UNIQUE (user_id, permission_id)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX idx_users_org_id        ON users (org_id);
CREATE INDEX idx_users_email         ON users (email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_username      ON users (username) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_role          ON users (role);
CREATE INDEX idx_user_roles_user     ON user_roles (user_id);
CREATE INDEX idx_user_roles_role     ON user_roles (role_id);
CREATE INDEX idx_role_perms_role     ON role_permissions (role_id);
CREATE INDEX idx_permissions_module  ON permissions (module, action);

-- ---------------------------------------------------------------------------
-- updated_at auto-maintenance trigger (reused by all tables)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
