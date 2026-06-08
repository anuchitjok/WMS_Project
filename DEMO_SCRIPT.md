# HSNT WMS — Management Demo Script (15 minutes)

> Audience: executives + warehouse management. Goal: show end-to-end warehouse
> operations and the value of a unified WMS in ~15 minutes.
> Login as `demo_admin` / `Demo@Admin1` (or switch roles to show RBAC).
> Data: seeded via `npm run seed:demo` (100 products, 50 receiving, 30 requests, 24 tasks, 20 shipments, 5 RMA).

## Recommended presentation flow (top-down: strategy → operations → lifecycle)

| # | Section | Route | Duration |
|---|---|---|---|
| 1 | Executive Dashboard | `/dashboard` | 3:00 |
| 2 | Inventory Overview | `/inventory` | 2:00 |
| 3 | Receiving | `/receiving` | 2:00 |
| 4 | Approval | `/approvals` | 2:00 |
| 5 | Fulfillment | `/outbound/fulfillment` | 3:00 |
| 6 | Shipment | `/outbound/fulfillment` (Ready/Shipped lane) → `/shipment-detail` | 1:30 |
| 7 | RMA / Returns | `/issued-items`, `/rtv` | 1:30 |
| | **Total** | | **15:00** |

---

### 1. Executive Dashboard — `/dashboard` (3 min)
- **Talking points:** single-glance operational picture — KPI row (Today Receiving, Pending Putaway, Pending Approval, Active Fulfillment, Shipment Today, Open Returns, Low Stock), Inventory Health, Alerts. *(Executive Dashboard V2 visuals land in Dashboard Phase A — currently the V1 dashboard shows totals + stock-by-status + activity.)*
- **Business value:** management gets real-time visibility in under 5 seconds; no spreadsheets.
- **Expected outcome:** audience sees live counts reflecting the seeded warehouse (pending approvals, shipments today, low-stock alerts).

### 2. Inventory Overview — `/inventory` (2 min)
- **Talking points:** every unit tracked by status (Available / Reserved / Picked / QC Hold / RTV) with location, batch/lot, serial, expiry.
- **Business value:** accurate, real-time stock truth; prevents ghost inventory and stockouts.
- **Expected outcome:** ~100 demo products with mixed statuses and locations visible/filterable.

### 3. Receiving — `/receiving` (2 min)
- **Talking points:** inbound from suppliers with PO/supplier reference, lot/expiry capture, QC status (QC_PENDING → completed); serial/batch enforcement.
- **Business value:** controlled inbound, FEFO support, supplier traceability.
- **Expected outcome:** 50 receiving records across dates; some pending QC, most completed.

### 4. Approval — `/approvals` (2 min)
- **Talking points:** governance queue for withdrawal requests; approve/reject with audit. Switch to `demo_requester` to show RBAC (cannot approve).
- **Business value:** segregation of duties, spend/stock control, full audit trail.
- **Expected outcome:** ~6 requests pending approval; approving one updates status live.

### 5. Fulfillment — `/outbound/fulfillment` (3 min)
- **Talking points:** unified Pick → Pack → Ship board (Kanban lanes), FIFO allocation, reservation, and **Goods Issue only at dispatch** (stock deducts once). SLA chips.
- **Business value:** one execution surface; inventory integrity guaranteed; no double-deduction.
- **Expected outcome:** active tasks in Picking/Packing lanes; advancing a task moves it across lanes.

### 6. Shipment — Fulfillment board "Ready/Shipped" lane → `/shipment-detail` (1.5 min)
- **Talking points:** dispatch creates a shipment (carrier, tracking, POD); delivery confirmation; timeline.
- **Business value:** outbound traceability and proof of delivery.
- **Expected outcome:** 20 demo shipments (some delivered, ~5 dispatched today); drill into a shipment's timeline.

### 7. RMA / Returns — `/issued-items`, `/rtv` (1.5 min)
- **Talking points:** post-issue usage confirmation (Used / DOA / Unused); DOA routes to RTV (return-to-vendor); unused returns go back to stock via warehouse verification.
- **Business value:** closes the loop; recovers value; vendor accountability.
- **Expected outcome:** 5 demo RTV cases; issued items awaiting usage confirmation.

---

## Demo tips
- Keep the **dashboard** open in one tab as the "home base"; return to it after each section to show KPIs updating.
- Use **role switching** (admin → requester → operator) once, during Approval, to demonstrate permissions cleanly.
- If anything looks stale, re-run `npm run seed:demo` beforehand for a clean, realistic dataset.

## End-to-end scenario (optional live walkthrough)
`Receiving → Putaway → Request → Approval → Fulfillment (pick/pack) → Shipment (dispatch = Goods Issue) → RMA usage`
— this is the same lifecycle verified in the full module test pass; every step writes an immutable audit entry.
