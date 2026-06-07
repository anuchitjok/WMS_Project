"""
HSNT Obsidian Vault Builder
Generates a complete, interlinked Obsidian vault from project analysis.
"""

import os
from pathlib import Path
from datetime import date

VAULT = Path(r"D:\HSNT_Knowledge_Vault")
TODAY = date.today().isoformat()  # 2026-06-03

def w(path: str, content: str):
    p = VAULT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    print(f"  ✓ {path}")

# ══════════════════════════════════════════════════════════════════════════════
# 00 — HOME DASHBOARD
# ══════════════════════════════════════════════════════════════════════════════

w("🏠 Home.md", f"""---
tags: [home, dashboard]
updated: {TODAY}
---

# 🏠 HSNT Knowledge Vault

> **Anuchit** — Highpoint Service Network Thailand
> Warehouse & Operations Management | 2026

---

## 🚀 Active Projects

| Project | Status | Priority | Last Updated |
|---|---|---|---|
| [[WMS/📋 WMS Overview\|WMS Project]] | 🟡 In Progress | 🔴 High | {TODAY} |
| [[Verifone/📋 Verifone Overview\|Verifone POS Project]] | 🟢 Running | 🟡 Medium | {TODAY} |
| [[Zebra/📋 Zebra Overview\|Zebra & EV Garage]] | 🟢 Running | 🟡 Medium | {TODAY} |
| [[Inventory/📋 Inventory Overview\|Inventory Management]] | 🟢 Running | 🟡 Medium | {TODAY} |

---

## ✅ Quick Tasks

- [ ] 🔴 นำเสนอ WMS ต่อ Board บริหาร
- [ ] 🟡 อัพเดท Part Request Forecast Q3
- [ ] 🟡 สร้าง Power BI Dashboard ใหม่สำหรับ Repair Report
- [ ] 🟢 ทบทวน GPS Goals 2026
- [ ] 🟢 เรียน English Unit ถัดไป

→ ดู [[Tasks/✅ Active Tasks]] สำหรับ Task ทั้งหมด

---

## 📂 Vault Map

```
🏠 Home (อยู่ที่นี่)
├── 📁 WMS          → ระบบ Warehouse Management System
├── 📁 Verifone     → POS Terminal Repair & Part Management
├── 📁 Zebra        → Zebra Scanner + EV Garage System
├── 📁 Inventory    → Daily/Weekly Inventory Reports
├── 📁 Tasks        → Tasks, Weekly Review, Archive
├── 📁 Architecture → System Design & Data Flow
├── 📁 Goals        → KPI, GPS Goals, Career
├── 📁 Learning     → AI, Excel, Power BI, English
└── 📁 Resources    → Tools, Scripts, References
```

---

## 📊 Project Health

| Area | Metric | Value |
|---|---|---|
| WMS | Portals Done | 0/4 |
| WMS | Slides Ready | ✅ 12 slides |
| Verifone | Open Part Requests | Tracking |
| Repair | Monthly Reports | Active |
| Goals | 2026 GPS Progress | Q2 |

---

## 🔗 Quick Links

[[WMS/🗺️ WMS Roadmap]] · [[WMS/🏗️ Architecture]] · [[Tasks/📅 Weekly Review]] · [[Goals/🎯 2026 Goals]] · [[Learning/🤖 AI & Prompt Engineering]]
""")

# ══════════════════════════════════════════════════════════════════════════════
# WMS PROJECT
# ══════════════════════════════════════════════════════════════════════════════

w("WMS/📋 WMS Overview.md", f"""---
tags: [project, wms, hsnt]
status: in-progress
priority: high
created: {TODAY}
---

# 📋 WMS Project Overview

**Client / Owner:** Highpoint Service Network Thailand (HSNT)
**Project Type:** Internal System Development
**Status:** 🟡 In Progress — Prototype & Board Approval Phase

---

## 🎯 Objective

พัฒนาระบบ Warehouse Management System เพื่อบริหารจัดการคลังสินค้าของ HSNT ครบวงจร แทน Manual Process / Excel

---

## 🏛 System Portals

| Portal | หน้าที่ | สถานะ |
|---|---|---|
| [[WMS/Portals/Admin System\|⚙ Admin System]] | User, Role, Master Data, Workflow Setup | 📐 Design |
| [[WMS/Portals/Warehouse Management\|🏭 Warehouse Mgmt]] | Receive, Putaway, Pick, Pack, Ship | 📐 Design |
| [[WMS/Portals/Requester Portal\|📋 Requester Portal]] | Request, Approve, Track, Confirm | 📐 Design |
| [[WMS/Portals/RTV Management\|🔄 RTV Management]] | DOA, Defective, Vendor Return | 📐 Design |

---

## 📎 Key Documents

- [[WMS/🏗️ Architecture]] — System Architecture & Data Model
- [[WMS/🔄 Workflows]] — All Process Flows
- [[WMS/👥 User Roles]] — 12 Roles & Permissions
- [[WMS/📊 Dashboard KPIs]] — Executive Dashboard Design
- [[WMS/🗺️ WMS Roadmap]] — Development Phases
- [[WMS/✅ WMS Tasks]] — All Tasks & Status

---

## 📁 Files on Disk

| File | Path | Purpose |
|---|---|---|
| SKILL.md | `D:\\WMS_Project\\Requirement\\HSNT_WMS_SKILL.md` | Dev standards guide |
| Board PPTX | `D:\\WMS_Project\\Requirement\\HSNT_WMS_Board_Presentation.pptx` | Board presentation |
| Demo (index) | `D:\\WMS_Project\\Requirement\\HSNT_WMS_English_Demo_index.zip` | HTML prototype |
| Demo (modules) | `D:\\WMS_Project\\Requirement\\HSNT_WMS_English_Demo_Separated_Modules.zip` | Modular prototype |

---

## 🏢 Warehouse Locations

- Tower B1FL / B2FL / C1FL
- SCG Warehouse (Off-site)
- RTV / Quarantine Holding Area

---

## 🔗 Related

[[Inventory/📋 Inventory Overview]] · [[Goals/🎯 2026 Goals]] · [[Architecture/🏗️ WMS System Design]]
""")

