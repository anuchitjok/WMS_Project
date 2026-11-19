# WMS Revision — Requirement Analysis & Development Plan

Source: `Revise WMS 20261112.xlsx` (3 sheets, 15 embedded images) — read in full on 13 Nov 2026.
Baseline code: branch `claude/wms-requirement-analysis-916e69` @ `400bc61`, latest prod migration `36_request_item_picks.sql`.

**สถานะเอกสาร: Analysis only — ยังไม่เขียน Code / ไม่แก้ Database / ไม่สร้าง Migration / ไม่ Commit / ไม่ Deploy**

**แก้ไขครั้งที่ 3 — 13 พ.ย. 2026:** รับมติ **C1–C5 และ C7** เข้า analysis แล้ว เหลือค้าง 2 ข้อ (C6, C8) ดูหัวข้อ 1.5

---

## 0. สิ่งที่อ่านมาแล้ว (Attachment review)

| Sheet | เนื้อหา | รูปภาพ |
|---|---|---|
| `1.Revise` | RQ 1–27 (No. / หมวดงาน / รายการแก้ไข / สิ่งที่ต้องการ) | 13 รูป |
| `2.Logistic` | Shipping Information 13 ฟิลด์ + Smart Address Autocomplete spec 8 ข้อ + Technical Analysis 7 ข้อ | 1 รูป |
| `3.Rack` | ตัวอย่าง Bulk Rack Creation + นิยามการคำนวณพื้นที่ 5 รายการ | 1 รูป |

ไม่มี worksheet ที่ซ่อน ไม่มี merged cell ไม่มีสูตร — เป็น flat table ทั้งหมด

### รูปภาพที่อ่านได้ และผมแมปไปที่ RQ ไหน

> ⚠️ ใน Excel **ไม่มีคอลัมน์อ้างอิงรูป** รูปวางลอยอยู่ในคอลัมน์ H แถว 1–319 ซึ่งไม่ตรงกับแถวข้อมูล (RQ อยู่แถว 2–28) การแมปด้านล่างจึงเป็น **การตีความของผม** ไม่ใช่สิ่งที่ Excel ระบุ — รบกวนช่วยยืนยัน

| รูป | เห็นอะไร | แมปไป RQ |
|---|---|---|
| S1_00 | Warehouse Master → Generate slots + Slots grid 50 ช่อง + Edit 3 slots | RQ4, RQ7 |
| S1_01 | New Relocation Request dialog (From slot / To slot / Reason) | RQ11 |
| S1_02 | Rack Details · ANT — แถวแรกขึ้น **"Data Unavailable"** ทุกช่อง, กรอบแดงครอบ "Available Slots" และ "Empty Slots 142" | RQ4 (user สับสน) |
| S1_03 | `template-receiving.xlsx` — 8 คอลัมน์ รวม `itemCondition NEW/REFURBISH` | RQ19 |
| S1_04 | Import Goods Receiving dialog — **เนื้อหาล้นกรอบ ฟิลด์ฝั่งขวาโดนตัด** | RQ20 |
| S1_05 | 3D Arrange racks — "All racks on the floor, no overlaps" + Save positions | RQ10, RQ13 |
| S1_06 | Confirm Putaway — dropdown เลือก slot เป็น list ยาว `M03-01-01 (0/1)` | RQ21 |
| S1_07 | New Withdrawal Request — กรอบแดงครอบ Brand = **ACER** อันเดียว | RQ22 |
| S1_08 | My Issued Items — **"No issued items awaiting usage confirmation"** (ว่าง) | RQ23 |
| S1_09 | รูปถ่ายคลังจริงมุมบน — ตีเส้น aisle, forklift crossing, zone วงกลม | RQ8, RQ10 (อ้างอิงภาพ) |
| S1_10 | Blueprint 2D — grid, zone picking/bulk/fast-slow movers, door, offset | RQ8, RQ9, RQ12 (อ้างอิงภาพ) |
| S1_11 | Warehouse layout & flow diagram — legend storage/aisle/office/dock, **SCALE 1:500** | RQ8, RQ12 (อ้างอิงภาพ) |
| S1_12 | ภาพ isometric **Phase 1 Ground Floor / Phase 2 ชั้นลอย (mezzanine)** | RQ14 (อ้างอิงภาพ) |
| S2_00 | หน้าจอขนส่ง (DHL) — พิมพ์ `10140` แล้วขึ้น dropdown "Bangkok, 10140" | RQ24 |
| S3_00 | Mock "Create Racks" — Rack Type + L/W/H + Quantity 15 → **Total Floor Area 15 m²** | RQ25, RQ26 |

4 รูป (S1_09–S1_12) เป็นภาพอ้างอิง/แรงบันดาลใจ ไม่ใช่ screenshot ระบบเรา — ผมไม่ได้แปลงเป็น requirement ใหม่

---

## 1. สรุปภาพรวม

| สถานะ | ก่อนมติ | หลัง C1–C5, C7 | หมายถึง |
|---|---|---|---|
| ✅ มีแล้ว / เกือบครบ | 4 | **5** | แก้นิดเดียวหรือแค่ยืนยัน |
| 🟡 มีบางส่วน | 13 | **12** | ฐานมีแล้ว ต่อยอดได้ |
| 🔴 ยังไม่มีเลย | 7 | 7 | ต้องสร้างใหม่ |
| ❗ เป็น bug/data | 2 | 2 | RQ22, RQ23 — เจอต้นเหตุแล้ว |
| ❓ ต้องตัดสินใจก่อน | 8 ประเด็น | **2 ประเด็น** (C6, C8) | ดูหัวข้อ 4 — กระทบแค่ P8/P9 |

**ข่าวดี:** ของที่ดูเหมือนงานใหญ่หลายตัวมีฐานอยู่แล้ว — 2D layout editor (undo/redo/snap), bulk rack creation, การคำนวณพื้นที่ m², location QR + scanner, batch import NEW/REFURBISH, relocation approval

**ข่าวที่ต้องระวัง:** มี 3 ตัวที่เป็นงานใหญ่จริงและกระทบของเดิม — **RQ14 Multi-Floor**, **RQ16 Partial Putaway**, **RQ24 Logistic**

---

## 1.5 Decision Log

| # | ประเด็น | มติ | วันที่ | ผลต่อขอบเขตงาน |
|---|---|---|---|---|
| **C1** | หน่วยวัด (RQ1) | **เก็บ cm ใน DB + แปลงที่ UI** — ไม่ migrate ทำ `<LengthInput>` + `formatLength()` ตัวกลาง ให้ผู้ใช้เลือกแสดง m/cm/mm ได้ | 13 พ.ย. 2026 | RQ1 **ไม่ต้อง migration** · P2 ความเสี่ยงลดเหลือ 🟢 |
| **C2** | Grid / Snap (RQ9) | **ทั้งสองอย่าง** — เพิ่มชั้น grid 10 cm ที่โผล่เฉพาะตอนซูมเข้า + เปลี่ยน snap step เป็น 0.1 m | 13 พ.ย. 2026 | RQ9 ได้ครบตามข้อกำหนด โดยไม่กระทบ performance |
| **C3** | Rack Type ปะทะ bulk create (RQ7/RQ25) | **auto-create Rack Type** — พิมพ์ขนาดเองได้ตอน bulk create แล้วระบบหา-หรือ-สร้าง Rack Type ให้อัตโนมัติ ขนาดยังคงมาจาก Rack Type เสมอ | 13 พ.ย. 2026 | แก้ความขัดแย้ง RQ7 ↔ RQ25 ได้ทั้งคู่ · **ไม่ต้อง migration** |
| **C4** | รูปแบบ rack code (RQ25) | **ตั้ง pattern ได้ ใช้กับ rack ใหม่เท่านั้น** — เลือกได้ทั้ง `RACK-001` และ `<Zone>-R01` **ห้าม rename rack เดิมเด็ดขาด** | 13 พ.ย. 2026 | ฉลาก QR ที่ติดชั้นวางแล้วยังสแกนได้ · เก็บ pattern ใน `Setting` ที่มีอยู่ → **ไม่ต้อง migration** |
| **C5** | การขยับ Rack บน Layout | **Separate** — Layout เป็นการแก้ผังอย่างเดียว ไม่ย้าย Stock/Slot/Location จริง และไม่สร้าง Relocation Transaction | 13 พ.ย. 2026 | RQ11 **ลดขอบเขตลงมาก** · RQ10/RQ13/RQ27 ความเสี่ยงลดลง |
| **C7** | Batch Goods Receiving | **One** — 1 ไฟล์ = 1 Goods Receipt, หลาย item lines ในไฟล์เดียว, ใช้ `itemCondition = NEW \| REFURBISH` ตามระบบปัจจุบัน ไม่สร้าง Batch Receiving Entity ไม่เปลี่ยนความหมาย `batchNumber` | 13 พ.ย. 2026 | RQ19 **ปิด ไม่มีงานพัฒนา** · RQ16 ขอบเขตแคบลง |

