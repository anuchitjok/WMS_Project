# แผนงานปรับปรุง WMS (ตามไฟล์ Revise WMS 20261105.xlsx)

จัดทำ: 6 พ.ย. 2026 · Branch: `claude/wms-improvement-execution-96d692` · สถานะ: **ฉบับแก้ไขครั้งที่ 2 (ตามคำตอบ Q1–Q10) — รอ review ยังไม่มีการแก้ไขโค้ด**

---

## 0. สรุปภาพรวม

- รายการในไฟล์ Excel ทั้งหมด **42 แถว / 13 ภาพประกอบ** → จัดกลุ่มเป็น **35 งาน** ใน 7 Phase
- งาน 1 รายการ **"ค้างไว้ก่อน"** ตาม Excel (ที่อยู่จัดส่งแบบเต็ม) → ไม่ทำรอบนี้
- ต้องมี **Database migration ใหม่ 3 ชุด** (29, 31, 32) ทั้งหมดเป็นแบบ "เพิ่มอย่างเดียว" (nullable column / ตารางใหม่) — ไม่ลบหรือแก้ข้อมูลเดิม มี rollback script ทุกชุด ทดสอบบน DB local (PGlite) เท่านั้น
  - migration 30 (ตาราง Space Booking) **ตัดออก** เพราะ Q5 ต้องการแค่ Simulation ไม่ต้องบันทึก
- คำถาม Q1–Q10 ได้คำตอบแล้ว — สรุปว่าแต่ละคำตอบเปลี่ยนแผนอย่างไรอยู่ใน **หัวข้อ 9**

### สิ่งที่เปลี่ยนจากฉบับแรก (สรุปให้ review)
| เรื่อง | ฉบับแรก | ฉบับนี้ |
|---|---|---|
| หน้า Warehouse Master (Q6) | สร้าง slot เป็นปุ่มแยก | **หน้าเดียวจัดการ WH → Rack → Slot** + ตัววางแผนว่าพื้นที่ใส่ rack ได้กี่ตัว / rack มีกี่ slot / slot ละกี่ m²·m³ |
| Rack type (Q4) | map ตอนแสดง | ตัวเลือกเหลือ **2 แบบเท่านั้น**: Standard Rack (ชั้นวาง) และ Pallet on Floor (พื้นวางพาเลท) |
| Space Booking (Q5) | ตารางจองพื้นที่ (migration 30) | **Space Simulator** — กรอกพื้นที่ หรือเลือกสินค้า + จำนวน → บอกว่าใช้กี่ m² / กี่ slot / พอไหมในคลังที่เลือก (ไม่บันทึก) |
| Floor plan / 3D (Q2) | ซ่อน 2D (+3D?) | ซ่อน 2D editor อย่างเดียว · **เก็บ 3D view และปรับภาพให้สมจริงขึ้น** (งานใหม่ 1.7) |
| เมนูที่ซ่อน (Q3) | Project Planning + Warranty | **Warranty + Material Planning (MRP)** — Project Planning ยังแสดงตามเดิม |
| QR (Q10) | ผู้ขอสแกนยืนยัน | **QR ใช้ได้ 2 ฝั่ง**: ผู้ขอสแกน → ยืนยันรับของ · WH สแกน → เห็นรายการที่ต้องหยิบ |
| Product | – | เพิ่มขนาดสินค้า (กว้าง×ยาว×สูง) ใน migration 31 เพื่อให้ Simulator คำนวณจากสินค้าได้ |
| ข้อ 2.1 Product Master | เพิ่มคำอธิบายว่าเทียบเท่า Stock Item | **ปรับชุดข้อมูล** ให้ตรงกับฟิลด์ Stock Item ของ Acumatica (Header / Detail / Type input ที่ส่งมา) |

| Phase | หัวข้อ | จำนวนงาน | Migration | ความเสี่ยง |
|---|---|---|---|---|
| P1 | Warehouse Structure & Space | 8 | 29 | สูง (โครงสร้างคลัง) |
| P2 | Master Data | 5 | 31 | กลาง |
| P3 | Goods Receiving & Receiving Report | 4 | – | กลาง |
| P4 | Withdrawal & Fulfillment | 7 | 32 | สูง (flow เบิก/อนุมัติ) |
| P5 | Warehouse Documents & QR | 4 | – | กลาง |
| P6 | Dashboard & Control Tower | 3 | – | ต่ำ (อ่านอย่างเดียว) |
| P7 | UI/UX & Governance | 4 | – | ต่ำ–กลาง |

---

## 1. สิ่งที่พบจากการสำรวจระบบปัจจุบัน (สำคัญต่อการวางแผน)

| หัวข้อ | สถานะปัจจุบัน | ผลต่อแผน |
|---|---|---|
| `Warehouse` (DB) | มีแค่ code, name, location — **ไม่มีขนาดพื้นที่** | ต้องเพิ่มคอลัมน์ขนาด (P1) |
| `Rack` (DB) | มี `rackType` เป็น enum 7 ค่า (STANDARD, DRIVE_IN, … PALLET), levels, columns — **ไม่มีขนาด L×W×H** | ต้องมี Rack Type Master + ขนาด (P1) |
| `Slot` (DB) | มี lengthCm/widthCm/heightCm แล้ว แต่ใส่ทีละช่อง | ทำ "Run slot" สร้างอัตโนมัติ (P1) |
| หน้า Warehouse Master | สร้าง slot ได้ทีละช่อง; ข้อความในหน้า **ยังไม่รองรับ 3 ภาษาเลย** (hard-coded English) | ต้องแปลทั้งหน้าเมื่อแก้ (เพิ่มงาน) |
| สิทธิ์ Warehouse Master | API เขียนได้ทั้ง SYSTEM_ADMIN และ WAREHOUSE_MANAGER | ต้องแยกสิทธิ์ใหม่ (P1) |
| Floor plan / 3D | หน้า Warehouse Operations (`/warehouse-layout`) มี tab 2D Floor plan และ 3D view — 3D **วาง rack อัตโนมัติตาม zone ได้เองเมื่อไม่มีผัง 2D** (`scene-geometry.ts`) และใช้ตำแหน่งที่เคยวาดไว้ถ้ามี | ซ่อน 2D ได้โดย 3D ไม่พัง |
| Label | `labels.service.ts` มี bin label + QR อยู่แล้ว แต่ข้อมูลน้อย (ตามภาพ: Location, WH, Pallet·Cap) | ปรับ layout + ข้อมูล (P5) |
| Product import | มีระบบ Import กลาง (`dataio`) ตรวจซ้ำด้วย **product code** เท่านั้น; brand ที่ไม่มีอยู่ = error | เพิ่มตรวจซ้ำด้วย **Brand + SKU** (P2) |
| Brand ↔ Product | ต้องสร้าง Brand ที่หน้า Business Partners ก่อน (หน้านี้ยังไม่รองรับ 3 ภาษา) | เพิ่ม Quick-add Brand ในฟอร์ม Product (P2) |
| Source Type "RTV Replacement" | ค่า string ถูกเก็บใน DB และถูกเขียนโดย `rtv.service.ts` อัตโนมัติ | แนะนำเปลี่ยนเฉพาะ "คำที่แสดง" (Q7) |
| RMA Reference No (receiving) | เก็บใน `GoodsReceiving.sourceRef` | ใช้ต่อใน report ได้ ไม่ต้องเพิ่ม field |
| Receive Report | มีแล้ว (`reports.service.ts` → `receive`) แต่คอลัมน์ไม่ครบตาม Excel | เพิ่มคอลัมน์จาก Item Master (P3) |
| Product: Created By / Last Modified By | **ไม่มีใน DB** (มีแค่ createdAt/updatedAt) | ดึงจาก Audit Log (ไม่ต้อง migrate) |
| Product: Part Type, Default Price | **ไม่มีใน DB** | migration 31 (ถ้ายืนยันใน Q9) |
| Withdrawal Request list | ไม่มีช่องค้นหา (มีแค่ filter status) | P4 |
| Approval Workspace | อนุมัติทีละรายการ, ไม่มีปุ่มดูรายละเอียด, ไม่มี checkbox | P4 |
| Allocate | ซ่อนอยู่ในปุ่ม "Allocate" → popup (ภาพ Excel วงแดง) | ทำเป็นคอลัมน์บนกระดาน (P4) |
| Picking Slip PDF | `documents.service.ts` → 4 ช่องเซ็น (Picked/Checked/Received/Approved) + คอลัมน์ Status | ปรับตามภาพ (P5) |
| Users page | มี import users ในหน้า Import/Export กลาง แต่ไม่มีปุ่มในหน้า Users, ไม่มี export, หน้าไม่รองรับ 3 ภาษา | P7 |
| Dashboard | ไม่มีข้อมูลพื้นที่/ความจุเลย | P6 (ต้องรอ P1) |