w("WMS/🏗️ Architecture.md", f"""---
tags: [architecture, wms, system-design]
updated: {TODAY}
---

# 🏗️ WMS System Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│                   HSNT WMS Platform                  │
├──────────────┬──────────────┬──────────┬────────────┤
│    Admin     │  Warehouse   │Requester │    RTV     │
│    System    │  Management  │  Portal  │ Management │
├──────────────┴──────────────┴──────────┴────────────┤
│              Core Business Logic Layer               │
│  • Approval Workflow Engine                          │
│  • Notification Engine                               │
│  • Audit Trail                                       │
│  • RBAC (Role-Based Access Control)                  │
├─────────────────────────────────────────────────────┤
│              Data Layer (Database)                   │
│  • Stock Ledger   • Request Records                  │
│  • User/Role      • Audit Logs                       │
│  • Master Data    • Workflow State                   │
└─────────────────────────────────────────────────────┘
```

---

## 📊 Core Data Models

### Stock / Inventory
```
Product
  ├── product_code (PK)
  ├── brand_id → Brand
  ├── category, serial_controlled
  └── warranty_rule_id → WarrantyRule

StockLedger
  ├── stock_id (PK)
  ├── product_code → Product
  ├── serial_number
  ├── status (enum: 19 statuses)
  ├── warehouse_id → Warehouse
  ├── rack_id, slot_id, bin_id
  ├── ownership_type (Consignment/Own/RMA)
  └── received_date, last_updated
```

### Request & Workflow
```
WithdrawalRequest
  ├── request_id (PK)
  ├── requester_id → User
  ├── rma_case_number
  ├── status (enum: 13 statuses)
  ├── department_id, required_date
  └── items[] → RequestItem

RequestItem
  ├── product_code, quantity_requested
  ├── serial_number (if serial-controlled)
  └── stock_id → StockLedger (after approval)
```

### RTV
```
RTVCase
  ├── rtv_id (PK)
  ├── stock_id → StockLedger
  ├── reason (DOA/Defective/Vendor Return)
  ├── status (enum: 10 statuses)
  ├── vendor_id → Vendor
  └── shipment_ref, credit_note_ref
```

---

## 🔐 RBAC Design

```
Role → Permissions → Resources

System Admin    → ALL
Warehouse Mgr   → ALL warehouse ops + reports
WH Supervisor   → Execute ops, view reports
WH Staff        → Execute assigned tasks only
Requester       → Own requests only
Dept Approver   → Requests in own department
RMA Team        → Usage confirmation + DOA
RTV Officer     → RTV cases + vendor comms
Finance Viewer  → Stock value + transactions (read)
Brand Viewer    → Brand-specific stock (read)
Mgmt Viewer     → Executive dashboard (read)
Auditor         → Audit log + cycle count (read)
```

---

## 🔔 Notification Triggers

| Event | Recipients |
|---|---|
| Request submitted | Dept Approver |
| Request approved | Requester + WH Staff |
| Request rejected | Requester |
| Picking ready | Requester |
| DOA declared | RTV Officer |
| RTV approved | WH Staff + Vendor |
| Low stock alert | WH Manager |

---

## 🔗 Related

[[WMS/📋 WMS Overview]] · [[WMS/🔄 Workflows]] · [[WMS/👥 User Roles]]
""")

w("WMS/🔄 Workflows.md", f"""---
tags: [workflow, wms, process]
updated: {TODAY}
---

# 🔄 WMS Key Workflows

## 1. Goods Receiving Flow

```
สินค้าเข้า (Brand/Vendor/RMA/RTV Replacement)
    │
    ▼
ตรวจสอบเอกสาร & ของจริง (WH Staff)
    │
    ▼
ตรวจสอบ/สร้าง Product Master
    │
    ▼
สร้าง Receiving Transaction
    │
    ▼
ตรวจนับ & ตรวจสภาพ ──── DOA/Damaged → [Quarantine]
    │
    ▼
Putaway → กำหนด Warehouse / Rack / Slot
    │
    ▼
Status: Available ✅
```

**Statuses:** Pending Receiving → Pending Inspection → Available / Quarantine / DOA

---

## 2. Withdrawal Request Flow

```
Requester สร้าง Request
    │
    ▼
System Validate (RMA Case, Stock Qty, Serial, Duplicate)
    │
    ├── ❌ Fail → Draft (แก้ไข)
    │
    ▼
Submit → Pending Approval
    │
    ▼
Dept Approver Review
    ├── ✅ Approved → Reserve Stock → Picking Task
    └── ❌ Rejected → Requester (พร้อมเหตุผล)
```

**Statuses:** Draft → Submitted → Pending Approval → Approved/Rejected → Picking → Picked → Packed → Ready for Pickup → Shipped → Issued to RMA → Completed

---

## 3. Pick / Pack / Ship Flow

```
WH Staff รับ Picking Task
    │
    ▼
ยืนยัน Item + Location (Serial Scan ถ้าจำเป็น)
    │
    ▼
Pack & พิมพ์ Label
    │
    ▼
เตรียมส่ง / Pickup
    │
    ▼
ผู้รับยืนยัน Handover ✅
    │
    ▼
Status: Completed
```

---

## 4. RMA Usage Confirmation Flow

```
สินค้าถูกเบิกออกไปแล้ว
    │
    ▼
Requester/RMA Team อัพเดทผลการใช้งาน
    │
    ├── Used/Consumed → ปิด
    ├── DOA → ส่งต่อ RTV Flow
    ├── Defective after test → ส่งต่อ RTV Flow
    ├── Unused → Return to Warehouse Flow
    └── Wrong Item → Return + Re-pick

Rule: Consumed + Returned + DOA = Issued ✅
```

---

## 5. RTV Flow

```
Item ถูก Flag ว่า DOA / Defective / Return Required
    │
    ▼
RTV Officer Review
    │
    ▼
สร้าง RTV Case + อนุมัติ
    │
    ▼
จัดส่งคืน Vendor + Shipment Doc
    │
    ▼
Vendor รับ → แจ้งผล
    ├── Replacement → ต้องผ่าน Receiving Flow
    ├── Credit Note → แจ้ง Finance
    └── Rejected by Vendor → Escalate
    │
    ▼
ปิด RTV Case ✅
```

---

## 6. Unused Goods Return Flow

```
Requester ขอ Return ของที่ไม่ได้ใช้
    │
    ▼
WH ตรวจสอบ: Original Request + Serial + Condition
    │
    ▼
WH ตัดสินใจ:
    ├── Return to Available Stock ✅
    ├── Quarantine (ตรวจสอบเพิ่ม)
    ├── Reject Return
    └── RTV Pending
    │
    ▼
อัพเดท Stock + Audit Log
```

---

## 🔗 Related

[[WMS/🏗️ Architecture]] · [[WMS/📋 WMS Overview]] · [[WMS/✅ WMS Tasks]]
""")

w("WMS/👥 User Roles.md", f"""---
tags: [roles, permissions, rbac, wms]
updated: {TODAY}
---

# 👥 WMS User Roles & Permissions

## Role Matrix

| # | Role | Portal Access | Key Permissions |
|---|---|---|---|
| 01 | **System Administrator** | All | Full access, system config, audit |
| 02 | **Warehouse Manager** | Admin + WH + Dashboard | All warehouse ops, all reports |
| 03 | **Warehouse Supervisor** | WH | Execute ops, assign tasks, view reports |
| 04 | **Warehouse Staff** | WH | Pick, Pack, Receive, Putaway |
| 05 | **Requester** | Requester | Own requests, track status, return |
| 06 | **Department Approver** | Requester + Approve | Approve dept requests |
| 07 | **RMA / Service Team** | Requester + RMA | Confirm usage, declare DOA |
| 08 | **RTV Officer** | RTV | DOA review, RTV case, vendor comms |
| 09 | **Finance / Acct Viewer** | Dashboard | Stock value, transactions (read) |
| 10 | **Brand / Vendor Viewer** | Dashboard | Brand stock, RTV status (read) |
| 11 | **Management Viewer** | Dashboard | Executive KPI dashboard (read) |
| 12 | **Auditor** | Audit | Audit log, cycle count (read) |

---

## Permission Design Principles

1. **Least Privilege** — Role sees only what it needs
2. **Department Scoping** — Approvers limited to own dept
3. **Brand Scoping** — Vendor viewers limited to own brand
4. **Audit Everything** — All actions logged with user + timestamp
5. **No Bypass** — Critical flows require approval, cannot skip

---

## Role Hierarchy

```
System Admin
    └── Warehouse Manager
            ├── Warehouse Supervisor
            │       └── Warehouse Staff
            └── Reports (read)

Department Approver
    └── Requester
            └── RMA / Service Team

RTV Officer (independent stream)

Finance / Brand / Mgmt / Auditor (read-only viewers)
```

---

## 🔗 Related

[[WMS/🏗️ Architecture]] · [[WMS/📋 WMS Overview]]
""")

