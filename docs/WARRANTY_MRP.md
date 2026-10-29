# Warranty Rules and Material Planning (MRP)

Status: integrated onto `master` 621187c (after PR #14) on branch `claude/mrp-wms-system-c06346`; **not deployed**.
Migration: `database/schema/26_warranty_mrp.sql` (additive only; must be applied before the code is merged — merging to `master` deploys).

Both modules extend the existing WMS. Neither changes authentication, receiving, reservation, fulfilment, RMA, DOA or RTV workflows.
MRP only *reads* those modules. Warranty only *reads* them and writes its own tables.

---

## 1. What already existed (capability assessment)

| Area | Existing in the WMS | Used by |
|---|---|---|
| Stock by status | `StockItem` (status, warehouse, serial, received date) | MRP position, warranty facts |
| Goods issue | Dispatch: `Shipment.shippedAt` + `FulfillmentTaskItem.qtyPicked`, audit `GOODS_ISSUED` | MRP usage, warranty `GOODS_ISSUE_DATE` |
| Unused returns | audit `UNUSED_RETURNED_TO_STOCK` | MRP usage (subtracted) |
| Repair consumption | audit `RMA_USAGE_CONFIRMED` with `Usage: USED` | MRP confirmed usage |
| Open demand | Withdrawal requests + reservations (legacy or unified mode) | MRP confirmed demand |
| Receipts | `GoodsReceiving` with `poNumber`, `supplierId`, `expectedDate` | MRP PO receipt matching, warranty vendor |
| Product master | `Product` (model, category, brand, type, `unitCost` without currency, `minStock`) | Both |
| Vendors, brands | `Vendor`, `Brand` | Both |
| Access control | `ACCESS` rules + `AccessGuard`, warehouse scope, maker ≠ checker helper | Both |

## 2. Gaps found and how they were handled

| Gap | Handling |
|---|---|
| No purchase-order table | New `InboundSupplyLine`, filled only by controlled file import from the purchasing system. Never edited or created by MRP. |
| No supplier-per-product data | New `MaterialSupplier` (approved/preferred, lead time, MOQ, multiple, price + currency + validity, purchase unit conversion). |
| No planning parameters | New `MaterialPlanningParam`, versioned by effective date, all-warehouse or per-warehouse. |
| `Product.unitCost` has no currency | Used only as a last-resort, *labelled* cost with currency "not specified"; never added to costs in a currency. |
| No warranty data | New `WarrantyRule` (versioned), `WarrantyDateRecord`, `WarrantyCheck` (log). No rules are seeded. |
| Invoice / installation / activation dates not captured | Recorded per serial in `WarrantyDateRecord`; until recorded, status is `START_DATE_UNKNOWN`. |
| No customer entity | Customer-scoped warranty rules **not implemented**. |
| Requests are not tied to a warehouse | Open demand is included only in a network (all-warehouse) run; a single-warehouse run warns. |
| Stock transfers have no structured destination | Transfers are **not** counted as supply. |

## 3. Data sources and field mapping

**Usage (per material, per period)**
- Issue = quantity picked on fulfilment tasks whose shipment has `shippedAt`, dated at `shippedAt`, warehouse of the stock item.
- Unused return = `UNUSED_RETURNED_TO_STOCK` quantity, dated at the audit time.
- Confirmed usage = `RMA_USAGE_CONFIRMED` with `Usage: USED`.
- Basis `NET_ISSUES` (default) = issues − unused returns, floored at 0 per period; `CONFIRMED_USAGE` = confirmed usage only.
- Receipts, transfers, adjustments, cycle counts and PO quantities are never usage. Only completed periods are used.

**Inventory position** (`StockItem.status`): available, allocated/reserved, blocked/quarantine, inspection (usable only if configured). On hand = all of these.

**Supply**: `InboundSupplyLine` with status OPEN/PARTIAL in the user's warehouses. Outstanding = ordered − cancelled − max(reported received, WMS received). WMS received = `GoodsReceivingItem` quantity on receipts with the same PO number and product (not cancelled/rejected), assigned to that PO's lines in line order. A line in a different unit is used only if the supplier entry has a conversion factor.

**PO import columns**: `poNumber, lineNumber, sku, vendorCode, warehouseCode, orderedQty, receivedQty, cancelledQty, uom, unitCost, currency, orderDate, expectedDate, confirmed, status, lastReceiptDate, notes`. Template: `GET /api/mrp/supply/template`. Preview writes nothing; commit upserts on PO + line and is audited (`MRP_SUPPLY_IMPORTED`). Prices need `mrp.cost`.

**Warranty facts per unit**: serial, product, model, category, brand, product type, vendor(s) from receipts, `RECEIPT_DATE` = `StockItem.receivedDate`, `GOODS_ISSUE_DATE` = latest dispatch of that unit, other dates from `WarrantyDateRecord`.

## 4. Calculations

**Usage history window**: the last `historyPeriods` completed periods, but starting at the period of the part's first recorded goods issue in scope (network, or the warehouse planned) when that is inside the window. Earlier periods are left out, not counted as zero demand, so averages, demand pattern, forecasts and classification describe only the time the part was in use. A part issued before the window keeps the full window; a part never issued keeps the full window and is flagged "No usage history". Runs stored before this change have no first-usage date and recalculate exactly as they did.

**Forecast methods** (on completed-period history):
- SMA(n): mean of the last n periods, flat over the horizon.
- FMA(n): same definition as SMA over the most recent window (kept as a separate named method because both were requested).
- WMA(n, w): Σ wᵢ·xᵢ with weights normalised to 1, newest first.
- LINEAR(n): least-squares line on the last n periods (≥ 3 observations), projected forward, floored at 0.
- Overrides: REPLACE or ADD per future period; the statistical value is stored with the override and kept in the plan.
- Not implemented: exponential smoothing, Croston/SBA. They are not added because no business owner has chosen parameters for them; intermittent demand is *flagged* (ADI/CV² classification) instead.

**Accuracy**: rolling one-step-ahead back-test over the last `evalPeriods`. Bias = mean(F − A). MAE = mean|F − A|. WAPE = Σ|F − A| / ΣA, *blank* when ΣA = 0. Fewer than `minPoints` points = not validated. Optional auto-selection picks the lowest WAPE.

**Demand pattern**: ADI = periods / non-zero periods; CV² of non-zero values; cut-offs 1.32 and 0.49 (Syntetos–Boylan) → smooth / erratic / intermittent / lumpy.

**Net requirements** (per bucket, bucket 0 starts today and is pro-rated):
```
gross      = MAX(forecast, confirmed demand)      (or SUM, by setting)
projected  = previous projected + receipts − gross
net        = max(0, safety stock − projected before new orders)
planned    = lot size(net): lot-for-lot, or up to max stock (Min/Max);
             then at least MOQ, then rounded up to the order multiple
release    = bucket start − lead time; "late" if before today
```
Past-due PO lines go to bucket 0 (or are excluded, by setting).

**Worked example** (from the integration test, monthly buckets, as of 2026-07-02):
on hand 17, available 13, open PO 19, gross 36, safety stock 5 → net 9, projected shortage 4,
MOQ 10, multiple 5 → suggested **10**, order by **2026-08-02**, arrive 2026-09-01, status PLANNED, estimated cost 25 USD (2.50 USD quote).

**Cost**: supplier price valid on the order date → planning-parameter cost → product master cost (currency unknown). Totals are per currency and never converted. All costs are labelled estimates.

**Classification**: fast / normal / slow / non-moving, high variability, high value, excess, potentially obsolete — only when the thresholds are set; otherwise "Not classified".

**Exceptions** (each with a recommendation): missing parameters, missing safety stock / lead time / supplier / cost, no or short history, forecast not validated, returns exceed issues, stock-out imminent, projected shortage, below safety stock, lead time too long, MOQ excess, overdue PO, PO excluded, excess stock, above max, parameter conflict, mixed currency, discontinued with demand.

**Warranty**:
- A rule applies when its scope matches the unit and its effective dates cover the unit's start date.
- Most specific scope wins: serial › product › model › category › brand › vendor › product type; then higher priority; a tie is reported as `CONFLICT` (activation of a rule that would tie is refused).
- Expiry = start + duration − 1 day (last covered day). Month arithmetic clamps to month end (31 Jan + 1 month → 28/29 Feb).
- Statuses: `NOT_STARTED`, `ACTIVE`, `EXPIRED`, `NO_RULE`, `START_DATE_UNKNOWN`, `CONFLICT`, `NOT_FOUND`.
- Every lookup is logged with rule code, version, dates and the explanation.

## 5. Reproducibility and audit

Each MRP run stores the config snapshot, every material's input snapshot and its results, plus a SHA-256 of the inputs (keys sorted). `GET /mrp/runs/:id/verify` recalculates every line from the stored inputs. Runs can be compared line by line. Audit actions: `MRP_RUN`, `MRP_EXPORT`, `MRP_CONFIG_UPDATED`, `MRP_PARAMETERS_*`, `MRP_SUPPLIER_*`, `MRP_SUPPLY_IMPORTED`, `MRP_FORECAST_OVERRIDE_*`, `WARRANTY_RULE_*`, `WARRANTY_DATE_RECORDED`.

## 6. Permissions

| Code | Allows | Legacy roles that also pass |
|---|---|---|
| `mrp.read` | View plans, runs, usage, forecasts, parameters, supply | System admin, warehouse manager, supervisor, management viewer |
| `mrp.run` | Start a planning run | System admin, warehouse manager |
| `mrp.parameters` | Planning parameters and suppliers | System admin, warehouse manager |
| `mrp.forecast` | Create/cancel forecast overrides | System admin, warehouse manager |
| `mrp.forecastApprove` | Approve/reject overrides (never one's own) | System admin, warehouse manager |
| `mrp.config` | Planning settings | System admin |
| `mrp.export` | CSV export | System admin, warehouse manager |
| `mrp.cost` | See and set costs and prices | System admin, warehouse manager, finance viewer |
| `mrp.supply` | Import PO lines | System admin, warehouse manager |
| `warranty.read` | Lookup, rules, history | System admin, warehouse manager, supervisor, RMA team, RTV officer |
| `warranty.manage` | Rules (draft, new version, activate, deactivate) and recorded dates | System admin, warehouse manager |

Warehouse scope applies everywhere: restricted users plan only their warehouses, see only runs inside their scope, and look up only units in their warehouses. The migration adds the permission codes but **grants them to no role**.

## 7. API

MRP (`/api/mrp`): `dashboard`, `runs` (GET/POST), `runs/latest`, `runs/compare?base&target`, `runs/:id`, `runs/:id/lines`, `runs/:id/lines/:lineId`, `runs/:id/verify`, `runs/:id/export`, `usage/:productId`, `forecast/:productId`, `preview/:productId`, `cost/:productId`, `config` (GET/PUT), `parameters` (GET/POST), `parameters/:productId`, `parameters/:id` (PATCH), `suppliers` (GET/POST/PATCH), `supply`, `supply/performance`, `supply/template`, `supply/import/preview|commit`, `overrides` (GET/POST), `overrides/:id/decide|cancel`.

Warranty (`/api/warranty`): `lookup?serial|stockItemId&asOf&context&ref`, `history`, `rules` (GET/POST), `rules/:ruleCode/versions`, `rules/:id` (PATCH, drafts only), `rules/:id/new-version`, `rules/:id/activate|deactivate`, `dates` (GET/PUT).

UI: **Planning › Material Planning** (`/mrp`: overview, planning workspace, runs, material analysis, parameters, inbound supply, settings) and **Planning › Warranty** (`/warranty`: lookup, rules, history & dates).

## 8. Deployment steps

1. Back up the database.
2. Apply `database/schema/26_warranty_mrp.sql` to **staging**; it is idempotent (safe to run twice) and only creates new types, tables, indexes and permission rows.
3. Grant the new permission codes to roles (business decision, §9).
4. Deploy the branch to staging, import a real PO extract, enter parameters for a pilot set of materials, run planning, review with planners.
5. Apply the migration to production **before** merging to `master` (merging deploys).
Rollback: the code can be reverted without touching data; the new tables are unused by other modules.

## 9. Decisions that need business approval

Nothing below has been assumed as policy; defaults are placeholders and can be changed in Settings.

**Warranty**
1. Every warranty rule: type, coverage period, start basis, scope and terms. No rules are seeded.
2. Whether expiry is the last covered day (implemented) or the day coverage ends.
3. What happens when a unit is out of warranty — currently the result is shown only; nothing is blocked in RTV/DOA/RMA.
4. Customer-specific warranty needs a customer master; not implemented.

**MRP**
5. Usage basis: net issues (default) or confirmed usage only.
6. Combining forecast and confirmed demand: MAX (default) or SUM.
7. Whether unapproved requests count as demand (default yes).
8. Overdue PO lines: expect in first bucket (default) or exclude.
9. Whether stock in inspection is usable (default no).
10. Whether forecast overrides need approval (default yes).
11. Default forecast method and windows (SMA 6, FMA 3, WMA 3 with 0.5/0.3/0.2, LINEAR 12), horizon (6 months), history (24 months).
12. All classification thresholds (fast/slow/non-moving/variability/excess/high value/MOQ excess) — unset until approved.
13. Which roles get the new permissions.
14. Base currency and exchange rates — not implemented; costs are reported per currency.
15. Lead-time variability is informational; safety stock is entered, not calculated.
16. Whether stock transfers should count as supply (needs a structured destination on transfers).
17. Source and refresh frequency of PO data from purchasing.
18. **Where usage history starts for a part.** *Implemented 28 Oct 2026, approved in the session:* history starts at each part's first recorded goods issue (see §4). Before, months before a part's first usage counted as zero demand (a part steadily using 18–22 a month showed 11.75 a month, "intermittent", class "normal"). Still open for the business: whether a set introduction date should be used instead when a part had no issues at first, and whether the first unused-return or confirmed usage should also count as a start.

## 10. Status

| Requirement | Status | Notes |
|---|---|---|
| Warranty rule master (type, period, basis, scope, priority, effective dates) | PASS | Customer scope not implemented |
| Rule versioning, history, maker ≠ checker activation | PASS | |
| Warranty validation, statuses, explanation, logging | PASS | |
| Missing dates / serials / overlapping rules | PASS | Recorded dates for invoice/installation/activation |
| Warranty integration with RTV/DOA/RMA screens | PARTIAL | API supports `context`/`ref`; no button added inside those screens yet |
| Material master / planning parameters + validation | PASS | |
| Supplier, alternatives, MOQ, multiples, price validity | PASS | |
| Usage history (day/week/month, MoM/YoY, variability, intermittency, trend, repair consumption) | PASS | |
| Forecasts SMA / FMA / WMA / Linear + manual overrides with approval | PASS | |
| Optional methods (exponential smoothing, Croston) | NOT IMPLEMENTED | Not justified without agreed parameters |
| Forecast accuracy (bias, MAE, WAPE, zero handling, comparison, optional selection) | PASS | |
| Inventory position | PASS | |
| Time-phased net requirements (lead time, MOQ, multiple, no duplicates) | PASS | |
| PO / inbound visibility (controlled import, read-only) | PASS | |
| Cost valuation per currency, labelled estimates | PASS | No currency conversion |
| Fast/slow classification with configurable thresholds | PASS | Thresholds unset by design |
| Dashboard, workspace (filter/sort/page/export/drill-down), run history & compare | PASS | |
| Exceptions with recommendations | PASS | |
| RBAC + warehouse scope + audit | PASS | Permissions not yet granted to roles |
| Browser QA against a running stack | PASS | 28 Oct 2026, local in-memory database with labelled sample data (see §11) |

## 11. Browser test, 28 Oct 2026

Run against a throwaway in-memory database with sample data (SKUs `SMP-*`, PO numbers `SMP-PO-*`); the configured database was never used.
Checked as two admins and a planner without cost rights: run planning (network and one warehouse), planning workspace and drill-down (numbers checked by hand), run history, reproducibility check, run comparison, usage history, forecast comparison, override create → approve by a second person, live plan, parameter version + supplier, PO import preview/commit, supplier performance, settings validation and save, classification after thresholds, CSV export content, cost hidden from the planner, warranty draft → activation by a second person (self-activation refused), lookup (in warranty / expired / not found), recorded installation date, check history.

Fixed during the test:
- Comparing a one-warehouse run with a network run listed every material as removed and added; materials are now matched and the scope difference is stated.
- PO import shifted CSV dates back one day on servers east of UTC; calendar dates are now kept (integration test asserts the stored date).
- Warranty rules showed internal product ids; they now show SKU / brand / vendor names.
- Planning run numbers could end in "-" or "_"; they now use letters and digits only.
- Usage history now starts at each part's first recorded goods issue (decision 18), shown on the usage screen and the plan drill-down.
- Text: "Not planned" tooltip, FMA description, rounding in the shortage message, empty classification and parameter-date lines in the drill-down.