---

## 2. P1 — Warehouse Structure & Space Management

> ลำดับภายใน Phase: 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7 → 1.8 (ขึ้นต่อกัน)

### ภาพรวมหน้า Warehouse Master ใหม่ (Q6) — จัดการได้ในหน้าเดียว
ผู้ใช้สร้างและจัดการคลังทั้งหมดในหน้าเดียว ไม่ต้องเปิด popup แยกเพื่อเข้าไปกรอก slot ทีละช่อง:

```
┌ ต้นไม้ (ซ้าย) ──────┐ ┌ รายละเอียด (ขวา) ─────────────────────────────────────┐
│ ▸ WH-A  (100 m²)    │ │ WH-A · 10 m × 10 m × 6 m = 100 m² / 600 m³             │
│   ▸ A01 Standard    │ │ ใช้ไป 37.5 m² (rack 3 ตัว + pallet zone 1) · ว่าง 62.5 m² │
│   ▸ A02 Standard    │ │                                                          │
│   ▸ P01 Pallet Floor│ │ Rack A01 · Standard Rack · 2.5 × 1.0 × 2.5 m             │
│ ▸ WH-B              │ │ Levels 5 × Columns 5 = 25 slots · slot ละ 0.10 m² / 0.05 m³ │
└─────────────────────┘ │ ┌──┬──┬──┬──┬──┐  ← ตาราง slot แก้ไขได้ในตาราง      │
                        │ │05│  │  │  │  │    (ชื่อ, ประเภท, ความจุ, ขนาด)     │
                        │ │..│  │  │  │  │    สีบอกสถานะ ว่าง / มีของ / blocked │
                        │ │01│  │  │  │  │                                        │
                        │ └──┴──┴──┴──┴──┘  [Generate slots]  [พิมพ์ป้าย]         │
                        └──────────────────────────────────────────────────────────┘
```

### 1.1 ขนาดพื้นที่คลัง (Create/Edit Warehouse)
- **ที่มา:** Excel แถว 16 "Create WH ให้มี Detail ทั้งหมด Dimension space area, CM"
- **แก้:** ฟอร์ม Create/Edit WH เพิ่ม กว้าง × ยาว × สูง (cm), % พื้นที่ใช้งานได้ (หักทางเดิน, ค่าเริ่ม 100) → ระบบคำนวณ m² และ m³ ให้เห็นทันที
- **DB (migration 29):** `Warehouse` + `lengthCm`, `widthCm`, `heightCm`, `usableAreaPct` (nullable ทั้งหมด → คลังเดิมไม่กระทบ)
- **API:** ขยาย `POST/PATCH /warehouse-master/warehouses`

### 1.2 Rack Type Master — เหลือ 2 แบบ (Q4)
- **ที่มา:** Excel แถว 16–18 + ภาพ dropdown 7 ประเภท
- **แก้:** ตารางใหม่ `RackTypeMaster` เก็บ "แม่แบบขนาด" ภายใต้ 2 หมวดเท่านั้น:
  - **Standard Rack** (ชั้นวาง/shelf) — ขนาด W×L×H cm, จำนวนชั้น (levels) × ช่อง (columns) เริ่มต้น
  - **Pallet on Floor** (พื้นว่างวางพาเลท) — ขนาดพาเลท W×L cm, ความสูงซ้อนสูงสุด, จำนวนตำแหน่ง (ใช้ level = 1)
  - สร้างได้หลายแม่แบบในแต่ละหมวด เช่น "Standard 2.5 m 5 ชั้น", "Pallet 1.2×1.0 m"
- `Rack` + `rackTypeId` (nullable) + `lengthCm/widthCm/heightCm` — เลือกแม่แบบแล้วเติมขนาด/ชั้น/ช่องให้อัตโนมัติ แก้ได้
- **dropdown เดิม 7 ตัวเลือกเอาออกจาก UI ทั้งหมด** (ฟอร์มสร้าง/แก้ rack, filter, label)
- **Rack เดิม:** ไม่แก้ข้อมูลใน DB — แสดงเป็น PALLET → Pallet on Floor, อื่นๆ → Standard Rack; enum `RackType` ใน DB คงไว้เพื่อไม่ให้ข้อมูลเก่าพัง และ rack ใหม่จะถูกเขียนเป็น STANDARD หรือ PALLET เท่านั้น
- **DB:** migration 29 (รวมกับ 1.1)

### 1.3 ตัววางแผนพื้นที่ในหน้าเดียว (Capacity Planner)
- **ที่มา:** คำตอบ Q6 "WH-A มี 100 m² จะได้กี่ Rack, ถ้าขนาด 5×5 = 25 slot และมีพื้นที่ slot ละเท่าไหร่"
- **แก้:** ในหน้ารายละเอียดคลังมีตัวช่วยคำนวณ:
  - เลือกแม่แบบ rack → บอก **"ใส่ได้อีกประมาณกี่ตัว"** จากพื้นที่ว่าง (footprint rack + % ทางเดิน)
  - แสดง **จำนวน slot = levels × columns** และ **ขนาดต่อ slot** (กว้าง × ลึก × สูง, m², m³) ที่คำนวณจากขนาด rack ÷ ช่อง
  - ปุ่ม "สร้าง rack ตามนี้" → ไปข้อ 1.4 ได้ทันที
- คำนวณฝั่ง backend ใน service กลางเดียวกับ 1.5 (ไม่คำนวณซ้ำ 2 ที่)

### 1.4 Run Slot อัตโนมัติ + แก้ slot ในหน้าเดียวกัน
- **ที่มา:** Excel แถว 16 "Run slot … 08" + Q6
- **รหัส slot:** `<RackCode>-<Level 2 หลัก>-<Column 2 หลัก>` เช่น `A01-01-08`
- **แก้:** ปุ่ม "Generate slots" → preview รหัสก่อนสร้าง → สร้างทั้งหมดใน transaction เดียว, **ข้ามช่องที่มีอยู่แล้ว** (ไม่ทับ/ไม่ลบช่องเดิม), ขนาด slot สืบทอดจาก rack
- **ตาราง slot ใน panel ขวา** แก้ชื่อ/ประเภท/ความจุ/ขนาดได้ในตาราง เลือกหลายช่องแก้พร้อมกันได้ — เลิกใช้ popup แยก
- ลบ slot ยังผ่านการเช็กผลกระทบเดิม (ช่องที่มีของลบไม่ได้)
- **API ใหม่:** `POST /warehouse-master/racks/:id/generate-slots` (preview + commit), `PATCH /warehouse-master/slots/bulk`; audit log 1 รายการต่อครั้ง
- **ระวัง:** unique `[rackId, code]` มีอยู่แล้ว → กันซ้ำได้ระดับ DB; slot เดิมที่ใช้รหัสรูปแบบอื่นยังใช้งานได้ตามเดิม

### 1.5 Space Calculation Service (เครื่องคำนวณพื้นที่)
- **ที่มา:** Excel แถว 2 "คำนวณพื้นที่ทั้งหมดของทุก WH หรือเลือก WH ได้ ว่าว่าง/เต็ม/เหลือเท่าไหร่"
- **แก้:** service กลาง คำนวณต่อคลัง: พื้นที่รวม, พื้นที่ rack/pallet ใช้ไป (footprint), พื้นที่ว่าง, จำนวน slot ทั้งหมด/มีของ/ว่าง/blocked, % ความจุที่ใช้ไป, ปริมาตร (m³) ที่ใช้/ว่าง
- **API ใหม่:** `GET /warehouse-master/space-summary?warehouseId=` — เคารพ warehouse scope ของ user (`common/warehouse-scope.ts`)
- ใช้ต่อใน 1.3, 1.6 และ P6 Dashboard

