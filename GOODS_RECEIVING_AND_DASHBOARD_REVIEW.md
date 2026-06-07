# HSNT WMS — Goods Receiving & Dashboard: Architectural Review & Redesign

> **Review only — no code written.** Grounded in the actual codebase (2026-06).
> Awaiting checkpoint approval before any implementation.

Files reviewed: `receiving.service.ts`, `dashboard.service.ts`, `dashboard/page.tsx`, `receiving` schema
(`GoodsReceiving`, `GoodsReceivingItem`, `StockItem`, `Product`, `StockStatus`), sidebar nav.

---

# PART 1 — GOODS RECEIVING

## Phase A — Operational Review (current state)

**How it works today**
- `POST /receiving` creates a `GoodsReceiving` (status free-string `"pending_inspection"`) and, in one transaction, **immediately creates a `StockItem` per line** (status `PENDING_RECEIVING`, or `DOA`/`DAMAGED` by `condition`).
- `PATCH /receiving/:id/verify` moves good stock → `PENDING_INSPECTION`, DOA → `RTV_PENDING`, damaged → `QUARANTINE`; sets receiving → `"completed"`.
- Putaway later confirms `PENDING_INSPECTION` → `AVAILABLE`.
- Serial uniqueness is validated pre-write; `Product.serialControlled` is enforced.

**What's correct already**
- ✅ All-or-nothing transaction on create; serial dedup (in-payload + against active stock); serial-controlled enforcement.
- ✅ DOA/damaged routed to distinct states; audit rows on create + verify.
- ✅ 3-stage stock lifecycle exists: `PENDING_RECEIVING → PENDING_INSPECTION → AVAILABLE`.

### Findings

| Area | Status | Finding |
|---|---|---|
| 1. Workflow | ⚠️ | Only 2 receiving states (`pending_inspection` → `completed`). No DRAFT, QC_HOLD, PARTIAL, REJECTED. |
| 2. Data model | ❌ | `GoodsReceiving.status` is a **free String**, not an enum → typos, no integrity. No `poNumber`, no `supplierId` (only free `sourceRef`/`sourceType`). |
| 3. Statuses | ❌ | Inconsistent casing (`"pending_inspection"`, `"completed"` lowercase) vs `StockStatus` enum (UPPER). Comment in `verify()` says "become AVAILABLE" but code sets `PENDING_INSPECTION` — misleading. |
| 4. FG vs 5. Spare | ⚠️ | `Product.productType` (FG/SPARE_PART) exists but receiving treats both identically — no FG-specific (lot/expiry) vs spare (serial/part-no) handling. |
| 6. Barcode / 7. QR | ❌ | **No `barcode` field on `Product`.** Receiving has no scan-to-receive; a separate `ScanModule`/scanner page exists but isn't wired into receiving. |
| 8. Batch/Lot | ❌ | `StockItem.batchNumber` + `expiryDate` exist, but **`GoodsReceivingItem` captures neither batch, expiry, nor manufacture date**; no `Product.batchControlled` flag. Batch is effectively unreachable from the receiving UI. |
| 9. Serial | ✅/⚠️ | Validated, but one serial per line only; multi-unit serialized receipts (qty N, N serials) aren't modeled (qty is a Float on one row). |
| 10. Supplier ref | ❌ | No link to `Vendor`; supplier is free text → no supplier analytics, no validation. |
| 11. QC flow | ❌ | "Verify" conflates receiving confirmation with QC. No sampling, no QC hold/release, no QC actor/result capture. |
| 12. Putaway readiness | ✅ | Works (`PENDING_INSPECTION` feeds putaway queue). |
| 13. Audit | ⚠️ | Create/verify audited; but no per-line discrepancy log, no QC decision audit, `detail` is a plain string. |
| 14. Roles | ⚠️ | Receiving guarded by JWT; no fine-grained receiver vs QC vs supervisor separation. |
| 15. Real-warehouse gaps | ❌ | Blind-only (no expected qty / PO / ASN) → **no over/short detection**; no Excel bulk receive; no multi-line scanning. |

