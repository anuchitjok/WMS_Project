# WMS/ERP Entity-Relationship Diagram

> Text-based ER diagram. Read with a monospace font.
> Relationships: `||--||` (one-to-one), `||--o{` (one-to-many), `}o--o{` (many-to-many)

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  FOUNDATION                                                                                          │
│                                                                                                      │
│  organizations ──────────────────────────────────────────────────────────────────────────────────┐   │
│       │ (org_id on all major tables)                                                             │   │
└───────┼──────────────────────────────────────────────────────────────────────────────────────────┘   │
        │
```

## Core Entity Map

```
ORGANIZATIONS (1)
    │
    ├──< WAREHOUSES (many per org)
    │         │
    │         └──< ZONES
    │                   │
    │                   └──< AISLES
    │                              │
    │                              └──< RACKS ──< SLOTS ──< BINS
    │
    ├──< USERS
    │      │
    │      ├──< USER_ROLES >──< ROLES >──< ROLE_PERMISSIONS >──< PERMISSIONS
    │      └──< USER_PERMISSIONS
    │
    ├──< BRANDS ──< PRODUCTS
    │                  │
    │                  ├──< BARCODES (entity_type='product')
    │                  └──< PRODUCT_CATEGORIES (hierarchical)
    │
    ├──< VENDORS
    │
    └──< UOM ──< UOM_CONVERSIONS


INVENTORY CORE
──────────────
BINS (1)
  │
  └──< INVENTORY_BALANCE (bin × product × lot × ownership)
            qty_on_hand - qty_reserved = qty_available

INVENTORY_TRANSACTIONS (append-only ledger, monthly partitioned)
  ├── src_bin_id → BINS
  ├── dst_bin_id → BINS
  ├── product_id → PRODUCTS
  ├── lot_id     → LOTS
  └── serial_id  → SERIAL_NUMBERS


SERIAL TRACKING
───────────────
SERIAL_NUMBERS
  ├── product_id → PRODUCTS
  ├── lot_id     → LOTS
  ├── grn_id     → GOODS_RECEIVING_NOTES
  ├── current_bin_id → BINS
  └──< SERIAL_MOVEMENTS (append-only location history)
            ├── from_bin_id → BINS
            └── to_bin_id   → BINS


INBOUND WORKFLOW
────────────────
GOODS_RECEIVING_NOTES (GRN)
  └──< GOODS_RECEIVING_ITEMS
            ├── product_id  → PRODUCTS
            ├── lot_id      → LOTS
            ├── serial_id   → SERIAL_NUMBERS
            └── put_away_bin_id → BINS


APPROVAL ENGINE (Generic, any entity can attach)
────────────────────────────────────────────────
WORKFLOW_TEMPLATES
  └──< WORKFLOW_STEPS

WORKFLOW_INSTANCES (1 per document)
  ├── template_id → WORKFLOW_TEMPLATES
  └──< WORKFLOW_APPROVALS
            ├── step_id     → WORKFLOW_STEPS
            └── approver_id → USERS


WITHDRAWAL REQUEST WORKFLOW  (full lifecycle)
──────────────────────────────────────────────
WITHDRAWAL_REQUESTS
  ├── requester_id           → USERS
  ├── workflow_instance_id   → WORKFLOW_INSTANCES
  ├── rma_id                 → RMA_CASES
  └──< WITHDRAWAL_REQUEST_ITEMS
              ├── product_id → PRODUCTS
              └── serial_id  → SERIAL_NUMBERS
        │
        ▼ (status: approved → picking)
PICK_ORDERS
  └──< PICK_TASKS
              ├── src_bin_id  → BINS
              ├── product_id  → PRODUCTS
              └── serial_id   → SERIAL_NUMBERS
        │
        ▼ (status: picked → packing)
PACK_ORDERS
  └──< CARTONS
              └──< CARTON_ITEMS
                          ├── product_id → PRODUCTS
                          └── serial_id  → SERIAL_NUMBERS
        │
        ▼ (status: packed → ready_for_pickup / shipped)
SHIPMENTS
  ├── carrier_id      → CARRIERS
  ├──< SHIPMENT_PACKAGES → CARTONS
  └──< SHIPMENT_EVENTS


RTV WORKFLOW
────────────
RTV_ORDERS
  ├── vendor_id              → VENDORS
  ├── workflow_instance_id   → WORKFLOW_INSTANCES
  └──< RTV_ORDER_ITEMS
              ├── product_id            → PRODUCTS
              ├── serial_id             → SERIAL_NUMBERS
              ├── src_bin_id            → BINS
              └── replacement_serial_id → SERIAL_NUMBERS


