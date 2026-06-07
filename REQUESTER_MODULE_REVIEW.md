# HSNT WMS — Requester Module: Operational Review & Real-World Redesign

> Architecture review only — no code changes. Grounded in the actual codebase (2026-06).
> Lenses (in priority order): inventory accuracy → real warehouse ops → approval governance → UX.

Files reviewed: `requests.service.ts`, `approval.service.ts`, `rma.service.ts`, `unused.service.ts`,
`fulfillment/services/allocation.service.ts`, `inventory-orchestration.service.ts`, `prisma/schema.prisma`
(`WithdrawalRequest`, `WithdrawalRequestItem`, `RequestStatus`, `AuditLog`, `FulfillmentTask`), sidebar nav.

---

## A. Operational Review

### ✅ What is correct already
- **Goods Issue timing is right.** Stock is only *deducted* (→ `SHIPPED`) at dispatch via `InventoryOrchestrationService.issueStockForShipment` — verified end-to-end. Picking/packing never reduce balance. This matches real WMS practice.
- **Approval reservation uses proper row locking.** `requests.service.approve()` uses `FOR UPDATE SKIP LOCKED` per unit — correctly prevents the double-allocation race under concurrency.
- **Cancellation is reversible and guarded.** `cancel()` releases only still-`RESERVED` rows and blocks cancel after `SHIPPED/ISSUED_TO_RMA/COMPLETED`. Good.
- **Transactions wrap multi-entity mutations** in RMA/unused/approve — atomic, with audit rows inside the tx.
- **There is a real multi-step approval engine** (`ApprovalRule` / `ApprovalInstance` / `ApprovalInstanceStep`) with role-based steps, timeouts, and notifications.

### ❌ What is unrealistic / what will break at scale

