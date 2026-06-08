# HSNT WMS — Executive Dashboard Redesign (Review & Architecture)

> Review only — no code, no logic changes, no schema changes. Grounded in the codebase. Awaiting approval.
> Files reviewed: `dashboard.service.ts`, `dashboard/page.tsx`, `components/dashboard/stat-card.tsx`,
> `reports.service.ts`, and existing aggregation routes.

## Current-state review

**What exists**
- `GET /dashboard/stats` → `{ totals{totalStock,availableStock,pendingRequests,totalProducts}, stockByStatus[], requestsByStatus[], recentAuditLogs[10], lowStockAlerts[5] }` (single uncached call, parallel Prisma queries).
- Frontend: 4 KPI cards + "Stock by status" list + "Recent activity" (8 logs).
- Reusable aggregation already in the codebase: `/reports/summary` (slaRate, doaRate, openRtv, lowStock, groupBy status/ownership), `/inventory/kpi`, `/inventory/summary`, `/products/kpi`, `/warehouse/stats`.

**Weaknesses**
- ❌ No operational/"today" metrics (receiving, putaway, shipments, returns, workload by stage).
- ❌ Not dark-mode compatible — `StatCard` hardcodes `bg-white` / `text-slate-900` / `text-slate-500`.
- ❌ Flat hierarchy; no executive "5-second" readability; no alerts/escalations.
- ❌ No role-aware widgets; no caching; no date indexes used.
- ⚠️ Low-stock metric counts **all** stock items in `reports.summary()` (same bug fixed in `dashboard.service` Phase 1) — `_count.stockItems` should filter `AVAILABLE`.

---

## 1. Information Architecture

Role-aware, top-to-bottom priority (executives read top; supervisors act mid; everyone sees alerts):

```
┌ Header: greeting · date · warehouse selector (multi-WH) · refresh/live toggle ┐
│ A. EXECUTIVE KPI ROW   (8 cards, 4×2 / responsive)                            │  ← all roles
│ B. INVENTORY HEALTH    (stacked bar + 5 chips)        │ E. ALERTS & ESCALATIONS │  ← exec/mgr
│ C. WAREHOUSE OPERATIONS (4 workload cards w/ aging)   │    (severity list)       │  ← supervisor
│ D. REQUESTER INSIGHTS  (3 mini-stats)                 │ F. ACTIVITY TIMELINE     │  ← mgr/requester
└──────────────────────────────────────────────────────────────────────────────┘
```
- **Role visibility:** executives → A,B,E; warehouse mgr/supervisor → A,B,C,E,F; requester → D + their slice of F. Server returns only permitted widgets.
- **Drill-through:** each KPI/workload card links to its operational queue (e.g., Pending Putaway → `/putaway`).

## 2. Component Hierarchy

```
DashboardPage (client)
├─ DashboardHeader (greeting, WarehouseSelector, RefreshToggle)
├─ KpiGrid                          → KpiCard[] {label,value,delta,trend,icon,tone,href}
├─ InventoryHealthCard              (StackedBar + LegendChip[])
├─ AlertsPanel                      → AlertRow[] {severity,label,count,href}
├─ WorkloadGrid                     → WorkloadCard[] {stage,count,oldestAgeH,href}
├─ RequesterInsightsCard            → MiniStat[]
└─ ActivityTimeline                 → TimelineItem[] (grouped, relative time)
```
- **Refactor `StatCard` → `KpiCard`**: theme tokens (`bg-card text-card-foreground border-border`), large numeral, small label, optional delta/trend, optional `href`. Keep `StatCard` as-is for backward compat; add `KpiCard` (additive).
- Shared primitives reused: `Badge`, `Skeleton`, `cn`, `next-themes` (already installed) for dark mode.

## 3. KPI Formulas

**Section A — Executive KPIs**
| Card | Formula |
|---|---|
| Today Receiving | `GoodsReceiving count where createdAt ≥ startOfDay(tz)` |
| Pending Putaway | `StockItem count where status = PENDING_INSPECTION` |
| Pending Approval | `WithdrawalRequest count where status ∈ {SUBMITTED, PENDING_APPROVAL}` |
| Active Fulfillment | `FulfillmentTask count where status ∉ {CLOSED, CANCELLED, RETURNED}` |
| Shipment Today | `Shipment count where shippedAt ≥ startOfDay(tz)` |
| Open Returns | `WithdrawalRequest (items.usageStatus ∈ {UNUSED, WRONG_ITEM}, status ≠ COMPLETED)` + `RTVCase status ≠ COMPLETED` |
| Inventory Accuracy | `100 − (abs adjustment units ÷ total units × 100)` over last cycle-count window (from `StockAdjustment`/cycle-count results); fallback 100% if none |
| Low Stock Alerts | `# products where (StockItem count where status=AVAILABLE) < minStock` *(available-based — do NOT use raw _count)* |

**Section B — Inventory Health** (`StockItem groupBy status`)
`Available=AVAILABLE · Reserved=RESERVED · Picked=PICKED · QC Hold=QUARANTINE+PENDING_INSPECTION · RTV Pending=RTV_PENDING`