### 🎯 ผลรวมที่สำคัญที่สุดของมติ C1–C4

**P0, P1 และ P2 ไม่ต้องใช้ migration เลยแม้แต่ตัวเดียว** — ตรวจแล้วว่า:
- C1 เก็บ cm ไว้ → ไม่แตะ schema
- C3 ใช้ `RackTypeMaster` ที่มีอยู่แล้ว → ไม่เพิ่มตาราง
- C4 เก็บ pattern ใน `model Setting` ที่มีอยู่แล้ว → ไม่เพิ่มคอลัมน์
- RQ5 (restore) — `Rack` / `Slot` / `Warehouse` **มี `isActive`, `isDeleted`, `deletedAt`, `deletedBy` ครบอยู่แล้ว** ต้องการแค่ endpoint ไม่ต้องเพิ่มคอลัมน์
- RQ2 / RQ6 (auto-name) และ RQ7 (ล็อกขนาด) เป็น logic ล้วน

migration ตัวแรกจะไปโผล่ที่ **P3** ตัวเดียว (เพิ่ม `DOOR` เข้า enum `LayoutObjectType`)

สำคัญเพราะกติกาของโปรเจกต์คือ merge แล้ว deploy ทันที ต้องรัน migration บน prod ก่อนเสมอ — **3 เฟสแรกจึงปล่อยได้โดยไม่ต้องแตะ prod DB เลย ความเสี่ยงในการปล่อยลดลงมาก**

### ผลการตรวจโค้ดหลังรับมติ

ตรวจแล้วพบว่า **ทั้งสองมติตรงกับพฤติกรรมที่ระบบทำอยู่แล้ว** — เป็นการ *ยืนยันการออกแบบเดิม* ไม่ใช่การสั่งเปลี่ยน

**C5** — `backend/src/warehouse-layout/warehouse-layout.service.ts:13-16` เขียนกำกับไว้ตั้งแต่ต้นว่า:

> *"Physical Layout is the drawing of the warehouse floor. It never owns inventory and never writes Warehouse / Rack / Slot / StockItem — this service reads those tables only to validate that a layout's warehouse exists."*

ตรวจทุกจุดที่ service นี้แตะ `StockItem` แล้ว — มีที่เดียวคือ `prisma.stockItem.findMany()` ใน `occupancy()` ซึ่งเป็นการ **อ่านอย่างเดียว** เพื่อระบายสี canvas และโค้ดเขียนเหตุผลกำกับไว้ว่าไม่เก็บค่า occupancy ลง `LayoutObject` เพราะ *"that would be the second inventory system this feature exists to avoid"* และการแก้ผังทุกครั้งถูกบันทึก audit (`LAYOUT_OBJECT_UPDATED` ฯลฯ)

**C7** — `backend/src/receiving/receiving-import.service.ts:13` เขียนไว้ว่า *"One file = one Goods Receiving"* และโค้ดเรียก `tx.goodsReceiving.create()` ครั้งเดียวต่อการ import หนึ่งครั้ง (บรรทัด 228) แล้ววน `goodsReceivingItem.create()` ตามจำนวนแถว ส่วน `itemCondition` ถูก validate ให้รับแค่ `NEW | REFURBISH` อยู่แล้ว (`create-receiving.dto.ts:47`) พร้อม test ครอบอยู่แล้วใน `receiving-display.spec.ts`

**สรุป:** C5 และ C7 ไม่ต้องแก้โค้ดเพื่อ *สร้าง* พฤติกรรม — เหลือแค่ **เขียน guard test ล็อกพฤติกรรมไว้ไม่ให้หลุดในอนาคต** และ **แก้ถ้อยคำบนจอให้ผู้ใช้เข้าใจตรงกับมติ**

### ขอบเขต 3 ชั้นที่ C5 ทำให้ชัด

มติ C5 ทำให้เส้นแบ่งความรับผิดชอบคมขึ้น และควรใช้เป็นหลักตัดสินทุก RQ ที่เกี่ยวกับ Rack/Slot/Stock ต่อจากนี้

| ชั้น | เปลี่ยนอะไร | ใครเปลี่ยนได้ | ต้องเช็ค Stock ไหม |
|---|---|---|---|
| **1. Warehouse Layout** (ภาพวาด) | ตำแหน่ง/ขนาด/การหมุนของรูปบนผัง | `warehouse-layout` service เท่านั้น | **ไม่** — ขยับได้เสมอแม้ rack มีของเต็ม |
| **2. Rack / Slot Master** (ตัวตน) | สร้าง / แก้ขนาด / deactivate / ลบ | `warehouse-master` service | **ใช่** — บล็อกเมื่อมี stock หรือ transaction (RQ5, RQ7) |
| **3. Stock Location** (ของจริง) | `StockItem.warehouseId/rackId/slotId` | Putaway + Relocation Request (+ Approval) เท่านั้น | **ใช่** — ผ่าน workflow เสมอ (RQ11, RQ16) |

> ⚠️ **ความเสี่ยงใหม่ที่ C5 เปิดขึ้น (plan drift):** เมื่อลาก rack บนผังได้อิสระ ผังอาจไม่ตรงกับของจริงหน้างาน — ผังบอกว่า rack อยู่โซน A แต่ของจริงยังอยู่โซน B
> **วิธีคุม:** (ก) บนผังให้ขึ้นเครื่องหมายว่า rack นี้มี stock อยู่กี่ชิ้น (ข) ข้อความบนจอต้องบอกตรง ๆ ว่า "บันทึกผังเท่านั้น ไม่ย้ายสินค้า" (ค) มีปุ่มลัดไป Relocation Request เมื่อผู้ใช้ตั้งใจจะย้ายของจริง — ทั้งสามข้อเป็นงาน UI ไม่ใช่ logic

---

## 2. RQ-by-RQ (ตารางวิเคราะห์)

### 2.1 Master Data & Units

**RQ1 — Standardize Measurement Unit** 🟡 — **มติ C1: เก็บ cm + แปลงที่ UI**
- ของเดิม: DB เก็บเป็น **cm** ทุกตาราง (`Warehouse/Rack/RackTypeMaster/Slot/Product .lengthCm|widthCm|heightCm`)
- ฟอร์ม Warehouse รับเป็น **เมตร** แล้วคูณ 100 (`frontend/src/components/warehouse-master/forms.tsx:21-23`)
- ฟอร์ม Rack / Rack Type / Slot / Product / Putaway box รับเป็น **cm** → ปนกันจริงตามที่แจ้ง
- พื้นที่แสดงเป็น m² แล้ว (9 จุด)
- **ขนาดของปัญหาที่วัดได้:** `*Cm` ถูกอ้าง **958 จุด ใน 44 ไฟล์** (backend 500 / frontend 458) และมี cm column ใน **5 ตาราง** (`Warehouse`, `Rack`, `RackTypeMaster`, `Slot`, `Product`)
- ✅ **มติ C1 = เก็บ cm ใน DB ไว้เหมือนเดิม ไม่ migrate** แล้วแก้ที่ชั้นแสดงผลอย่างเดียว

**งานจริงที่ต้องทำตามมติ C1**
1. `<LengthInput>` ตัวเดียวใช้ทุกฟอร์ม — มี dropdown m/cm/mm, รับค่าเข้า-ออกเป็น cm เสมอ
2. `formatLength(cm, unit)` ตัวเดียวใช้ทุกจุดแสดงผล
3. ผู้ใช้เลือกหน่วยที่อยากเห็นได้ และจำไว้ (เก็บใน `Setting` หรือ localStorage)
4. **เก็บกวาดที่ได้มาฟรี:** ตอนนี้ฟอร์ม Warehouse มีตัวแปลงของตัวเองซ่อนอยู่ (`mToCm = Math.round(v*100*100)/100` ที่ `forms.tsx:23` และซ้ำอีกชุดใน `setup-wizard.tsx:24`) — การรวมเป็นทางเดียวตัดโอกาสปัดเศษเพี้ยนคนละแบบออกไป