w("WMS/📊 Dashboard KPIs.md", f"""---
tags: [dashboard, kpi, analytics, wms]
updated: {TODAY}
---

# 📊 WMS Dashboard & KPI Design

## Executive Dashboard KPIs

### Stock Overview
| KPI | Description | Alert Threshold |
|---|---|---|
| Total Stock Value | มูลค่าสต็อกรวม (THB) | — |
| Available Units | จำนวน Available | < Min Level |
| Stock by Brand | แยกตาม Brand | — |
| Stock by Warehouse | แยกตาม Location | Utilization > 90% |
| Consignment Balance | สต็อก Consignment | — |

### Operational KPIs
| KPI | Description | Alert Threshold |
|---|---|---|
| DOA Quantity | สินค้า DOA รอดำเนินการ | > 10 units |
| RTV Pending | RTV รอส่งคืน | Aging > 30 days |
| Inventory Aging | สต็อกอายุเกิน | > 90 days |
| WH Utilization | % การใช้พื้นที่คลัง | > 85% |
| SLA Completion | % Request ตาม SLA | < 90% |
| Monthly Withdrawal | ปริมาณเบิกรายเดือน | — |

---

## Warehouse Dashboard

| Widget | Data |
|---|---|
| Pending Receiving | รายการรอรับสินค้า |
| Pending Putaway | รายการรอจัดเก็บ |
| Pending Picking | Task รอ Pick |
| Pending Packing | Task รอ Pack |
| Ready for Pickup | รอ Requester มารับ |
| Overdue Pickup | เกิน SLA แล้ว 🔴 |
| Low Stock Items | ใกล้หมด ⚠️ |
| Location Capacity | % พื้นที่แต่ละคลัง |

---

## Requester Dashboard

| Widget | Data |
|---|---|
| Open Requests | คำขอที่ยังเปิดอยู่ |
| Pending Approval | รออนุมัติ |
| Ready for Pickup | รอรับสินค้า |
| Pending Usage Update | รอยืนยันการใช้งาน |
| Unused Return Pending | รอ Return |
| Completed (30d) | เสร็จสิ้นใน 30 วัน |

---

## RTV Dashboard

| Widget | Data |
|---|---|
| RTV Pending Cases | เคสรอดำเนินการ |
| RTV Shipped | ส่งคืน Vendor แล้ว |
| Vendor Response Pending | รอ Vendor ตอบ |
| Replacement Pending | รอของทดแทน |
| Credit Note Pending | รอ Credit Note |
| RTV Aging | เคสเก่าเกิน threshold |
| RTV by Brand | แยกตาม Brand |
| DOA Rate by Product | % DOA ของแต่ละสินค้า |

---

## 🔗 Related

[[WMS/📋 WMS Overview]] · [[WMS/🏗️ Architecture]]
""")

w("WMS/🗺️ WMS Roadmap.md", f"""---
tags: [roadmap, wms, planning]
updated: {TODAY}
---

# 🗺️ WMS Development Roadmap

## Phase 1 — Core WMS Launch (Now → Q3 2026)

**Goal:** ระบบ WMS ใช้งานได้จริงครบ 4 Portals

### Milestones
- [x] ✅ จัดทำ Requirement Document (SKILL.md)
- [x] ✅ สร้าง HTML Demo Prototype
- [x] ✅ Board Presentation (12-slide PPTX)
- [ ] 🔲 Board Approval
- [ ] 🔲 System Architecture Finalization
- [ ] 🔲 Database Design
- [ ] 🔲 Admin Portal Development
- [ ] 🔲 Warehouse Portal Development
- [ ] 🔲 Requester Portal Development
- [ ] 🔲 RTV Portal Development
- [ ] 🔲 UAT (User Acceptance Testing)
- [ ] 🔲 Go-Live

---

## Phase 2 — Enhanced Integration (Q4 2026 → Q1 2027)

**Goal:** เพิ่ม Integration และ Mobile

### Features
- [ ] 🔲 Barcode / QR Code Scanner Integration
- [ ] 🔲 Mobile Warehouse App (PWA)
- [ ] 🔲 RMA System Integration (API)
- [ ] 🔲 Vendor Portal (Read-only)
- [ ] 🔲 SLA Monitoring & Alert System

---

## Phase 3 — Analytics & AI (Q2 2027+)

**Goal:** Data-driven operations

### Features
- [ ] 🔲 Power BI Dashboard Integration
- [ ] 🔲 Inventory Demand Forecasting
- [ ] 🔲 DOA Trend Analytics
- [ ] 🔲 RTV Aging Analytics
- [ ] 🔲 Cycle Count Automation
- [ ] 🔲 AI-assisted Putaway Optimization

---

## Timeline

```
2026
Q2 ──[Board Pres]──[Approval]──── Q3 ──[UAT]──[Go-Live]──
                                   │
                              Phase 1 Complete
Q4 ──[Mobile App]──[RMA Integration]──────────────────────
                                   │
2027                          Phase 2 Complete
Q1 ──────────── Q2 ──[Power BI]──[AI Forecast]────────────
                                   │
                              Phase 3 Ongoing
```

---

## 🔗 Related

[[WMS/📋 WMS Overview]] · [[WMS/✅ WMS Tasks]] · [[Goals/🎯 2026 Goals]]
""")

w("WMS/✅ WMS Tasks.md", f"""---
tags: [tasks, wms]
updated: {TODAY}
---

# ✅ WMS Tasks

## 🔴 Critical (This Week)

- [ ] นำเสนอ Board Presentation ต่อคณะกรรมการ
- [ ] รอ Board Approval และบันทึก Feedback
- [ ] กำหนดทีมพัฒนา (Developer, BA, QA)

## 🟡 Upcoming (This Month)

- [ ] Finalize System Architecture Document
- [ ] Database Schema Design
- [ ] Wireframe Admin Portal
- [ ] Wireframe Warehouse Portal
- [ ] สร้าง SOP Document สำหรับ 5 Workflows หลัก

## 🟢 Backlog

- [ ] API Design Document
- [ ] Test Case Writing
- [ ] Training Material
- [ ] User Manual (EN + TH)
- [ ] Deployment Plan

## ✅ Done

- [x] จัดทำ SKILL.md (Requirement Guide)
- [x] HTML Demo Prototype (index + modules)
- [x] Board Presentation PPTX (12 slides, interactive)
- [x] Obsidian Vault Structure

---

## 🔗 Related

[[WMS/🗺️ WMS Roadmap]] · [[Tasks/✅ Active Tasks]]
""")

# Portal sub-notes
portals = {
    "Admin System": ("⚙", ["User Management", "Role Management", "Permission Setup",
                            "Product / Brand / Vendor Master", "Warehouse / Rack Master",
                            "Reason Code Master", "Warranty Rule Setup",
                            "Approval Workflow Setup", "Notification Setup", "Audit Log"]),
    "Warehouse Management": ("🏭", ["Goods Receiving", "Receiving Verification",
                                     "Product Inspection", "Putaway", "Inventory Stock Inquiry",
                                     "Stock Transfer", "Stock Adjustment", "Picking", "Packing",
                                     "Label Printing", "Shipment", "Handover Confirmation",
                                     "Cycle Count", "Warehouse Dashboard"]),
    "Requester Portal": ("📋", ["Create Withdrawal Request", "Track Request Status",
                                 "View Request History", "Confirm RMA Usage",
                                 "Mark Item as Used / Consumed", "Declare DOA / Defective",
                                 "Submit Unused Goods Return", "Upload Documents / Photos"]),
    "RTV Management": ("🔄", ["DOA Review", "Defective Item Review", "RTV Case Creation",
                               "RTV Approval", "Vendor Return Document", "Shipment Tracking",
                               "Vendor Response Tracking", "Replacement Tracking",
                               "Credit Note Tracking", "RTV Closure"]),
}
for name, (icon, funcs) in portals.items():
    fname = name.replace(" ", "_")
    func_list = "\n".join(f"- [ ] {f}" for f in funcs)
    w(f"WMS/Portals/{name}.md", f"""---
tags: [wms, portal, {fname.lower()}]
updated: {TODAY}
---

# {icon} {name}

## Functions

{func_list}

## Status
🔲 Design Phase

## 🔗 Related
[[WMS/📋 WMS Overview]] · [[WMS/🏗️ Architecture]]
""")