**Section C — Warehouse Operations (count + oldest-age)**
| Stage | Count | Aging |
|---|---|---|
| Receiving | `GoodsReceiving where statusEnum=QC_PENDING (or status='pending_inspection')` | oldest `createdAt` |
| Putaway | `StockItem where status=PENDING_INSPECTION` | oldest `receivedDate` |
| Picking | `FulfillmentTask where status ∈ {ALLOCATED,PICKING,PICKED}` | oldest `createdAt` |
| Dispatch | `FulfillmentTask where status ∈ {PACKED,READY_TO_SHIP}` | oldest `updatedAt` |

**Section D — Requester Insights**
`Pending Requests = SUBMITTED+PENDING_APPROVAL · Approved Today = WithdrawalRequest where approvedAt ≥ startOfDay · Delayed = SUBMITTED/APPROVED older than SLA threshold (e.g. 24h)`

**Section E — Alerts & Escalations**
`Low Stock (A) · QC Hold = StockItem QUARANTINE · Aging Receiving = GoodsReceiving pending > N h · DOA = StockItem DOA`

**Section F — Activity Timeline**
`AuditLog latest N (default 15), grouped by entityType, relative time, actor` (reuse `recentAuditLogs`, expanded).

## 4. Required Backend Aggregation APIs

**Reuse:** `/reports/summary` (after fixing its low-stock filter), `/inventory/kpi`, `/warehouse/stats`.
**Add (additive — old `/dashboard/stats` untouched):**
- `GET /dashboard/kpis?warehouseId=` → Section A (+deltas vs yesterday).
- `GET /dashboard/inventory-health?warehouseId=` → Section B.
- `GET /dashboard/workload?warehouseId=` → Section C (counts + aging).
- `GET /dashboard/requester-insights` → Section D.
- `GET /dashboard/alerts?warehouseId=` → Section E.
- `GET /dashboard/activity?limit=` → Section F.

Split endpoints enable independent caching, role-gating, and lazy section loading. All read-only `count`/`groupBy`/`findMany take`; **no business logic touched.** Server applies role + warehouse scoping (reuse the `@CurrentUser` warehouse pattern already in the fulfillment controller).

## 5. Caching Strategy
- **In-memory TTL cache** per aggregate, keyed by `(endpoint, warehouseId, roleScope)`, **TTL 30–60 s** (counts are cheap; cache smooths refresh bursts and the live-toggle 30 s poll).
- **Event-based bust:** subscribe to existing `RealtimeGateway` events (`emitInventoryUpdate`, `emitRequestUpdate`) to invalidate affected keys early (near-real-time without hammering DB).
- No external cache infra (no Redis) at current scale; a `Map`-based `CacheService` (or `@nestjs/cache-manager`) suffices.

## 6. Performance Impact
- Each endpoint = a handful of indexed `count`/`groupBy` queries run in parallel — low cost.
- **Date-bounded queries** need indexes: `GoodsReceiving.createdAt` ✅ (added Phase 1), `AuditLog.createdAt` ✅, **add `Shipment.shippedAt` index** and **`WithdrawalRequest.approvedAt`** (additive, later phase — not now).
- Frontend: sections load independently with skeletons → fast first paint; live poll hits cache, not DB.
- Net: lighter than today's single fat call once cached; slightly more endpoints but each smaller.

## 7. Rollback Plan
- **Feature flag `ENABLE_DASHBOARD_V2`** (frontend env `NEXT_PUBLIC_ENABLE_DASHBOARD_V2`): OFF → current dashboard renders unchanged; ON → new layout. Old `dashboard/page.tsx` preserved (component kept; new layout in a sibling component swapped by the flag).
- Backend new endpoints are **purely additive**; `/dashboard/stats` stays for the legacy page. Removing the flag fully reverts UX with zero data/API risk.
- No schema change in the dashboard phases except optional additive indexes (separately flagged/rollback = drop index).

## 8. Phased Implementation Plan
- **Phase 1 — Foundations (low risk):** add `KpiCard` (dark-mode tokens) alongside `StatCard`; add `/dashboard/kpis` + `/dashboard/inventory-health` (additive, cached). Fix `reports.summary` low-stock filter. *No UI cutover yet.*
- **Phase 2 — New layout behind flag:** `ENABLE_DASHBOARD_V2` renders Sections A + B; old dashboard intact when OFF. **Checkpoint before enabling.**
- **Phase 3 — Operations depth:** `/dashboard/workload`, `/requester-insights`, `/alerts`, `/activity`; render Sections C–F; role-aware gating.
- **Phase 4 — Polish:** event-based cache busting, warehouse selector, deltas/trends, additive date indexes, accessibility/responsive QA.

Each phase: additive migrations only · feature-flagged · backend+frontend typecheck · verify against Supabase · runtime summary · checkpoint before the UI cutover.

---

*No code written. Recommend starting at Phase 1 (KpiCard + 2 additive cached endpoints + the reports low-stock fix) after approval.*