**Critical issues**
- **C1.** `GoodsReceiving.status` is a free string with inconsistent casing → integrity risk, no reliable querying/reporting.
- **C2.** No batch/lot/expiry/manufacture-date capture at receipt despite FG/expiry needs → unusable for FEFO and consumables.
- **C3.** No expected-vs-received (no PO/ASN) → over/short receiving undetectable; no reconciliation.
- **C4.** No barcode/QR on `Product` and no scan-to-receive → manual entry only, error-prone at scale.

**Medium issues**
- No supplier (`Vendor`) linkage; no QC hold/release; large receipts run as one synchronous transaction (Supabase pooler timeout risk for 100s of lines); no Excel bulk import.

**Nice-to-have**
- ASN pre-receipt; label/GRN print; putaway suggestions; receiving SLA/aging; cross-dock.

## Phase B — Target Real-World Workflows

**Recommended `ReceivingStatus` enum (additive; keep old string values mapped):**
```
DRAFT → RECEIVING → QC_PENDING → (QC_HOLD) → PUTAWAY_PENDING → COMPLETED
                                           ↘ PARTIAL  ↘ REJECTED  ↘ CANCELLED
```

| Flow | Capture at receipt | QC | Stock outcome |
|---|---|---|---|
| **Finished Goods** | lot, mfg/expiry date, qty (UOM) | sample/visual | FEFO-ready `AVAILABLE` |
| **Spare Parts** | part no, serial (if controlled) | visual | `AVAILABLE` |
| **Consumables** | lot, expiry, qty | minimal | `AVAILABLE`, FEFO |
| **Serialized** | one serial per unit | per-unit | per-unit `AVAILABLE` |
| **Batch/Lot** | batch + expiry, qty | sample | lot stock |
| **DOA/Damaged** | condition + photo/note | mandatory | `DOA→RTV_PENDING` / `DAMAGED→QUARANTINE` |
| **Excess/Short** | expected vs received | n/a | over→QC_HOLD/reject; short→PARTIAL |
| **Supplier return** | original GRN ref | n/a | route to RTV |
| **QC hold** | reason, sample size | hold/release | `QC_HOLD` → release `PUTAWAY_PENDING` or `REJECTED` |
| **Blind** | no expected (current behavior) | normal | unchanged |
| **ASN-ready (future)** | match against ASN/PO | normal | auto-populate lines |

**Ownership:** Receiver creates/records → QC inspector holds/releases → Putaway operator stocks. Each transition audited with actor + correlationId (reuse the Phase-1 `AuditLog.correlationId`).

## Phase C — Excel Upload Architecture

**Flow:** Download template → upload `.xlsx/.csv` → **server-side parse + validate → preview (dry-run) → confirm import → result report**.

- **Parser:** `exceljs` is already a dependency. Add a `ReceivingImportService` that parses to rows, validates each (SKU exists, supplier exists, qty>0, barcode format, serial uniqueness, dup detection within file + DB), returns a structured `{ valid[], errors[] }` **without writing** (preview).
- **Columns:** PO No, Supplier, SKU, Description, Qty, UOM, Lot No, Serial No, Barcode, Location, Manufacture Date, Expiry Date.
- **Transaction strategy:** import in **batches** (e.g., 100 lines/tx) — not one giant tx (Supabase pooler). **Partial success** allowed: commit valid batches, collect failed rows into a downloadable error report. Each import = one `ImportBatch` audit record (file name, counts, actor).
- **Async for large files:** small files (<~200 rows) synchronous; larger → background job. The app already has `@nestjs/schedule`; a lightweight DB-backed job table + worker is sufficient (no new broker). Return a job id; poll status.
- **Rollback:** per-batch; a failed batch rolls back only itself. Preview step is the primary safeguard.

## Phase D — Barcode / QR Scanning

**Prereq:** add `Product.barcode` (+ optional `gtin`) — currently missing.