# ══════════════════════════════════════════════════════════════════════════════
# VERIFONE PROJECT
# ══════════════════════════════════════════════════════════════════════════════

w("Verifone/📋 Verifone Overview.md", f"""---
tags: [project, verifone, pos, hsnt]
status: running
updated: {TODAY}
---

# 📋 Verifone POS Project Overview

**Client:** Verifone Thailand
**Scope:** POS Terminal Repair Management, Part Request, Inventory, Power BI Reporting
**Status:** 🟢 Running Operations

---

## 🎯 Project Scope

| Area | Description |
|---|---|
| [[Verifone/📦 Part Request Management\|Part Request]] | บริหาร Part Request สำหรับ POS Terminal ที่ต้องซ่อม |
| [[Verifone/🔧 Repair Report System\|Repair Report]] | Track สถานะการซ่อม Terminal รายวัน |
| [[Verifone/📊 Power BI Reports\|Power BI]] | Dashboard: Repair SLA, Part Consumption, Forecast |
| [[Verifone/🔮 Forecasting\|Forecasting]] | Demand Forecast สำหรับ Spare Parts (ABC Analysis) |

---

## 🖥 Terminal Models Covered

- VX520 CTLS
- V240M
- BAY / BAYATM / BAYMINI
- และ Models อื่นๆ ตาม Appointment

---

## 🏢 Key Stakeholders

- Verifone Thailand (Client)
- HSNT Warehouse Team
- Amdocs (Integration Partner)
- BBL (Bangkok Bank) — Special Program

---

## 📁 Key Files

| File | Location | Purpose |
|---|---|---|
| Part Request Master | `D:\\Verifone Project\\Appointment Part Request\\` | Part consumption & forecast |
| Power BI Reports | `D:\\Verifone Project\\Report Bi.pbix` | Main dashboard |
| Part Forecast (AI) | `D:\\Verifone Project\\Appointment Part Request\\AI\\` | AI-assisted forecast tools |
| JD / Calendar | `D:\\Verifone Project\\` | Job description + cutoff calendar |

---

## 🔗 Related

[[Inventory/📋 Inventory Overview]] · [[WMS/📋 WMS Overview]] · [[Goals/🎯 2026 Goals]]
""")

w("Verifone/📦 Part Request Management.md", f"""---
tags: [verifone, parts, inventory, forecast]
updated: {TODAY}
---

# 📦 Verifone Part Request Management

## Process Flow

```
Appointment Created (Field Repair Request)
    │
    ▼
ตรวจสอบ Part ที่ต้องใช้ (per Terminal Model)
    │
    ▼
ยืนยัน Stock Available ใน Inventory
    │
    ▼
สร้าง Part Request → จ่ายให้ Technician
    │
    ▼
Technician ซ่อม → อัพเดทผล (Used / Not Used)
    │
    ▼
อัพเดท Consumption Report
    │
    ▼
Forecast การใช้งานสัปดาห์/เดือนถัดไป
```

---

## 📊 Key Metrics Tracked

| Metric | Description |
|---|---|
| Part Consumption | จำนวน Part ที่ใช้ต่อ Model / เดือน |
| Consumption Rate | % Part ที่ใช้จริง vs จ่ายออกไป |
| Top 10 Parts | Parts ที่ใช้บ่อยที่สุด |
| ABC Classification | A=High, B=Mid, C=Low consumption |
| Forecast Accuracy | เทียบ Forecast vs Actual |

---

## 🤖 AI Forecast Tools

| Tool | File | Method |
|---|---|---|
| Y_Final_Inventory_Forecast | Excel | Multi-model auto selection |
| Spare_Part_ABC_Forecast | Excel | ABC + moving average |
| Spare_Part_Forecast | Excel | Trend-based |
| Demand file | Excel | Raw demand input |

---

## 📅 Key Dates

- **Cutoff Calendar:** ดู `D:\\Verifone Project\\Appointment Part Request\\Calendar.xlsx`
- **Monthly Review:** สิ้นเดือน — Consumption summary
- **Quarterly Forecast:** ต้นไตรมาส — Forecast update

---

## 🔗 Related

[[Verifone/📋 Verifone Overview]] · [[Verifone/🔮 Forecasting]] · [[Inventory/📋 Inventory Overview]]
""")

w("Verifone/🔧 Repair Report System.md", f"""---
tags: [repair, verifone, report, tracking]
updated: {TODAY}
---

# 🔧 Repair Report System

## Overview

ระบบ Track สถานะการซ่อม POS Terminal แบบ Daily — ใช้ Excel + Power BI

## Daily Report Flow

```
ทุกวันทำการ:
1. ดึงข้อมูล Repair Status จากระบบ
2. อัพเดท Repair Report Excel
3. ตรวจสอบ Cases ที่ค้าง (Aging > threshold)
4. ส่ง Report ให้ Stakeholders
5. อัพเดท Power BI Dashboard
```

## Report Types

| Report | Frequency | Tool |
|---|---|---|
| Daily Repair Report | Daily | Excel |
| Weekly Summary | Weekly (Mon) | Excel → Power BI |
| Monthly Cutoff | Monthly | Excel |
| Amdocs Integration | Per Batch | Excel |
| Terminal Return | As needed | Power BI |

## Aging Thresholds

| Category | Threshold | Action |
|---|---|---|
| Normal | < 14 days | Monitor |
| Warning | 14–30 days | Escalate |
| Critical | > 30 days | Management Review |
| Dead Stock | > 5 years (VX520 CTLS) | Write-off consideration |

## Key Files

| File | Path |
|---|---|
| Main Report | `D:\\Repair Report Daily\\Repair Report all End cut off.xlsx` |
| Power BI | `D:\\Repair Report Daily\\Terminal ReturnV2_01-2026.pbix` |
| Model Map | `D:\\Repair Report Daily\\model map terminal fcst..xlsx` |
| Amdocs 2024 | `D:\\Repair Report\\Amdocs\\Amdocs 2024 รวม.xlsx` |

---

## 🔗 Related

[[Verifone/📋 Verifone Overview]] · [[Verifone/📊 Power BI Reports]]
""")

w("Verifone/📊 Power BI Reports.md", f"""---
tags: [powerbi, reporting, verifone, dashboard]
updated: {TODAY}
---

# 📊 Power BI Reports — Verifone

## Active Dashboards

| Dashboard | File | Content |
|---|---|---|
| Main Report | `Report Bi.pbix` | Overall Verifone ops |
| Part Consumption | `Part consumption 2024.pbix` | Part usage by model |
| Report Connector | `Report conencter.pbix` | Multi-source connector |
| Terminal Return | `Terminal ReturnV2_01-2026.pbix` | Return flow tracking |

## Data Sources

- Excel: Part Request files
- Excel: Repair Report daily files
- Excel: Inventory Balance
- CSV: Appointment data

## Key Visuals per Dashboard

### Main Report
- Repair Volume by Month (Bar Chart)
- SLA Achievement % (KPI Card)
- Top 10 Terminal Models by Repair Count
- Aging Analysis (Stacked Bar)

### Part Consumption
- Top Parts Used (Bar)
- Consumption Trend (Line)
- ABC Classification Matrix
- Forecast vs Actual

---

## Power BI Best Practices (This Project)

- ใช้ **Date Table** แยกสำหรับ Time Intelligence
- ทุก Measure ใส่ Unit (units, THB, %)
- Color: Green = Good, Yellow = Warning, Red = Alert
- Refresh: Manual (ยังไม่มี auto-refresh)

---

## 🔗 Related

[[Verifone/📋 Verifone Overview]] · [[Verifone/🔧 Repair Report System]] · [[Learning/📊 Excel & Power BI]]
""")