**จุดที่ต้องไล่เปลี่ยน:** ฟอร์ม Warehouse (วันนี้เป็น m) · Rack / Rack Type / Slot bulk edit (วันนี้เป็น cm) · Product dimensions · Putaway box size · การ์ดพื้นที่ที่แสดง m²

- **ไม่ต้อง migration** → P2 ความเสี่ยงลดจาก 🟡 เหลือ 🟢

**RQ2 — Auto Generate Warehouse Name** 🔴
- ยังไม่มี logic ไหนสร้างชื่ออัตโนมัติ
- งานเล็ก แต่ **ต้องการสูตรที่ชัด** — ข้อมูลจริงตอนนี้ name กับ location ซ้ำกัน (เช่น `HSNT_WHCM` / `HSNT_WHCM`)
- เสนอ: auto-fill เป็น **คำแนะนำ** ที่แก้ทับได้ ไม่ใช่ล็อก เพราะชื่อถูกใช้ในรายงาน/ฉลากหมดแล้ว

**RQ3 — Warehouse Code Validation** 🟡
- ห้ามซ้ำ: ✅ มีแล้ว (`@unique` + `ConflictException` ที่ `warehouse-master.service.ts:364`)
- แก้ไม่ได้หลังสร้าง: ✅ มีแล้วโดยปริยาย (`updateWarehouse` ไม่รับ `code`)
- ห้ามเอา code เก่ากลับมาใช้: ✅ โดยปริยาย — ระบบ**ไม่มี** route ลบ warehouse เลย มีแต่ deactivate ซึ่ง code ยังอยู่
- เหลือแค่: เขียน test ยืนยัน + ขึ้นข้อความอธิบายในฟอร์ม

**RQ6 — Auto Generate Rack Type Name** 🟡
- ตรวจ code ซ้ำ: ✅ มีแล้ว (`warehouse-master.service.ts:445`)
- สร้างชื่อจาก Category + Code: 🔴 ยังไม่มี — งานเล็ก

### 2.2 Rack Management

**RQ5 — Rack Delete / Restore** 🔴 ⚠️
- **ปัญหาจริงที่เจอ:** `deleteRack()` ปฏิเสธถ้ามี slot แม้แต่ 1 ช่อง (`warehouse-master.service.ts:533`) — rack จริงทุกตัวมี slot เสมอ แปลว่า**ลบไม่ได้เลยในทางปฏิบัติ**
- Rack **ไม่มี** endpoint deactivate/activate (`updateRack` ไม่รับ `isActive`) — มีแต่ warehouse ที่มี
- **ไม่มี restore ที่ไหนเลยในระบบ** (soft-delete แล้วจบ)
- มี `getImpact()` ตรวจ dependency อยู่แล้ว ✅ เอามาใช้ต่อได้
- งาน: เพิ่ม deactivate/activate/restore ให้ Rack (+ Slot, + Warehouse restore) + แก้เงื่อนไขลบให้บล็อกเฉพาะเมื่อ**มี stock หรือ transaction** ไม่ใช่มี slot

**RQ7 — Rack Configuration ควบคุมโดย Rack Type** 🟡 — **มติ C3 ทำให้ข้อนี้บังคับได้เต็มที่**
- `setupRacks()` ทำถูกแล้ว — สร้าง rack โดยปล่อยขนาดว่าง ให้ไปอ่านจาก type (`warehouse-master.service.ts:646`)
- แต่ `createRack`/`updateRack` ยัง**รับ** `lengthCm/widthCm/heightCm/levels/columns` ตรง ๆ และฟอร์มยังให้พิมพ์
- ✅ **มติ C3 ปลดล็อกข้อนี้:** เดิมที่ลังเลเพราะถ้าล็อกแข็งจะขัดกับ Sheet 3 ที่ให้พิมพ์ขนาดเอง — ตอนนี้ตอบได้แล้วว่า **ขนาดมาจาก Rack Type เสมอ 100%** ส่วนความต้องการ "พิมพ์เอง" ไปรองรับด้วย auto-create แทน
- **rack เก่าที่มีขนาดของตัวเอง** (legacy): ใช้วิธีเดียวกับ C3 — ตอนแก้ไขครั้งแรก ระบบหา-หรือ-สร้าง Rack Type ที่ตรงกับขนาดเดิมของมัน แล้วผูกให้ → ไม่มี rack ไหนเสียขนาดเดิม และหลังจากนั้นทุกตัวอยู่ใต้กติกาเดียวกัน

**RQ25 ภาคต่อ — auto-create Rack Type (มติ C3)**
- `SetupRacksDto.rackTypeId` วันนี้เป็น `@IsNotEmpty()` บังคับเลือก (`warehouse-master.dto.ts:131`) → เพิ่มทางเลือกให้ส่ง `lengthCm/widthCm/heightCm/levels/columns` มาแทนได้
- กติกา **หา-ก่อน-ค่อยสร้าง**: ถ้ามี Rack Type ที่ `(category, L, W, H, levels, columns, slotCapacity)` ตรงกันอยู่แล้ว ให้ใช้ตัวนั้น — กัน Rack Type งอกรัว ๆ จนรกทุกครั้งที่กด create
- ต้องมีตัวสร้าง `code` และ `name` ให้ Rack Type ใหม่ (`code` เป็น `@unique` และ `name` บังคับ) → **ใช้ตัวเดียวกับ RQ6 ที่จะทำใน P1 อยู่แล้ว** ทำ P1 ก่อน P2 จึงได้ของชิ้นนี้ฟรี
- **ไม่ต้อง migration** — `RackTypeMaster` มีครบทุกคอลัมน์ที่ต้องใช้

**RQ25 — Bulk Rack Creation** 🟡 — **มติ C3 + C4**
- ✅ **มีแล้วเกือบครบ**: `POST /warehouse-master/warehouses/:id/setup-racks` สร้าง N rack ต่อ zone, gen code อัตโนมัติ, gen slot ครบ, preview ก่อน commit, ทำใน transaction เดียว, จำกัด `SETUP_MAX_RACKS`
- ต่างจาก Sheet 3 สองเรื่อง — **ปิดด้วยมติแล้วทั้งคู่**:

**1. รูปแบบ code — มติ C4: ตั้ง pattern ได้ ใช้กับ rack ใหม่เท่านั้น**

เหตุผลที่ห้าม rename ของเก่าเด็ดขาด — rack code ไม่ใช่แค่ป้ายชื่อ แต่เป็นกุญแจที่ของอื่นผูกอยู่:

| ผูกยังไง | หลักฐาน |
|---|---|
| รหัส slot สร้างจาก rack code | `slotCode = <RackCode>-<LL>-<CC>` (`space-math.ts:450`) → เปลี่ยนชื่อ rack = เปลี่ยนรหัส slot **ทุกช่อง** |
| QR payload ฝัง rack code | `LOC\|<WH>\|<RACK>\|<SLOT>` (`location-label.ts:50`) |
| พิมพ์ฉลากค้นจาก rack code ตรง ๆ | `labels.service.ts:97` → **ฉลากที่ติดชั้นวางแล้วจะสแกนไม่เจอทันที** |
| Cycle count ประกอบ locationKey จาก rack code | `cycle-count.service.ts:82` |
| Data import upsert rack ด้วย code | `import.service.ts:399` |

→ งานที่ทำ: เก็บ pattern ไว้ใน `model Setting` (มีอยู่แล้ว ไม่ต้อง migration) ให้เลือกได้ทั้ง `RACK-001` และ `<Zone>-R01` ใช้ตอน `setupRacks` สร้างของใหม่ ส่วนตัวนับเลขที่ไม่ซ้ำมีอยู่แล้วในโค้ด (`taken` set) ใช้ต่อได้เลย