### 1.6 Space Simulator (แทน Space Booking — Q5)
- **ที่มา:** Excel แถว 3, 16 + คำตอบ Q5 "เป็นแค่ Simulation ก็พอ"
- **แก้:** หน้าจำลอง (ไม่บันทึกลง DB) 2 แบบ:
  1. **จองเป็นพื้นที่:** กรอก m² หรือจำนวน slot → บอกว่าคลังที่เลือกรองรับไหม เหลือเท่าไหร่หลังจอง
  2. **จากสินค้า:** เลือกสินค้า (หรือกรอกขนาดกล่องเอง) + จำนวน + ซ้อนได้กี่ชั้น → บอกว่าต้องใช้ **กี่ m² / กี่ slot / กี่พาเลท** และเทียบกับพื้นที่ว่างของแต่ละคลัง
  - เพิ่มได้หลายรายการในการจำลองครั้งเดียว + ปุ่มพิมพ์/Export ผลไว้ใช้เสนองาน
- ต้องมีขนาดสินค้า → เพิ่ม `Product.lengthCm/widthCm/heightCm` (nullable) ใน migration 31 (ข้อ 2.5); สินค้าที่ยังไม่มีขนาดให้กรอกเองในหน้าจำลอง
- **ไม่แตะ** slot / stock / reservation ใดๆ — **ไม่มี migration 30**

### 1.7 สิทธิ์ Warehouse (Q1)
- **ที่มา:** Excel แถว 12–13
- **แก้:** สร้าง/แก้/ปิดคลัง และ Rack Type Master = **SYSTEM_ADMIN** เท่านั้น; Rack/Slot, กำหนดคลังให้ผู้ใช้, Product Master = **WAREHOUSE_MANAGER** ทำได้ด้วย; role อื่นดูอย่างเดียว
- แก้ทั้ง backend (`@Roles` ใน controller) และ frontend (ซ่อนปุ่ม) ให้ตรงกัน, ใช้ legacy role enum ตาม sidebar ปัจจุบัน
- **ไม่ต้อง migrate**

### 1.8 ซ่อน Floor Plan 2D + ปรับ 3D view ให้สมจริง (Q2)
- **ซ่อน:** tab Floor plan 2D editor ในหน้า Warehouse Operations — **ไม่ลบตาราง `WarehouseLayout`/`LayoutObject` และไม่ลบโค้ด** (ปิดด้วย setting เปิดกลับได้); ตำแหน่ง rack ที่เคยวาดไว้ 3D ยังใช้ต่อ
- **เก็บและปรับ 3D view** ให้เหมือนภาพตัวอย่างคลังจริง:
  - Rack แบบ selective pallet rack: เสาสีน้ำเงิน, คานสีส้ม, ค้ำยันไขว้ด้านข้าง
  - กล่องสีน้ำตาลวางบนชั้นตามจำนวนของจริงใน slot (ว่าง = ชั้นโล่ง) + พาเลทไม้ใต้กล่อง
  - Pallet on Floor แสดงเป็นพาเลทบนพื้นในโซนตีเส้นเหลือง
  - พื้นปูนสีเทาอ่อน, เส้นทางเดินสีเหลือง, ป้ายชื่อ zone/rack แขวนหัว rack (เช่น "A01")
  - ใช้ขนาดจริงของคลัง/rack จาก 1.1–1.2 (ถ้าไม่มี ใช้ค่าเดิม)
  - คงฟังก์ชันเดิม: คลิก slot → ดูของ / "View Stock Detail", ค้นหาของแล้วไฮไลต์ตำแหน่ง
- **ระวังประสิทธิภาพ:** คลังที่มี slot เยอะใช้ instancing (วาดกล่องซ้ำแบบประหยัด) และไม่ใช้ texture ภาพถ่ายหนัก (ใช้สี/วัสดุแทน) เพื่อไม่ให้หน้าช้า

### + งานแฝงใน P1
- แปลหน้า Warehouse Master ทั้งหน้าเป็น EN/TH/ZH (ตอนนี้ยังไม่มี i18n)

---

## 3. P2 — Master Data Management

### 2.1 ปรับข้อมูล Product Master ให้ตรงกับ Stock Item ของ Acumatica
- **ที่มา:** Excel แถว 24 + ตาราง Header / Detail / Type input ที่ส่งมาเพิ่ม (6 พ.ย.) — **ไม่ได้เปลี่ยนชื่อเมนู แต่ปรับชุดข้อมูล**
- ฟิลด์แบ่งเป็น 3 กลุ่มตามที่มาของข้อมูล:

**ก. ข้อมูลสินค้า (กรอกในฟอร์ม Product Master)**

| Header (Acumatica) | ช่องในระบบ | วิธีกรอก | สถานะปัจจุบัน |
|---|---|---|---|
| Inventory ID/SKU | `partNumber` (SKU หลัก) | Free text, ห้ามซ้ำ | มีแล้ว — แต่ตอนนี้ `code` ถูกสร้างอัตโนมัติแบบยาว (`…-RF-1783584067992`) → ให้ SKU ที่ผู้ใช้กรอกเป็นตัวหลักที่แสดง |
| Description | `description` | Free text | มีแล้ว |
| Brand | `brandId` | Dropdown จาก Brand Master (+ เพิ่มใหม่ได้ ข้อ 2.3) | มีแล้ว |
| Model | `model` | Free text | มีแล้ว |
| Item Status | `productStatus` | Dropdown: Active / Inactive | มีแล้ว (มี Discontinued เพิ่ม — ดูข้อยืนยัน) |
| Item Type | `productType` | Dropdown: Finished Good / Spare Parts | มีแล้ว |
| Part Type | `partType` **ใหม่** | Free text (เช่น Panel, Mainboard) | migration 31 |
| Current Cost | `unitCost` | ตัวเลข | มีแล้ว |
| Default Price | `defaultPrice` **ใหม่** | ตัวเลข | migration 31 |

**ข. ข้อมูลระบบ (บันทึกอัตโนมัติ ผู้ใช้ไม่ต้องกรอก)**

| Header | ช่องในระบบ | หมายเหตุ |
|---|---|---|
| Created By | `createdById` **ใหม่** | ผู้สร้าง (User) — migration 31 |
| Created On | `createdAt` | Time stamp — มีแล้ว |
| Last Modified By | `updatedById` **ใหม่** | ผู้แก้ล่าสุด (User) — migration 31 |
| Last Modified On | `updatedAt` | มีแล้ว |

- สินค้าเดิมที่ยังไม่มีชื่อผู้สร้าง/ผู้แก้: เติมจาก Audit Log ตอนแสดงผล (ไม่ UPDATE ข้อมูลเดิม)
- "CreateBy" กับ "Created By", "CreateDate" กับ "Created On" ในตารางซ้ำกัน → ใช้ชุดเดียว

**ค. ข้อมูลจากการรับของ / stock (แสดงในตาราง Product Master และ Receiving Report — ไม่ได้กรอกในฟอร์มสินค้า)**

| Header | มาจาก | วิธีกรอก (ตอนรับของ) |
|---|---|---|
| AWB, Invoice No, RMA Reference No, PO / Reference No. | `GoodsReceiving` | Free text |
| Source Type | `GoodsReceiving.sourceType` | Dropdown: Brand Owner / Vendor / Customer Return / RTV Return |
| Warehouse | `StockItem.warehouse` | Dropdown |
| Bin Number | Rack / Slot ของ stock | จาก putaway |
| Condition | `GoodsReceivingItem.itemCondition` **ใหม่** | Dropdown: New / Refurbish |
| QTY, S/N | stock / receiving item | ตัวเลข / Free text |
| ReceiveBy, ReceiveDate | `GoodsReceiving` | อัตโนมัติ |