w("Verifone/🔮 Forecasting.md", f"""---
tags: [forecasting, demand, verifone, ai]
updated: {TODAY}
---

# 🔮 Demand Forecasting — Verifone Parts

## Forecasting Methods Used

| Method | Tool | When Used |
|---|---|---|
| Moving Average | Excel | Stable demand parts |
| Exponential Smoothing | Excel | Seasonal variation |
| ABC Auto-Select | Excel (AI) | Auto pick best model |
| Trend Regression | Excel | Growing/declining trend |

## ABC Classification

| Class | Criteria | Strategy |
|---|---|---|
| A (High) | Top 20% by consumption value | Weekly review, safety stock |
| B (Medium) | Next 30% | Monthly review, moderate buffer |
| C (Low) | Bottom 50% | Quarterly review, min stock |

## Forecast Files

| File | Purpose |
|---|---|
| `Y_Final_Inventory_Forecast_Tool.xlsx` | Best final version, multi-model |
| `Spare_Part_ABC_Forecast_Tool.xlsx` | ABC + forecast combined |
| `Spare_Part_Forecast_Tool.xlsx` | Standalone forecast |
| `Demand_Forecasting_Sample.xlsx` (Learning) | Practice/reference |

## Process

```
1. Input actual consumption (monthly)
2. ABC Classification auto-update
3. Model selection (MA / ES / Trend)
4. Generate 3-month forward forecast
5. Review & adjust for known events
6. Submit to procurement for PO
```

---

## 🔗 Related

[[Verifone/📦 Part Request Management]] · [[Learning/🤖 AI & Prompt Engineering]]
""")

# ══════════════════════════════════════════════════════════════════════════════
# ZEBRA / EV GARAGE
# ══════════════════════════════════════════════════════════════════════════════

w("Zebra/📋 Zebra Overview.md", f"""---
tags: [project, zebra, ev-garage, technician]
status: running
updated: {TODAY}
---

# 📋 Zebra & EV Garage Project

**Scope:** Technician Productivity Reporting + EV Garage Service System
**Status:** 🟢 Running

---

## Sub-Projects

### 1. Zebra Technician Productivity
- File: `Technician_Productivity_Report_Zebra.xlsx`
- Data: OLP Inventory 2021–2025 (CSV files)
- Purpose: Track Technician Performance ต่อปี
- See: [[Zebra/📊 Technician Productivity]]

### 2. EV Garage System
- Path: `D:\\Zebra_P'Kay\\EV Garage\\`
- Platform: Google Apps Script + HTML
- Purpose: ระบบ Service Management สำหรับ EV Garage (PKNewEnergy)
- See: [[Zebra/🚗 EV Garage System]]

---

## Key Files

| File | Purpose |
|---|---|
| `Technician_Productivity_Report_Zebra.xlsx` | Main productivity tracking |
| `data\\OLP_Inventory_*.csv` | Annual inventory data (2021–2025) |
| `EV Garage\\index.html` | EV Garage web app |
| `EV Garage\\Code.gs` | Google Apps Script backend |
| `EV Garage\\README.md` | System documentation |

---

## 🔗 Related

[[Verifone/📋 Verifone Overview]] · [[WMS/📋 WMS Overview]]
""")

w("Zebra/🚗 EV Garage System.md", f"""---
tags: [ev-garage, google-apps-script, web-app]
updated: {TODAY}
---

# 🚗 EV Garage Service System

## Overview

ระบบบริหารจัดการ Service ของ EV Garage สำหรับ PKNewEnergy
พัฒนาด้วย HTML + Google Apps Script (GAS) — ไม่ต้องมี Backend Server

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML + CSS + JavaScript (Single file) |
| Backend | Google Apps Script (Code.gs) |
| Database | Google Sheets |
| Hosting | Google Apps Script Web App |

## Features

- Service Job Creation
- Technician Assignment
- Job Status Tracking
- Customer Information Management
- Service History

## Versions

| Version | File | Notes |
|---|---|---|
| v2 | `ev_service_system_v2.html` | Stable production |
| v5 | `ev_service_system_v5.html` | Enhanced version |
| v6 | `EV_service_system_v6.html` | Latest iteration |
| PKNewEnergy | `PKNewEnergy\\index.html` | Branded version |

## Architecture

```
User (Browser)
    │  HTTP
    ▼
Google Apps Script Web App
    │  doGet() / doPost()
    ▼
Google Sheets (Data Store)
    └── Jobs Sheet
    └── Customers Sheet
    └── Technicians Sheet
```

---

## 🔗 Related

[[Zebra/📋 Zebra Overview]] · [[Zebra/📊 Technician Productivity]]
""")

w("Zebra/📊 Technician Productivity.md", f"""---
tags: [zebra, technician, productivity, reporting]
updated: {TODAY}
---

# 📊 Zebra Technician Productivity Report

## Data Sources

| File | Year | Records |
|---|---|---|
| `OLP_Inventory_20250512_2021Y.csv` | 2021 | Historical |
| `OLP_Inventory_20250512_2022Y.csv` | 2022 | Historical |
| `OLP_Inventory_20250512_2023Y.csv` | 2023 | Historical |
| `OLP_Inventory_20250512_2024Y.csv` | 2024 | Historical |
| `OLP_Inventory_20250512_2025Y.csv` | 2025 | Current |

## Key Metrics

- Jobs Completed per Technician
- Average Resolution Time
- First-Time Fix Rate
- Parts Used per Job
- Productivity Score (YoY comparison)

## Report: `Technician_Productivity_Report_Zebra.xlsx`

**Sheets:**
- Raw Data (pivot-ready)
- Summary Dashboard
- Technician Ranking
- Trend Analysis (2021–2025)

---

## 🔗 Related

[[Zebra/📋 Zebra Overview]]
""")

# ══════════════════════════════════════════════════════════════════════════════
# INVENTORY
# ══════════════════════════════════════════════════════════════════════════════

w("Inventory/📋 Inventory Overview.md", f"""---
tags: [inventory, reporting, hsnt]
status: running
updated: {TODAY}
---

# 📋 Inventory Management Overview

## Purpose

บริหารจัดการ Inventory สำหรับ Operations ของ HSNT — Daily & Weekly Balance Reporting

## Report Cadence

| Report | Frequency | Tool | Recipients |
|---|---|---|---|
| Daily Inventory Balance | Daily | Excel | Operations Team |
| Weekly Inventory Report | Weekly (Mon) | Excel | Management |
| Open Orders Report | As needed | Excel | Procurement |
| Sales Order Details | As needed | Excel | Sales / Ops |

## Coverage

- Spare Parts (Consignment)
- Finished Goods
- RMA Buffer Stock
- API Parts (API3001 tracking)
- Verifone Sales Orders (VF)

## Key Files

| File | Purpose |
|---|---|
| `Daily Inventory Balance\\*.xlsx` | Daily snapshots 2023–2024 |
| `Inventory Weekly Report\\*.xlsx` | Weekly consolidated reports |
| `Inventory Balance\\Report Inven.xlsx` | Balance master |
| `VF Sales Order Details*.xlsx` | Verifone SO tracking |
| `Open Orders Report*.xlsx` | Outstanding PO/SO |

## Archive Structure

```
D:\\Inventory\\
├── Daily Inventory Balance\\   ← Daily snapshot files
├── Inventory Balance\\         ← Consolidated balance
├── Inventory Weekly Report\\   ← Weekly reports by date
├── 2023-09-14\\                ← Point-in-time snapshots
├── 2023-09-19\\
└── 01\\
```

---

## 🔗 Related

[[WMS/📋 WMS Overview]] · [[Verifone/📦 Part Request Management]] · [[Goals/🎯 2026 Goals]]
""")