**ข้อแลกเปลี่ยนที่ต้องรู้:** `RACK-001` ไม่มีชื่อโซนอยู่ในรหัส พนักงานที่อ่านป้ายบนชั้นวางจะไม่รู้ว่าเป็นโซนไหนจนกว่าจะสแกน — ถ้าหน้างานใช้การอ่านป้ายด้วยตาเป็นหลัก `<Zone>-R01` ใช้งานดีกว่า ผมจึงเสนอให้ **ค่าตั้งต้นยังเป็น `<Zone>-R01`** แล้วให้เปลี่ยนเป็น `RACK-001` ได้ถ้าต้องการ

**2. พิมพ์ L/W/H เองได้ — มติ C3: auto-create Rack Type** (รายละเอียดอยู่ที่ RQ7 ด้านบน)

**RQ26 — Automatic Rack Area Calculation** ✅
- คำนวณครบแล้ว: `newFootprintM2`, `usedFootprintM2`, `usableAreaM2`, เตือน `OVER_AREA` / `NO_WAREHOUSE_SIZE` (`warehouse-master.service.ts:628-636`)
- `space-math.ts` มี `footprintM2`, `floorSpace`, `storageSpace`, `planCapacity` ครบ
- เหลือแค่ปรับ UI ให้โชว์ "Floor Area ต่อ rack" + "Total" แบบ mock ใน S3_00

**RQ4 — Rack detail (user สับสน)** 🟡
- จาก S1_02: rack ที่ไม่มี slot ขึ้น **"Data Unavailable"** 5 ช่องรวด ผู้ใช้อ่านไม่ออกว่าคืออะไร
- มีทั้งคอลัมน์ "Available Slots" และการ์ด "Empty Slots 142" ซึ่งผู้ใช้มองว่าเรื่องเดียวกัน
- โค้ดตั้งใจไว้ดีแล้ว (`space-layers.tsx:8` — "cannot be known shows Data Unavailable instead of a guessed value") แต่**ถ้อยคำไม่สื่อ**
- งาน: แก้ข้อความ + empty state บอกสาเหตุ ("rack นี้ยังไม่ได้สร้าง slot") + รวม/อธิบายคอลัมน์ที่ซ้ำความหมาย — **เป็นงาน presentation ล้วน ไม่แตะ logic**

### 2.3 Warehouse Layout 2D / 3D

**RQ8 — 2D Warehouse Layout** ✅🟡
- ✅ มีครบ: `WarehouseLayout` + `LayoutObject`, canvas, toolbar, property panel, batch save พร้อม optimistic lock
- `LayoutObjectType` มี 12 แบบ รวม `AISLE`, `WORK_AREA`, `STORAGE_AREA`, `RECEIVING_AREA`, `STAGING_AREA`, `QC_AREA`
- 🔴 **ไม่มี `DOOR`** — ต้องเพิ่ม enum + icon + i18n (งานเล็ก)

**RQ9 — Grid / Snap / Rotation** 🟡 — **มติ C2: ทำทั้ง grid 10 cm และ snap 0.1 m**
- Snap to grid: ✅ มี toggle แล้ว (`layout-toolbar.tsx`)
- Rotation: ฟิลด์มีใน DB (`LayoutObject.rotation`) แต่ **ไม่มีปุ่มหมุนใน property panel** — ค่าเป็น 0 ตลอด

> **⚠️ แก้การประเมินเดิมของผม:** เอกสารฉบับแรกเขียนว่า grid 10 cm = 100,000 ช่อง วาดไม่ไหว — **ผิดครับ** นั่นจะจริงถ้าวาดทีละช่อง แต่โค้ดจริงใช้ SVG `<pattern>` (`layout-canvas.tsx:266-272`) ซึ่ง browser tile ให้เอง ไม่ได้สร้าง DOM node ต่อช่อง ต้นทุนการวาดจึงเกือบคงที่ไม่ว่า grid ละเอียดแค่ไหน

**สิ่งที่โค้ดมีอยู่แล้วและทำให้มติ C2 ทำง่าย**
- มี **grid 2 ชั้นอยู่แล้ว** (`fp-grid-minor` 1 หน่วย + `fp-grid-major` ทุก 5 หน่วย)
- มี **การซ่อน grid ตามระดับซูมอยู่แล้ว** — `showMinorGrid = pxPerUnit >= 7` (`layout-canvas.tsx:225`) → เพิ่มชั้นที่ 3 ที่ 0.1 m โดยเปิดเมื่อซูมเข้ามากพอ เป็นงานไม่กี่บรรทัด
- snap ปัจจุบัน: `Math.round(n)` เมื่อเปิด (ล็อก 1 m) / `Math.round(n*100)/100` เมื่อปิด (**ได้ 1 cm อยู่แล้ว**) → เปลี่ยนเป็น `Math.round(n*10)/10` **คือแก้บรรทัดเดียว** (`layout-canvas.tsx:92`)

**รายละเอียดที่ต้องตามเก็บ:** `MIN_SIZE = 0.5` (วัตถุเล็กสุด 0.5 m) จะกลายเป็นคอขวดเมื่อ snap ละเอียด 10 cm — ต้องลดลงเป็น 0.1 ไม่งั้นวาด door/เสาเล็ก ๆ ไม่ได้

- **ไม่ต้อง migration** · เข้าคู่กับ scale bar ของ RQ12 ได้พอดี

**RQ10 — Boundary / Overlap Validation** 🟡
- ✅ มีแล้วใน **3D arrange**: `floor-geometry.ts:188 rectsOverlap()` (Separating Axis Test) + `rackProblems()` เช็คหลุดพื้น/ทับกัน → ที่เห็นใน S1_05 ว่า "All racks on the floor, no overlaps"
- 🔴 **2D canvas ไม่เช็คอะไรเลย** — ลากทับกันได้ ลากออกนอกพื้นที่ได้
- 🔴 ไม่มีใครเช็คการทับ Aisle / Zone / Door
- งาน: ดึง `floor-geometry` มาใช้ใน 2D + ขยายให้เช็ค object type อื่น — reuse ได้เยอะ
- 📌 **หลังมติ C5:** การ validate นี้คือ **คุณภาพของผัง** ไม่ใช่ความปลอดภัยของ stock (ผังผิดไม่ทำให้ของหาย) → ให้เป็น **คำเตือนที่ผู้ใช้ override ได้** ไม่ใช่ hard block ที่ห้าม Save ระดับความรุนแรงลดจาก data-integrity เหลือ plan-quality

**RQ11 — Rack with Stock ห้ามย้ายตรง** ✅🟡 — **ปรับตามมติ C5 (Separate)**
- ✅ ฝั่ง **stock**: มี Location Relocation Request + Approval ครบแล้ว (`RelocationRequest`/`RelocationLine`, PR7 — S1_01) → **นี่คือทางเดียวที่ย้ายของจริงได้ และข้อกำหนด "ต้องเคลียร์ Stock หรือผ่าน Approval" ถือว่าบรรลุแล้ว**
- ✅ ฝั่ง **layout**: ตามมติ C5 การลาก rack เป็นการแก้ผังล้วน — ตรงกับที่ `saveRackPositions` ทำอยู่แล้ว (*"Racks, slots and stock do not change"*) **ไม่ต้องเพิ่ม guard บล็อกการลาก และไม่ต้องต่อ approval เข้ากับการจัดผัง**
- 🟡 เหลือแค่ 3 อย่าง ซึ่งเป็นงาน UI ทั้งหมด:
  1. บนผัง/3D แสดงว่า rack นี้มี stock กี่ชิ้น (ข้อมูลมีแล้วจาก `occupancy()`)
  2. ข้อความยืนยันตอน Save ต้องบอกชัดว่า "บันทึกผังเท่านั้น ไม่ย้ายสินค้า"
  3. ปุ่มลัดไป Relocation Request สำหรับคนที่ตั้งใจย้ายของจริง
- **ขอบเขตลดจาก "งานกลาง-สูง + ต่อ approval engine" เหลือ "งาน UI เล็ก + guard test"** → ย้ายจาก P4 ไป **P3**

**RQ12 — Undo / Redo / Blueprint Scale** 🟡
- Undo/Redo: ✅ มีแล้ว (snapshot-based, `use-layout-editor.ts`, มี `HISTORY_LIMIT`, มี Discard ก่อน save)
- 🔴 เครื่องมือวัดระยะ (measure tool): ไม่มี
- 🔴 แสดง Scale (เช่น 1:500 แบบ S1_11): ไม่มี — แม้ข้อมูล `metersPerUnit` จะมีอยู่แล้ว