1. **Two reservations for one request (the #1 inventory risk).**
   Stock is reserved **at approval** (`requests.service.ts:121-150`, one `StockItem` per unit, links the *first* unit to the line via `stockItemId`) **and again at allocation** (`allocation.service.ts` re-runs its own FIFO `findFirst` over `status IN (AVAILABLE, RESERVED)` and calls `reserveForTask`). Consequences:
   - Allocate can grab a row that is **already `RESERVED` for a different request** (the query includes `RESERVED`), double-booking one physical unit.
   - Allocate may pick a **different** `StockItem` than the one reserved at approval → the approval-reserved unit is **orphaned in `RESERVED` forever** (ghost reservation, never released by cancel because the link no longer matches what shipped).
   - This violates your own rule *"picking must reserve, not double-handle"* and breaks SSOT.

2. **The shipped unit and the RMA/usage unit can be different physical items.**
   `rma.confirmUsage()` and `unused.returnToStock()` mutate `item.stockItemId` — the unit linked **at approval**. But the unit actually picked/shipped is the one chosen by `allocate`/pick. If they differ (see #1), `USED→CONSUMED` marks the **wrong** item consumed, while the truly-shipped item is left `SHIPPED`. **Permanent inventory inaccuracy.**

3. **Two disconnected approval systems.**
   `requests.approve()` (simple, inline, reserves stock) does **not** use the `ApprovalService` engine. The sophisticated rule/step engine exists but isn't wired to withdrawal requests. Result: duplicated responsibility, no segregation of duties, and the "governance" engine is effectively dead for the main flow.

4. **Two parallel state machines for one physical process.**
   `RequestStatus` carries `PICKING, PICKED, PACKED, READY_FOR_PICKUP, SHIPPED` *and* `FulfillmentTask.status` carries the same lifecycle. Post-consolidation, the request statuses `PICKED/PACKED/READY_FOR_PICKUP/SHIPPED` are **dead** — `allocate` jumps request to `PICKING`, handover jumps it to `ISSUED_TO_RMA`, nothing sets the middle ones. Two machines must be hand-synced → drift.

5. **`ISSUED_TO_RMA` is overloaded.** It means both "issued, awaiting usage confirmation" (`rma.pendingUsage`) and "unused, awaiting return verification" (`unused.pending` filters the same status by item `usageStatus`). One status, two operational meanings → queue confusion.

6. **`quantityIssued` is dead/untrustworthy.** Defaults to 0, never written by the dispatch path (dispatch updates `StockItem`, not the request line). Any report reading `quantityIssued` is wrong.

7. **`approve()` couples authorization with a warehouse action.** An approver's click physically reserves stock. In real ops, approval = *authorize*; reservation/allocation = *warehouse* responsibility. Coupling them gives approvers inventory-mutating power and makes "approved but not yet reservable" impossible to model.

### What causes inventory inaccuracies (summary)
Double reservation (#1), shipped-vs-linked unit mismatch (#2), ghost `RESERVED` rows from orphaned approval reservations, and `quantityIssued` never reconciled.

### What causes user confusion
Overloaded `ISSUED_TO_RMA` (#5); dead request statuses (#4); two approval paths (#3); returns that silently flip to `AVAILABLE` with no inbound inspection step.

### Who owns what (current vs intended)
| Phase | Current owner | Should be |
|---|---|---|
| Create / submit request | Requester | Requester ✅ |
| Approve (authorize) | Approver **+ reserves stock** | Approver authorizes only |
| Reserve / allocate stock | Approver **and** Warehouse (twice) | **Warehouse only, once** |
| Pick / pack / dispatch | Warehouse ✅ | Warehouse ✅ |
| Confirm usage (USED/DOA) | Requester/RMA on approval-linked unit | Requester/RMA on **actually-issued** unit |
| Return unused / inbound QC | Warehouse (status flip only) | Warehouse via **inbound + QC gate** |

---

## B. Recommended Real-World Workflow

**Single guiding rule:** *one reservation, carried by one `stockItem` link, from reservation → pick → dispatch → usage/return.* Deduction only at Goods Issue.

### Canonical outbound flow (all withdrawal types)
```
DRAFT → SUBMITTED → PENDING_APPROVAL → APPROVED
  → (warehouse) ALLOCATED → PICKING → PICKED → PACKING → PACKED
  → READY_TO_SHIP → SHIPPED(Goods Issue) → DELIVERED
  → (post-issue) USAGE_PENDING → COMPLETED
                              ↘ RETURN_PENDING → (QC) AVAILABLE | RTV_PENDING
```
- **WithdrawalRequest** should own only the *request-level* lifecycle: `DRAFT → SUBMITTED → PENDING_APPROVAL → APPROVED → IN_FULFILLMENT → ISSUED → CLOSED` (+ `REJECTED/CANCELLED`). The granular pick/pack/ship states live **only** on `FulfillmentTask`. The request mirrors a *coarse* status derived from the task.

### Withdrawal-type matrix
| Type | Approval | Reservation | Deduction | Return path |
|---|---|---|---|---|
| Internal withdrawal | 1-step (manager) | at allocate | at dispatch | unused→QC |
| Project usage | 2-step (manager + project owner) | at allocate | at dispatch | unused→QC |
| Technician issue | 1-step or auto under threshold | at allocate | at dispatch (or van-stock issue) | unused→QC |
| Consumables | auto-approve under qty/value threshold | at allocate | at dispatch | usually none (CONSUMED) |
| Temporary issue (loan) | 1-step | at allocate | at dispatch | **expected return**, due date tracked |
| Return unused | n/a (return order) | n/a | **reverse** (re-add) | inbound + QC |
| Damaged | n/a | n/a | quarantine | → RTV / scrap |
| RMA flow | per RMA policy | at allocate | at dispatch | vendor RTV |

### Ownership transitions
- **Requester:** edits only while `DRAFT`; may `CANCEL` until `ALLOCATED`; confirms usage post-issue.
- **Approver:** decides on `SUBMITTED/PENDING_APPROVAL`; **no stock mutation**.
- **Warehouse:** owns everything from `ALLOCATED` onward (reserve, pick, pack, dispatch, inbound QC on returns).

### Approval rules
- Drive via the **existing `ApprovalService` engine** (wire it in additively). Thresholds: auto-approve consumables under a configurable qty/value; require manager for standard; second step for high-value/project.
- Approval = authorization only; it sets `APPROVED` and (optionally) a **soft availability check** (read-only count), never `StockItem.status`.

### Inventory movement timing (target)
- **Reserve:** once, at `allocate` (warehouse), via `InventoryOrchestrationService.reserveForTask`.
- **Pick:** `RESERVED → PICKED` (no balance change).
- **Deduct (Goods Issue):** `PICKED → SHIPPED` at dispatch — already correct.
- **Return:** reverse via an explicit **inbound** that re-creates/reactivates stock through QC, never a bare status flip.

### Audit-trail expectations
- Every state transition and every stock movement → one immutable `AuditLog` row with **structured** `detail` (JSON, consistent schema), `entityType/entityId`, actor, and `correlationId` (requestId↔taskId↔shipmentId) so the full chain is queryable.

### Who can edit what, by phase
| Phase | Requester | Approver | Warehouse |
|---|---|---|---|
| DRAFT | edit/delete | – | – |
| SUBMITTED/PENDING_APPROVAL | view, cancel | approve/reject | view |
| APPROVED → ALLOCATED | cancel (pre-alloc) | view | allocate |
| PICKING…SHIPPED | view | view | full |
| Post-issue (usage/return) | confirm usage | view | inbound/QC |

---

## C. Data Model Review

| Entity | Verdict | Notes |
|---|---|---|
| `WithdrawalRequest` | **Keep + slim status** | Add `version Int` (optimistic lock), `type` (enum: INTERNAL/PROJECT/TECH/CONSUMABLE/TEMP/RMA), `warehouseId`, `expectedReturnDate` (temp issues). Reduce `RequestStatus` to coarse request-level states; **deprecate** `PICKED/PACKED/READY_FOR_PICKUP` (keep as `@deprecated`, don't drop). |
| `WithdrawalRequestItem` | **Keep + fix** | `quantity*` are `Float` — for discrete units prefer integer semantics or document UoM. **`quantityIssued` must be written at dispatch** (reconcile from the task), or deprecate it. `usageStatus`/`usageNotes` are free strings → make `usageStatus` an enum. Move the authoritative issued-unit link to the **fulfillment task item**, not here. |
| `FulfillmentTask` | **Keep (SSOT for execution)** | Already has `version`. This should be the **only** owner of pick/pack/ship state. Request mirrors a coarse status from it. |
| `Shipment` | **Keep** | Has `dispatchedById`, `podReference`. Fine. |
| RMA (`RTVCase` + RMA-as-request) | **Split concepts** | Today "RMA" = (a) `rmaCaseNumber` string on a withdrawal request + usage flow, and (b) `RTVCase` for vendor returns. These are different domains; keep `RTVCase` for vendor RTV; model "issued-to-RMA usage" as a post-issue sub-state, not a status overload. |
| Approval | **Merge onto the engine** | `ApprovalInstance/Step/Rule` exist and are good — **deprecate the inline approve-reserves-stock path** in favor of engine-driven decisions. Keep `WithdrawalRequest.approverId/approvedAt` as denormalized convenience, sourced from the instance. |
| Handover | **Keep as fulfillment sub-state** | Already lives in `handover.service` (issueToRma/confirmDelivery). No separate entity needed. |
| `AuditLog` | **Keep + harden** | Make immutability explicit (DB: revoke UPDATE/DELETE for app role, or append-only trigger). Standardize `detail` as JSON. Add index on `(action, createdAt)` for ledger queries. |

**Missing fields:** `WithdrawalRequest.version`, `type`, `warehouseId`, `expectedReturnDate`; structured `AuditLog.detail`; a `correlationId` linking request↔task↔shipment.
**Dangerous fields:** `quantityIssued` (silently wrong); overloaded `ISSUED_TO_RMA`; `WithdrawalRequestItem.stockItemId` used as the "shipped unit" when it's only the approval-linked unit.
**Optimistic locking needs:** `WithdrawalRequest` (none today) — required to make approve/cancel/allocate concurrency-safe at the request level (task already has it).
**Immutable audit:** enforce at DB level, not just convention.

---

## D. Frontend UX Review

Current Requester sidebar group: **Withdrawal Requests · Approval Queue · RMA Usage · Unused Return**.

| Menu | Recommendation |
|---|---|
| **Withdrawal Requests** | **Keep** as the requester home. Make it state-aware tabs: *My Drafts / Pending Approval / In Fulfillment / Issued / Closed*. Add **reservation visibility** (reserved vs available) per line. |
| **Approval Queue** | **Move to a cross-cutting "Approvals" surface** driven by the approval engine (not requester-owned). An approver is not a requester; today it sits in the requester group, which conflates roles. Keep visible only to approver roles. |
| **RMA Usage** | **Convert to a post-issue tab/state**, not a top-level menu. It's a step in a request's life ("confirm what you did with issued goods"), surfaced on the request detail + a focused worklist. |
| **Unused Return** | **Move to the Warehouse side** (it's an *inbound* operation: receive → QC → putaway/RTV). Requester only *initiates* a return; warehouse executes it. Today it silently flips `→ AVAILABLE` with no inbound — operationally wrong. |

**Dashboard widgets (requester):** My open requests by state; items awaiting my usage confirmation; temp issues due for return; rejected needing rework; SLA on approvals.
**Requester notifications:** approved/rejected (exists), allocated/picking started, dispatched/ready for pickup, usage-confirmation reminder, temp-return due.
**Approval UX:** show the engine's step chain, who's next, due time, and a read-only **availability check** at decision time (so approver sees feasibility without reserving).
**Inventory/reservation visibility:** on each request line show requested / approved / reserved / picked / issued, sourced from the task — single coherent picture.

---

## E. Technical Refactor Plan (additive, no-downtime)

**Non-negotiables preserved:** keep fulfillment architecture; no route deletion; proxy/adapter pattern; reserve-at-allocate / deduct-at-dispatch; reversible auditable returns.

### Migration strategy (additive only)
1. **Schema (additive):** add `WithdrawalRequest.version`, `type`, `warehouseId`, `expectedReturnDate`; add `correlationId`; standardize new `AuditLog` writes to JSON `detail`. All `ADD COLUMN ... NULL/DEFAULT`. No drops; deprecated statuses stay in the enum.
2. **Single reservation authority:** stop mutating `StockItem.status` in `requests.approve()`. Approval becomes authorization + read-only availability check. `allocate` remains the **sole** reservation point. *Backward-compat:* keep `approve()` route/signature; behind a feature flag, switch its internal behavior (reserve → don't reserve) so rollback is config-only.
3. **Carry the unit link forward:** make RMA/unused operate on the **fulfillment task item's** issued `stockItemId` (resolve via the task), not the approval-linked one. Adapter resolves "the unit that actually shipped."
4. **Wire the approval engine:** on `submit`, additively call `ApprovalService.startApproval('WithdrawalRequest', id, …)`; `approve()` becomes a thin adapter over `ApprovalService.decide`. No-rule fallback already auto-approves (preserves current behavior).
5. **Returns as inbound:** route `unused.returnToStock` through a proper inbound (receiving/putaway/QC) instead of a bare status flip; keep the old endpoint as a proxy that creates the inbound.

### Backward compatibility
- All existing routes (`/requests`, `/approval`, `/rma`, `/unused`) stay; internals swapped behind adapters/flags.
- Deprecated enum values retained; UI stops *producing* them but still *renders* them.
- Feature-flag each behavioral change for instant rollback.

### Phased rollout
- **Phase 1 (safety):** add `version` + optimistic lock on request; fix double-reservation (flag-gated); fix RMA/unused to use the shipped unit. *Highest inventory-accuracy ROI.*
- **Phase 2 (governance):** wire approval engine; decouple approval from reservation; approvals UX.
- **Phase 3 (returns):** unused-return → inbound+QC; warehouse ownership move.
- **Phase 4 (model/UX cleanup):** slim `RequestStatus`; request shows derived coarse status + reservation visibility; dashboards/notifications.

### API compatibility approach
Keep signatures; add **new optional** fields/endpoints; never change response shapes destructively. New behavior gated by flags; old clients keep working.

### No-downtime migration
Additive columns first (safe on live) → deploy code that *reads* new+old → backfill (`quantityIssued`, `correlationId`) in background → flip flags → later (separate cycle) mark deprecated fields. No table locks beyond fast `ADD COLUMN`.

---

## Closing Summary

### 1. Critical issues (fix first — inventory integrity)
- **C1. Double reservation** (approval *and* allocate) → double-booking + ghost `RESERVED`. (`requests.service.ts:121-150` vs `allocation.service.ts`)
- **C2. RMA/unused act on the wrong unit** (approval-linked, not shipped) → permanent stock inaccuracy. (`rma.service.ts:43-48`, `unused.service.ts:38-42`)
- **C3. No optimistic lock on `WithdrawalRequest`** → approve/cancel/allocate races.
- **C4. `ISSUED_TO_RMA` overloaded** → wrong queues / mis-routing.

### 2. Medium-priority improvements
- Wire withdrawal requests to the **approval engine**; decouple approval from stock reservation.
- Returns via **inbound + QC**, not status flip; move "Unused Return" to warehouse.
- Fix or deprecate **`quantityIssued`**; reconcile issued qty at dispatch.
- Harden **AuditLog** immutability + structured `detail` + correlationId.

### 3. Nice-to-have enhancements
- Withdrawal **`type`** + threshold-based auto-approval for consumables.
- **Temporary-issue** return tracking with due dates.
- Requester **dashboard widgets** + richer notifications + reservation visibility per line.

### 4. Recommended final Requester architecture
- **WithdrawalRequest** = request-level intent + coarse status (derived from task), version-locked, typed.
- **ApprovalInstance** = authorization (governance engine), no stock effects.
- **FulfillmentTask** = single execution SSOT (reserve→pick→pack→ship), the only owner of granular state and the authoritative issued-unit link.
- **Inventory** = SSOT for movement; reserve once at allocate, deduct once at dispatch.
- **Returns** = inbound operations (receive→QC→putaway/RTV), reversible + audited.
- Requester UI = state-aware request workspace; Approvals + Returns surfaced to their real owners.

### 5. Suggested implementation order
1. C3 (version/optimistic lock) → 2. C1 (single reservation, flag-gated) → 3. C2 (shipped-unit linkage) →
4. Approval engine wiring + decouple (C-medium) → 5. Returns-as-inbound → 6. C4 + status slim + UX/dashboards.

*Each step is additive, flag-guarded, and preserves existing routes and the fulfillment architecture.*