# ══════════════════════════════════════════════════════════════════════════════
# TASKS
# ══════════════════════════════════════════════════════════════════════════════

w("Tasks/✅ Active Tasks.md", f"""---
tags: [tasks, active]
updated: {TODAY}
---

# ✅ Active Tasks — {TODAY}

## 🔴 Critical

- [ ] **WMS Board Presentation** — นำเสนอต่อ Board บริหาร
  - File: `D:\\WMS_Project\\Requirement\\HSNT_WMS_Board_Presentation.pptx`
  - Related: [[WMS/📋 WMS Overview]]

- [ ] **WMS Board Approval** — รอผล + บันทึก Feedback จาก Board

## 🟡 This Week

- [ ] Verifone Part Request — อัพเดท Forecast Q3 2026
  - Related: [[Verifone/🔮 Forecasting]]
- [ ] Repair Report — สร้าง Power BI Dashboard สำหรับ June 2026
  - Related: [[Verifone/📊 Power BI Reports]]
- [ ] GPS Goals 2026 — ทบทวน Q2 Progress
  - Related: [[Goals/🎯 2026 Goals]]

## 🟢 Backlog

- [ ] WMS Database Schema Design
  - Related: [[WMS/🏗️ Architecture]]
- [ ] WMS Admin Portal Wireframe
  - Related: [[WMS/Portals/Admin System]]
- [ ] Zebra Productivity Report — 2025 Annual Update
  - Related: [[Zebra/📊 Technician Productivity]]
- [ ] เรียน English — Unit ถัดไป
  - Related: [[Learning/🌏 English Learning]]
- [ ] ศึกษา Power BI Advanced Features
  - Related: [[Learning/📊 Excel & Power BI]]

## ✅ Completed This Month

- [x] สร้าง HSNT WMS Board PPTX (12 slides, interactive) — {TODAY}
- [x] สร้าง Obsidian Vault Structure — {TODAY}
- [x] จัดทำ SKILL.md สำหรับ WMS Development

---

## 🔗 See Also

[[Tasks/📅 Weekly Review]] · [[WMS/✅ WMS Tasks]] · [[Goals/🎯 2026 Goals]]
""")

w("Tasks/📅 Weekly Review.md", f"""---
tags: [review, weekly, reflection]
updated: {TODAY}
---

# 📅 Weekly Review Template

> Copy this each week. Date the file as `Weekly Review YYYY-WW.md`

---

## Week of: {{WEEK}}

### ✅ Accomplished

-
-
-

### ❌ Not Done (carry forward)

-
-

### 🔍 Blockers / Issues

-

### 📊 Key Numbers

| Metric | This Week | Last Week |
|---|---|---|
| WMS Progress | | |
| Repair Reports Sent | | |
| Part Requests Processed | | |

### 🎯 Next Week Priorities

1.
2.
3.

### 💡 Learnings

-

---

## Archive

- [[Tasks/Archive/2026-W22]] *(example)*

---

## 🔗 Related

[[Tasks/✅ Active Tasks]] · [[Goals/🎯 2026 Goals]]
""")

# ══════════════════════════════════════════════════════════════════════════════
# ARCHITECTURE
# ══════════════════════════════════════════════════════════════════════════════

w("Architecture/🏗️ WMS System Design.md", f"""---
tags: [architecture, wms, design]
updated: {TODAY}
---

# 🏗️ WMS System Design (Detailed)

> See also: [[WMS/🏗️ Architecture]] for high-level overview

---

## Technology Recommendations

### Frontend
| Option | Pros | Cons |
|---|---|---|
| React + TypeScript | Modern, component-based, type-safe | Learning curve |
| Vue.js 3 | Simpler learning curve | Smaller ecosystem |
| Next.js | SSR/SSG, SEO, API routes | More complex setup |

**Recommendation:** React + TypeScript + Tailwind CSS

### Backend
| Option | Pros | Cons |
|---|---|---|
| Node.js + Express | JavaScript full-stack, fast | Callback complexity |
| Python + FastAPI | Fast, auto docs, type hints | Different language |
| .NET Core | Enterprise, Microsoft stack | Heavier |

**Recommendation:** Python + FastAPI (อ่านง่าย, มี OpenAPI docs อัตโนมัติ)

### Database
| Option | Pros | Cons |
|---|---|---|
| PostgreSQL | Robust, JSON support, free | Self-hosted |
| MySQL | Simple, widely used | Less features |
| MSSQL | Microsoft ecosystem | License cost |

**Recommendation:** PostgreSQL

---

## Deployment Architecture

```
                    [Load Balancer]
                         │
              ┌──────────┴──────────┐
         [Web App 1]          [Web App 2]
              │                     │
         [App Server]         [App Server]
              └──────────┬──────────┘
                    [Database]
                   PostgreSQL
                         │
                   [File Storage]
                  (Documents/Images)
```

---

## Security Considerations

- JWT Authentication (Access + Refresh tokens)
- HTTPS everywhere
- RBAC at API middleware level
- Input validation & sanitization
- Audit log for all write operations
- Rate limiting on API endpoints

---

## Integration Points

| System | Integration Type | Priority |
|---|---|---|
| RMA System | REST API | Phase 2 |
| Power BI | Direct DB connect or REST | Phase 3 |
| Barcode Scanner | WebUSB / Camera API | Phase 2 |
| Email (Notification) | SMTP / SendGrid | Phase 1 |
| LINE Notify | LINE API | Phase 1 |

---

## 🔗 Related

[[WMS/🏗️ Architecture]] · [[WMS/🔄 Workflows]] · [[WMS/🗺️ WMS Roadmap]]
""")

w("Architecture/📊 Data Flow Diagrams.md", f"""---
tags: [architecture, data-flow, diagram]
updated: {TODAY}
---

# 📊 Data Flow Diagrams

## Main Data Flow

```
External Sources                  HSNT WMS Core               Outputs
─────────────                     ────────────────             ───────
Brand/Vendor ──►  Goods Receiving ──► Stock Ledger ──► Dashboard
                        │                  │
Customer/RMA ──►  Inspection     ──► Transactions  ──► Reports
                        │                  │
RTV Return ──────  Putaway       ──► Audit Log     ──► Notifications
                        │
                   ─────────────────────────────────────
                   │  Request Engine                    │
                   │  Requester → Approval → Pick/Pack  │
                   ─────────────────────────────────────
                        │
                   RTV Engine ──► Vendor Returns
```

## Stock Status Transitions

```
[Pending Receiving]
       │ Verified
       ▼
[Pending Inspection]
       │ Pass              │ Fail
       ▼                   ▼
  [Available]         [Quarantine] / [DOA]
       │                        │
  [Reserved] ◄── Request        │
       │ Approved               ▼
  [Picking]              [RTV Pending]
       │                        │ Approved
   [Picked]              [RTV Shipped]
       │                        │ Vendor OK
   [Packed]                [Closed]
       │
  [Shipped]
       │
[Issued to RMA]
       │
  [Consumed] / [Returned Unused] / [DOA]
```

---

## 🔗 Related

[[WMS/🏗️ Architecture]] · [[WMS/🔄 Workflows]]
""")