- **Frontend:** receiving page gains a **scan mode** — a focused input that captures USB-scanner keyboard-wedge input (auto-submit on Enter, auto-refocus), plus `html5-qrcode` (already a dep) for mobile camera. Multi-scan: each scan increments qty for the matched SKU/serial; duplicate-serial scans rejected inline.
- **Formats:** CODE128, QR, GS1 (parse AI fields: lot/expiry/serial), EAN13.
- **Backend:** a `validateScan(barcode)` endpoint resolves SKU/serial, checks duplicates, returns product + expected handling. Keep validation server-side (source of truth); debounce client-side for latency.
- **Latency/offline:** optimistic UI increment + background confirm; queue scans if offline and flush on reconnect (Phase 4, optional).
- **Keyboard-free:** scanner-wedge flow needs no mouse; cursor auto-returns to the scan field after each item.

---

# PART 2 — DASHBOARD REDESIGN (Phase E)

## Current state review
- **4 KPI cards:** Total Stock, Available, Pending Requests, Active Products.
- **2 panels:** Stock-by-status list, Recent Activity (last 8 audit logs).
- Single `GET /dashboard/stats`, parallel Prisma queries, **no caching**, **no date-bounded ("today") metrics**, **no workload-by-stage**, **no role-aware widgets**.

**Weaknesses**
- **Bug:** `lowStockAlerts` uses `_count.stockItems` (all statuses incl. shipped/consumed) — it does **not** reflect *available* qty, so "low stock" is wrong.
- Not dark-mode compatible (hardcoded `bg-white`/`text-slate-900`).
- No operational awareness (receiving/putaway/picking/dispatch workload, shipments today, returns, QC hold).
- Flat hierarchy; no executive "5-second" readability; no escalations.

## Proposed Information Architecture
```
1. Executive KPI row (8 cards)   — Today Receiving · Pending Putaway · Pending Approval ·
                                    Active Fulfillment · Shipments Today · Low Stock ·
                                    Open Returns · Inventory Accuracy
2. Inventory Health              — Available · Reserved · Picked · QC Hold · RTV Pending  (stacked bar + chips)
3. Warehouse Operations workload — Receiving · Putaway · Picking · Dispatch  (queue counts + aging)
4. Shipment performance          — dispatched today · in-transit · delivered · SLA
5. Requester operations          — pending · approved today · delayed
6. Alerts & escalations          — low stock · DOA · aging receiving · failed QC
7. Activity timeline             — grouped, human-readable
```

## Component hierarchy
```
DashboardPage
├─ KpiGrid (role-aware) → KpiCard[]   (value, delta, icon, trend, href)
├─ InventoryHealthCard (stacked bar + legend chips)
├─ WorkloadGrid → WorkloadCard[] (stage, count, aging badge, link to queue)
├─ ShipmentPerformanceCard
├─ RequesterInsightsCard
├─ AlertsPanel → AlertRow[] (severity-colored, actionable links)
└─ ActivityTimeline (grouped by entity, relative time)
```

## KPI formulas
| KPI | Formula |
|---|---|
| Today Receiving | `GoodsReceiving count where createdAt ≥ startOfDay` |
| Pending Putaway | `StockItem count where status = PENDING_INSPECTION` |
| Pending Approval | `WithdrawalRequest where status ∈ {SUBMITTED, PENDING_APPROVAL}` |
| Active Fulfillment | `FulfillmentTask where status ∉ {CLOSED, CANCELLED, RETURNED}` |
| Shipments Today | `Shipment where shippedAt ≥ startOfDay` |
| Low Stock | `# products where (AVAILABLE qty) < minStock` *(fix the current bug — count AVAILABLE only)* |
| Open Returns | `WithdrawalRequest items usageStatus ∈ {UNUSED, WRONG_ITEM} not COMPLETED` + open `RTVCase` |
| Inventory Accuracy | `1 − (abs adjustment units / total units)` from `StockAdjustment`/cycle-count results |
| Inventory Health | `StockItem groupBy status` → map AVAILABLE/RESERVED/PICKED/(QUARANTINE+PENDING_INSPECTION=QC)/RTV_PENDING |
| Workload aging | oldest item age per queue (receiving/putaway/picking/dispatch) |

