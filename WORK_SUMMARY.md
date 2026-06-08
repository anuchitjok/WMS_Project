# HSNT WMS — Work Summary (Session Log)

> สรุปงานทั้งหมดที่ทำในเซสชันนี้ · Last updated: 2026-06-07
> Stack: NestJS + Prisma + PostgreSQL (Supabase) · Next.js (App Router) + TypeScript
> Release: **v1.0-stable** (commit `037123f`)

---

## ภาพรวม (Overview)

เซสชันนี้ทำงานใหญ่ 6 ส่วน บนหลักการเดียวกันตลอด: **additive-only, ไม่ทำลายของเดิม, backward compatible, มี feature flag สำหรับงานเสี่ยง, verify ทุก phase กับ Supabase จริง**:

1. Fulfillment Consolidation (รวม V1/V2 เป็นระบบเดียว)
2. Requester Module Refactor — Phases 1–6
3. Goods Receiving — Phase 1 (additive)
4. Full Module Test Pass (13 modules)
5. Test-data Cleanup + Release `v1.0-stable`
6. Dashboard Redesign — Review + Phase 1

เอกสารประกอบที่สร้างไว้: `FULFILLMENT_CONSOLIDATION_SUMMARY.md`, `REQUESTER_MODULE_REVIEW.md`,
`GOODS_RECEIVING_AND_DASHBOARD_REVIEW.md`, `DASHBOARD_REDESIGN_REVIEW.md`, `PROJECT_SUMMARY.md`.

---

## 1) Fulfillment Consolidation ✅

รวม `/fulfillment` (V1) + `/fulfillment-v2` (V2) + packing/dispatch ของ `ShipmentModule` เป็น **FulfillmentModule เดียว** (execution SSOT) โดยใช้ Strangler-Fig + proxy.

- **InventoryOrchestrationService** = ทางผ่านเดียวของการเคลื่อนไหวสต็อก (reserve / release / pick / **Goods Issue**) ทุกอย่างอยู่ใน transaction + เขียน AuditLog
- Goods Issue (หักสต็อก) เกิด **เฉพาะตอน dispatch** เท่านั้น
- Sub-services: `allocation / picking / packing / dispatch / handover`
- `fulfillment2` กลายเป็น **proxy** (มาร์ค `@deprecated`), `shipment` เหลือ **read-only tracker**
- Frontend: รวมเป็นหน้าเดียว `/outbound/fulfillment`; หน้าเก่า redirect; แก้ board crash ด้วย `normalizeBoard`/`asArray`
- DB guard rails: `database/schema/18_fulfillment_guard_rails.sql` (unique active task per request, `version`, `Shipment.dispatchedById/podReference`)
- **Verify:** e2e flow `AVAILABLE→RESERVED→PICKED→SHIPPED` + audit ledger ครบ

---

## 2) Requester Module Refactor — Phases 1–6 ✅

แก้ปัญหาหลัก: **double reservation**, **RMA/return ชี้ผิดชิ้น**, **ไม่มี optimistic lock**, **สถานะซ้ำซ้อน**.

| Phase | สิ่งที่ทำ | Flag |
|---|---|---|
| 1 | Additive schema: `WithdrawalRequest.version/correlationId`, `WithdrawalRequestItem.shippedStockItemId`, `AuditLog.correlationId` (`19_requester_refactor_phase1.sql`) | — |
| 2 | **Single reservation**: approval เป็น governance-only, allocate เป็นจุดจองสต็อกจุดเดียว | `ENABLE_UNIFIED_RESERVATION` (OFF) |
| 3 | **Shipped-unit linkage (C2)**: เขียน `shippedStockItemId` ตอน dispatch; RMA/Unused ใช้ชิ้นที่ส่งจริง (`shipped-unit-resolver.ts`) | — |
| 4 | **Approval engine wiring**: `submit` สร้าง instance, `approve` delegate ไป ApprovalService (fallback เดิมคงอยู่) | `ENABLE_APPROVAL_ENGINE` (OFF) |
| 5 | **Derived coarse status**: `deriveRequestStage()` map จาก FulfillmentTask; มาร์ค status เก่าเป็น `@deprecated` | — |
| 6 | **Frontend UX restructure**: Approvals workspace, My Issued Items, Pending Returns, Warehouse Returns + redirect ของเส้นทางเก่า | — |

- **Verify:** Phase 2 → 9/9, Phase 3–5 → 12/12 (รวม "RMA USED consume ชิ้นที่ส่งจริง")
- ทั้งสอง flag **ปิดเป็น default** → production ไม่เปลี่ยนพฤติกรรม

---

## 3) Goods Receiving — Phase 1 (additive) ✅

- Schema (`20_receiving_phase1.sql`): enum **`ReceivingStatus`** + shadow column `GoodsReceiving.statusEnum`, `poNumber/supplierId/expectedDate`, `GoodsReceivingItem.batchNumber/expiryDate/manufactureDate`, `Product.batchControlled`
- Service: เก็บ lot/expiry/supplier, set `statusEnum` (QC_PENDING→COMPLETED), set `StockItem.expiryDate` (FEFO), บังคับ `batchControlled`
- แก้ **low-stock KPI bug** (นับเฉพาะ AVAILABLE)
- legacy free-string `status` ยังคงอยู่ (backward compat)
- **Verify:** 11/11

---

## 4) Full Module Test Pass (13 modules) ✅

ทดสอบจริงกับ Supabase ครบ: Auth, Dashboard, Products, Inventory, Receiving, Putaway, Requests, Approval, Fulfillment, Shipment, RMA, Returns, Audit.