# ══════════════════════════════════════════════════════════════════════════════
# GOALS
# ══════════════════════════════════════════════════════════════════════════════

w("Goals/🎯 2026 Goals.md", f"""---
tags: [goals, gps, 2026, kpi]
updated: {TODAY}
---

# 🎯 2026 Goals (VF GPS)

**Source Files:**
- `D:\\Goal Results\\2026\\GPS Setup_2026Y_VF.xlsx`
- `D:\\Goal Results\\VF Goal Results2025_ Anuchit.xlsx`

---

## 🏆 Key Goal Areas (2026)

*(อัพเดทจากไฟล์ GPS จริงตามที่ตั้งไว้)*

| Goal Area | KPI | Target | Current |
|---|---|---|---|
| WMS Project | Board Approval | Q2 2026 | In Progress |
| Repair SLA | % Cases ปิดใน SLA | > 90% | Tracking |
| Part Forecast Accuracy | MAPE | < 15% | Tracking |
| Inventory Accuracy | % Balance Correct | > 98% | Tracking |
| Reporting | Power BI Dashboard Live | Q3 2026 | Planning |

---

## 📅 Review Schedule

| Review | Date | Status |
|---|---|---|
| Q1 Review | 2026-03-31 | ✅ Done |
| Q2 Review | 2026-06-30 | 🟡 Upcoming |
| Q3 Review | 2026-09-30 | 🔲 Pending |
| Year-End | 2026-12-31 | 🔲 Pending |

---

## 🎯 Personal Development Goals 2026

- [ ] **WMS System** — Launch Phase 1 by Q3
- [ ] **English** — Complete Pre-Intermediate level
- [ ] **Power BI** — Advanced DAX & storytelling
- [ ] **AI/ML** — Apply AI Forecasting in Verifone project
- [ ] **Leadership** — Lead WMS UAT Team

---

## 🔗 Related

[[Goals/📈 Career Roadmap]] · [[WMS/🗺️ WMS Roadmap]] · [[Tasks/✅ Active Tasks]]
""")

w("Goals/📈 Career Roadmap.md", f"""---
tags: [career, roadmap, personal]
updated: {TODAY}
---

# 📈 Career Roadmap

## Current Role

**Operations & Warehouse Management Specialist**
Highpoint Service Network Thailand (HSNT)

Core areas: WMS, Inventory, Repair Operations, Reporting, Forecasting

---

## Skill Development Path

### Technical Skills

```
Now (2026)
├── Excel / Power BI ████████░░ 80%
├── Python (Basic)   ████░░░░░░ 40%
├── AI / Prompt Eng  ██████░░░░ 60%
├── WMS Design       ████████░░ 80%
└── English          █████░░░░░ 50%

Target (2027)
├── Excel / Power BI ██████████ 95%
├── Python           ███████░░░ 70%
├── AI / ML Applied  ████████░░ 80%
├── WMS Build        ████████░░ 80%
└── English          ████████░░ 80%
```

### Domain Skills

| Domain | Level Now | Target |
|---|---|---|
| Warehouse Ops | Expert | Expert |
| Inventory Mgmt | Expert | Expert |
| Data Analytics | Intermediate | Advanced |
| System Design | Intermediate | Advanced |
| Project Management | Intermediate | Advanced |

---

## Milestones

- 🎯 2026 Q3: WMS Phase 1 Go-Live
- 🎯 2026 Q4: Power BI Certification
- 🎯 2027 Q1: Python Data Analysis Course Complete
- 🎯 2027 Q2: WMS Phase 2 Mobile App

---

## 🔗 Related

[[Goals/🎯 2026 Goals]] · [[Learning/🤖 AI & Prompt Engineering]]
""")

# ══════════════════════════════════════════════════════════════════════════════
# LEARNING
# ══════════════════════════════════════════════════════════════════════════════

w("Learning/🤖 AI & Prompt Engineering.md", f"""---
tags: [learning, ai, prompt-engineering, claude]
updated: {TODAY}
---

# 🤖 AI & Prompt Engineering

## Tools Used

| Tool | Use Case |
|---|---|
| Claude (Anthropic) | WMS design, code, documents, analysis |
| ChatGPT | General questions, brainstorming |
| GitHub Copilot | Code assistance |
| Codex | Advanced code generation |

## Prompt Patterns That Work

### For Document Generation
```
Context: [project background]
Task: Create [document type]
Requirements:
- [req 1]
- [req 2]
Format: [markdown/pptx/excel]
Tone: [professional/technical]
```

### For Code Generation
```
Language: [Python/JavaScript/etc]
Task: [specific function]
Input: [data structure]
Output: [expected result]
Constraints: [limitations]
```

### For Analysis
```
Data: [paste data or describe]
Question: [specific question]
Format: [table/chart/narrative]
```

---

## AI Tools for Forecasting

- Excel AI Forecast Tool (อยู่ใน Verifone project)
- Python: `statsmodels`, `scikit-learn`, `prophet`
- Files: `D:\\Learning\\Demand Forecasting\\`

## Files

| File | Location |
|---|---|
| How to Prompt.pptx | `D:\\Learning\\AI\\How to pormpt.pptx` |
| Interactive AI Demo | `D:\\Learning\\AI\\interactive_minimal_ai_web_demo.jsx` |
| Excel Visualize | `D:\\Learning\\AI\\Excel Visualize\\` |

---

## 🔗 Related

[[Learning/📊 Excel & Power BI]] · [[Verifone/🔮 Forecasting]] · [[Goals/📈 Career Roadmap]]
""")

w("Learning/📊 Excel & Power BI.md", f"""---
tags: [learning, excel, powerbi, analytics]
updated: {TODAY}
---

# 📊 Excel & Power BI

## Excel Skills

### Currently Proficient
- VLOOKUP / XLOOKUP / INDEX-MATCH
- PivotTable & PivotChart
- Power Query (M Code)
- Conditional Formatting
- Data Validation
- Array Formulas

### Learning / Improving
- Advanced Power Query (M Code for regions/filtering)
- Dynamic Arrays (FILTER, UNIQUE, SORT)
- Excel + Python integration

### Key Formulas Used in Projects
```excel
# Part Request matching
=IF(ISNUMBER(SEARCH([@Category],standard)),...)

# M Code for region filter (from D:\Scrip task\M Code for find let.txt)
# Custom region mapping logic

# Inventory aging
=DATEDIF(receive_date, TODAY(), "D")
```

---

## Power BI Skills

### Currently Proficient
- Data Modeling (Star Schema)
- Basic DAX (SUM, COUNT, CALCULATE, FILTER)
- Report Design & Layout
- Slicers & Filters
- Bar, Line, Pie, Matrix visuals

### Learning
- Advanced DAX (Time Intelligence, RANKX, TOPN)
- Row-Level Security (RLS)
- Power BI Storytelling (ref: `Microsoft-Power-BI-Storytelling.pptx`)
- Custom Visuals

---

## Reference Files

| File | Path |
|---|---|
| Power BI Storytelling | `D:\\Repair Report Daily\\Microsoft-Power-BI-Storytelling.pptx` |
| Excel Learning Platform | `D:\\Learning\\AI\\Excel Visualize\\excel-learning-platform.html` |
| DuckDB CLI | `D:\\Scrip task\\DockDB\\duckdb.exe` |
| Demand Forecasting Sample | `D:\\Learning\\Demand Forecasting\\Demand_Forecasting_Sample.xlsx` |

---

## 🔗 Related

[[Learning/🤖 AI & Prompt Engineering]] · [[Verifone/📊 Power BI Reports]]
""")