## Backend aggregation APIs
- Extend `DashboardService` with `getOps()` (workload + today metrics + alerts) — or split into `/dashboard/kpis`, `/dashboard/inventory-health`, `/dashboard/workload`, `/dashboard/alerts` for independent caching and role-gating.
- **Caching:** short-TTL in-memory (30–60 s) per aggregate (counts are cheap at current scale; cache mainly to smooth refresh bursts). Add `@@index` on `GoodsReceiving.createdAt`, `Shipment.shippedAt` for date-bounded queries.
- **Role-aware:** server filters widgets by role (executives → KPIs + health; supervisors → workload; requesters → their insights).

## UX requirements
Responsive grid (1/2/4 cols), **dark-mode tokens** (replace hardcoded `bg-white`/`text-slate-900` with theme classes — `next-themes` is already installed), card hierarchy with consistent spacing, large numerals + small labels + trend deltas, severity-colored alerts, links from each card to its operational queue.

---

# Phase F — Implementation Plan

1. **Architecture review:** receiving needs a real status enum + line-level lot/expiry/serial + supplier link; dashboard needs ops aggregation + caching + dark mode. All additive.
2. **UX review:** receiving → add scan mode + bulk import + QC step; dashboard → 7-section IA above.
3. **Database impact (additive only):** `GoodsReceiving`: `+status enum` (keep string mapping / shadow column), `+poNumber`, `+supplierId`, `+expectedDate`. `GoodsReceivingItem`: `+batchNumber`, `+expiryDate`, `+manufactureDate`, `+expectedQty`, `+location`. `Product`: `+barcode`, `+batchControlled`. New: `ReceivingImportBatch` (audit), optional job table. **No drops, no enum value removals.**
4. **API impact:** keep `POST /receiving`, `/verify` working; **add** `/receiving/import/{template,preview,commit}`, `/receiving/scan/validate`, QC endpoints, and dashboard aggregation endpoints. No breaking changes.
5. **Migration strategy:** additive SQL (`ADD COLUMN ... NULL/DEFAULT`, new tables, new indexes), applied idempotently to Supabase (same pattern as Phases 1–5). Map legacy string statuses → enum via a tolerant adapter.
6. **Rollback:** feature-flag risky flows (`ENABLE_RECEIVING_QC`, `ENABLE_RECEIVING_IMPORT`, `ENABLE_SCAN_RECEIVING`, `ENABLE_DASHBOARD_V2`); flags OFF = current behavior. Columns/tables are inert until used.
7. **Performance:** batch imports; date-indexed dashboard queries; cached aggregates; avoid single mega-transaction.
8. **Security:** server-side validation for scans/imports; role-gated QC + import; file-type/size limits; audit every import/scan/QC decision.
9. **Mobile usability:** camera scan, large tap targets, keyboard-free receiving, responsive dashboard.
10. **Phased rollout (per Phase G rules — additive, flagged, typecheck + Supabase verify each phase):**
    - **Phase 1 (low-risk additive):** add columns/enum (shadow), supplier link, line-level lot/expiry/serial capture; fix low-stock KPI bug. No UI restructure.
    - **Phase 2 (upload/scanning):** Excel template/preview/commit + barcode/QR scan-to-receive (flagged).
    - **Phase 3 (dashboard redesign):** ops aggregation APIs + new dashboard IA + dark mode (flagged `ENABLE_DASHBOARD_V2`; old dashboard preserved). **Checkpoint before this UI rewrite.**
    - **Phase 4 (advanced workflow):** QC hold/release, ASN-ready, over/short reconciliation, putaway suggestions.

## Phase G — Coding rules (acknowledged, for when approved)
Additive migrations only · no destructive changes · preserve existing APIs · feature-flag risky flows · verify against running Supabase · typecheck FE/BE each phase · runtime verification summary · **checkpoint before major UI rewrites (dashboard Phase 3, receiving scan UI)**.

---

## Closing — recommended order
1. Receiving Phase 1 (additive model: enum + lot/expiry/serial + supplier) + low-stock KPI fix.
2. Dashboard ops APIs + redesign (flagged) — *checkpoint first*.
3. Excel import.
4. Barcode/QR scan-to-receive.
5. QC hold/release + over/short + ASN-ready.

*No code written. Awaiting approval to proceed (recommend starting with Receiving Phase 1 + the low-stock KPI bug fix, both low-risk additive).*