**RQ13 — 2D / 3D Synchronization** 🟡
- ✅ เชื่อมกันแล้วบางส่วน: 3D "Save positions" → เขียนลง Floor Plan; 2D (`metersPerUnit`/`floorOrigin`) → ป้อน 3D
- 🔴 **ไม่มี Preview ใน 3D ก่อน Save**
- 🔴 **ไม่มี Approve / Publish** — `WarehouseLayout` มีแต่ `version` ไม่มี `status` (DRAFT/PENDING/PUBLISHED)
- งานนี้ = state machine ใหม่ + ต่อเข้า approval engine ที่มีอยู่ (`ApprovalRule`/`ApprovalInstance`) — **งานกลาง-ใหญ่**
- 📌 **หลังมติ C5:** Approve/Publish เป็นเรื่อง **การกำกับผัง** (ใครอนุมัติผังใหม่) ไม่ใช่การคุม stock — ไม่ต้องผูกกับ stock state ใด ๆ ทำให้ state machine ง่ายลงและทดสอบง่ายขึ้น ความเสี่ยงลดจาก 🟠 เหลือ 🟡

**RQ14 — Multi-Level Warehouse** 🔴 ⚠️⚠️ **เสี่ยงสูงสุด**
- `WarehouseLayout.warehouseId` เป็น `@unique` → **1 คลัง = 1 ผังเท่านั้น**
- `Warehouse` / `Rack` / `Slot` / `LayoutObject` **ไม่มีฟิลด์ floor/level** เลย
- `scene-3d.tsx` สร้างพื้นเดียว
- กระทบ: schema (4 ตาราง), ทุก unique key ของ rack code, ทุก selector ที่เลือกคลัง, location key `WH|RACK|SLOT` (ฉลาก QR ที่พิมพ์ไปแล้ว), space summary, pick route, 3D scene
- **ประเมิน: ใหญ่กว่าทุก RQ ที่เหลือรวมกัน** — เสนอแยกเป็นโปรเจกต์ต่างหาก ไม่ปนรอบนี้

**RQ27 — Bulk Rack Placement in Layout** 🔴
- rack ที่ `setupRacks` สร้าง **ไม่มี `LayoutObject`** → ไม่ปรากฏในผัง ต้องวาดเองทีละตัว
- งาน: auto-place rack ใหม่ N ตัวลงผัง พร้อมเช็คพื้นที่พอ + ไม่ทับกัน — **ต้องทำ RQ10 ก่อน**
- 📌 **หลังมติ C5:** การวาง rack อัตโนมัติไม่ต้องเช็ค stock เลย (เป็นการวาดล้วน) → ตัดเคสยุ่งยากออกไปมาก เหลือแค่โจทย์เรขาคณิต

### 2.4 Receiving / Putaway

**RQ19 — Batch Goods Receiving + New/Refurbish** ✅ **ปิดแล้ว — ไม่มีงานพัฒนา (มติ C7 = One)**
- ✅ **มีครบแล้วตรงตามมติ**: import ไฟล์ได้ (`receiving-import.service.ts`), 1 ไฟล์ = 1 Goods Receipt (บรรทัด 13 + `tx.goodsReceiving.create()` ครั้งเดียวที่บรรทัด 228), หลาย item lines ในไฟล์เดียว ✓, `itemCondition NEW|REFURBISH` validate แล้ว (`create-receiving.dto.ts:47`) พร้อม test, แสดงผลต่อถึง picking slip
- ตามมติ C7: **ไม่สร้าง Batch Receiving Entity** และ **ไม่เปลี่ยนความหมายของ `batchNumber`** (ยังเป็น lot/batch ของสินค้าตามเดิม แยกจากคำว่า "batch" ในชื่อ RQ)
- เหลืองานเดียว: **regression test** ล็อกไว้ว่า import 1 ไฟล์ต้องได้ `GoodsReceiving` แถวเดียวเสมอ → ใส่ไว้ใน P0 (งานเขียน test ไม่ใช่ feature)

**RQ20 — Import Receiving UI ล้นกรอบ** 🟡
- `DialogContent` มี `max-w-3xl max-h-[90vh] overflow-y-auto overflow-x-hidden` อยู่แล้ว (`receiving/page.tsx:357`) แต่ S1_04 ยังเห็นฟิลด์ฝั่งขวาโดนตัด
- น่าจะเป็นเรื่อง grid 2 คอลัมน์ไม่ยุบที่ความกว้าง/zoom นั้น
- งานเล็ก **แต่ต้องรู้ zoom + ความกว้างจอที่ถ่าย** ถึงจะ reproduce ได้ตรง

**RQ16 — Partial Receiving / Putaway** 🟡 ⚠️ — **ขอบเขตแคบลงตามมติ C7**
- 📌 **มติ C7 ตัดความกำกวมออก:** "Partial Receiving" **ไม่ได้** แปลว่าแตกเป็นหลายใบรับ — 1 ไฟล์ยังคง = 1 Goods Receipt การรับบางส่วนจัดการด้วย `inspectedQty` + `ReceivingDiscrepancy` บนใบเดิม → **งานที่เหลือจริงคือฝั่ง putaway เท่านั้น**
- ✅ ฝั่งรับ: มี `inspectedQty` แยกจาก `quantity` + `ReceivingDiscrepancy` (short_qty ฯลฯ) แล้ว
- 🔴 ฝั่ง putaway: `confirm()` ย้าย **ทั้ง StockItem row** ไป slot เดียว (`putaway.service.ts:59-86`) — **แบ่งเก็บหลาย slot ไม่ได้**
- **ความเสี่ยง:** การ split StockItem ต้องสร้าง row ใหม่ แต่ `stockItemId` ถูกอ้างจาก `WithdrawalRequestItem`, `WithdrawalRequestPick`, `RTVCase`, `ScrapCase`, `RelocationLine`, `GoodsReceivingItem` — ถ้า split row ที่ถูกจองอยู่ ลิงก์พวกนี้จะเพี้ยน
- ต้องออกแบบกติกาชัด: split ได้เฉพาะสถานะไหน, row ลูกสืบทอดอะไร, audit ยังไง

**RQ15 — Capacity Calculation + แนะนำ Slot** 🟡
- ✅ วัตถุดิบครบ: `Product.lengthCm/widthCm/heightCm` มีแล้ว, `Slot` มีขนาด, `boxFitsSlot()` เช็คใส่ได้ไหมแบบหมุนได้, space simulator มี `boxesPerLayer()`/`simulateLine()`
- 🔴 ไม่มี endpoint "QTY นี้ต้องใช้พื้นที่เท่าไร / slot ไหนเหมาะ"
- **ความเสี่ยง (data):** ขนาดสินค้าใน prod น่าจะยังว่างเป็นส่วนใหญ่ → ถ้าไม่เช็คก่อน ฟีเจอร์จะโชว์ว่างเปล่า ต้องมี fallback ที่พูดตรง ๆ ว่า "สินค้านี้ยังไม่มีขนาด"

**RQ21 — Storage Slot Selection UX** 🟡
- จาก S1_06: ตอนนี้เป็น `<select>` แบน ๆ ยาวเป็นร้อยรายการ `M03-01-01 (0/1)`
- งาน: filter ตาม zone/rack, แสดงพื้นที่ว่าง + จำนวนที่รองรับ, เรียง slot ที่แนะนำขึ้นก่อน — **ต้องทำ RQ15 ก่อน**

### 2.5 QR / Container

**RQ17 — Location QR vs Container QR** 🟡
- ✅ **Location QR มีครบแล้ว**: payload `LOC|<WH>|<RACK>|<SLOT>` (`labels/location-label.ts`), พิมพ์ฉลากได้ (S1_00 "Print rack labels"), scanner parse ได้ (`barcode-parser.service.ts`)
- 🔴 **Container QR ไม่มีเลย** — ไม่มี entity กล่อง/ลัง

**RQ18 — Box Split / Movement** 🔴
- ต้องสร้างใหม่ทั้งหมด: model `Container` (code, parentContainerId, slotId, status), QR prefix ใหม่ (`BOX|`), รองรับใน scanner, operation แบ่ง/รวม/ย้าย + audit + ผูกกล่องเดิม↔กล่องใหม่
- งานใหญ่ แต่ **แยกส่วนได้สะอาด** ไม่พันกับของเดิมมาก