w("Learning/🌏 English Learning.md", f"""---
tags: [learning, english, language]
updated: {TODAY}
---

# 🌏 English Learning

## Current Level

**Pre-Intermediate** — กำลังเรียน actively

## Materials

| Material | Location | Status |
|---|---|---|
| Pre-Intermediate Wordlist CH7 | `D:\\Learning\\English\\` | 📖 Current |
| LINE Album Photos (Part 1) | `D:\\Learning\\English\\1st\\` | ✅ Done |
| Vocabulary Screenshots | `D:\\Learning\\English\\messageImage_*.jpg` | 📖 Review |

## Learning Strategy

1. **Vocabulary** — Wordlist per chapter, review 3x/week
2. **Reading** — English documents at work (WMS SKILL.md practice)
3. **Writing** — Email in English (see `D:\\asd\\write email.png`)
4. **Listening** — Meetings, recordings

## Work English Context

- WMS documents all in English (practice reading)
- Board presentations in English (writing practice)
- Repair reports — bilingual (TH + EN)

---

## 🔗 Related

[[Goals/📈 Career Roadmap]] · [[Goals/🎯 2026 Goals]]
""")

# ══════════════════════════════════════════════════════════════════════════════
# RESOURCES
# ══════════════════════════════════════════════════════════════════════════════

w("Resources/🛠️ Tools & Scripts.md", f"""---
tags: [tools, scripts, resources]
updated: {TODAY}
---

# 🛠️ Tools & Scripts

## Installed Tools

| Tool | Path | Purpose |
|---|---|---|
| Node.js | `D:\\nodejs\\node.exe` | JavaScript runtime |
| DuckDB CLI | `D:\\Scrip task\\DockDB\\duckdb.exe` | SQL on files |
| Python 3.11 | `C:\\Users\\2404048\\AppData\\Local\\Programs\\Python\\Python311\\` | Scripts & data |

## Python Packages Available

- `python-pptx` — PowerPoint generation
- `Pillow` — Image processing
- `XlsxWriter` — Excel generation
- `lxml` — XML processing

## Useful Scripts

| Script | Path | Purpose |
|---|---|---|
| build_pptx.py | `D:\\WMS_Project\\build_pptx.py` | WMS Board PPTX generator |
| build_vault.py | `D:\\WMS_Project\\build_vault.py` | This Obsidian vault |

## Script Snippets (D:\\Scrip task)

| File | Content |
|---|---|
| `Code for regien.txt` | Region classification code |
| `cpu code.txt` | CPU-related code |
| `M Code for find let.txt` | Power Query M Code |
| `IF(ISNUMBER... .txt` | Excel formula snippet |

## VS Code Extensions (Recommended)

- Markdown All in One
- Obsidian MD Preview
- Python
- Power BI Reports
- GitLens

---

## 🔗 Related

[[Learning/🤖 AI & Prompt Engineering]] · [[Learning/📊 Excel & Power BI]]
""")

w("Resources/📚 Useful References.md", f"""---
tags: [references, resources]
updated: {TODAY}
---

# 📚 Useful References

## Internal Documents

| Document | Location |
|---|---|
| WMS SKILL.md (Dev Guide) | `D:\\WMS_Project\\Requirement\\HSNT_WMS_SKILL.md` |
| Board PPTX | `D:\\WMS_Project\\Requirement\\HSNT_WMS_Board_Presentation.pptx` |
| Verifone Visual Inspection | `D:\\Verifone Project\\06156_visual_inspection revI01_TH HSN.pdf` |
| EV Garage README | `D:\\Zebra_P'Kay\\EV Garage\\EV Garage\\README.md` |
| EV Garage User Manual | `D:\\Zebra_P'Kay\\EV Garage\\EV Garage\\USER_MANUAL.md` |
| Power BI Storytelling | `D:\\Repair Report Daily\\Microsoft-Power-BI-Storytelling.pptx` |

## Key Contacts (to fill in)

| Contact | Role | Preferred Channel |
|---|---|---|
| — | Board Members | Email |
| — | Verifone PM | LINE |
| — | Warehouse Team | LINE Group |

## Reference Model

- `D:\\Repair Report Daily\\Reference Model_REV.xlsx` — Terminal model reference

## Coffee Book (Personal)

- `D:\\Learning\\The_world_atlas_of_coffee*.pdf` ☕

---

## 🔗 Related

[[Resources/🛠️ Tools & Scripts]] · [[WMS/📋 WMS Overview]]
""")

# ══════════════════════════════════════════════════════════════════════════════
# OBSIDIAN CONFIG
# ══════════════════════════════════════════════════════════════════════════════

# .obsidian/app.json — basic settings
import json
obsidian_config = {
    "useMarkdownLinks": True,
    "showLineNumber": True,
    "vimMode": False,
    "defaultViewMode": "preview",
    "foldHeading": True,
    "foldIndent": True,
    "readableLineLength": True,
    "showFrontmatter": False,
    "livePreview": True,
}
(VAULT / ".obsidian").mkdir(exist_ok=True)
(VAULT / ".obsidian" / "app.json").write_text(json.dumps(obsidian_config, indent=2), encoding="utf-8")

# .obsidian/appearance.json — theme
appearance = {
    "theme": "obsidian",
    "cssTheme": "",
    "baseFontSize": 16,
    "enabledCssSnippets": []
}
(VAULT / ".obsidian" / "appearance.json").write_text(json.dumps(appearance, indent=2), encoding="utf-8")

# Graph view config
graph = {
    "collapse-filter": False,
    "search": "",
    "showTags": True,
    "showAttachments": False,
    "hideUnresolved": False,
    "showOrphans": True,
    "collapse-color-groups": False,
    "colorGroups": [
        {"query": "tag:#wms", "color": {"a": 1, "rgb": 5087956}},
        {"query": "tag:#verifone", "color": {"a": 1, "rgb": 16737843}},
        {"query": "tag:#learning", "color": {"a": 1, "rgb": 3394662}},
        {"query": "tag:#tasks", "color": {"a": 1, "rgb": 16744272}},
    ],
    "collapse-display": False,
    "showArrow": True,
    "textFadeMultiplier": 0,
    "nodeSizeMultiplier": 1.5,
    "lineSizeMultiplier": 1,
    "collapse-forces": False,
    "centerStrength": 0.518713248970312,
    "repelStrength": 10,
    "linkStrength": 1,
    "linkDistance": 250,
    "scale": 1,
    "close": False,
}
(VAULT / ".obsidian" / "graph.json").write_text(json.dumps(graph, indent=2), encoding="utf-8")

# Hotkeys
hotkeys = {}
(VAULT / ".obsidian" / "hotkeys.json").write_text(json.dumps(hotkeys, indent=2), encoding="utf-8")

# ══════════════════════════════════════════════════════════════════════════════
# PRINT SUMMARY
# ══════════════════════════════════════════════════════════════════════════════
all_files = list(VAULT.rglob("*.md"))
print(f"\n{'='*60}")
print(f"✅ Obsidian Vault Created: {VAULT}")
print(f"   Total Notes: {len(all_files)}")
print(f"\n📁 Structure:")
for f in sorted(all_files):
    rel = f.relative_to(VAULT)
    depth = len(rel.parts) - 1
    print(f"   {'  ' * depth}{'└── ' if depth else ''}{rel}")
print(f"\n{'='*60}")
print("Open with Obsidian: File → Open vault → Select D:\\HSNT_Knowledge_Vault")
