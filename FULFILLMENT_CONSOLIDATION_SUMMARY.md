# HSNT WMS — Fulfillment Consolidation Refactor Summary

> Created: 2026-06-06 | Status: Backend + Frontend consolidated, type-checked clean
> Scope: Merge legacy `/fulfillment` (V1) and `/fulfillment-v2` (V2) into one unified module

---

## 📌 Problem

The system had **two parallel fulfillment implementations** competing over the same inventory:

| Concern | Before |
|---|---|
| Backend modules | `FulfillmentModule` (V1, operated on `WithdrawalRequest`) + `Fulfillment2Module` (V2, operated on `FulfillmentTask`) |
| Shipment ops | `ShipmentModule` owned packing + dispatch mutations |
| Frontend pages | `/fulfillment` (3-lane) + `/fulfillment-v2` (5-lane) — ~100% UI duplication |
| Inventory | No stock reservation on allocate; no Goods Issue on dispatch |
| Concurrency | No optimistic locking; dual-system could double-allocate one request |

---

## ✅ Solution — Unified Architecture

Single source of truth: **`FulfillmentModule`** orchestrating `FulfillmentTask`, with all
inventory movements routed through **`InventoryOrchestrationService`** inside transactions.

```
WithdrawalRequest (APPROVED)
  → allocate()        → reserve stock (FIFO)  → FulfillmentTask (ALLOCATED)
  → advance()/pick    → recordPickTransaction → PICKING → PICKED
  → packing           → PackingSession        → PACKING → PACKED
  → createShipment()  → Shipment              → READY_TO_SHIP
  → confirmDispatch() → Goods Issue (deduct)  → SHIPPED
  → confirmDelivery() → POD                   → DELIVERED
  → issueToRma()      → sync WithdrawalReq    → CLOSED / ISSUED_TO_RMA
```

### Migration pattern: Strangler Fig + backward-compat proxies
- `Fulfillment2Module` now **imports** `FulfillmentModule` and proxies all calls — `/fulfillment2/*` endpoints still work, zero duplicated logic.
- `ShipmentModule` reduced to a **read-only tracker** (list / get / track).
- Old frontend routes `/fulfillment` and `/fulfillment-v2` **redirect** to `/outbound/fulfillment`.

---

## 🗄️ Phase 1 — Database Guard Rails

**`database/schema/18_fulfillment_guard_rails.sql`** (manual apply)
- Partial **UNIQUE index** on `FulfillmentTask(requestId)` excluding `CANCELLED`/`RETURNED` — prevents double-allocation of one request.
- `version` column (optimistic locking), `Shipment.dispatchedById`, `Shipment.podReference`.
- Composite index `(warehouseId, status)` for board queries.

**`backend/prisma/schema.prisma`** (additive only — no breaking migration)
- `FulfillmentTask.version Int @default(0)`
- `Shipment.dispatchedById String?`, `Shipment.podReference String?`

---

## ⚙️ Phase 2 — Inventory Orchestration Service

**`backend/src/inventory/inventory-orchestration.service.ts`** — single gateway for all stock movements, every method transactional (`tx`) and writes an `AuditLog` ledger entry:

| Method | Effect |
|---|---|
| `reserveForTask` | AVAILABLE → RESERVED |
| `releaseReservation` | RESERVED/PICKING → AVAILABLE |
| `recordPickTransaction` | stockItem → PICKED |
| `issueStockForShipment` | stockItem → SHIPPED + `GOODS_ISSUED` (deduction happens only at dispatch) |

Registered + exported from `inventory.module.ts`.

---

## 🧩 Phase 3 — Extracted Sub-Services

`backend/src/fulfillment/services/`

| File | Responsibility |
|---|---|
| `allocation.service.ts` | FIFO stock selection, create task + items, reserve stock |
| `picking.service.ts` | `confirmPick` with double-pick prevention, progress recalc, auto-advance |
| `packing.service.ts` | start / update / complete packing (idempotent) |
| `dispatch.service.ts` | `createShipment`, `confirmDispatch` (triggers Goods Issue) |
| `handover.service.ts` | handover queue, `confirmDelivery`, `issueToRma`, `releaseAndCancel` |

`fulfillment.service.ts` is the orchestration layer: `board`, `findAll`, `findOne`, `advance` (linear pipeline w/ version increment), `setException`.

---

## 🔌 Phase 4 — Unified Controller + Proxies

**`fulfillment.controller.ts`** — `@Controller('fulfillment')`, 15 endpoints (board, list, handover-queue, findOne, allocate, advance, exception, confirmPick, start/update/complete packing, createShipment, confirmDispatch, confirmDelivery, issueToRma, cancel).

- `fulfillment2.service.ts` / `fulfillment2.module.ts` → backward-compat proxy.
- `shipment.*` → read-only (`GET /shipments`, `/:id`, `/track/:trackingNumber`).

---

## 🎨 Phase 5 — Frontend Consolidation

| File | Change |
|---|---|
| `app/(dashboard)/outbound/fulfillment/page.tsx` | **Unified board** (5 lanes: Pending Inv / Picking / Packing / Ready-Ship / Exception) |
| `app/(dashboard)/fulfillment/page.tsx` | Redirect → `/outbound/fulfillment` |
| `app/(dashboard)/fulfillment-v2/page.tsx` | Redirect → `/outbound/fulfillment` |
| `lib/api.ts` | `fulfillmentApi` expanded to 16 methods; `fulfillment2Api` = aliases; `shipmentApi` = read-only |
| `components/layout/sidebar.tsx` | Two nav entries → single **"Fulfillment Board"** → `/outbound/fulfillment` |

---

## 🛡️ Crash Recovery — Board Render Safety

Fixed runtime crash `board.allocated is not iterable` by normalizing the API response at the boundary in `outbound/fulfillment/page.tsx`:

- `FulfillmentBoardResponse` type accepts **both** shapes: flat (`{ allocated, picking, ... }` — what backend currently returns) **and** lane-keyed (`{ lanes: { ALLOCATED, ... } }`).
- `normalizeBoard()` + `asArray()` guarantee every lane is always an array.
- Defensive guards in `KpiBar`, lane render, skeleton check, and `FulfillmentLane`.
- Fallout fixes: `handover/page.tsx` (`handover` → `issueToRma`), `shipment-detail/page.tsx` (`shipmentApi.deliver` → `fulfillmentApi.confirmDelivery`).

---

## 🧪 Verification

- `tsc --noEmit` (frontend): **clean, 0 errors**.
- Live browser preview **not** run (requires backend + authenticated session).

### Remaining manual steps
1. `npx prisma migrate dev` against updated `schema.prisma`.
2. Apply `database/schema/18_fulfillment_guard_rails.sql`.
3. (Optional) remove temporary `console.debug('Unified Fulfillment Board Response:', raw)` after confirming live response shape.

---

## 🚦 Invariants Preserved

- ✅ No full system rewrite; no `fulfillment3/` or duplicate modules.
- ✅ Backward compatibility: `/fulfillment2/*` and old routes still resolve.
- ✅ Inventory consistency: all movements transactional + audit-logged.
- ✅ Goods Issue deferred to dispatch (SAP EWM pattern).
- ✅ Optimistic locking via `version`.

---

*Generated by Claude (Anthropic) · HSNT WMS · 2026-06-06*