### 2.6 Request / Issued Items (2 bug ที่เจอต้นเหตุแล้ว)

**RQ22 — Brand เลือกได้แค่ ACER** ❗ **ไม่ใช่ Business Rule — เป็นปัญหา data + filter เงียบ**
- ต้นเหตุ (`frontend/src/app/(dashboard)/requests/page.tsx:485-487`):
  ```ts
  const brandsWithProducts = brands.filter((b) =>
    allProducts.some((p) => p.brand?.id === b.id),
  );
  ```
- `allProducts` มาจาก `getProductsWithAvailableQty()` ซึ่งกรอง `productStatus: 'ACTIVE'` (`requests.service.ts:298`)
- แปลว่า brand จะหายไปถ้า: สินค้าของ brand นั้น**ไม่ ACTIVE** หรือ **ไม่ได้ผูก brandId**
- **ไม่มีที่ไหนในโค้ดฮาร์ดโค้ด ACER** — ยืนยันแล้ว
- แก้: (ก) ตรวจข้อมูล prod (ข) เปลี่ยนจาก**ซ่อน** brand เป็น**แสดงแบบ disabled พร้อมเหตุผล** เพื่อไม่ให้ผู้ใช้เดา
- 🔎 **ต้องการจากคุณ:** จำนวน product แยกตาม brand + productStatus บน prod (ผมเข้า DB ไม่ได้)

**RQ23 — My Issued Items ไม่แสดงข้อมูล** ❗
- ต้นเหตุ (`backend/src/rma/rma.service.ts:11,28-31`):
  ```ts
  const USAGE_PENDING_STATUSES = [ISSUED_TO_RMA, SHIPPED, READY_FOR_PICKUP];
  const own = user && !hasAccess(user, ACCESS.rmaUsageOnBehalf) ? { requesterId: user.id } : {};
  ```
- เงื่อนไขที่แสดง = request ที่สถานะอยู่ใน 3 ตัวนั้น **และ** (ถ้าไม่มีสิทธิ์ `rmaUsageOnBehalf`) ต้องเป็น request ที่ตัวเองสร้าง
- ใน S1_08 ผู้ใช้คือ System Administrator → เป็นไปได้ 2 ทาง: (ก) ไม่มี request ไหนอยู่ใน 3 สถานะนั้น (ข) admin ไม่ได้รับสิทธิ์ `rmaUsageOnBehalf` และตัวเองไม่เคยสร้าง request
- แก้: empty state ต้อง**บอกให้ชัดว่าเป็นกรณีไหน** + ตรวจการ grant สิทธิ์
- 🔎 **ต้องการจากคุณ:** จำนวน WithdrawalRequest แยกตาม status บน prod + role ไหนได้ `rmaUsageOnBehalf`

### 2.7 Logistic (Sheet 2)

**RQ24 — Shipping Information + Smart Address Autocomplete** 🔴 ⚠️ **งานใหม่ทั้งหมด**
- สแกนทั้ง schema แล้ว: **ไม่มีฟิลด์ที่อยู่จัดส่งเลยแม้แต่ฟิลด์เดียว**
  - `Shipment` มีแค่ `carrier`, `trackingNumber`, `receiverName`, `podReference`
  - `CompanyProfile.address` เป็น free text ก้อนเดียว (ที่อยู่บริษัทเรา ไม่ใช่ปลายทาง)
  - ไม่มี model `Address` / `Province` / `PostalCode`
- ✅ มีจุดต่อแล้ว: `WithdrawalRequest.deliveryMethod = COLLECT | SHIP` (migration 32) และ UI มีปุ่ม Ship (S1_07)
- ต้องสร้าง: model ที่อยู่ 13 ฟิลด์ตาม sheet + ผูกเข้า request → fulfillment → shipment + ชุดข้อมูลไปรษณีย์ไทย
- ⚠️ **Sheet 2 ข้อ F19 เขียนไว้เองว่า: "Do not implement until the proposed design and data source have been reviewed and approved"** — ผมจะไม่แตะจนกว่าจะเคาะแหล่งข้อมูล

---

## 3. แผนงานที่เสนอ (เรียงตามลำดับที่ควรทำ)

ทุก Phase = 1 PR, migration รันบน prod ก่อน merge เสมอ (ตามกติกาเดิมของโปรเจกต์: merge แล้ว deploy ทันที)

| Phase | RQ | เนื้องาน | Migration | ความเสี่ยง |
|---|---|---|---|---|
| **P0 — Quick wins** | 20, 22, 23, 4, 3, **19** | แก้ dialog ล้น, แก้ brand filter ให้โปร่งใส, แก้ empty state ของ My Issued Items, แก้ถ้อยคำ Rack Details, test ยืนยันกติกา warehouse code, **+ regression test ล็อกมติ C7 (1 ไฟล์ = 1 receipt)** | ไม่มี | 🟢 ต่ำ |
| **P1 — Rack lifecycle** | 5, 6, 2, 7 | deactivate/activate/restore สำหรับ Rack+Slot+Warehouse, แก้เงื่อนไขลบ, auto-gen ชื่อ rack type + warehouse (**ตัวนี้ P2 เอาไปใช้ต่อ**), ล็อกขนาด rack ตาม Rack Type | **ไม่มี** — คอลัมน์ soft-delete มีครบแล้ว | 🟡 กลาง — กระทบ rack เก่า |
| **P2 — Units & Bulk create** | 1, 25, 26 | `<LengthInput>` + `formatLength()` ใช้ทั้งระบบ (C1), auto-create Rack Type (C3), pattern ของ rack code ใน `Setting` (C4), ปรับหน้า Bulk Rack Creation ให้ตรง mock S3_00 | **ไม่มี** | 🟢 **ต่ำ** (เดิม 🟡 — ลดเพราะ C1/C3/C4 ไม่ต้องแตะ schema) |
| **P3 — Layout 2D** | 8, 9, 10, 12, 27, **11** | เพิ่ม DOOR, ปุ่มหมุน, **grid 10 cm ตามซูม + snap 0.1 m + ลด `MIN_SIZE` (C2)**, ย้าย overlap/boundary check มาที่ 2D (เป็น**คำเตือน** ไม่ใช่ hard block), measure tool + scale bar, auto-place rack ที่สร้างใหม่, **+ RQ11: ป้ายบอก stock บนผัง + ข้อความ "บันทึกผังเท่านั้น" + ปุ่มลัดไป Relocation** | มี 1 ตัว (enum `DOOR`) | 🟡 กลาง |
| **P4 — Layout lifecycle** | 13 | Preview 3D ก่อน Save, สถานะ DRAFT/PENDING/PUBLISHED + approval ของผัง | มี | 🟡 **กลาง** (เดิม 🟠 — ลดลงเพราะ C5 ตัดการผูกกับ stock ออก) |
| **P5 — Putaway intelligence** | 15, 21 | endpoint คำนวณพื้นที่จาก QTY+ขนาดสินค้า + แนะนำ slot, ปรับหน้าจอเลือก slot | ไม่มี | 🟡 กลาง (ติด data quality) |
| **P6 — Partial putaway** | 16 | split StockItem ตามจำนวน + ติดตามยอดคงเหลือ (**ฝั่ง putaway เท่านั้น** — ฝั่งรับปิดด้วย C7 แล้ว) | มี | 🔴 **สูง** |
| **P7 — Container & QR** | 17, 18 | model Container, QR กล่อง, แบ่ง/ย้าย/ผูกกล่อง | มี (ใหญ่) | 🟠 สูงแต่แยกส่วนได้ |
| **P8 — Logistic** | 24 | ที่อยู่จัดส่ง + postal autocomplete | มี (ใหญ่) | 🔴 **สูง** — รอเคาะ data source (C6) |
| **P9 — Multi-floor** | 14 | คลังหลายชั้น | มี (ใหญ่มาก) | 🔴 **สูงสุด** — เสนอแยกโปรเจกต์ (C8) |
| ~~—~~ | ~~19~~ | ✅ **ปิดด้วยมติ C7** — ไม่มีงานพัฒนา เหลือแค่ test ที่ย้ายไป P0 | — | — |

