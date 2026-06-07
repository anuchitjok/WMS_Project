-- =============================================================================
-- FILE: 00_extensions_and_types.sql
-- PURPOSE: PostgreSQL extensions, custom domains, and all system-wide ENUMs.
-- Must be run first. Requires superuser for extension creation.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";        -- gen_random_uuid() / uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";         -- crypt(), gen_salt() for password hashing
CREATE EXTENSION IF NOT EXISTS "btree_gist";       -- GiST index on scalar types (exclusion constraints)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";          -- trigram indexes for fuzzy product/serial search
CREATE EXTENSION IF NOT EXISTS "unaccent";         -- accent-insensitive search
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"; -- query performance monitoring

-- ---------------------------------------------------------------------------
-- UUID helper: all tables use gen_random_uuid() as default PK.
-- Integer surrogate keys are kept only where the legacy SQLite schema demands
-- backward-compat (noted per table). New tables are UUID-only.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Custom Domains
-- ---------------------------------------------------------------------------

-- Non-blank short codes (warehouse codes, product codes, etc.)
CREATE DOMAIN d_code AS VARCHAR(50)
    CHECK (VALUE ~ '^[A-Za-z0-9_\-\.]+$');

-- Positive-or-zero quantity (prevents negative stock at domain level)
CREATE DOMAIN d_qty AS NUMERIC(18,4)
    CHECK (VALUE >= 0);

-- Signed quantity for ledger entries (can be negative for deductions)
CREATE DOMAIN d_qty_signed AS NUMERIC(18,4);

-- Cost/price – always non-negative
CREATE DOMAIN d_money AS NUMERIC(18,4)
    CHECK (VALUE >= 0);

-- ---------------------------------------------------------------------------
-- ENUMs  (mirrors & extends models.py enums)
-- ---------------------------------------------------------------------------

-- User roles (matches UserRole in models.py)
CREATE TYPE e_user_role AS ENUM (
    'system_admin',
    'warehouse_manager',
    'warehouse_supervisor',
    'warehouse_staff',
    'requester',
    'dept_approver',
    'rma_team',
    'rtv_officer',
    'finance_viewer',
    'brand_viewer',
    'mgmt_viewer',
    'auditor'
);

-- Stock statuses (matches StockStatus in models.py)
CREATE TYPE e_stock_status AS ENUM (
    'pending_receiving',
    'pending_inspection',
    'available',
    'reserved',
    'picking',
    'picked',
    'packed',
    'ready_for_pickup',
    'shipped',
    'issued_to_rma',
    'consumed',
    'returned_unused',
    'quarantine',
    'damaged',
    'doa',
    'rtv_pending',
    'rtv_shipped',
    'closed',
    'cancelled'
);

-- Request / withdrawal statuses (matches RequestStatus in models.py)
CREATE TYPE e_request_status AS ENUM (
    'draft',
    'submitted',
    'pending_approval',
    'approved',
    'rejected',
    'picking',
    'picked',
    'packed',
    'ready_for_pickup',
    'shipped',
    'issued_to_rma',
    'completed',
    'cancelled'
);

-- RTV statuses (matches RTVStatus in models.py)
CREATE TYPE e_rtv_status AS ENUM (
    'rtv_required',
    'pending_review',
    'approved',
    'pending_shipment',
    'shipped_to_vendor',
    'vendor_received',
    'replacement_pending',
    'credit_note_pending',
    'completed',
    'rejected_by_vendor',
    'cancelled'
);

-- Ownership types (matches OwnershipType in models.py)
CREATE TYPE e_ownership_type AS ENUM (
    'own',
    'consignment',
    'rma',
    'customer'
);

-- RMA statuses
CREATE TYPE e_rma_status AS ENUM (
    'open',
    'pending_return',
    'received',
    'under_inspection',
    'approved',
    'rejected',
    'credited',
    'replaced',
    'closed',
    'cancelled'
);

-- RMA disposition actions
CREATE TYPE e_rma_disposition AS ENUM (
    'restock',
    'scrap',
    'repair',
    'return_to_vendor',
    'quarantine',
    'pending'
);

-- Pick order statuses
CREATE TYPE e_pick_status AS ENUM (
    'pending',
    'assigned',
    'in_progress',
    'partially_picked',
    'picked',
    'cancelled'
);

-- Pack order statuses
CREATE TYPE e_pack_status AS ENUM (
    'pending',
    'in_progress',
    'packed',
    'cancelled'
);

-- Shipment statuses
CREATE TYPE e_shipment_status AS ENUM (
    'draft',
    'ready',
    'handed_to_carrier',
    'in_transit',
    'delivered',
    'returned',
    'cancelled'
);

-- Goods receiving statuses
CREATE TYPE e_grn_status AS ENUM (
    'pending_inspection',
    'inspecting',
    'passed',
    'partially_passed',
    'failed',
    'closed'
);

-- Item condition on receipt / inspection
CREATE TYPE e_item_condition AS ENUM (
    'good',
    'damaged',
    'doa',
    'expired',
    'wrong_item'
);

-- Inventory transaction types (ledger entry classification)
CREATE TYPE e_inv_txn_type AS ENUM (
    'receipt',              -- stock coming in from GRN
    'issue',               -- stock leaving on a request/pick
    'transfer',            -- bin-to-bin move within warehouse
    'transfer_in',         -- inter-warehouse transfer – receiving side
    'transfer_out',        -- inter-warehouse transfer – sending side
    'adjustment_in',       -- positive stock adjustment
    'adjustment_out',      -- negative stock adjustment
    'rtv_deduction',       -- removed for RTV shipment
    'rma_receipt',         -- returned goods received
    'rma_restock',         -- returned goods restocked
    'rma_scrap',           -- returned goods scrapped
    'cycle_count_in',      -- cycle count surplus
    'cycle_count_out',     -- cycle count shortage
    'reservation',         -- soft-reserve for a request
    'reservation_release'  -- release of soft-reserve
);

-- Approval workflow decision
CREATE TYPE e_approval_decision AS ENUM (
    'pending',
    'approved',
    'rejected',
    'delegated',
    'auto_approved'
);

-- Priority levels
CREATE TYPE e_priority AS ENUM ('low', 'normal', 'high', 'urgent');

-- Barcode type
CREATE TYPE e_barcode_type AS ENUM (
    'ean13', 'ean8', 'upc_a', 'upc_e',
    'code128', 'code39', 'qr', 'datamatrix',
    'gs1_128', 'sscc', 'internal'
);

-- Warehouse location type
CREATE TYPE e_location_type AS ENUM (
    'storage', 'staging', 'receiving', 'shipping',
    'quarantine', 'returns', 'virtual'
);

-- RTV resolution
CREATE TYPE e_rtv_resolution AS ENUM (
    'replacement', 'credit_note', 'repair', 'no_action'
);

-- Audit action verbs
CREATE TYPE e_audit_action AS ENUM (
    'create', 'update', 'delete', 'soft_delete', 'restore',
    'approve', 'reject', 'login', 'logout', 'export',
    'status_change', 'assign', 'transfer', 'adjust'
);