- **ฟอร์ม Product Master:** เรียงช่องตามกลุ่ม ก. และแสดงกลุ่ม ข. เป็นข้อมูลอ่านอย่างเดียว
- **ตาราง Product Master:** คอลัมน์ครบทั้ง 3 กลุ่มตามรายการข้างบน (เพิ่ม Part Type, Default Price, PO/Ref, Receive By, Created/Modified By ที่ยังไม่มี) และลากสลับ/ซ่อนได้ (ข้อ 2.2)
- **Import/Export template:** เพิ่มคอลัมน์ใหม่ — **คอลัมน์เดิมไม่เปลี่ยนชื่อ** (ไฟล์เก่ายัง import ได้)
- **ฟิลด์เดิมที่ไม่อยู่ในรายการ Acumatica** (UOM, Category, Manufacturer, Vendor Part #, Min Stock, Serial/Batch control): **ไม่ลบ** — ย้ายไปส่วน "ข้อมูลเพิ่มเติม" แบบพับได้ในฟอร์ม เพราะ Serial/Batch ใช้บังคับตอนรับของ และ Min Stock ใช้แจ้งเตือนของใกล้หมด
- ใช้ชุดฟิลด์เดียวกันนี้ใน Receiving Report (ข้อ 3.4)

### 2.2 ลาก/สลับลำดับคอลัมน์ในตาราง Product Master
- **ที่มา:** Excel แถว 25 "สามารถกดย้าย ขยับคอลัมน์ได้"
- **แก้:** ลากหัวคอลัมน์เพื่อสลับ + เมนูซ่อน/แสดงคอลัมน์ + ปุ่ม Reset; จำค่าต่อผู้ใช้ใน browser (ไม่ต้องใช้ DB)
- **ระวัง:** ตารางมี group header 4 กลุ่ม (Product Identity / Inventory Context / Traceability / Operational Audit) → ให้ลากได้ภายในกลุ่มเดียวกัน

### 2.3 สร้าง Brand ได้ในฟอร์ม Product (รวมกัน)
- **ที่มา:** Excel แถว 27 "ต้อง create business master ก่อนถึงจะ create Product ได้ — เอามารวมกันเลยได้ไหม"
- **แก้:** ช่อง Brand ในฟอร์ม Product มีตัวเลือก "+ เพิ่ม Brand ใหม่" (code + name) สร้างทันทีแล้วเลือกให้อัตโนมัติ — ใช้ API Brand เดิม, สิทธิ์เท่าเดิม
- หน้า Business Partners ยังอยู่เหมือนเดิม (+ แปล 3 ภาษา)

### 2.4 Upload ไฟล์ Product + ตรวจซ้ำด้วย Brand + SKU
- **ที่มา:** Excel แถว 28
- **แก้:** ขยาย import ที่มีอยู่ (`dataio/import.service.ts`): ตรวจซ้ำแบบ **Brand + SKU (partNumber/code)** ทั้งภายในไฟล์และกับข้อมูลใน DB, หน้า preview แสดงแถวซ้ำชัดเจน (ข้าม / error), ตัวเลือก "สร้าง Brand ที่ยังไม่มีให้อัตโนมัติ" (ค่าเริ่ม = ปิด), เปิดได้จากปุ่ม Import ในหน้า Product Master โดยตรง
- **ระวัง:** `Product.code` และ `partNumber` เป็น unique อยู่แล้ว → ยังต้องเคารพกฎเดิม

### 2.5 Field ใหม่สำหรับ Item Master
- **ที่มา:** ภาพ header list ใน Excel (Part Type, Default Price) + Q9 + Q5 (ขนาดสินค้าสำหรับ Simulator)
- **แก้:** `Product` + `partType` (text เช่น Panel / Mainboard), `defaultPrice` (number), `createdById`, `updatedById` (ผู้สร้าง/ผู้แก้ล่าสุด), `lengthCm/widthCm/heightCm` (ขนาดกล่อง) — nullable ทั้งหมด, migration 31; เพิ่มในฟอร์ม, ตาราง, import/export template
- สินค้าเดิมที่ไม่มี Created/Modified By: แสดงจาก Audit Log แทน
- **ลำดับ:** migration 31 ทำต้น P2 แต่ 1.6 (Simulator) ใน P1 ต้องใช้ขนาดสินค้า → **ใน P1 ผมจะทำ Simulator ให้กรอกขนาดเองได้ก่อน แล้วต่อการเลือกสินค้าจาก master ใน P2** (ไม่ข้าม Phase)

---

## 4. P3 — Goods Receiving & Receiving Report

### 3.1 Source Type: "RTV Replacement" → "RTV Return"
- **แก้ (ตาม Q7, แนะนำ):** เปลี่ยนเฉพาะคำที่แสดงใน 3 ภาษา + ใน report/export — ค่าที่เก็บใน DB คงเดิม → ข้อมูลเก่า, filter, และ flow RTV อัตโนมัติไม่พัง

### 3.2 ค้นหา Product ได้ในฟอร์มรับของ
- **ที่มา:** Excel แถว 8 "เพิ่มให้คีย์ค้นหา product ได้"
- **แก้:** เปลี่ยน dropdown "Select Product" เป็นแบบพิมพ์ค้นหา (SKU / ชื่อ / Part# / Model) — reuse `SearchableDropdown` ที่มีอยู่ในหน้า Requests (ย้ายเป็น component กลาง)

### 3.3 จัดลำดับฟอร์มรับของใหม่
- **ที่มา:** Excel แถว 9–10 + ภาพวงสีน้ำเงิน
- **ลำดับใหม่:** Source → Product → Receiving Details (Qty, Serial) → **กลุ่ม Reference** (PO/Ref No., Lot/Batch, AWB, Invoice No., RMA Reference No.) → **Warehouse** → **Notes** เป็นช่องข้อความ 5 บรรทัดท้ายสุด
- แค่ย้าย UI — ไม่เปลี่ยน API/field (Lot ยังเก็บที่ item เหมือนเดิม) ทำทั้งฟอร์มรับเดี่ยวและรับหลายรายการ

### 3.4 Receiving Report (Good Receiving + Item Master)
- **ที่มา:** Excel แถว 6, 11 + ภาพ header list
- **คอลัมน์ตาม Excel (ชุดเดียวกับข้อ 2.1):** AWB, Bin Number, Brand, Condition, Created By, Created On, Current Cost, Default Price, Description, Inventory ID/SKU, Invoice No, Item Status, Item Type, Last Modified By, Last Modified On, Model, Part Type, QTY, Receive By, Receive Date, RMA Reference No, S/N, Source Type, Warehouse, **PO / Reference No.**
- (ใน Excel มี "CreateBy/Created By" และ "CreateDate/Created On" ซ้ำกัน → รวมเหลือชุดเดียว)
- ใช้กับทั้งหน้าจอ Report และ Export Excel; เคารพ warehouse scope

---

## 5. P4 — Withdrawal & Fulfillment Workflow

### 4.1 ช่องค้นหาในรายการ Withdrawal Requests
- ค้นหา Ref #, RMA Case, ผู้สร้าง, SKU — เพิ่ม `q` ใน `GET /requests` (server-side) + debounce

### 4.2 ย้าย Approval Workspace ไปกลุ่ม Warehouse (WH Operation)
- ย้ายเมนูใน sidebar — **สิทธิ์ต่อเมนูคงเดิม** (DEPT_APPROVER ยังเห็นได้)

### 4.3 ปุ่มดูรายละเอียด request ใน Approval Workspace
- เปิด drawer: ผู้ขอ, RMA, หมายเหตุ, รายการสินค้า + stock คงเหลือ — reuse หน้ารายละเอียด request เดิม

### 4.4 เลือกหลายรายการ (checkbox) แล้วอนุมัติ/ปฏิเสธพร้อมกัน
- เลือกทั้งหมด/บางรายการ → Approve หรือ Reject (ใส่เหตุผลครั้งเดียวใช้กับทุกรายการ)
- **Backend:** endpoint ใหม่ `POST /requests/bulk-approve` ที่เรียก logic อนุมัติเดิม **ทีละรายการแยก transaction** (คงการล็อก version / approval engine / การจอง stock FIFO เดิม) แล้วรายงานผลรายตัว สำเร็จ/ล้มเหลว — รายการหนึ่งพังไม่ทำให้รายการอื่นพัง

### 4.5 Allocate ออกมาบนกระดาน Fulfillment
- **ที่มา:** Excel แถว 38–39 + ภาพวงแดง ("User หาไม่เจอว่าต้องไป Allocate ที่ไหน")
- **แก้:** เพิ่มการ์ด/คอลัมน์ **"Awaiting Allocation"** เป็นช่องแรกบนกระดาน แสดง request ที่อนุมัติแล้วพร้อมปุ่ม Allocate ในการ์ด + ตัวเลขแจ้งว่ามีงานเข้า — ใช้ API `fulfillmentApi.allocate` เดิม

### 4.6 การ์ดขนาดเท่ากัน + เรียงตาม flow
- **ที่มา:** Excel แถว 42, 54 + ภาพการ์ด Fulfillment Execution
- **ลำดับ:** Awaiting Allocation → Pending Inventory → Picking → Packing/Label → Ready/Shipped → Exception → SLA Risk (+ All Active) — ทุกการ์ดกว้างเท่ากัน (grid)

### 4.7 Delivery Method: Collect / Ship ใน New Withdrawal Request
- **ที่มา:** Excel แถว 48–49 + ภาพฟอร์ม
- **แก้:** ตัวเลือก "รับของเอง (Collect)" / "ให้จัดส่งผ่าน Logistics (Ship)" — แสดงในรายการ, Approval, Fulfillment, Picking Slip
- **DB (migration 32):** `WithdrawalRequest.deliveryMethod` (nullable, ค่าเริ่ม COLLECT → request เดิมไม่กระทบ)
- **ไม่ทำรอบนี้:** ช่องที่อยู่จัดส่ง (ชื่อ, บริษัท, ที่อยู่, ตำบล/อำเภอ/จังหวัด, รหัสไปรษณีย์, โทรศัพท์) — Excel ระบุ "ค้างไว้ก่อน"

---

## 6. P5 — Warehouse Documents & QR

### 5.1 ปรับ Picking Slip PDF (ตามภาพที่ขีดไว้)
- **คง (✓ เขียว):** SKU/Part#, Description, Brand, Serial/Batch, QTY, Condition
- **เอาออก (✗ แดง):** คอลัมน์ Status, ช่องเซ็น "Checked By" และ "Approved By"
- **ช่องเซ็นใหม่ 2 ฝั่ง:** ซ้าย = WH (Picked By) | ขวา = RQ (Received By)
- **Ref (Q8):** ย้ายไปอยู่ใต้ QR/Barcode มุมขวาบน
- **Location (Q8):** รวม WH + BIN เป็นคอลัมน์ "Location" เดียว (บรรทัดบน = คลัง, บรรทัดล่าง = Rack/Slot) ให้อ่านเป็นกลุ่มเดียวกัน
- แสดง Delivery Method (Collect / Ship) จาก 4.7

### 5.2 เติมชื่ออัตโนมัติ
- ชื่อ WH = ผู้ที่ทำการ pick (จาก fulfillment task), ชื่อ Receiver = ผู้ขอ (requester) — พิมพ์ไว้ในช่องเซ็นเลย

### 5.3 QR ใช้ได้ 2 ฝั่ง (Q10) — พิมพ์กระดาษเป็นทางเลือก
QR เดียวกัน (บนใบ Picking Slip หรือบนหน้าจอคลัง) เปิดหน้าเว็บของ request นั้น — **ต้อง login** และระบบแสดงตามสิทธิ์ของคนที่สแกน:

| คนสแกน | เห็นอะไร | ทำอะไรได้ |
|---|---|---|
| **ผู้ขอ (Requester)** — เดินมารับที่คลังหลัง WH pick เสร็จ | รายการของที่จะได้รับ + จำนวน | กด **"ยืนยันรับของ"** → บันทึกแบบเดียวกับ Handover เดิม → งาน fulfillment ปิดต่อเองอัตโนมัติ |
| **WH (คลัง)** | รายการที่ผู้ขอขอ: SKU, รายละเอียด, จำนวน, **Location ที่ต้องไปหยิบ** | ใช้เป็นใบหยิบบนมือถือ, ไปหน้า Pick ของ task นั้นได้ทันที |
| คนอื่น / ไม่มีสิทธิ์ | ข้อความ "ไม่มีสิทธิ์" | – |

- **กันผิดพลาด:** ผู้ขอยืนยันได้เฉพาะ request ของตัวเอง และเฉพาะเมื่อสถานะพร้อมส่งมอบแล้ว; กดซ้ำไม่บันทึกซ้ำ (ใช้ optimistic lock `version` เดิม)
- **ไม่ต้องพิมพ์ก็ได้:** คลังเปิด QR บนหน้าจอให้ผู้ขอสแกน; การพิมพ์ใบเป็นทางเลือก
- **Reuse:** logic ของ Handover เดิม + โมดูล `scan` เดิม — ไม่สร้าง flow ส่งมอบใหม่ซ้อน
- **ทดสอบบนมือถือจริง** (ขนาดจอเล็ก) ทั้ง 2 ฝั่ง

### 5.4 Location Label ใหม่
- **ที่มา:** Excel แถว 19–22 + ภาพป้าย WHCM_B
- **ข้อมูลบนป้าย:** Location code (ตัวใหญ่), ชื่อคลัง (W/H Name), Rack info/No., Slot, **QR สำหรับสแกนรับของ/putaway** (QR = location key ที่หน้า scanner/putaway อ่านได้อยู่แล้ว)
- พิมพ์ได้ทีละช่อง / ทั้ง rack / ทั้งคลัง — ปรับ `labels.service.ts` (`binLabels`)

---

## 7. P6 — Dashboard & Management Control Tower

### 6.1 Dashboard พื้นที่คลัง (WH Space)
- ทุกคลังรวม หรือเลือกคลัง: พื้นที่รวม / ใช้ / ว่าง (m² และ m³), % ความจุ, slot ว่าง-เต็ม, แยก Standard Rack / Pallet on Floor — ใช้ service จาก P1.5

### 6.2 มุมมองผู้บริหาร: Work Space / Capacity
- "พื้นที่ที่ยังเสนอรับงานได้" ต่อคลัง, คลังที่ใกล้เต็ม (เกณฑ์ตั้งค่าได้), ปุ่มเปิด Space Simulator (P1.6) เพื่อลองว่างานใหม่ใส่ได้ไหม

### 6.3 Operations Control Tower คงเดิม + บอกชัดว่าเป็น dashboard อะไร
- เพิ่ม tab/หัวข้อ "Operations Control Tower" กับ "Warehouse Space" พร้อมคำอธิบายสั้นๆ (3 ภาษา) — ไม่แก้ตัวเลขเดิม

---

## 8. P7 — UI/UX & System Governance

### 7.1 ซ่อน Warranty และ Material Planning (MRP) (Q3)
- ซ่อนเมนู + กันเข้าทาง URL ด้วย setting เปิด/ปิด — **ไม่ลบข้อมูล ไม่ลบโค้ด** (MRP จะกลับมาทำใน phase ถัดไป)
- **Project Planning ยังแสดงตามเดิม** (เข้าใจว่าคำว่า "planner" ใน Excel หมายถึง Material Planning — ถ้าไม่ใช่โปรดแจ้ง)

### 7.2 Users: Import (batch file) + Export
- ปุ่ม Import/Export ในหน้า Users — reuse import `users` จาก `dataio` เดิม (มีตรวจซ้ำ username/email อยู่แล้ว) + endpoint export ใหม่ (**ไม่ export รหัสผ่าน**), import ยังเคารพการกำหนด role/คลัง
- แปลหน้า Users เป็น 3 ภาษา (ตอนนี้ยังไม่มี)

### 7.3 Role & Permission Matrix ให้อ่านง่ายขึ้น
- จัดกลุ่มสิทธิ์ตาม module (พับ/ขยายได้), หัวตาราง role ติดด้านบน, ช่องค้นหาสิทธิ์, ติ๊กทั้ง module, คำอธิบายสิทธิ์แต่ละตัว (3 ภาษา), สรุปจำนวนสิทธิ์ต่อ role — **ไม่เปลี่ยนสิทธิ์จริงของใคร**

### 7.4 การ์ดขนาดเท่ากันทั้งระบบ
- ไล่ปรับแถวการ์ด KPI ในหน้าหลัก (Product Master, Fulfillment, Dashboard ฯลฯ) ให้กว้างเท่ากันตาม UI guideline เดิม (เรียบ, อ่านง่าย, ไม่ใช้สีรุ้ง)

---

## 9. คำตอบ Q1–Q10 และผลต่อแผน

| # | คำตอบ (สรุป) | ผลต่อแผน |
|---|---|---|
| Q1 | SuperAdmin = SYSTEM_ADMIN, Admin = WAREHOUSE_MANAGER | ข้อ 1.7 |
| Q2 | ซ่อน 2D editor (เก็บข้อมูล) · **เก็บ 3D view** และปรับภาพให้สมจริงตามภาพตัวอย่าง | ข้อ 1.8 (งานใหม่) |
| Q3 | ซ่อน **Warranty** + **Material Planning (MRP)** (ทำ phase ถัดไป) | ข้อ 7.1 — Project Planning คงไว้ |
| Q4 | เหลือแค่ **Standard Rack** (shelf) และ **Pallet on Floor** (พื้นวางพาเลท) | ข้อ 1.2 — เอา 7 ตัวเลือกเดิมออกจาก UI |
| Q5 | **Simulation** ก็พอ: จองกี่ m² / สินค้า xxx ใช้พื้นที่เท่าไหร่ | ข้อ 1.6 — ตัด migration 30, เพิ่มขนาดสินค้าใน migration 31 |
| Q6 | รหัส `A01-01-08` + **จัดการ WH/Rack/Slot ในหน้าเดียว** + คำนวณว่าพื้นที่ใส่ rack ได้กี่ตัว / slot ละกี่ m² | ข้อ 1.3, 1.4 |
| Q7 | เปลี่ยนแค่คำที่แสดง | ข้อ 3.1 |
| Q8 | Ref ไปใต้ QR · รวม WH + BIN เป็น "Location" | ข้อ 5.1 |
| Q9 | Condition = New/Refurbish (ค่าใหม่ตอนรับของ) · เพิ่ม Part Type + Default Price | ข้อ 2.5, 3.4 — migration 31 มี `GoodsReceivingItem.itemCondition` (nullable) |
| Q10 | ผู้ขอสแกนแล้วกดยืนยันรับของ · WH สแกนดูว่าผู้ขอขออะไรเพื่อหยิบให้ถูก | ข้อ 5.3 — QR ใช้ได้ 2 ฝั่งตามสิทธิ์ |

### จุดที่ผมตีความเอง — โปรดยืนยันตอน review
1. **Q3:** "planner" = Material Planning (MRP) → ซ่อน; **Project Planning ไม่ซ่อน**
2. **Q5:** Simulator **ไม่บันทึกผล** (ใช้แล้วจบ, Export/พิมพ์ได้) — ถ้าต้องการเก็บไว้ดูภายหลังต้องเพิ่มตารางกลับมา (migration 30)
3. **Q6:** "ใส่ rack ได้กี่ตัว" คำนวณจาก footprint ของ rack + % ทางเดินที่ตั้งไว้ในคลัง (ไม่ได้จัดวางตำแหน่งจริงแบบ CAD)
4. **Q2:** 3D ปรับด้วยรูปทรง/สี/วัสดุ (เสาน้ำเงิน คานส้ม กล่องน้ำตาล พื้นเทา เส้นเหลือง) — ไม่ใช้ภาพถ่ายจริงเป็น texture เพื่อให้หน้าเร็ว
5. **ข้อ 2.1 — Item Status:** ตาราง Acumatica มีแค่ Active / Inactive แต่ระบบมี **Discontinued** อยู่ด้วย (ใช้กันรับของสินค้าเลิกผลิต) → แนะนำ **คง Discontinued ไว้เป็นตัวเลือกที่ 3** เพราะสินค้าเดิมบางตัวอาจใช้อยู่ ถ้าต้องการให้เหลือ 2 ค่าจริงๆ ต้องตัดสินใจว่าสินค้าที่เป็น Discontinued อยู่ตอนนี้จะให้เป็นอะไร
6. **ข้อ 2.1 — ชื่อสินค้า (Product Name):** Acumatica ใช้ Description เป็นชื่อหลัก แต่ระบบบังคับมี `name` → แนะนำให้ฟอร์มมีแค่ Description แล้วระบบใช้ค่าเดียวกันเป็น name อัตโนมัติ (สินค้าเดิมไม่เปลี่ยน)
7. **ข้อ 2.1 — Model "EA":** ตัวอย่างในตารางใส่ Model = EA ซึ่งปกติเป็นหน่วยนับ (Each) → ผมจะทำ Model เป็น Free text และหน่วยนับ (UOM) แยกไว้ในส่วน "ข้อมูลเพิ่มเติม" เหมือนเดิม

---

## 10. Database migration ที่จะเตรียม (ไม่รันบน production จนกว่าจะได้รับอนุมัติ)

| # | ไฟล์ | เนื้อหา | Phase |
|---|---|---|---|
| 29 | `29_warehouse_space.sql` | Warehouse + ขนาด + `usableAreaPct`; ตาราง `RackTypeMaster` (+ seed 2 แบบ: Standard Rack, Pallet on Floor); Rack + `rackTypeId`, ขนาด | P1 |
| ~~30~~ | ~~space booking~~ | **ตัดออก** (Q5 = Simulation ไม่บันทึก) — เว้นเลขไว้ | – |
| 31 | `31_item_master_fields.sql` | Product + `partType`, `defaultPrice`, `createdById`, `updatedById`, `lengthCm/widthCm/heightCm`; GoodsReceivingItem + `itemCondition` | P2/P3 |
| 32 | `32_request_delivery_method.sql` | WithdrawalRequest + `deliveryMethod` | P4 |

- ทุกไฟล์มี `database/rollback/<เลข>_..._rollback.sql` คู่กัน
- เป็นการ **เพิ่ม** อย่างเดียว: nullable column / ตารางใหม่ / index — ไม่ลบ ไม่เปลี่ยนชนิด ไม่ UPDATE ข้อมูลเดิม
- อัปเดต `schema.prisma` ให้ตรงกันแล้ว — `00_run_order.sql` ไม่ได้แก้ เพราะไฟล์นี้หยุดที่ 17 มาตั้งแต่ก่อนหน้า (18–28 ก็รันทีละไฟล์) จึงรัน 29 → 31 → 32 ทีละไฟล์ตามลำดับ
- ข้อควรระวัง (จากบทเรียน PR #8): ต้องรัน migration บน production **ก่อน** merge เพราะ merge = deploy ทันที

---

## 11. วิธีทดสอบทุกงาน (ทำซ้ำจนผ่าน)

1. **Unit test** backend (`npm test` — 18 spec เดิมต้องผ่าน + เพิ่ม spec ใหม่ เช่น slot generator, space calculator, bulk approve, Brand+SKU dedupe)
2. **Integration test** (`npm run test:integration`) บน PGlite local DB จริง รวม migration ใหม่
3. **Type check** backend + frontend (`tsc --noEmit`), lint ต้องไม่แย่กว่า baseline เดิม
4. **Frontend build** (`next build`)
5. **ทดสอบหน้าจอจริง** ใน browser local ทั้ง 3 ภาษา (EN/TH/ZH) + ขนาดมือถือสำหรับหน้าที่เกี่ยว
6. **Regression flow หลัก** หลังจบทุก Phase: Receive → Putaway → Withdrawal Request → Approve → Allocate → Pick → Pack → Handover → Return; รวมถึงสิทธิ์ (login หลาย role) และ warehouse scope
7. ตรวจความสอดคล้องข้อมูล: stock quantity, slot status, reservation ก่อน/หลัง ต้องตรงกัน

**รายงานท้ายแต่ละ Phase:** งานที่เสร็จ, ไฟล์ที่แก้, DB changes, API changes, screenshot, ผลทดสอบ, ปัญหาค้าง, ยืนยัน regression

---

## 12. กฎความปลอดภัยที่จะยึดตลอดงาน

- ทำใน branch ปัจจุบันเท่านั้น — **ไม่ commit / push / PR / merge / deploy** จนกว่าจะสั่ง
- **ไม่แตะข้อมูล production** และไม่รัน migration บน production
- ทำทีละ Phase — Phase ถัดไปเริ่มเมื่อ Phase ปัจจุบันผ่านทดสอบครบและรายงานแล้วเท่านั้น
- ข้อความ UI ที่เพิ่ม/แก้ทุกจุดผ่านระบบ i18n กลาง (EN/TH/ZH)
- Checklist งานเสร็จ/ค้างจะอัปเดตในไฟล์นี้ทุกครั้งที่จบงาน

---

## 13. Checklist

### P1 — Warehouse Structure & Space
- [x] 1.1 ขนาดพื้นที่คลัง
- [x] 1.2 Rack Type Master (2 แบบ)
- [x] 1.3 Capacity Planner ในหน้าเดียว
- [x] 1.4 Run Slot อัตโนมัติ + แก้ slot ในหน้าเดียว
- [x] 1.5 Space Calculation Service
- [x] 1.6 Space Simulator
- [x] 1.7 สิทธิ์ Warehouse
- [x] 1.8 ซ่อน Floor Plan 2D + ปรับ 3D view
- [x] แปลหน้า Warehouse Master 3 ภาษา
- [x] ทดสอบ + รายงาน P1

### P2 — Master Data
- [x] 2.1 ปรับชุดข้อมูล Product Master ตาม Stock Item (Acumatica)
- [x] 2.2 ลาก/สลับคอลัมน์ Product Master
- [x] 2.3 Quick-add Brand ในฟอร์ม Product
- [x] 2.4 Import ตรวจซ้ำ Brand + SKU
- [x] 2.5 Part Type / Default Price / ขนาดสินค้า (+ ต่อ Simulator กับ Product master)
- [x] ทดสอบ + รายงาน P2

### P3 — Goods Receiving & Report
- [x] 3.1 RTV Replacement → RTV Return
- [x] 3.2 ค้นหา Product ในฟอร์มรับของ
- [x] 3.3 จัดลำดับฟอร์มรับของใหม่
- [x] 3.4 Receiving Report คอลัมน์ใหม่
- [x] ทดสอบ + รายงาน P3

### P4 — Withdrawal & Fulfillment
- [x] 4.1 ช่องค้นหา Requests
- [x] 4.2 ย้าย Approval Workspace
- [x] 4.3 ปุ่มดูรายละเอียด
- [x] 4.4 Bulk approve/reject
- [x] 4.5 Allocate บนกระดาน
- [x] 4.6 การ์ดเท่ากัน + เรียงตาม flow
- [x] 4.7 Delivery Method Collect/Ship
- [x] ทดสอบ + รายงาน P4

### P5 — Documents & QR
- [x] 5.1 Picking Slip ใหม่
- [x] 5.2 เติมชื่อ WH/Receiver อัตโนมัติ
- [x] 5.3 QR 2 ฝั่ง (ผู้ขอยืนยันรับ / WH ดูรายการหยิบ)
- [x] 5.4 Location Label ใหม่
- [x] ทดสอบ + รายงาน P5

### P6 — Dashboard
- [x] 6.1 WH Space dashboard
- [x] 6.2 Work Space / Capacity ผู้บริหาร
- [x] 6.3 แยกชื่อ Control Tower ให้ชัด
- [x] ทดสอบ + รายงาน P6

### P7 — UI/UX & Governance
- [x] 7.1 ซ่อน Warranty + Material Planning
- [x] 7.2 Users Import/Export
- [x] 7.3 Role & Permission Matrix layout
- [x] 7.4 การ์ดเท่ากันทั้งระบบ
- [x] ทดสอบ + รายงาน P7 + regression รวม

### ไม่ทำรอบนี้
- ที่อยู่จัดส่งแบบเต็ม (Ship address) — Excel ระบุ "ค้างไว้ก่อน"

---

## 14. รายงานผลการทำงาน (6 พ.ย. 2026)

> สถานะ: ทำครบ P1–P7 ใน branch `claude/wms-improvement-execution-96d692` — **ยังไม่ commit / push / PR / merge / deploy** และไม่ได้แตะ production (ทดสอบบน DB จำลองในเครื่อง PGlite เท่านั้น)

### 14.1 ผลทดสอบรวม (หลังแก้ครั้งสุดท้าย)
| รายการ | ผล |
|---|---|
| Backend type check (`tsc --noEmit`) | 0 error |
| Backend unit tests (`jest`) | 35 suites / **590 tests ผ่านทั้งหมด** |
| Frontend type check | 0 error |
| i18n (`check:i18n`) | EN/TH/ZH ครบ 2709/2709 key |
| Frontend production build (`next build`) | ผ่าน (รวมหน้าใหม่ `/r`) |
| Backend build + start | ผ่าน, ทุก module โหลดได้ |
| Regression ทั้ง flow (สคริปต์ใหม่ 39 ข้อ, 3 ผู้ใช้) | **38/39 ผ่าน** — ข้อที่ไม่ผ่านคือข้อมูล demo (ดู 14.9 ข้อ 1) |

Flow ที่ทดสอบจริง: สร้างสินค้า (Part Type/Default Price/Created By) → รับเข้า REFURBISH → Verify → Putaway ลง slot → ผู้ขอสร้างคำขอแบบ Collect → ผู้ขออนุมัติตัวเองไม่ได้ → Manager อนุมัติ → ค้นด้วยเลข RMA → Allocate (จอง 1 ชิ้น) → QR ฝั่ง WH เห็นตำแหน่ง + สภาพ REFURBISH / ฝั่งผู้ขอไม่เห็นตำแหน่ง → Picking slip PDF → Pick → Pack → Shipment → ผู้ขอยืนยันรับผ่าน QR → Request = ISSUED_TO_RMA, Task = CLOSED → แจ้ง UNUSED → คืนเข้าสต๊อก → ยอดรวมยังเป็น 3 ชิ้น, ไม่มีของค้างจอง, ไม่มีสต๊อกติดลบ, มี audit ครบทุกขั้น

> หมายเหตุ: สคริปต์เดิม `backend/e2e-test.js` (มิ.ย. 2026) ล้าสมัยแล้ว — เรียก route ที่ถูกเปลี่ยนไปก่อนงานนี้ (เช่น advance ด้วย request id, `PATCH /fulfillment/:id/handover`) จึงไม่ได้ใช้เป็นเกณฑ์

### 14.2 P1 — Warehouse Structure & Space
- **ทำแล้ว:** หน้า Warehouse Master รวม WH → Rack → Slot ในหน้าเดียว (tree + slot grid), Rack Type Master (เหลือ Standard Rack / Pallet on Floor), สร้าง slot อัตโนมัติรหัส `A01-01-08` (ข้ามที่มีอยู่แล้ว), คำนวณพื้นที่ใช้ได้ / จำนวน rack ที่วางได้, Space Simulator (ไม่บันทึก), ซ่อน 2D floor plan, 3D สมจริงขึ้น (เสาน้ำเงิน คานส้ม กล่อง พาเลท), ซ่อน Warranty + MRP (ผ่าน setting `ui.hiddenModules`), สิทธิ์ Product Master = SYSTEM_ADMIN + WAREHOUSE_MANAGER
- **DB:** migration 29 (Warehouse ขนาด + `usableAreaPct`, ตาราง `RackTypeMaster` + seed 2 แบบ, Rack + `rackTypeId` + ขนาด)
- **API ใหม่:** `rack-types` CRUD, `racks/:id/generate-slots`, `PATCH slots/bulk`, `space-summary`, `space-planner`, `space-simulate`, `GET /settings/modules`
- **ทดสอบ:** 20×10 ม. ที่ 70% = 140 ม² ใช้ได้, วาง rack ได้ 55 ตัว; สร้าง slot 25 แล้วเพิ่มอีก 5 (ข้าม 25 เดิม); Simulator 5 พาเลท = 6 ม²; Manager แก้ warehouse ไม่ได้ (403)

### 14.3 P2 — Master Data
- **ทำแล้ว:** ฟิลด์ตาม Acumatica Stock Item (Brand dropdown + เพิ่ม Brand ด่วน, Condition, Part Type, Default Price, Item Status, Item Type, Source Type, Created/Modified By/On ฯลฯ), ฟอร์มใช้ Description (name = description สำหรับสินค้าใหม่), Model เป็น free text, เลือกคอลัมน์ที่แสดงได้, import กันข้อมูลซ้ำ, ป้าย RTV เปลี่ยนเฉพาะการแสดงผล, หน้า Business Partners/Users/Roles แปล 3 ภาษา, export users (ไม่มีรหัสผ่าน)
- **DB:** migration 31 (Product + `partType`, `defaultPrice`, `createdById`, `updatedById`, ขนาด)
- **API:** `GET /users/export`, `GET /users/capabilities`; import สินค้าจำกัดสิทธิ์ตาม 1.7
- **ทดสอบ:** สร้างสินค้าเก็บฟิลด์ใหม่ + Created By ถูก; Manager สร้างได้; ผู้ขอสร้างไม่ได้ (403); ผู้ขอ export users ไม่ได้ (403)

### 14.4 P3 — Goods Receiving & Receiving Report
- **ทำแล้ว:** เลือก Condition New/Refurbish ตอนรับ (บันทึกต่อบรรทัด), dropdown ค้นหาได้, Receive Report 25 คอลัมน์ตาม Excel
- **DB:** `GoodsReceivingItem.itemCondition` (อยู่ใน migration 31)
- **ทดสอบ:** รับ REFURBISH แล้วค่าไปถึงใบหยิบ/หน้า QR; ค่าที่ไม่ถูกต้อง (เช่น USED) ถูกปฏิเสธ (400)

### 14.5 P4 — Withdrawal & Fulfillment
- **ทำแล้ว:** วิธีรับของ Collect/Ship, ค้นหาคำขอ (`?q=` เลขคำขอ/RMA), อนุมัติหลายรายการพร้อมกัน (แยกผลทีละรายการ, สูงสุด 100), หน้ารายละเอียดคำขอ, การ์ด "Awaiting Allocation" เป็นช่องแรกพร้อมปุ่ม Allocate, การ์ดเรียงตาม flow ขนาดเท่ากัน, Approval Workspace ย้ายไปกลุ่มคลังสินค้า
- **DB:** migration 32 (`WithdrawalRequest.deliveryMethod`)
- **API:** `GET /requests?q=`, `POST /requests/bulk-approve`; board ส่ง `deliveryMethod`
- **ทดสอบ:** deliveryMethod ผิด → 400; bulk approve 2 ผ่าน 1 ล้มแยกกัน; ผู้ขอ bulk approve ไม่ได้ (403); ผู้ขออนุมัติคำขอตัวเองไม่ได้

### 14.6 P5 — Warehouse Documents & QR
- **ทำแล้ว:**
  - Picking Slip: เอาคอลัมน์ Status ออก, รวม WH+BIN เป็น "Location", Ref อยู่ใต้ QR, มี Delivery Collect/Ship, ลายเซ็นเหลือ 2 ช่อง (WH ผู้หยิบ / ผู้ขอ ผู้รับ) พร้อมเติมชื่ออัตโนมัติ, Condition มาจากใบรับจริง, เกิน 5 บรรทัดขึ้นหน้าต่อ (ของเดิมเขียนว่ามีใบแนบแต่ไม่เคยพิมพ์)
  - QR 2 ฝั่ง: หน้า `/r?ref=<เลขคำขอ>` — ผู้ขอเห็นรายการ + ปุ่มยืนยันรับ (กดได้เมื่อของพร้อม), WH เห็นรายการหยิบพร้อมตำแหน่ง, คนอื่นเห็น "ไม่มีสิทธิ์"; ปุ่ม "Show QR" บน Fulfillment Board และหน้า Handover; Scanner สแกน QR คำขอแล้วพาไปหน้า `/r`
  - ถ้ายังไม่ login ตอนสแกน → login แล้วกลับมาหน้าเดิมอัตโนมัติ (รวมกรณี session หมดอายุ)
  - Location Label 100×60 มม.: รหัสตัวใหญ่, ชื่อคลัง, Rack/Pallet, Level/Column, Capacity, QR `LOC|WH|RACK|SLOT`; พิมพ์ได้ทีละ slot / ทั้ง rack / ทั้งคลัง
- **DB:** ไม่มี (ใช้ตารางเดิม)
- **API:** `GET /documents/ref/:ref`, `POST /documents/ref/:ref/confirm-receipt`, `GET /documents/ref/:ref/qr`; `POST /labels/bin/print` รับ `slotIds/rackIds/warehouseIds` เพิ่ม; handover queue ส่งชื่อผู้ขอ + deliveryMethod; env ใหม่ (ไม่บังคับ) `QR_BASE_URL`
- **ทดสอบ:** ยืนยันรับก่อนของพร้อม → 400; คนที่ไม่ใช่เจ้าของ → 403; version เก่า → 409; กด 2 ครั้งพร้อมกัน → ยืนยันจริงครั้งเดียว + audit HANDOVER_CONFIRMED 1 รายการ; ผู้ขอขอ QR ฝั่ง WH ไม่ได้ (403); เลขคำขอไม่มี → 404; พิมพ์ label ทั้ง rack 30 ใบ / ทั้งคลัง 33 ใบ ขนาด 100×60 มม.
- **แก้เพิ่มระหว่างตรวจ:** endpoint พิมพ์ label เดิมเปิดให้ทุกคนที่ login — ตอนนี้การพิมพ์แบบทั้ง slot/rack/คลัง จำกัดให้คนที่มีสิทธิ์ putaway (ผู้ขอได้ 403) ส่วนการพิมพ์แบบเดิมยังทำงานเหมือนเดิม

### 14.7 P6 — Dashboard & Control Tower
- **ทำแล้ว:** แท็บ Operations / Warehouse Space (`/dashboard?view=space`): พื้นที่ทั้งหมด / ใช้ได้ / ใช้ไป / ว่าง, % ความจุ, รายละเอียดราย rack
- **ทดสอบ:** ตัวเลขตรงกับข้อมูล (140 ม² ใช้ได้, ใช้ 2.5, ว่าง 137.5)

### 14.8 P7 — UI/UX & Governance
- **ทำแล้ว:** เมนูซ่อน/แสดง module ตาม setting, หน้า Settings มีการ์ดจัดการ module, แปลภาษาทุกข้อความใหม่, การ์ด KPI ทุกหน้าเป็น grid กว้างเท่ากัน — ตรวจด้วยการวัดจริงที่ 1440px: Dashboard, Products, Inventory, Receiving, Fulfillment, Reports, Space ผ่านหมด; แก้ Product Master จาก 12 การ์ดแถวเดียว (กว้าง 88px ตัวหนังสือถูกตัด) เป็น 2 แถว × 6 (184px ไม่ถูกตัด)

### 14.9 ปัญหาที่เหลือ / สิ่งที่ต้องรู้
1. **ข้อมูล demo มีสต๊อกสถานะ RESERVED 6 ชิ้นที่ไม่มีงานผูก** — มาจาก `prisma/seed-demo.ts` (สร้างตรงๆ ไม่ผ่าน flow) ไม่ใช่โค้ดที่แก้ และไม่เกี่ยวกับ production ที่ไม่ได้ใช้ demo seed
2. **"Capacity Used" อาจเกิน 100%** ถ้า capacity ของ slot ไม่ตรงความจริง (demo ตั้ง 1 แต่เก็บหลายชิ้น) — ต้องกรอก capacity ให้ถูก
3. **PDF ใช้ฟอนต์ Helvetica ซึ่งแสดงภาษาไทยไม่ได้** — ชื่อคนไทยบนใบหยิบ/label จะเพี้ยน (เป็นมาก่อนงานนี้) — แก้ได้โดยฝังฟอนต์ไทย (งานแยก)
4. การซ่อน Warranty/MRP เป็นการซ่อนที่หน้าจอ — API ยังเปิดตามสิทธิ์เดิม
5. ภาพหน้าจอ: ตรวจผ่าน browser ด้วยการอ่านหน้า/วัดขนาดจริง และ API — ไม่ได้บันทึกไฟล์ภาพ เพราะ browser pane ถูกซ่อนระหว่างตรวจ

### 14.10 การเปลี่ยนสิทธิ์ที่ต้องรับทราบ
- WAREHOUSE_SUPERVISOR **ไม่สามารถ**สร้าง/แก้/import สินค้าได้อีก (ตามข้อ 1.7)
- WAREHOUSE_MANAGER **ดู/export รายชื่อผู้ใช้ และกำหนดคลังให้ผู้ใช้ได้**
- แก้ข้อมูลคลัง (Warehouse) ได้เฉพาะ SYSTEM_ADMIN; Rack/Slot ได้ทั้ง SYSTEM_ADMIN + WAREHOUSE_MANAGER
- พิมพ์ label ทั้ง slot/rack/คลัง ต้องมีสิทธิ์ putaway

### 14.11 ขั้นตอนขึ้น production (รอคำสั่ง — ยังไม่ทำ)
1. Backup DB
2. รัน migration บน production ตามลำดับ **ก่อน merge**: `29_warehouse_space.sql` → `31_item_master_fields.sql` → `32_request_delivery_method.sql` (ทุกไฟล์รันซ้ำได้; ถ้าต้องถอย ใช้ไฟล์ใน `database/rollback/` ย้อนลำดับ 32 → 31 → 29)
3. ตรวจว่าคอลัมน์/ตารางใหม่มีครบ แล้วค่อย commit → PR → merge (merge = deploy)
4. ตั้ง `FRONTEND_URL` (ตัวแรก) หรือ `QR_BASE_URL` บน Render ให้เป็น URL เว็บจริง ไม่งั้น QR จะชี้ไป localhost
5. หลัง deploy: ตั้ง capacity ของ slot ให้ถูก, ตรวจ setting `ui.hiddenModules` (ค่าเริ่มต้นซ่อน warranty, mrp, floorPlan2d)