### สิ่งที่เปลี่ยนใน Roadmap หลังมติ C1–C5, C7

| เดิม | ใหม่ | เหตุผล |
|---|---|---|
| P1 ต้องมี migration เล็ก | **ไม่ต้องมี** | คอลัมน์ `isActive/isDeleted/deletedAt/deletedBy` มีครบทั้ง Rack/Slot/Warehouse แล้ว |
| P2 ความเสี่ยง 🟡 | **🟢 ต่ำ** | C1 ไม่ migrate · C3 ใช้ `RackTypeMaster` เดิม · C4 ใช้ `Setting` เดิม |
| RQ9 แก้ grid ไม่ได้ (กลัว performance) | **ทำได้ทั้ง grid 10 cm และ snap 0.1 m** | C2 — SVG pattern ไม่ได้วาดทีละช่อง และมี zoom gate อยู่แล้ว |
| RQ7 รอมติเรื่อง rack เก่า | **ล็อกได้เต็มที่ + migrate rack เก่าอัตโนมัติ** | C3 — auto-create Rack Type จากขนาดเดิมของ rack นั้น |
| RQ25 ขัดกับ RQ7 | **ไม่ขัดแล้ว** | C3 — "พิมพ์เอง" กลายเป็นการสร้าง Rack Type ให้อัตโนมัติ |
| RQ11 อยู่ P4 เป็นงาน guard + approval | ย้ายไป **P3** เป็นงาน UI เล็ก | C5 — ผังไม่แตะ stock จึงไม่ต้อง guard |
| P4 ความเสี่ยง 🟠 กลาง-สูง | **🟡 กลาง** | C5 — Approve/Publish ไม่ต้องผูก stock state |
| RQ19 เป็น scope item รอคำตอบ | **ปิด** ย้าย test ไป P0 | C7 — ตรงกับระบบปัจจุบันแล้ว |
| RQ16 ครอบทั้งรับและ putaway | **เหลือ putaway อย่างเดียว** | C7 — ฝั่งรับใช้ `inspectedQty` บนใบเดิม |
| RQ10 เป็น hard block | **เป็นคำเตือนที่ override ได้** | C5 — ผังผิดไม่กระทบความถูกต้องของ stock |

**ลำดับที่แนะนำ (ยืนยันเหมือนเดิม แต่ตอนนี้มีเหตุผลหนักขึ้น):** **P0 → P1 → P2 → P3**

เหตุผลที่ P2 ขยับขึ้นมาก่อน P3: หลังมติ C1/C3/C4 แล้ว P2 ไม่ต้องใช้ migration และความเสี่ยงเหลือ 🟢 — รวมกับ P0, P1 แปลว่า **ปล่อยได้ 3 รอบติดโดยไม่ต้องแตะ prod DB เลย** และ P1 ยังส่งตัวสร้างชื่ออัตโนมัติ (RQ6) ให้ P2 ใช้ต่อใน auto-create Rack Type พอดี

**ยังไม่ตัดสินใจเรื่อง P6/P8/P9** — รอ C6 กับ C8

---

## 4. ❓ ประเด็นที่ต้องให้คุณตัดสินใจ — เหลือ 2 ข้อ

**ตัดสินใจแล้ว 6 ข้อ:** ~~C1~~ ✅ · ~~C2~~ ✅ · ~~C3~~ ✅ · ~~C4~~ ✅ · ~~C5~~ ✅ · ~~C7~~ ✅ (ดูหัวข้อ 1.5)

ทั้ง 6 ข้อที่ปิดไปแล้วครอบคลุม **P0–P3 ทั้งหมด** → เริ่มลงมือได้ทันทีโดยไม่ติดอะไร ส่วน 2 ข้อที่เหลือกระทบเฉพาะ P8 กับ P9 ซึ่งอยู่ปลายแถว **ยังไม่ต้องตอบตอนนี้ก็ได้**

| # | ประเด็น | กระทบ | ทางเลือก | ที่ผมแนะนำ |
|---|---|---|---|---|
| **C6** | RQ24 แหล่งข้อมูลไปรษณีย์ | P8 | (ก) dataset ไทยเก็บในเครื่อง (ข) เรียก API ภายนอก (ค) ผสม | **(ก) + cache** ตาม F16 ที่ sheet เขียนเอง; และต้องรู้ว่ารองรับกี่ประเทศ |
| **C8** | RQ14 Multi-floor | P9 | ทำรอบนี้ **หรือ** แยกเฟสถัดไป | **แยก** — งานใหญ่กว่าที่เหลือรวมกัน และกระทบ location key ที่พิมพ์ฉลากไปแล้ว |

> หมายเหตุ: C5 ไม่ได้ลดความสำคัญของ C8 ลง — ตรงกันข้าม การแยกชั้น "ผัง / master / stock" ให้ชัดตาม C5 คือ**ฐานที่ทำให้ multi-floor ทำได้สะอาดขึ้น**ถ้าตัดสินใจทำในอนาคต เพราะชั้น floor จะไปอยู่ที่ layout เป็นหลัก
>
> และ C4 เพิ่งยืนยันอีกชั้นว่าทำไม C8 ถึงเสี่ยง — ถ้า multi-floor ทำให้ต้องใส่ชั้นเข้าไปใน location key (`WH|FLOOR|RACK|SLOT`) ฉลาก QR ที่พิมพ์ไปแล้วจะพังด้วยเหตุผลเดียวกับที่เราเพิ่งตัดสินใจห้าม rename rack

---

## 5. 🔎 ข้อมูลที่ผมต้องการจากคุณ (เข้า DB prod ไม่ได้)

1. **RQ22** — จำนวน product แยกตาม `brand` × `productStatus` บน prod
2. **RQ23** — จำนวน `WithdrawalRequest` แยกตาม `status` + role ไหนได้สิทธิ์ `rmaUsageOnBehalf`
3. **RQ15** — product กี่ % ที่กรอก `lengthCm/widthCm/heightCm` แล้ว
4. **RQ20** — ความกว้างจอ + zoom ตอนถ่าย S1_04 (ไว้ reproduce ให้ตรง)

---

## 6. แผนการทดสอบ

### 6.1 Guard test ของมติ (ทำพร้อมเฟสที่เกี่ยวข้อง — สำคัญที่สุด)

มติทั้งสองตรงกับพฤติกรรมปัจจุบันอยู่แล้ว **แต่ไม่มี test อะไรล็อกไว้** ถ้าใครแก้โค้ดในอนาคตแล้วเผลอทำหลุด จะไม่มีอะไรจับได้ — สองเทสต์นี้คือสิ่งที่เปลี่ยน "มติ" ให้กลายเป็น "ข้อบังคับที่บังคับใช้ได้จริง"

| Test | ล็อกอะไร | ไฟล์ |
|---|---|---|
| **C5-G1** | เรียก `batchSave()` / `updateObject()` / `saveRackPositions()` แล้ว **ไม่มี write ไปที่ `StockItem`, `Slot`, `Rack` เลย** (spy prisma client แล้วยืนยันว่ามีแต่ `findMany`/`findFirst` ของตารางเหล่านั้น) | `warehouse-layout.service.spec.ts` |
| **C5-G2** | ย้าย rack ที่ **มี stock อยู่** บนผังได้สำเร็จ และหลังย้าย `StockItem.slotId / rackId / warehouseId` ไม่เปลี่ยน (เคสบวก — พิสูจน์ว่าไม่ได้เผลอไปบล็อก) | `warehouse-layout-arrange.service.spec.ts` |
| **C5-G3** | ย้าย stock จริงทำได้ **ทางเดียว** คือผ่าน Relocation + Approval และ putaway — ยืนยันว่าไม่มี endpoint อื่นเขียน `StockItem.slotId` | `relocation` + `putaway` spec |
| **C7-G1** | import ไฟล์ที่มี N แถว → ได้ `GoodsReceiving` **1 แถว** และ `GoodsReceivingItem` N แถว | `receiving-import` spec |
| **C7-G2** | `itemCondition` รับแค่ `NEW` / `REFURBISH` (มี test อยู่แล้วใน `receiving-display.spec.ts` — ขยายให้ครอบ import path ด้วย) | `receiving-display.spec.ts` |
| **C4-G1** | `setupRacks` ไม่เคย **แก้ code ของ rack ที่มีอยู่แล้ว** ไม่ว่าจะเปลี่ยน pattern เป็นอะไร (เคสที่พังฉลากจริง) | `setup-racks.service.spec.ts` |
| **C3-G1** | ส่งขนาดซ้ำกับ Rack Type ที่มีอยู่ → **ใช้ตัวเดิม ไม่สร้างใหม่** (กัน Rack Type งอกรก) | `setup-racks.service.spec.ts` |
| **C1-G1** | `formatLength()` / `<LengthInput>` แปลงไป-กลับแล้ว **ได้ค่า cm เดิมเป๊ะ** ทุกหน่วย (กันปัดเศษหาย) | `length-unit.spec.ts` |