- **ผล: ทุก module ผ่าน, ไม่พบ bug จริงของระบบ**
- 5 เครื่องหมายแดงตอนแรก = ปัญหาของ test harness/test-data (เช่น helper fallback ไป admin token, รหัส requester01 ไม่ตรง, password < 6 ตัวโดน validation 400) — พิสูจน์แล้วทั้งหมด
- Verify เพิ่ม: migrations ครบ 15 คอลัมน์, prisma schema valid, RBAC (requester โดน 403 ถูกต้อง), feature flags, frontend routes 19/19 = HTTP 200

---

## 5) Cleanup + Release `v1.0-stable` ✅

- **Forensic (read-only)** ก่อน แล้วค่อยลบ ตามที่อนุมัติ
- ลบเฉพาะ **business test data** ใน transaction เดียว (anchor ด้วย product ID ชัดเจน):
  products 7, stock 9, receiving 9, requests 6, approval 1, tasks 5, shipments 5, temp user 1
- **เก็บ Audit Logs ไว้ครบ (1542 → 1542)** — แถว LOGIN ของ temp user ใช้วิธี detach (`userId→NULL`) ไม่ลบ
- Integrity: 0 orphan; production data ไม่ถูกแตะ (มีแค่ counter login ของ admin/requester01)
- **Release:** initial commit ทั้งโปรเจกต์ (391 files, ไม่รวม node_modules/.env) + tag **`v1.0-stable`** = `037123f20959803a9641623054f0eb52b88b8dc3`

---

## 6) Dashboard Redesign ✅ (Review + Phase 1)

**Review:** ออกแบบ IA 6 ส่วน (Executive KPIs / Inventory Health / Workload / Requester / Alerts / Timeline), KPI formulas, APIs, caching, rollback, phased plan → `DASHBOARD_REDESIGN_REVIEW.md`

**Phase 1 (additive, ยังไม่ cutover):**
- `KpiCard` + `KpiGrid` (dark-mode tokens, responsive, role-aware)
- APIs ใหม่: `GET /dashboard/kpis`, `GET /dashboard/inventory-health` (legacy `/dashboard/stats` คงเดิม)
- **shared low-stock metric** (`inventory-metrics.ts`) ใช้ร่วม dashboard + reports → ค่าตรงกัน (23==23)
- `Inventory Accuracy` = `null` (ยังไม่มี cycle-count source ที่ validated)
- Activity Timeline architecture (`activity-timeline.ts`) เตรียมไว้สำหรับ Phase 3
- Flag **`ENABLE_DASHBOARD_V2` = false**
- **Verify:** 9/9 · BE/FE typecheck ผ่าน

---

## Feature Flags (สถานะปัจจุบัน = ปิดทั้งหมด)

| Flag | ผลเมื่อเปิด | Default |
|---|---|---|
| `ENABLE_UNIFIED_RESERVATION` | จองสต็อกจุดเดียวที่ allocate (แก้ double-reservation) | **OFF** |
| `ENABLE_APPROVAL_ENGINE` | อนุมัติผ่าน ApprovalService engine | **OFF** |
| `ENABLE_DASHBOARD_V2` | ใช้ dashboard ใหม่ (Phase 2 ขึ้นไป) | **OFF** |

> หมายเหตุ: Phase 1 ของ requester (single reservation logic) ยังไม่ active จนกว่าจะเปิด flag — ดังนั้น double-reservation เดิมยัง latent อยู่ใน legacy path โดยตั้งใจ

---

## Migrations (additive only, idempotent, apply แล้วบน Supabase)

- `database/schema/18_fulfillment_guard_rails.sql`
- `database/schema/19_requester_refactor_phase1.sql`
- `database/schema/20_receiving_phase1.sql`

ทั้งหมดเป็น `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / enum แบบมี guard — ไม่มี DROP / reset

---

## สิ่งที่ค้าง / ขั้นต่อไป (Pending)

- **Dashboard Phase 2** — layout ใหม่หลัง flag (Section A + B) — *รอ checkpoint อนุมัติ*
- Dashboard Phase 3–4 — workload/alerts/timeline + caching + dark-mode `StatCard`
- Receiving Phase 2–4 — Excel upload + barcode/QR (มี `DataioController`/`ScanController` อยู่แล้ว) + QC hold/ASN
- ตัดสินใจเปิด unified-reservation / approval-engine flags บน environment จริง
- (ถ้าต้องการ) commit งานหลัง v1.0-stable + tag ใหม่ เช่น `v1.1-dashboard-phase1`
- demo user `requester01` รหัสไม่ตรง — reseed ถ้าจะใช้ demo

---

## Verification Scorecard (รวม)

| งาน | ผล |
|---|---|
| Fulfillment e2e | ✅ inventory + Goods Issue ถูกต้อง |
| Requester Phase 2 | ✅ 9/9 |
| Requester Phase 3–5 | ✅ 12/12 |
| Receiving Phase 1 | ✅ 11/11 |
| Full module test (13) | ✅ ทุก module ผ่าน, 0 bug จริง |
| Dashboard Phase 1 | ✅ 9/9 |
| Backend / Frontend typecheck | ✅ 0 errors ทุก phase |
| Cleanup integrity | ✅ 0 orphan, audit ครบ |

---

*เอกสารนี้สรุปงานทั้งหมดในเซสชัน · สถาปัตยกรรมเดิมถูกรักษาไว้ · ไม่มีการลบ feature หรือ destructive migration*