RMA WORKFLOW
────────────
RMA_CASES
  ├── request_id             → WITHDRAWAL_REQUESTS
  ├── receiving_grn_id       → GOODS_RECEIVING_NOTES
  ├── workflow_instance_id   → WORKFLOW_INSTANCES
  └──< RMA_ITEMS
              ├── product_id     → PRODUCTS
              ├── serial_id      → SERIAL_NUMBERS
              ├── restock_bin_id → BINS
              └── rtv_order_id   → RTV_ORDERS (escalate to vendor)


AUDIT  (compliance)
────────────────────
AUDIT_LOGS (append-only, monthly partitioned)
  ├── user_id     → USERS
  └── entity_type + entity_id → any table (polymorphic)
```

## Table Count Summary

| Module                  | Tables                            |
|-------------------------|-----------------------------------|
| Foundation / RBAC       | organizations, users, roles, permissions, role_permissions, user_roles, user_permissions |
| Warehouse Hierarchy     | warehouses, zones, aisles, racks, slots, bins |
| Master Data             | brands, vendors, products, product_categories, uom, uom_conversions, barcodes |
| Inventory               | lots, inventory_balance, inventory_transactions (partitioned) |
| Serial Tracking         | serial_numbers, serial_movements |
| Receiving               | goods_receiving_notes, goods_receiving_items |
| Approval Engine         | workflow_templates, workflow_steps, workflow_instances, workflow_approvals |
| Request Workflow        | withdrawal_requests, withdrawal_request_items |
| Picking                 | pick_orders, pick_tasks |
| Packing                 | pack_orders, cartons, carton_items |
| Shipment                | carriers, shipments, shipment_packages, shipment_events |
| RTV                     | rtv_orders, rtv_order_items |
| RMA                     | rma_cases, rma_items |
| Audit                   | audit_logs (partitioned) |
| Utilities               | ref_number_sequences, stock_items (compat), goods_receiving (compat) |
| **Total**               | **~55 tables**                    |

## Partitioned Tables

| Table                    | Key        | Strategy       | Recommended Retention |
|--------------------------|------------|----------------|----------------------|
| inventory_transactions   | txn_date   | RANGE monthly  | 7 years (financial)  |
| audit_logs               | created_at | RANGE monthly  | 7 years (compliance) |

## Key Indexes Summary

| Table                | Index Type    | Columns                          | Purpose                     |
|----------------------|---------------|----------------------------------|-----------------------------|
| inventory_balance    | B-tree INCLUDE| product_id, warehouse_id + cols  | Availability check          |
| inventory_transactions| B-tree       | product_id, txn_date DESC        | Stock history               |
| inventory_transactions| BRIN         | txn_date                         | Partition pruning           |
| serial_numbers       | GIN trigram   | serial_number                    | Partial SN search           |
| products             | GIN trigram   | name, code                       | Product search              |
| audit_logs           | BRIN         | created_at                       | Date-range queries          |
| pick_tasks           | Partial       | (pending only)                   | Active task list            |
| workflow_approvals   | Partial       | pending approver_id              | Approver inbox              |

## Scalability Notes

1. **Horizontal read scaling**: Add PostgreSQL read replicas. Route all SELECT queries
   from FastAPI to replica via SQLAlchemy `execution_options(synchronize_session=False)`.

2. **Partition pruning**: Always include `txn_date`/`created_at` in WHERE clauses
   against partitioned tables or the planner cannot prune partitions.

3. **Multi-warehouse isolation**: All major tables carry `warehouse_id` and `org_id`.
   Row-Level Security (RLS) policies can be added per org/warehouse without schema changes.

4. **Future sharding**: If a single org exceeds ~500M inventory_transactions rows,
   shard by `warehouse_id` using Citus or pg_partman hash partitioning.

5. **JSONB columns** (`settings`, `storage_conditions`, `dimensions_cm`):
   Add GIN indexes on specific JSON paths only when query patterns are established.
   Avoid full-table GIN on JSONB early — it's expensive to maintain.

6. **Time-series metrics**: For dashboards showing throughput over time, materialize
   `v_warehouse_stock_summary` into a dedicated `analytics.stock_snapshots` table
   via a nightly pg_cron job rather than querying the live inventory_balance.