**Unit test** (ตามรูปแบบเดิมของ repo — pure helper + `.spec.ts` ข้าง ๆ ไฟล์)
- `space-math.spec.ts` — ต่อเคส floor area ต่อ rack / total (RQ26)
- `floor-geometry.spec.ts` — overlap กับ aisle/zone/door, boundary ในระบบพิกัด 2D (RQ10) — **assert ว่าผลลัพธ์เป็น warning ไม่ใช่ throw** ตามมติ C5
- ไฟล์ใหม่ `length-unit.spec.ts` — แปลง m↔cm↔mm ปัดเศษ (RQ1)
- `putaway-fit.util.ts` — ต่อเคส QTY หลายชิ้นต่อ slot (RQ15)
- `rack-lifecycle.spec.ts` — deactivate/restore + เงื่อนไขบล็อกการลบ (RQ5) — **ต้องบล็อกที่ชั้น master เท่านั้น ไม่ใช่ชั้นผัง**

**Controller / service test**
- `warehouse-master.controller.spec.ts` — rack code immutable, restore permission
- `rma.service` — pendingUsage ทั้งกรณีมีและไม่มีสิทธิ์ on-behalf (RQ23)
- `requests.service` — products-available เมื่อ brand ไม่มีสินค้า ACTIVE (RQ22)

**Manual / Browser QA ที่เพิ่มจากมติ**
- ลาก rack ที่มีของบนผัง → Save → เปิดหน้า Inventory ยืนยันว่า location ของ stock **ไม่เปลี่ยน** (คือสิ่งที่ C5 สัญญากับผู้ใช้ ต้องเห็นด้วยตา ไม่ใช่เชื่อแค่ test)
- ข้อความบนปุ่ม Save ต้องอ่านแล้วเข้าใจทันทีว่าไม่ย้ายของ — ทดสอบกับผู้ใช้จริง 1 คนก่อนปิดงาน

**i18n parity** — ทุก string ใหม่ต้องครบ 3 ภาษา (`en` / `th` / `zh-CN`) ไม่งั้น key โผล่ดิบบนจอ

**Migration** — รันบน prod **ก่อน** merge ทุกครั้ง และแนบผลลัพธ์จริงมายืนยัน (ไม่ใช่แค่บอกว่ารันแล้ว)

**Browser QA** — ทุก Phase ที่แตะ UI ต้องดูจริงบน Cloudflare Pages หลัง deploy ไม่ใช่เชื่อแค่ test ผ่าน

---

## 7. Requirement Traceability Matrix

RQ → มติที่เกี่ยวข้อง → โค้ด/ไฟล์ที่รับผิดชอบ → Phase → Test ที่พิสูจน์

| RQ | หมวด | มติ | โค้ดที่เกี่ยวข้อง | Phase | Test |
|---|---|---|---|---|---|
| 1 | Measurement Unit | **C1** ✅ | `warehouse-master/forms.tsx`, `space-math.ts` | P2 | `length-unit.spec` + **C1-G1** |
| 2 | Auto WH Name | — | `warehouse-master.service.ts:360` | P1 | controller spec |
| 3 | WH Code Validation | — | `warehouse-master.service.ts:364` | P0 | controller spec |
| 4 | Rack detail สับสน | — | `dashboard/space/space-layers.tsx` | P0 | QA บนจอ |
| 5 | Rack Delete/Restore | — | `warehouse-master.service.ts:526` | P1 | `rack-lifecycle.spec` |
| 6 | Auto Rack Type Name | — | `warehouse-master.service.ts:442` | P1 | controller spec |
| 7 | Config by Rack Type | **C3** ✅ | `warehouse-master.service.ts:474-524` | P1 | controller spec |
| 8 | 2D Layout | — | `warehouse-layout/*`, `LayoutObjectType` | P3 | layout spec |
| 9 | Grid/Snap/Rotation | **C2** ✅ | `layout-canvas.tsx`, `layout-toolbar.tsx` | P3 | layout spec |
| 10 | Boundary/Overlap | **C5** ✅ | `floor-geometry.ts:188,203` | P3 | `floor-geometry.spec` (warning ไม่ใช่ throw) |
| 11 | Rack with Stock | **C5** ✅ | `warehouse-layout.service.ts:13-16`, `RelocationRequest` | P3 | **C5-G1/G2/G3** |
| 12 | Undo/Redo/Scale | — | `use-layout-editor.ts` | P3 | editor spec |
| 13 | 2D/3D Sync | **C5** ✅ | `warehouse-3d.tsx`, `saveRackPositions` | P4 | layout lifecycle spec |
| 14 | Multi-Floor | C8 ❓ | `WarehouseLayout @unique`, `scene-3d.tsx` | P9 | — (รอมติ) |
| 15 | Capacity Calc | — | `putaway-fit.util.ts`, `space-math.ts` | P5 | `putaway-fit` spec |
| 16 | Partial Putaway | **C7** ✅ | `putaway.service.ts:59`, `StockItem` | P6 | putaway split spec |
| 17 | Location/Container QR | — | `labels/location-label.ts`, `barcode-parser` | P7 | label spec |
| 18 | Box Split/Movement | — | *(ยังไม่มี model)* | P7 | container spec |
| 19 | Batch Receiving | **C7** ✅ | `receiving-import.service.ts:13,228` | **P0 (test เท่านั้น)** | **C7-G1/G2** |
| 20 | Import UI ล้น | — | `receiving/page.tsx:357` | P0 | QA บนจอ |
| 21 | Slot Selection UX | — | `putaway/page.tsx` | P5 | QA บนจอ |
| 22 | Brand = ACER | — | `requests/page.tsx:485`, `requests.service.ts:298` | P0 | `requests.service` spec |
| 23 | Issued Items ว่าง | — | `rma.service.ts:11,28` | P0 | `rma.service` spec |
| 24 | Logistic | C6 ❓ | *(ยังไม่มี model)* | P8 | address spec |
| 25 | Bulk Rack Creation | **C3, C4** ✅ | `warehouse-master.service.ts:585` | P2 | `setup-racks.service.spec` + **C3-G1 / C4-G1** |
| 26 | Rack Area Calc | — | `space-math.ts:68,276` | P2 | `space-math.spec` |
| 27 | Bulk Rack Placement | **C5** ✅ | `floor-geometry.ts`, `LayoutObject` | P3 | placement spec |

**สรุป coverage ของมติ:** C1→RQ1 · C2→RQ9 · C3→RQ7+RQ25 · C4→RQ25 · C5→RQ10/11/13/27 (+กรอบของ RQ5) · C7→RQ16/19

**RQ ที่ยังติดมติค้าง: 2 ตัวเท่านั้น** — RQ24 (รอ C6) และ RQ14 (รอ C8) ทั้งคู่อยู่ P8/P9 ปลายแถว · **RQ ใน P0–P3 ทั้งหมดเคลียร์มติครบแล้ว ลงมือได้ทันที**

---

## 8. สิ่งที่ผมยังไม่ได้ทำ (โดยตั้งใจ)

- ❌ ไม่ได้เขียนโค้ดหรือแก้ไฟล์ใด ๆ นอกจากเอกสารฉบับนี้ — Analysis only ตามที่สั่ง
- ❌ ไม่ได้แก้ Database / ไม่ได้สร้าง Migration
- ❌ ไม่ได้ Commit / Push / Deploy
- ❌ ไม่ได้ต่อ DB prod — port ถูกบล็อกจากเครื่องนี้
- ❌ ไม่ได้เพิ่ม requirement ที่ไม่มีใน Excel/รูป
