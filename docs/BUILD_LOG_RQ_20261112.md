# WMS Revision — Build Log (Local Development)

> # 🛑 CHECKPOINT ล่าสุด — 17 พ.ย. 2026 เวลา ~20:05
>
> หยุดตามคำสั่งผู้ใช้ · **P3 ปิดเฟสแล้ว · 18 จาก 27 RQ** · ไม่มี agent ทำงานอยู่ · ไม่มี process ค้าง (port 3000/3001/5433 ว่าง) · **ไม่มี commit / push / merge / deploy และไม่แตะ production ใด ๆ**
>
> Git: `claude/wms-requirement-analysis-916e69` @ `400bc61` · **62 ไฟล์แก้ · 18 ไฟล์ใหม่ · 3,634 insertions / 395 deletions** ยังไม่ commit
>
> **อ่านหัวข้อ 0.1 (มติเปิด module) และ 0 ก่อนทำงานต่อ**

---

## 0.1 🔓 มติ: เปิด module `floorPlan2d` (17 พ.ย. 2026)

ผู้ใช้สั่ง "เปิดด้วย" → เปลี่ยนค่าตั้งต้นให้ 2D floor plan editor แสดงผล ส่วน `warranty` กับ `mrp` **ยังซ่อนตามเดิม ไม่แตะ**

| ไฟล์ | เปลี่ยนอะไร |
|---|---|
| `backend/src/settings/setting-definitions.ts` | `DEFAULT_HIDDEN_MODULES` เอา `'floorPlan2d'` ออก (`seed` เปลี่ยนตามอัตโนมัติ) |
| `frontend/src/lib/feature-flags.ts` | `floorPlan2d: false → true` |
| `frontend/src/components/layout/module-settings-card.tsx` | **ลบสำเนาที่สามของรายการค่าตั้งต้นทิ้ง** เปลี่ยนไปคำนวณจาก `isModuleVisibleDefault()` ซึ่งเป็นแหล่งเดียว |
| `backend/src/settings/setting-definitions.spec.ts` | ปรับ assertion ให้ตรงเจตนาใหม่ + เพิ่ม `expect(DEFAULT_HIDDEN_MODULES).not.toContain('floorPlan2d')` พร้อมคอมเมนต์ว่าการเอากลับเข้าไปจะซ่อน RQ8–RQ12 และ RQ27 จากทุกการติดตั้งใหม่ |

### ⚠️ สิ่งที่ต้องรู้ก่อน deploy — การเปลี่ยนค่าตั้งต้น **ไม่พอ** สำหรับระบบที่ติดตั้งไปแล้ว

ค่าตั้งต้นมีผล**เฉพาะตอนที่ยังไม่มีแถว `ui.hiddenModules` ใน DB** ถ้ามีแถวอยู่แล้ว แถวนั้นชนะเสมอ

ยืนยันด้วยของจริงบน local: `dist` ที่รันอยู่มีค่าตั้งต้นใหม่ `['warranty','mrp']` แล้ว แต่ API ยังตอบ `source: "configured"` และ `floorPlan2d: false` เพราะมีแถวเก็บค่า `warranty,mrp,floorPlan2d` อยู่

→ **บน production ต้องให้แอดมินเข้า System Settings → Modules แล้วเอา floorPlan2d ออกจากรายการที่ซ่อน** การ deploy อย่างเดียวจะไม่ทำให้หน้าจอโผล่

> 🪤 **กับดัก:** ค่าของ setting นี้เป็น **comma-separated ไม่ใช่ JSON array** (`hiddenModulesFrom` ใช้ `value.split(',')`) ใส่เป็น JSON แล้วจะเงียบไปเฉย ๆ เพราะ parse ไม่ผ่านแล้วถอยไปใช้ค่าตั้งต้น

### 🐛 bug จริงที่เจอระหว่างทาง และแก้แล้ว

`WarehouseLayoutService.problems()` **ไม่ได้ประกาศชนิดที่คืน** และมีสองทางออก ทางที่ไม่มี layout คืน `problems: []` ซึ่ง TypeScript อนุมานเป็น `never[]` แล้ว union กับอีกทาง ทำให้ `res.problems[n].severity` ใช้ไม่ได้ทั้งฝั่ง caller และ spec

```
src/warehouse-layout/warehouse-layout-plan.service.spec.ts(119,40):
error TS2339: Property 'severity' does not exist on type 'never'.
```

**`npx jest` ผ่านทั้ง 972 tests แต่ `tsc --noEmit` แดง** เพราะ ts-jest ผ่อนปรนกว่า → นี่คือเหตุผลที่ต้องรัน typecheck แยกเสมอ ไม่ใช่ดูแค่ test เขียว

แก้โดยประกาศ return type ชัดเจน พร้อมคอมเมนต์อธิบายว่าทำไมต้องประกาศ และ import `type PlanFloor` / `type LayoutProblem` เข้ามา · หลังแก้ tsc EXIT=0 และ 972 tests ยังผ่านครบ

### Gate หลังการเปลี่ยนทั้งหมด (Main Agent รันยืนยันเอง)

| Gate | ผล |
|---|---|
| Backend typecheck | ✅ 0 errors |
| Backend tests | ✅ **59 suites / 972 tests** |
| Frontend typecheck | ✅ 0 errors |
| i18n TH / ZH-CN | ✅ 3,528 · 100% |
| Production build | ✅ 55 routes |

---

> # 🛑 CHECKPOINT ก่อนหน้า — 13 พ.ย. 2026 เวลา ~14:35
>
> หยุดเพราะโควต้าการใช้งาน 5 ชั่วโมงเหลือน้อย (ใช้ไป 86%) **ไม่ใช่เพราะงานมีปัญหา**

---

## 0. 🛑 Checkpoint — สถานะ ณ จุดหยุด

### Git

| | |
|---|---|
| Branch | `claude/wms-requirement-analysis-916e69` |
| HEAD | `400bc61` Merge PR F: approver chooses the pick location at approval (PR6) |
| Worktree | `D:\WMS_Project\.claude\worktrees\wms-requirement-analysis-916e69` |
| **Commit / Push / Merge / Deploy** | **ไม่มีเลย — 0 ครั้ง** |
| **แตะ Production DB** | **ไม่มีเลย — 0 ครั้ง** |
| ไฟล์แก้ไข (`M`) | **47** |
| ไฟล์ใหม่ (`??`) | **13** |
| ขนาดรวม | 2,050 insertions · 343 deletions |

งานทั้งหมด**ยังไม่ได้ commit** อยู่ใน working tree ล้วน ๆ — ห้ามรัน `git checkout`, `git restore`, `git clean` หรือ `git stash` กับ worktree นี้ จะหายทั้งหมด

### ไฟล์ใหม่ 13 ไฟล์

```
backend/src/common/rack-size-rule.ts                        กติกา RQ7 ที่ใช้ร่วมกันสองเส้นทาง
backend/src/receiving/receiving-batch-guard.spec.ts         guard มติ C7 (8 tests)
backend/src/requests/requests-create-active-product.spec.ts guard productStatus (6 tests)
backend/src/requests/requests-products-available.spec.ts    RQ22 (8 tests)
backend/src/rma/rma-pending-usage.spec.ts                   RQ23 (9 tests)
backend/src/warehouse-master/rack-lifecycle.service.spec.ts RQ5 + RQ7 (56 tests)
backend/src/warehouse-master/restore-list.service.spec.ts   รายการที่ลบ (16 tests)
backend/src/warehouse-master/setup-racks-size-pattern.spec.ts C3 + C4 + RQ26 (19 tests)
backend/src/warehouse-master/warehouse-code-guard.spec.ts   RQ3 (12 tests)
docs/RQ_ANALYSIS_20261112.md                                เอกสารวิเคราะห์ + Decision Log
docs/BUILD_LOG_RQ_20261112.md                               ไฟล์นี้
frontend/src/components/ui/length-input.tsx                 RQ1 — P2-B สร้าง ยังไม่จบ
frontend/src/lib/length.ts                                  RQ1 — P2-B สร้าง ยังไม่จบ
```

### ไฟล์ที่ไม่ได้ติดตามใน git แต่จำเป็นต่อการรัน local

| ไฟล์ | สถานะ |
|---|---|
| `backend/.env` | **สร้างใหม่ ชี้ `127.0.0.1:5433` เท่านั้น** ห้ามใส่ URL ของ Supabase |
| `frontend/.env.local` | ชี้ `http://localhost:3001` |
| `.claude/launch.json` | config เปิด dev server |

### ✅ เสร็จและผ่าน Quality Gate แล้ว — 11 RQ

| RQ | เรื่อง |
|---|---|
| RQ2 | Auto-generate Warehouse Name |
| RQ3 | Warehouse Code Validation (+ guard 12 ตัว) |
| RQ4 | Rack detail สับสน (ตาราง Rack Details) |
| RQ5 | Rack Delete / Restore (+ endpoint รายการที่ลบ) |
| RQ6 | Auto-generate Rack Type Name |
| RQ7 | ขนาด Rack ควบคุมโดย Rack Type (ปิดประตูหลังแล้ว) |
| RQ19 | Batch Receiving — ปิดด้วยมติ C7 (+ guard 8 ตัว) |
| RQ20 | Import dialog ล้นกรอบ (ยืนยันด้วยตา 3 ความกว้าง) |
| RQ22 | Brand = ACER (+ ปิดช่อง productStatus) |
| RQ23 | My Issued Items ว่าง |
| RQ26 | Automatic Rack Area Calculation |
| **RQ1** | **Measurement Unit — `<LengthInput>` + `length.ts`** |
| **RQ25** | **Bulk Rack Creation (backend + UI ครบ)** |

**รวม 13 RQ จาก 27** · P2-B ทำงานเสร็จครบก่อนคำสั่งหยุดจะถึง **ไม่มีไฟล์ค้างกลางคัน ไม่มี TODO**

### 🔄 ยังไม่จบ

| งาน | สถานะ |
|---|---|
| **ต่อ UI รายการ "ลบแล้ว"** | backend พร้อม (`GET /warehouse-master/deleted`) ยังไม่ได้ต่อ UI — **งานเดียวที่เหลือของ P2** |
| **RQ1 ส่วนที่เหลือ** | ช่องขนาด slot และอีก 4 จุด ยังไม่ได้แปลง (รายการด้านล่าง) |
| **P3–P7** | ยังไม่เริ่มเลย |
| **P8 / P9** | หยุดถาวรตามเหตุผลในหัวข้อ 5 (รอมติ C6 / C8) |

### RQ1 — จุดที่ยังไม่ได้แปลงเป็น `<LengthInput>`

เรียงตามลำดับความสำคัญ P2-B ไม่แตะเพราะอยู่นอกรายการไฟล์ที่เป็นเจ้าของ ซึ่งถูกต้องตามกติกา

| ไฟล์ | บรรทัด | เรื่อง |
|---|---|---|
| `warehouse-master/rack-detail.tsx` | 375-377 | **ขนาด slot (แก้ทีละช่อง) — สำคัญสุด อยู่ห่างจากฟอร์ม rack แค่คลิกเดียว จอคู่นี้จึงยังปนหน่วยกันอยู่** |
| `warehouse-master/rack-detail.tsx` | 511-513 | ขนาด slot (แก้ทีเดียวหลายช่อง) |
| `warehouse-master/floor-shape-field.tsx` | 98-102 | 6 ช่องเป็นเมตรตายตัว อยู่ใต้ช่องขนาดคลังที่ตามหน่วยผู้ใช้แล้ว |
| `products/product-form-dialog.tsx` | 278-287 | ขนาดกล่องสินค้า |
| `(dashboard)/putaway/page.tsx` | 151-155 | ขนาดกล่องตอน fit-check |
| `warehouse-master/warehouse-detail.tsx` | 32, 78 | แสดงอย่างเดียว ยังมี `cmToM` ส่วนตัวกับ " m" ตายตัว |

### 🧪 Test ที่รันจริงและผลลัพธ์

| ชุด | คำสั่ง | ผล |
|---|---|---|
| Backend unit | `npx jest --ci` | ✅ **57 suites / 919 tests** |
| Backend integration | `jest --config test/jest-integration.json --runInBand` | ✅ **20 suites / 227 tests** |
| Backend typecheck | `npx tsc --noEmit -p tsconfig.json` | ✅ 0 errors |
| Frontend typecheck | `npx tsc --noEmit` | ✅ 0 errors |
| i18n | `npm run check:i18n` | ✅ **3,443 strings** · th 100% · zh-CN 100% |
| Production build | `npm run build` | ✅ 55 routes |
| Browser QA | RQ20 ที่ 375 / 723 / 1280 · RQ4 กับข้อมูลจริง · wizard ของ RQ25 | ✅ |

**รวม 1,146 tests · ไม่มีตัวแดง** · Baseline เดิมคือ 49 suites / 774 tests

✅ **ตัวเลข frontend ทั้งหมดข้างบน Main Agent รันยืนยันเองหลัง P2-B แก้ไฟล์ครั้งสุดท้าย** ตรงกับที่ agent รายงานทุกตัว ไม่ต้องรันซ้ำตอนกลับมา (ยกเว้นถ้ามีการแก้ไฟล์เพิ่ม)

### 🔌 Background process — ปิดหมดแล้ว

ตรวจด้วย `netstat` ยืนยันว่า port 3000 / 3001 / 5433 ว่างทั้งหมด ไม่มี zombie process

### วิธีเปิดสภาพแวดล้อม local กลับมา

```bash
# 1. Postgres ท้องถิ่น (ข้อมูลยังอยู่ใน ./data)
cd <scratchpad>/pgl && node server.mjs

# 2. Backend (ต้อง preload pool1.cjs เพราะ PGlite รับทีละ 1 connection)
cd backend && node -r <scratchpad>/pgl/pool1.cjs dist/src/main.js

# 3. Frontend
cd frontend && npm run dev
```

ถ้า scratchpad ถูกล้าง ต้องติดตั้ง PGlite ใหม่แล้ว `npx prisma db push` + seed 3 ชุด (base / rbac / demo) ตามหัวข้อ 10

### ▶️ ขั้นตอนทำงานต่อ (ปรับปรุง 17 พ.ย. 2026)

**P0 · P1 · P2 · P3 ปิดครบแล้ว — 18 จาก 27 RQ**
RQ1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 19, 20, 22, 23, 25, 26, 27

1. **ถามเจ้าของระบบเรื่องหน่วยตั้งต้น** (คำถามข้อ 5) ก่อนแปลงช่องขนาดที่เหลือ เพราะถ้าเปลี่ยนใจทีหลังต้องไล่แก้ทุกจอที่ทำไปแล้ว
2. **แปลงช่องขนาดที่เหลือของ RQ1** ตามตารางลำดับความสำคัญ — ขนาด slot ใน `rack-detail.tsx` สำคัญสุด เพราะอยู่ห่างจากฟอร์ม rack แค่คลิกเดียว
3. เริ่ม **P4 — Layout lifecycle (RQ13)**: Preview ใน 3D ก่อน Save · สถานะ DRAFT / PENDING / PUBLISHED ต่อเข้า approval engine เดิม (`ApprovalRule` / `ApprovalInstance`) · ความเสี่ยง 🟡 เพราะมติ C5 ตัดการผูกกับ stock ออกแล้ว
4. **P5** putaway intelligence (RQ15, RQ21) → **P6** partial putaway (RQ16, เสี่ยงสูง) → **P7** container & QR (RQ17, RQ18)
5. **P8 / P9** หยุดถาวรจนกว่าจะได้มติ C6 / C8

### ⚠️ กับดักที่ต้องรู้ก่อนแก้ไฟล์ frontend

**repo นี้เป็น CRLF** (`core.autocrlf=true` และไม่มี `.gitattributes`) การแก้ด้วยสคริปต์ (Python `newline=''` หรือ `sed -i`) จะเปลี่ยนไฟล์เป็น LF เงียบ ๆ ทำให้ diff บวมเป็นทั้งไฟล์ · P2-B เจอปัญหานี้กับ 7 ไฟล์แล้วแก้กลับเป็น CRLF พร้อมรัน gate ใหม่ทั้งหมด · **ถ้าจะเขียนด้วยสคริปต์ ต้องใช้ `newline='\r\n'` หรือ normalise ทีหลัง**

### ❓ คำถามที่ยังรอเจ้าของระบบตอบ

1. **C6** — แหล่งข้อมูลรหัสไปรษณีย์ (บล็อก P8)
2. **C8** — Multi-floor ทำรอบนี้หรือแยกเฟส (บล็อก P9)
3. สินค้าถูกยกเลิก**หลัง**ใบเบิกถูกสร้าง — บล็อก / เตือนแล้วปล่อย / ปล่อยผ่าน? กระทบ 3 จุด (`submit`, `approve`, `allocation.service.ts:174`)
4. เส้นทางเก่า `/warehouse/racks` จะปลดระวางหรือรวมเส้น?
5. **หน่วยตั้งต้นของ `<LengthInput>` ควรเป็น cm หรือ m?** — ตอนนี้ตั้งเป็น **cm** เพราะเป็นหน่วยที่เก็บจริง พิมพ์อะไรก็บันทึกอย่างนั้นไม่ต้องแปลง และ 3 ใน 4 ฟอร์มเดิมก็ใช้ cm อยู่แล้ว **ผลข้างเคียง: ฟอร์ม Warehouse ที่เคยแสดง "40" ตอนนี้แสดง "4000"** จนกว่าผู้ใช้จะกดเลือก "m" หนึ่งครั้ง (แล้วจำไว้ทุกจอ) · เปลี่ยนได้ด้วยค่าคงที่ตัวเดียว `DEFAULT_LENGTH_UNIT` ใน `length.ts` · **ควรตอบก่อนแปลงช่องที่เหลือ** ไม่งั้นถ้าเปลี่ยนใจต้องไล่แก้ทุกจอที่ทำไปแล้ว
6. ชื่อ Rack Type อัตโนมัติ ใช้ภาษาที่แอดมินใช้ หรือบังคับอังกฤษเสมอ? (และชื่อที่ server สร้างฝังคำว่า "cm" ไว้เสมอ ไม่ตามหน่วยที่ผู้ใช้เลือก)
7. "Data Unavailable" ที่เหลืออีก 8 จุดใน Warehouse Summary — แก้ด้วยไหม (นอกขอบเขต RQ4)
8. `max-w-*` ไม่มี `sm:` อีก 8 จุดทั่วแอป — แก้ด้วยไหม (bug เดิม นอกขอบเขต RQ20)

---

ใช้คู่กับ [RQ_ANALYSIS_20261112.md](RQ_ANALYSIS_20261112.md) · เริ่ม 13 พ.ย. 2026
Worktree: `D:\WMS_Project\.claude\worktrees\wms-requirement-analysis-916e69` · branch `claude/wms-requirement-analysis-916e69`

> **สถานะสิ่งแวดล้อม: LOCAL เท่านั้น** — ไม่ commit / ไม่ push / ไม่ merge / ไม่ deploy / ไม่แตะ production DB

---

## 1. Environment Setup (เสร็จแล้ว)

| รายการ | ผล |
|---|---|
| Node / npm | v22.16.0 / 10.9.2 |
| `backend/node_modules` | ติดตั้งใหม่ใน worktree (เดิมไม่มี) — exit 0 |
| `frontend/node_modules` | ติดตั้งใหม่ใน worktree (เดิมไม่มี) — exit 0 |
| Prisma Client | generate แล้ว v7.8.0 |
| `backend/.env` | **สร้างใหม่แบบ local-only** |

### 🔒 บันทึกความปลอดภัยของ production

`backend/.env` ของ repo หลักชี้ไป **Supabase production** ผมจึง**ไม่คัดลอกเข้ามาใน worktree** และสร้างไฟล์ใหม่ที่ชี้ไป `127.0.0.1:5433` (PGlite local) เท่านั้น พร้อมหมายเหตุกำกับหัวไฟล์ว่าห้ามใส่ URL ของ production

เหตุผล: คำสั่งเดียวอย่าง `prisma db push` หรือ `prisma migrate dev` ที่เผลอรันพร้อม env ของ production จะแก้ฐานข้อมูลจริงทันทีโดยไม่ถาม การตัดการเข้าถึงตั้งแต่ระดับไฟล์ปลอดภัยกว่าการอาศัยวินัยของแต่ละ agent

---

## 2. Baseline ก่อนแก้โค้ด (วัดจริง 13 พ.ย. 2026)

ทุกตัวเลขด้านล่างมาจากการรันจริง ไม่ใช่การประมาณ

| Quality Gate | คำสั่ง | ผล |
|---|---|---|
| Backend typecheck | `npx tsc --noEmit -p tsconfig.json` | ✅ PASS (0 errors) |
| Backend unit tests | `npx jest --ci` | ✅ **49 suites / 774 tests PASS** · 38.2s |
| Frontend typecheck | `npx tsc --noEmit` | ✅ PASS (0 errors) |
| i18n TH / ZH-CN | `npm run check:i18n` | ✅ 29 modules · 3,379 strings · th 100% · zh-CN 100% |

**นี่คือเส้นที่ห้ามถอยหลัง** — ทุก Phase ต้องจบด้วยตัวเลขที่ไม่ต่ำกว่านี้

### หมายเหตุเรื่อง test ที่ต้องใช้ DB
`backend/test/integration/*.int-spec.ts` ต้องใช้ Postgres จริง และ `jest.config` หลักตั้ง `rootDir: src` จึงไม่ถูกรวมใน `npm test` ปกติ — integration suite จะรันได้ก็ต่อเมื่อตั้ง PGlite local ขึ้นมา จะทำเมื่อถึง Phase ที่แตะ schema จริง

---

## 3. Agent Roster

โปรเจกต์นี้**ไม่มี `.claude/agents`** (ตรวจแล้วทั้ง worktree และ repo หลัก) จึงไม่มี agent เฉพาะทางที่ตั้งค่าไว้ล่วงหน้า วิธีที่ใช้แทนคือ spawn `general-purpose` agent แล้วกำหนด **บทบาท + ขอบเขตไฟล์ที่เป็นเจ้าของ** ให้ชัดในบรีฟแต่ละตัว

**หลักการแบ่งงานขนาน:** แบ่งตาม **vertical slice (ฟีเจอร์)** ไม่ใช่ตามชั้น (frontend/backend) — เพราะถ้าแบ่งตามชั้น สอง agent จะต้องตกลง API contract กันกลางทางแล้วบล็อกกันเอง แต่ถ้าแบ่งตามฟีเจอร์ แต่ละตัวเป็นเจ้าของไฟล์ของตัวเองครบทั้ง stack และไม่มีใครแตะไฟล์เดียวกันเลย

Main Agent (ผม) รับผิดชอบ: ทำ file-ownership map, ตรวจ integration หลังทุก agent ส่งงาน, รัน Quality Gate รวมอีกครั้งแบบ integrated, และเขียนรายงาน

---

## 4. Phase P0 — Quick Wins (กำลังดำเนินการ)

### File-ownership map (กันแก้ไฟล์ชนกัน)

| Agent | บทบาท | RQ | ไฟล์ที่เป็นเจ้าของ |
|---|---|---|---|
| **P0-A** | Full-stack | RQ22 Brand filter | `app/(dashboard)/requests/page.tsx` · `requests.service.ts` · `requests.controller.ts` · `i18n/*/requests.ts` ×3 · spec ใหม่ใน `src/requests/` |
| **P0-B** | Full-stack | RQ23 Issued Items | `app/(dashboard)/issued-items/page.tsx` · `rma.service.ts` · `rma.controller.ts` · `i18n/*/returns.ts` ×3 · spec ใหม่ใน `src/rma/` |
| **P0-C** | Frontend / UX | RQ20 Dialog · RQ4 Wording | `app/(dashboard)/receiving/page.tsx` · `dashboard/space/space-layers.tsx` · `i18n/*/{receiving,space,dashboard}.ts` ×3 |
| **P0-D** | Testing | RQ3 · C7 guards | spec ใหม่ใน `src/receiving/` และ `src/warehouse-master/` |

ตรวจแล้วไม่มีไฟล์ซ้ำข้าม agent · ไม่มีใครแตะ `components/ui/dialog.tsx` หรือ `lib/api.ts` ซึ่งเป็นไฟล์ร่วมของทั้งระบบ

### กติกาที่ให้ทุก agent

1. ห้ามแตะไฟล์นอกรายการที่เป็นเจ้าของ ถ้าจำเป็นต้องแตะ ให้หยุดแล้วรายงานแทน
2. ทุก string ใหม่ต้องครบ 3 ภาษา (en / th / zh-CN) key และ `{placeholder}` ต้องตรงกัน
3. ต้องแนบ output จริงของ Quality Gate มาในรายงาน — **เขียนโค้ดเสร็จไม่นับว่าเสร็จ**
4. ถ้า typecheck error ชี้ไปไฟล์ที่ตัวเองไม่ได้เป็นเจ้าของ ให้ข้ามและรายงาน ห้าม "ช่วยแก้" เพราะนั่นคือไฟล์ที่ agent อื่นกำลังแก้อยู่
5. ห้าม commit / push / merge / deploy · ห้ามต่อ DB · ห้ามรัน prisma migrate หรือ db push
6. ห้ามเดากติกาธุรกิจเอง — ถ้ากำกวมให้เลือกทางที่ระมัดระวังที่สุดแล้วรายงานไว้

---

## 5. Phase ที่จะ "หยุดเฉพาะส่วน" และเหตุผล

ตามคำสั่งที่ได้รับ: *หากพบ Requirement ขัดแย้งหรือมีความเสี่ยงเกินขอบเขตที่อนุมัติ ให้หยุดเฉพาะส่วนนั้นและบันทึกเหตุผล ไม่ให้คาดเดากติกาธุรกิจเอง*

| Phase | RQ | เหตุผลที่หยุด |
|---|---|---|
| **P8** | RQ24 Logistic | ติดมติ **C6** ยังไม่ได้เลือกแหล่งข้อมูลรหัสไปรษณีย์ (dataset ในเครื่อง / API ภายนอก / ผสม) และยังไม่รู้ว่าต้องรองรับกี่ประเทศ · นอกจากนี้ Sheet 2 ข้อ F19 ของ requirement เองเขียนว่า *"Do not implement until the proposed design and data source have been reviewed and approved"* — การเลือกแหล่งข้อมูลเป็นการตัดสินใจเชิงธุรกิจ (ค่าใช้จ่าย, ข้อผูกพันกับผู้ให้บริการ, รอบการอัปเดตข้อมูล) ที่เดาแทนไม่ได้ |
| **P9** | RQ14 Multi-Floor | ติดมติ **C8** ยังไม่ตัดสินว่าทำรอบนี้หรือแยกเฟส · ถ้าทำ จะต้องเปลี่ยน location key เป็น `WH\|FLOOR\|RACK\|SLOT` ซึ่งทำให้ฉลาก QR ที่พิมพ์ติดชั้นวางจริงไปแล้วสแกนไม่เจอ — เป็นผลกระทบต่อหน้างานจริงที่ต้องให้เจ้าของระบบตัดสิน |

ถ้าได้คำตอบ C6 / C8 ระหว่างทาง จะรับเข้ามาทำต่อได้ทันที

---

## 5.1 กติกาเพิ่มเติมที่เพิ่งพบระหว่างทาง

`frontend/AGENTS.md` (อ้างจาก `frontend/CLAUDE.md`) ระบุว่า:

> **This is NOT the Next.js you know** — เวอร์ชันนี้มี breaking changes ทั้ง API, convention และโครงไฟล์ อาจต่างจากที่โมเดลเคยเรียนมา ให้อ่านคู่มือใน `node_modules/next/dist/docs/` ก่อนเขียนโค้ด และสนใจ deprecation notice

**ต้องใส่ข้อนี้ในบรีฟของทุก agent ที่แตะ frontend ตั้งแต่ P2 เป็นต้นไป** และเหตุผลที่ตั้ง `npm run build` เป็น Quality Gate ของงาน frontend ทุกชิ้นก็คือข้อนี้ — typecheck อย่างเดียวจับการใช้ API ของ Next.js ผิดรุ่นไม่ได้ แต่ production build จับได้

---

## 6. บันทึกผลรายเฟส

### P0-D · Testing · RQ3 + C7 guards — ✅ ผ่าน

ไฟล์ใหม่ 2 ไฟล์ **ไม่แตะ production code เลย**

| ไฟล์ | จำนวน | ล็อกอะไร |
|---|---|---|
| `backend/src/receiving/receiving-batch-guard.spec.ts` | 8 | มติ C7 — 1 ไฟล์ = 1 Goods Receipt |
| `backend/src/warehouse-master/warehouse-code-guard.spec.ts` | 12 | RQ3 — code ซ้ำไม่ได้ / แก้ไม่ได้ / เอากลับมาใช้ไม่ได้ |

guard ที่มีค่าที่สุด:
- **C7-G1 (ไฟล์เดียวแต่ condition/warehouse/lot ต่างกัน ต้องยังเป็นใบรับเดียว)** — เป็นวิธีที่ C7 จะถูกทำพังในอนาคตโดยที่โค้ดยังดูถูกต้อง เช่นมีคนมา refactor เป็น "group by warehouse"
- **C7-G1 (ไฟล์ที่ไม่มีแถวถูกต้องเลย ต้องไม่สร้างใบรับเปล่าทิ้งไว้)** — throw ก่อนเข้า `$transaction`
- **RQ3 (code ของ warehouse ที่ปิดใช้งาน/soft-delete แล้ว ยังถูกจองอยู่)** — assert ว่า lookup ไม่มีการ narrow ด้วย `isActive`/`isDeleted` ซึ่งเป็นการแก้จุดเดียวที่จะทำให้ code เก่าหลุดกลับมาใช้ได้

### 🔍 ข้อโต้แย้งที่ Main Agent ตรวจแล้วไม่รับ

Agent เสนอให้เพิ่ม `ConflictException` ใน `updateWarehouse` เพราะพบว่าส่ง `code` เข้าไปแล้วระบบตอบ 200 แล้วเงียบ ๆ ทิ้งค่า ทำให้ client เข้าใจผิดว่า rename สำเร็จ

**ตรวจแล้วไม่จริงที่ระดับ HTTP** — `backend/src/common/validation.ts` ตั้ง `whitelist: true` + `forbidNonWhitelisted: true` ดังนั้น PATCH ที่แนบ `code` ถูกปฏิเสธด้วย **400 `property code should not exist`** ตั้งแต่ก่อนเข้า service ที่ agent เห็นเป็นเงียบเพราะ unit test เรียก service ตรง ๆ ซึ่งข้าม pipe

→ **ไม่เพิ่ม `ConflictException`** เพราะจะกลายเป็น dead code หลัง 400 ที่ยิงไปก่อนแล้ว สั่งให้เขียน test ปิดช่องที่ระดับ HTTP แทน ได้มาอีก 2 ตัว (รวมเป็น 12)

ยืนยันเพิ่ม: `Warehouse.code` มี `@unique` ใน `schema.prisma:339` จริง · ฟอร์มหน้าเว็บไม่เคยส่ง `code` ตอน update (`forms.tsx:87`) จึงไม่กระทบ UI ไม่ว่าทางไหน

**เกร็ดที่ได้จากรอบแก้:** `BadRequestException.message` ของ Nest เป็นข้อความรวม `"Bad Request Exception"` ส่วนเหตุผลรายฟิลด์อยู่ใน `getResponse().message` — test ที่เช็ค pipe ต้องอ่านจาก response body ไม่ใช่จาก exception message

### P0-B · Full-stack · RQ23 Issued Items — ✅ ผ่าน

**ต้นเหตุ:** `pendingUsage()` คืน array เปล่า ๆ ซึ่งแปลได้ 2 อย่างที่ต่างกันสิ้นเชิง — ไม่มีใบไหนอยู่ใน 3 สถานะนั้นเลย หรือผู้ใช้เห็นได้แค่ของตัวเองและตัวเองไม่มี — หน้าจอเลยขึ้นข้อความเดียวกันทั้งสองกรณี

**แก้:** เปลี่ยนเป็น envelope `{ rows, scope, pendingElsewhere }` · `scope` เป็น `'own' | 'all'` ตามกติกาสิทธิ์เดิมเป๊ะ · `pendingElsewhere` ยิง query เพิ่มเฉพาะตอน scope เป็น `own` และรายการของตัวเองว่าง (ทางปกติไม่มี query เพิ่ม) · **ไม่มีการเปลี่ยนสิทธิ์ว่าใครเห็นอะไร** เป็นการอธิบาย ไม่ใช่การให้สิทธิ์

ไฟล์: `rma.service.ts`, `rma.controller.ts` (comment), `issued-items/page.tsx`, `i18n/*/returns.ts` ×3 (+4 keys), `rma-pending-usage.spec.ts` ใหม่ 9 tests

### 🔧 Integration break ที่ Main Agent ต้องเก็บเอง

P0-B รายงานตรงไปตรงมาว่าการเปลี่ยนรูปแบบ response จะทำให้ consumer นอกขอบเขตของตัวเองพัง และ **ไม่แตะเพราะไม่ใช่ไฟล์ของตัวเอง** — ถูกต้องตามกติกา

จุดที่พัง: `backend/test/integration/phase5-returns.int-spec.ts:260,265` อ่าน `.body.some(...)` ซึ่งตอนนี้ `body` เป็น object แล้ว

**อันตรายตรงที่ Quality Gate ทั้ง 4 ตัวมองไม่เห็น** — ไฟล์นี้ต้องใช้ DB จริงผ่าน `test:integration` และ backend typecheck ก็ผ่านเพราะ `body` ของ supertest เป็น `any`

Main Agent แก้เองแล้ว 2 ไฟล์:
- `backend/test/integration/phase5-returns.int-spec.ts` → `.body.rows.some(...)` + เพิ่ม assert ว่า `scope === 'own'` สำหรับ requester ที่ไม่มีสิทธิ์ on-behalf
- `frontend/src/lib/api.ts:637` → generic เดิมเป็น `any[]` ซึ่งผิดแล้ว เปลี่ยนเป็น `{ rows; scope; pendingElsewhere }`

ตรวจแล้ว `backend/e2e-test.js:86` เช็คแค่ `usageQueue.ok` จึงไม่กระทบ · typecheck ทั้งสองฝั่งสะอาดหลังแก้

**ข้อสังเกตเชิงออกแบบของ P0-B ที่รับไว้:** `pendingElsewhere` เป็น boolean ไม่ใช่จำนวน จงใจไม่เปิดเผยว่ามีของคนอื่นค้างกี่รายการ ถ้าต้องการโชว์ตัวเลขถือเป็นการตัดสินใจเชิง product ที่ต้องถามเจ้าของระบบก่อน

### P0-A · Full-stack · RQ22 Brand filter — ✅ ผ่าน (รอบแรก)

**ต้นเหตุ:** `getProductsWithAvailableQty()` กรอง `productStatus: 'ACTIVE'` **ใน SQL WHERE** ดังนั้น brand ที่สินค้าทุกตัวไม่ ACTIVE จะไม่มีแถวกลับมาเลย หน้าเว็บจึงกรอง brand นั้นทิ้งเงียบ ๆ เหลือ ACER · ส่วนสินค้าที่ `brandId = null` เป็นทางตันอีกแบบ คือกลับมาในรายการแต่เลือกไม่ได้เพราะช่อง Brand บังคับกรอก

**แก้:** ย้ายการกรองออกจาก SQL เปลี่ยนเป็น field `requestable` แทน · หน้าเว็บแสดง brand **ทุกตัว** โดยตัวที่เลือกไม่ได้เป็น disabled พร้อมเหตุผล 3 แบบ (`noProducts` / `noActive` / `noStock`) · `noStock` ยัง**เลือกได้** เพราะการห้ามคือกติกาใหม่ที่ไม่มีใครสั่ง · เพิ่มบรรทัดบอกจำนวนสินค้าที่ยังไม่ผูก brand

ไฟล์: `requests.service.ts`, `requests.controller.ts` (comment), `requests/page.tsx`, `i18n/*/requests.ts` ×3 (+6 keys), `requests-products-available.spec.ts` ใหม่ 8 tests

### 🔧 ช่องโหว่ที่ Main Agent สั่งให้ปิดเพิ่ม

P0-A รายงานตรง ๆ ว่า endpoint นี้คืนแถว**มากขึ้น**กว่าเดิม ผมตรวจเองแล้วพบว่า consumer มีตัวเดียวจริง (`requests/page.tsx:497`) จึงปลอดภัย **แต่เปิดช่องที่มีอยู่เดิมให้เข้าถึงง่ายขึ้น**

`requests.service.ts` `create()` **ไม่เคยตรวจ `productStatus` เลย** — ตรวจแล้วไม่มีการอ้างถึงในเส้นทาง create ทั้งเส้น แปลว่า client ยิง request สำหรับสินค้า INACTIVE / DISCONTINUED ได้ เดิมทีไม่มีใครทำได้เพราะหน้าเว็บไม่เคยมี ID พวกนั้นอยู่ในมือ แต่ตอนนี้มีแล้วโดยการออกแบบ

**ทำไมถึงไม่ใช่การเดากติกาธุรกิจ:** โปรเจกต์มีกติกานี้อยู่แล้วและใช้ตรงกันทั้งสองเส้นทางของ receiving —
`receiving.service.ts:198` และ `receiving-import.service.ts:127` ซึ่งเขียนกำกับว่า *"Same rule as Receive Goods: discontinued / inactive products cannot be received"* → สั่งให้ **ลอกกติกาเดิมมาใช้ ไม่ใช่ออกแบบใหม่** เปลี่ยนแค่คำกริยาเป็น `cannot be requested`

**สิ่งที่สั่งห้ามทำ:** ห้ามใส่ guard เดียวกันใน `submit()` / `approve()` เพราะใบ DRAFT ที่สร้างตอนสินค้ายัง ACTIVE แล้วมาส่งตอนสินค้าถูกยกเลิกไปแล้ว เป็น**คำถามเชิงธุรกิจจริง** (บล็อก / เตือนแล้วปล่อย / ปล่อยผ่าน) ที่ต้องถามเจ้าของระบบ → ให้รายงานรายชื่อจุดที่ควรมีกติกาเดียวกันกลับมาแทน

### P0-C · Frontend/UX · RQ20 + RQ4 — ✅ ผ่าน

**RQ20 ต้นเหตุจริง (ลึกกว่าที่ผมประเมินไว้ในเอกสารวิเคราะห์):**

1. `max-w-3xl` ที่เขียน**ไม่มี `sm:`** ไปอยู่กลุ่มเดียวกับ `max-w-[calc(100%-2rem)]` ที่ `dialog.tsx` ใส่ไว้ tailwind-merge เลย**ลบ clamp ตัวนั้นทิ้ง** popup จึงกลายเป็นกว้างเต็มจอชิดขอบทั้งสองข้าง
2. `overflow-y-auto` ทำให้ popup เป็น scroll container และ popup เป็น `display: grid` → track เดียวของมันถูกคิดขนาดจาก **min-content ของฟอร์มทั้งก้อน** ซึ่ง grid track ไม่ยอมหดต่ำกว่านั้น ตัวกว้างสุดคือตาราง preview และ `-mx-4` ของ `DialogFooter` ฟอร์มจึงถูกวางกว้างเกินกรอบ แล้วโดน `overflow-x-hidden` ตัดทิ้งเงียบ ๆ
3. `md:` อิงความกว้าง**จอ** ไม่ใช่ความกว้าง container → สองคอลัมน์เปิดที่ 768px พอดีกับจังหวะที่ dialog มีที่ว่างต่อคอลัมน์น้อยที่สุด

**แก้:** ใช้ convention ที่ 4 dialog ในแอปนี้ใช้อยู่แล้ว — `w-full sm:max-w-Nxl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0` + header คงที่ + body `flex-1 overflow-y-auto` + footer เป็น div ธรรมดา เหตุผลเชิงโครงสร้างคือใน column flex ขนาดแนวนอนของ body ถูก stretch ให้เท่า container จึง**เป็นค่าที่แน่นอน** ไม่มีทางถูกคิดจาก content แบบ grid track และไม่ต้องใช้ `overflow-x-hidden` อีกเลย

**RQ4:** เปลี่ยน "Data Unavailable" 5 ช่องรวดเป็น **ช่องเดียว `colSpan={5}`** ที่บอกว่าต้องทำอะไร (`ยังไม่มีช่องเก็บ — สร้างช่องให้ rack นี้`) พร้อม tooltip ที่**ระบุชื่อเมนูและชื่อปุ่มจริง** ที่ผู้ใช้กดได้ · ไม่แตะการคำนวณใด ๆ

**Available vs Empty Slots — เลือก "ทำให้เหมือนกัน" ไม่ใช่ "แยกให้ต่าง"** เพราะ `api-warehouse.ts:90` ระบุสัญญาไว้ว่า `available = EMPTY` ทั้งคู่คือ slot สถานะ EMPTY ต่างกันแค่ขอบเขต (การ์ด = ทุกคลัง, คอลัมน์ = rack เดียว) การมีสองชื่อสำหรับของเดียวกันคือตัวปัญหา → เหลือชื่อเดียว แล้วให้ tooltip บอกขอบเขต · หลักฐานที่ยืนยันว่าคิดถูก: ภาษาไทยใช้ `ช่องว่าง` เหมือนกันทั้งสองที่อยู่แล้ว มีแต่ EN กับ ZH ที่หลุด

### ⚠️ ข้อค้นพบที่ยังไม่แก้ (บันทึกไว้ตัดสินใจ)

**1. `max-w-*` ไม่มี `sm:` ยังเหลืออีก 8 จุดทั่วแอป** — ผมตรวจ DialogContent ทุกตัวในแอปเองแล้ว ยืนยันว่าคำกล่าวอ้างของ P0-C ถูกต้อง: อีก 5 จุดที่เหลือ (`pick-location-dialog:188`, `products/page:136`, `link-slot-dialog:88`, `w3d-arrange:87`, `request-qr-dialog:70`) และ `business-partners` อีก 4 จุด **ไม่มี `overflow-y-auto` หรือ `max-h` บน DialogContent** จึงไม่เข้าสูตรการถูกตัดเนื้อหา

แต่ทุกจุดยัง**ฆ่า clamp `max-w-[calc(100%-2rem)]` เหมือนกัน** → บนมือถือ 360px dialog เหล่านี้ชิดขอบจอไม่มีระยะขอบ 16px เป็นอาการเบากว่าและเป็น bug ที่มีมาก่อนหน้านี้ ไม่ได้เกิดจากงานรอบนี้

**ไม่แก้ในรอบนี้** เพราะอยู่นอกขอบเขต RQ20 และกระจายอยู่ใน 8 หน้าจอที่ไม่เกี่ยวกับ requirement ชุดนี้ (business-partners, roles, planning ฯลฯ) ซึ่งแต่ละตัวต้องตรวจด้วยตาแยกกัน · วิธีแก้คือเติม `sm:` ตัวเดียวต่อจุด

**2. `WarehouseSummaryTable` ในไฟล์เดียวกันยังขึ้น "Data Unavailable"** — อยู่นอกขอบเขตที่ RQ4 ระบุ และตารางนั้นมีรายการ `Gaps` อธิบายอยู่ใต้ตารางอยู่แล้ว

### P0-A รอบสอง · ปิดช่อง product status — ✅ ผ่าน

Agent ลอกกติกาจาก `receiving.service.ts:198` มาใช้จริงตามสั่ง เปลี่ยนแค่คำกริยาเป็น `cannot be requested` · เพิ่ม helper `assertRequestableProducts()` เรียกเป็นคำสั่งแรกของ `create()` ก่อนเขียนอะไรทั้งสิ้น · **query เดียวต่อทั้งใบ dedupe แล้ว ไม่ใช่ N+1** · spec ใหม่ 6 tests

**สิ่งที่ agent ทำเกินบรีฟและผมรับไว้:** เพิ่มสาขา `!product` ด้วย เพราะ receiving มีคู่นี้เสมอ (`does not exist` / `cannot be received`) ถ้าไม่มี id ที่ไม่มีจริงจะหลุดไปโผล่เป็น FK error ของ Prisma แทนที่จะเป็น 400 ที่อ่านรู้เรื่อง — รับไว้เพราะดีกว่าเดิมชัดเจนและสอดคล้องกับบ้าน

**ข้อมูลสำคัญที่ agent ยืนยันให้:** `RequestsService.create()` เป็น**ที่เดียวในระบบ**ที่เขียนแถว `withdrawalRequest` / `withdrawalRequestItem` (grep ทั้ง `backend/src` ยกเว้น spec) → ไม่มีเส้นทางสร้างใบเบิกอื่นที่หลบ guard นี้ได้

### ❓ คำถามเชิงธุรกิจที่ต้องให้เจ้าของระบบตอบ (ไม่เดาแทน)

กรณี **สินค้าถูกยกเลิกหลังจากใบเบิกถูกสร้างไปแล้ว** — จะบล็อก เตือนแล้วปล่อย หรือปล่อยผ่าน? จุดที่กติกานี้จะไปลงตามลำดับที่ใบเบิกวิ่งผ่าน:

1. `requests.service.ts` `submit()` — ใบ DRAFT ที่สร้างตอนสินค้ายัง ACTIVE แล้วส่งหลังถูกยกเลิก **เป็นตัวตั้งที่ตัดสินข้ออื่น**
2. `requests.service.ts` `approve()` — จุดที่ stock ถูกจองจริงในโหมด legacy เป็นด่านสุดท้ายก่อนผูกของ (`bulkApprove()` เรียกตัวนี้ คำตอบเดียวครอบทั้งคู่)
3. `fulfillment/services/allocation.service.ts:174` — คู่แฝดของข้อ 2 เมื่อเปิด `isUnifiedReservationEnabled()` ถ้าตอบว่า "บล็อก" ที่ข้อ 2 จุดนี้ต้องทำเหมือนกัน ไม่งั้นกติกาจะมีผลเฉพาะตอนปิด flag

**จุดที่ agent โต้แย้งว่ากติกานี้ไม่ควรไปลง และผมเห็นด้วย:** `relocation` / `rtv` / `warranty` รับ `productId` โดยไม่เช็ค `isActive` ก็จริง แต่ทั้งหมดทำงานกับ**ของที่มีอยู่แล้วในคลัง** — ต้องย้าย ส่งคืน และเคลมประกันสินค้า end-of-life ได้ต่อไป ซึ่งคือความหมายของ DISCONTINUED ในสคีมานี้พอดี

---

## 7. ✅ P0 — ปิดเฟส (Quality Gate รวม รันโดย Main Agent)

| Gate | Baseline | หลัง P0 | ผล |
|---|---|---|---|
| Backend typecheck | 0 errors | 0 errors | ✅ |
| Backend tests | 49 suites / 774 | **54 suites / 817** | ✅ |
| Frontend typecheck | 0 errors | 0 errors | ✅ |
| i18n TH / ZH-CN | 3,379 · 100% | **3,396 · 100%** | ✅ |
| Production build | — | สำเร็จ 55 routes | ✅ |

**+5 suites · +43 tests · ไม่มีตัวแดง**

| RQ | สถานะ |
|---|---|
| RQ3 Warehouse Code Validation | ✅ ปิด (guard 12 ตัว ยืนยันว่าบังคับอยู่แล้ว 2 ชั้น) |
| RQ4 Rack detail สับสน | ✅ ปิด |
| RQ19 Batch Receiving | ✅ ปิดด้วยมติ C7 (guard 8 ตัว) |
| RQ20 Import dialog ล้นกรอบ | ✅ ปิด |
| RQ22 Brand = ACER | ✅ ปิด + ปิดช่อง productStatus ที่เจอระหว่างทาง |
| RQ23 My Issued Items ว่าง | ✅ ปิด |

### ⏳ Gate ที่ยังทำไม่ได้ในเฟสนี้

**UI / Browser QA** — หน้า Receiving และ Rack Details อยู่หลัง auth layout และต้องใช้ backend + DB จริง ตอนนี้ยังไม่ได้ตั้ง PGlite local จึงยังเปิดดูด้วยตาไม่ได้ ข้อสรุปเรื่อง responsive ของ P0-C ตั้งอยู่บนเหตุผลเชิง CSS และข้อเท็จจริงที่ว่าตอนนี้ใช้ container pattern เดียวกับ dialog อีก 4 ตัวที่ขึ้น production ไปแล้ว **ยังไม่ใช่ผลที่สังเกตเห็นจริง** → ยกไปทำรวดเดียวเมื่อตั้ง local DB ในเฟสที่ต้องแตะ schema

จุดที่ควรดูด้วยตาเป็นพิเศษ: ความกว้าง 360px และ zoom 150% โดยโหลดไฟล์ preview ไว้ด้วย เพราะตาราง preview คือตัวที่กว้างสุดและเป็นต้นเหตุเดิม

---

## 8. Phase P1 — Rack Lifecycle (กำลังดำเนินการ)

### ทำไมรอบนี้แบ่งงานต่างจาก P0

P0 แบ่งตามฟีเจอร์ได้เพราะแต่ละ RQ อยู่คนละไฟล์ แต่ P1 **ทั้ง 4 RQ ชนกันหมด** ที่ `warehouse-master.service.ts` และ `i18n/*/warehouseMaster.ts` จะแบ่งตามฟีเจอร์แล้วรันขนานไม่ได้เลย

วิธีแก้: แบ่งเป็น backend / frontend แล้ว **Main Agent กำหนด API contract ให้ล่วงหน้า** ทั้งสองตัวจึงเขียนไปพร้อมกันได้โดยไม่ต้องรอกันตกลง contract กลางทาง

| Agent | ไฟล์ที่เป็นเจ้าของ | RQ |
|---|---|---|
| **P1-A** Backend | `warehouse-master.{service,controller,dto}.ts` + spec ใหม่ | RQ5 lifecycle · RQ7 ล็อกขนาดตาม Rack Type |
| **P1-B** Frontend | `warehouse-master/{forms,rack-types-tab,structure-tree,rack-detail,warehouse-detail}.tsx` · `lib/api-warehouse.ts` · `i18n/*/warehouseMaster.ts` | RQ2 · RQ6 auto-name · UI ของ RQ5 · UI ของ RQ7 |

### API contract ที่กำหนดไว้ (ทั้งสอง agent ยึดตามนี้)
```
PATCH /warehouse-master/racks/:id/deactivate   -> rack row
PATCH /warehouse-master/racks/:id/activate     -> rack row
PATCH /warehouse-master/racks/:id/restore      -> rack row
PATCH /warehouse-master/warehouses/:id/restore -> warehouse row
DELETE /warehouse-master/racks/:id             -> { success, id, slotsDeleted }
409 = มี dependency ขวาง · 400 { code: 'RACK_SIZE_FROM_TYPE' } = กติกา RQ7
```

### โจทย์ยากที่สั่งให้ระวังเป็นพิเศษ

**การ restore ต้องไม่ปลุก slot ที่ถูกลบแยกไว้ก่อนหน้า** — ถ้า rack ถูกลบแล้วลบ slot ทีละตัวมาก่อน การ restore ต้องคืนเฉพาะ slot ที่ถูกลบพร้อม rack เท่านั้น ถ้าแยกไม่ได้อย่างเชื่อถือได้ สั่งให้หยุดแล้วรายงาน เพราะพลาดตรงนี้คือการปลุกตำแหน่งเก็บของผีขึ้นมาเงียบ ๆ

### P1-A · Backend · RQ5 + RQ7 — ✅ ผ่าน

**วิธีแก้โจทย์ slot ผี — กุญแจสองชั้นที่ต้องตรงกันทั้งคู่:**
1. `deleteRack` เขียนรายการ slot id ที่ cascade ลง audit entry ของตัวเอง → `restoreRack` อ่านกลับจาก entry ล่าสุด (รองรับวงจร delete → restore → delete)
2. `deletedAt` ของ slot ต้องตรงกับของ rack **ระดับมิลลิวินาที** เพราะเขียนด้วย `Date` object เดียวกันใน transaction เดียว

slot ที่ถูกลบแยกไว้ก่อนไม่เข้าเงื่อนไขทั้งสองข้อ และทุก failure mode (ไม่มี audit, detail พัง, `deletedAt` เป็น null) degrade ไปทาง "คืนแค่ rack" **ไม่เคย over-restore** · rack ที่ถูกลบก่อนการเปลี่ยนแปลงนี้ถูกต้องโดยอัตโนมัติ เพราะโค้ดเดิมไม่ยอมให้ลบ rack ที่มี slot อยู่แล้ว

**`rackImpact()` เป็นที่เดียวที่ตัดสินว่าอะไรขวางการลบ** — `deleteRack` เรียกตัวนี้ ไม่มีกติกาคู่ขนานอีกชุด

| ตัวขวาง | ขวางไหม |
|---|---|
| `slots` มี slot อยู่ | **ไม่** — นี่คือ bug เดิมที่แก้ |
| `stock` มีของอยู่ใน rack หรือใน slot ของมัน | ขวาง |
| `history` เคยมีของอ้างถึง | ขวาง |
| `openRelocations` ใบย้ายที่ยังไม่จบ | ขวาง |
| `layoutObjects` รูปบนผัง/3D | ไม่ — FK เป็น nullable |

**ผลที่ตามมาซึ่งต้องสื่อสารให้ผู้ใช้เข้าใจ:** ในคลังที่ใช้งานจริง rack ส่วนใหญ่จะมี `history` → **ลบไม่ได้โดยการออกแบบ** Delete กลายเป็นปุ่มสำหรับ rack ที่สร้างผิดเท่านั้น ส่วน rack ที่เคยใช้งานต้องใช้ Deactivate ซึ่งตรงกับถ้อยคำ requirement ที่ว่า "ป้องกันการลบ Rack ที่มี Stock หรือ Transaction"

**restore คืนของมาในสถานะ inactive** — เป็นการตัดสินใจที่ถูก การ restore ไม่ควรเอาตำแหน่งเก็บกลับเข้าระบบโดย admin ไม่ได้สั่ง UI ต้องมีสองขั้น

### 🚪 ประตูหลังที่ Main Agent ตรวจแล้วพบว่าเปิดอยู่จริง

Agent รายงานว่ามี rack CRUD เส้นเก่าที่ `warehouse.service.ts` และประเมินว่า *"worth a follow-up ticket"* — **ผมตรวจแล้วหนักกว่านั้น มันเปิดอยู่ในหน้าเว็บจริง**

- `frontend/src/lib/api.ts:384-386` ยังเปิด `/warehouse/racks` POST/PATCH/DELETE คู่ขนานกับเส้นใหม่ที่บรรทัด 420-422
- `frontend/src/components/warehouse-layout/control-center.tsx:277` **เรียกเส้นเก่าจริง** พร้อมส่ง `levels, columns` ตรง ๆ

→ ผู้ใช้ที่สร้าง rack จากหน้า Warehouse Layout จะข้ามกติกา RQ7 ทั้งหมด **RQ7 จึงยังไม่มีผลจริงจนกว่าจะปิดช่องนี้**

> 🔎 **บทเรียนของ Main Agent:** รอบแรกผมค้นด้วย glob `frontend/src/**/*.{ts,tsx}` ซึ่ง **brace ไม่ขยายตัว** ได้ผลว่า "ไม่มีใครเรียก" แล้วเกือบสรุปผิด ต้องค้นใหม่แยก glob ถึงเจอ — การค้นที่ได้ผลว่างไม่ได้แปลว่าไม่มี

**สั่งปิดที่ backend** เพราะเป็นชั้นที่ข้ามไม่ได้ และสั่งให้ทำเป็น **helper กลางตัวเดียว** ไม่ให้ก๊อปกติกาไปวางที่สอง เพราะการมีกติกาสองชุดที่ต้องตรงกันคือสาเหตุที่ bug ประเภทนี้เกิดตั้งแต่แรก · สั่งห้ามลบ endpoint เก่าทิ้ง เพราะการปลด public endpoint เป็นการตัดสินใจของเจ้าของระบบ

**ผลลัพธ์:** `backend/src/common/rack-size-rule.ts` ใหม่ · ลบสำเนาเดิมที่อยู่ใน `warehouse-master.service.ts` ทิ้ง เหลือกติกาชุดเดียวจริง ๆ · มี **anti-drift test** ที่ขับทั้งสอง service ให้ reject แล้วเทียบ response body ทั้งก้อนด้วย `toEqual` ถ้าใครทำสำเนาที่ต่างออกไปจะแดงทันที

**จุดที่เสี่ยงจริงกลับไม่ใช่ `POST`:** DTO เก่าไม่เคยประกาศ `rackTypeId` และ pipe เป็น `forbidNonWhitelisted` → ยิง `rackTypeId` เข้า `/warehouse/racks` ไม่ได้เลย ช่องจริงคือ **`PATCH /warehouse/racks/:id` บน rack ที่มี `rackTypeId` อยู่แล้ว** (เช่นของที่ setup wizard สร้าง) แล้วส่ง `levels`/`columns` — ตอนนี้ปิดแล้ว

ยืนยัน `control-center.tsx` ยังทำงานเหมือนเดิม: payload ไม่มี `rackTypeId` กติกาจึงไม่ทำงาน + มี test ตรึง payload ก้อนนั้นไว้โดยเฉพาะ

**ยังเปิดอยู่ให้เจ้าของระบบตัดสิน:** เส้นเก่ายังเข้าถึงได้จากภายนอก และเป็นเส้นเดียวที่**ไม่มี RQ5** (`deleteRack` ของมันยังแค่พลิก `isActive`, ปฏิเสธเมื่อมี stock, ไม่มี restore) จะปลดระวางหรือรวมเส้นเป็นการตัดสินใจของคุณ

**Gate:** 55 suites / **882 tests** · typecheck 0 · ไม่มี migration (`git diff -- backend/prisma/` ว่าง)

### P1-B · Frontend · RQ2 · RQ6 · UI ของ RQ5 และ RQ7 — ✅ ผ่าน

**RQ2 / RQ6 auto-name** — helper `suggestName()` ตัวเดียวใช้ร่วมกัน จัดการเคสข้อมูลจริงที่พัง: `HSNT_WHCM` + `HSNT_WHCM` → `HSNT_WHCM` ครั้งเดียว ไม่ใช่ซ้ำสองรอบ · เทียบแบบไม่สนตัวพิมพ์และตัวคั่น · ถ้าส่วนหนึ่งมีอีกส่วนอยู่แล้วใช้ตัวที่ยาวกว่า โดยมีเงื่อนไขว่าส่วนที่ถูกกลืนต้องยาว ≥ 3 ตัวอักษร กันไม่ให้ location ตัวอักษรเดียวหายไป

เป็น **คำแนะนำที่พิมพ์ทับได้ ไม่ใช่ช่องที่ถูกล็อก** · พอผู้ใช้พิมพ์เองครั้งแรก การ sync หยุดถาวร แล้วมีลิงก์ "ใช้ชื่อที่ระบบตั้งให้" ให้กลับไปได้ · **ทำงานเฉพาะโหมด create** เพราะชื่อของที่มีอยู่แล้วไปอยู่บนฉลาก รายงาน และ 3D view

**UI ของ RQ5** — ปุ่ม Deactivate / Activate พร้อมแยก "ปิดใช้งาน" กับ "ลบ" ให้เห็นชัด · รับคำเตือนของผมเรื่อง rack ที่เคยมีของลบไม่ได้ไปทำจริง: เมื่อเจอ 409 กล่องยืนยันจะ**เปลี่ยนปุ่มแดง Delete เป็นปุ่มเขียว Deactivate** ให้ทำต่อได้ตรงนั้น พร้อมแสดงข้อความ blocker ของ server ตรง ๆ ไม่แต่งเอง

**UI ของ RQ7** — เมื่อเลือก Rack Type แล้ว ช่องขนาดทั้งห้า**หายไปเลย ไม่ใช่ disabled** เพื่อไม่ให้มีใครพยายามคลิก แทนที่ด้วยแผงอ่านอย่างเดียวที่บอกว่าค่ามาจาก type ไหนและจะแก้ได้ที่ไหน · payload ตรงกับกติกา backend: มี type → ไม่ส่งห้าฟิลด์เลย, เคลียร์ type → ส่ง `rackTypeId: null` พร้อมขนาด ซึ่งกติกาอนุญาต

**Gate:** typecheck 0 · i18n **3,426 strings 100% ครบ 3 ภาษา** (+30: 28 key ใหม่ 2 key แก้ถ้อยคำ) · production build สำเร็จ 55 routes

### 🔧 Main Agent เก็บเอง

`app/(dashboard)/warehouse-master/page.tsx` ไม่ได้ส่ง `onRestored` ทำให้หลังกู้คืนต้อง `window.location.reload()` ซึ่ง**ทิ้งรายการที่เพิ่งลบไปทั้งหมด** (เพราะรายการนั้นเก็บใน session) → ใส่ `onRestored={load}` แล้ว typecheck ผ่าน

### 🔴 ช่องว่างที่ต้องปิดก่อนถือว่า RQ5 เสร็จ

**ลบ rack แล้ว refresh หน้า = กู้คืนจาก UI ไม่ได้อีกเลย**

P1-B ทำรายการ "ลบแล้ว" จากสองแหล่ง: แถวที่ API ส่งมาพร้อม `isDeleted` (ซึ่งตอนนี้ tree ไม่ส่ง) และ session store ที่จำเฉพาะสิ่งที่ลบหลังเปิดหน้า — agent เขียนบอกผู้ใช้ตรง ๆ ว่า *"ตรงนี้แสดงเฉพาะรายการที่ลบหลังเปิดหน้านี้เท่านั้น"* และ**ไม่ประดิษฐ์ endpoint เองเพราะไม่อยู่ใน contract** ซึ่งถูกต้องตามกติกา

แต่ **restore ที่หายไปเมื่อ refresh คือฟีเจอร์ครึ่งเดียว** RQ5 ขอ "รองรับ Deactivate / Restore" ไม่ใช่ "restore ได้ถ้ายังไม่ปิดหน้า" → **ต้องเพิ่ม endpoint อ่านรายการที่ถูก soft-delete** UI รองรับไว้แล้วโดยไม่ต้องแก้อะไรเพิ่ม

**คิวไว้ทำทันทีที่ P2-A ปล่อย `warehouse-master.service.ts` ว่าง** (ตอนนี้ P2-A ถืออยู่ จะสั่งแก้ซ้อนไม่ได้)

### ❓ คำถามที่ฝากเจ้าของระบบ

ชื่อ Rack Type ที่ระบบตั้งให้อัตโนมัติใช้ **ป้ายหมวดตามภาษาที่แอดมินใช้ตอนสร้าง** เช่นแอดมินไทยสร้างได้ชื่อไทย เป็น WYSIWYG และแก้ได้ แต่ถ้าต้องการให้ชื่อที่เก็บลง DB เป็นภาษาอังกฤษเสมอ บอกได้

---

## 9. Phase P2 — Units & Bulk Create

### P2-A · Backend · C3 + C4 + RQ26 — ✅ ผ่าน

**C3 auto-create Rack Type** — `setupRacks` รับได้ทั้ง `rackTypeId` แบบเดิม หรือ **ส่งขนาดมาแทน** แล้วระบบ `findFirst` หา type ที่ตรงทั้ง 7 ฟิลด์ก่อน เจอก็ใช้ตัวเดิม ไม่เจอค่อยสร้าง · **ตัวที่คนสร้างเองก็ถูกนำมาใช้ซ้ำด้วย** เพราะเครื่องหมาย `[auto]` ไม่ได้อยู่ในเงื่อนไขการจับคู่ · type ใหม่ถูกเขียนใน `$transaction` เดียวกับ rack ของมัน ล้มกลางทางจึงไม่เหลือ Rack Type กำพร้า

ทำเครื่องหมายด้วย prefix `[auto]` ใน `description` ซึ่งเป็นคอลัมน์ที่มีอยู่แล้ว → **ไม่ต้อง migration**

code ที่สร้าง: `RT-AUTO-250x100x400-L3C4` กันชนด้วยการอ่าน code ที่ขึ้นต้น `RT-AUTO-` ทั้งหมดมาเป็น `taken` set แบบ case-insensitive แล้วต่อท้าย `-2`, `-3` จนว่าง — ใช้รูปแบบเดียวกับที่ `setupRacks` ทำกับ rack code อยู่แล้ว

**C4 code pattern** — เก็บใน `Setting` ผ่าน `SettingDefinition` ตามระเบียบของบ้าน key `warehouse.rackCodePattern` · **ค่าตั้งต้น `zone-r01` และ fallback เป็นค่านี้เมื่อแถวหาย ปิดใช้งาน หรือค่าเพี้ยน** → ระบบที่ติดตั้งไปแล้วซึ่งไม่เคยมีแถวนี้ ทำงานเหมือนเดิมทุกประการ · ฉีด `SystemSettingsService` แบบ `@Optional()` เพื่อให้ spec เดิมที่ `new WarehouseMasterService(prisma)` ยังใช้ได้

**test ที่พิสูจน์ว่าไม่มีการเปลี่ยนชื่อ rack เดิม** ทำได้ดีกว่าที่ผมสั่ง: ตั้ง `rack.update` / `rack.updateMany` / `slot.update` / `slot.updateMany` ทั้งบน client และ tx ให้เป็น `jest.fn()` ที่ **throw ถ้าถูกเรียก** แล้วสลับ pattern ไปกลับ — ถ้ามีโค้ดไหนแอบเขียนทับ code เดิมจะระเบิดทันที ไม่ใช่แค่ assert ว่าผลลัพธ์ดูถูก

**RQ26** — `racks[]` ขยายเป็น `{ code, zone, lengthCm, widthCm, footprintM2 }` ต่อแถว พร้อม `rackFootprintM2` · ลบ helper `m2()` ที่เขียนไว้ในไฟล์ทิ้ง เปลี่ยนไปใช้ `footprintM2()` จาก `space-math.ts` ทุกจุด · มี test ยืนยันว่าผลรวมต่อแถวเท่ากับ `newFootprintM2`

**ไฟล์นอกรายการที่ agent แตะและรายงานตรง ๆ:** `settings/setting-definitions.ts` และ `settings/system-settings.service.ts` แบบเพิ่มอย่างเดียว เพราะเป็นระเบียบของบ้านในการเพิ่ม setting — รับไว้

**Gate:** 56 suites / **901 tests** · typecheck 0 · ไม่มี migration

**ข้อควรรู้:** `rackTypeId` + ฟิลด์ขนาดพร้อมกัน จะถูก **ปฏิเสธ ไม่ใช่เพิกเฉย** เพราะถ้าเพิกเฉย Rack Type จะชนะแล้วตัวเลขที่ผู้ใช้พิมพ์จะหายไปเงียบ ๆ · การจับคู่ขนาดใช้ float เท่ากันเป๊ะ ไม่มี tolerance (เลือกทางระมัดระวังไว้ก่อน)

### ✅ ปิดช่อง RQ5 · `GET /warehouse-master/deleted` — ผ่าน

restore ไม่หายเมื่อ refresh แล้ว **57 suites / 919 tests** · typecheck 0 · ไม่มี migration

**เคส rack ที่ถูกลบอยู่ในคลังที่ถูกลบ — เลือก "แสดงแล้วทำเครื่องหมาย" ไม่ใช่ "ซ่อน"** เหตุผลของ agent ที่ผมเห็นด้วย: ถ้าซ่อนจะกลายเป็น bug เดียวกับที่ endpoint นี้เกิดมาเพื่อแก้ คือลบคลังแล้ว rack หายไปจากสายตาถาวรทั้งที่แถวยังอยู่ใน DB ผู้ใช้จะไม่รู้ว่ากำลังจะได้อะไรกลับมาบ้าง และแยกคลังเปล่ากับคลังที่มี rack รออยู่ยี่สิบตัวไม่ออก · การทำเครื่องหมายยังทำให้รายการซื่อสัตย์กับ `restoreRack` ที่ 409 เคสนี้พอดี UI จึงปิดปุ่มพร้อมบอกเหตุผลได้ แทนที่จะเสนอปุ่มที่กดแล้วพังแน่นอน · มี test ยืนยันว่าทั้งสองฝั่งพูดตรงกัน

**ความซื่อสัตย์ของตัวเลข slot** — `slotsDeleted` ที่รายการสัญญา กับ slot ที่ `restoreRack` คืนจริง **ใช้ parser ตัวเดียวกัน** (`parseCascadedSlotIds`) จึงไม่มีทางแสดงตัวเลขที่ restore ทำไม่ได้ · batch ด้วย `auditLog.findMany` ครั้งเดียว ไม่ใช่ N+1

**test ที่ผมชอบ:** assert ว่าทุก `create`/`update`/`updateMany`/`createMany`/`delete`/`deleteMany`/`upsert` ของ**ทุก model** ไม่ถูกเรียกเลย รวม `$transaction` และ `auditLog.create` — พิสูจน์ว่าเป็น read-only จริง ไม่ใช่แค่ตั้งใจให้เป็น

**หมายเหตุ:** รายการ `warehouses` จะว่างเสมอในทางปฏิบัติ เพราะระบบ**ยังไม่มีทางลบ warehouse เลย** (ตรงกับที่วิเคราะห์ไว้ใน RQ3) endpoint รองรับไว้แล้วสำหรับวันที่มี

---

## 10. 🧪 Local Database + Browser QA (Main Agent ทำเอง)

### ตั้ง PGlite เป็น Postgres ท้องถิ่น — สำเร็จ

เครื่องนี้ไม่มี Docker และต่อ Supabase ไม่ได้ จึงใช้ PGlite ผ่าน socket server ที่ `127.0.0.1:5433` ซึ่งพูด wire protocol จริง Prisma จึงคุยด้วยเหมือน Postgres ปกติ · สคริปต์อยู่ใน scratchpad ไม่ปนกับโปรเจกต์

ข้อควรรู้: **PGlite รับได้ทีละ 1 connection** ต้อง preload `pool1.cjs` ที่ครอบ `pg.Pool` ให้ `max: 1` ไม่งั้น connection ที่สองค้างและแอปดูเหมือนแฮงก์แทนที่จะ error

**ยืนยันความปลอดภัยก่อน `prisma db push` ทุกครั้ง** — ตรวจว่า `DATABASE_URL` / `DIRECT_URL` ไม่มี host ของ supabase หรือ pooler (รอบแรกผม `grep -ci supabase` แล้วได้ 1 ซึ่งคือคอมเมนต์เตือนที่ผมเขียนเองในไฟล์ ไม่ใช่ URL — ต้อง grep เฉพาะบรรทัด URL ถึงจะเชื่อได้)

สถานะ: schema push ลง local สำเร็จ · seed ครบ 3 ชุด (base + rbac + demo: 100 products / 149 stock / 50 receiving / 30 requests / 24 tasks / 20 shipments) · backend ขึ้นที่ port 3001 ตอบ `{"status":"ok","database":"up"}`

### ✅ Integration suite — รันได้เป็นครั้งแรก

```
Test Suites: 20 passed, 20 total
Tests:       227 passed, 227 total
Time:        378 s
```

ชุดนี้**ไม่เคยถูกรันเลยในโปรเจกต์นี้** เพราะต้องมี Postgres จริง และ `jest.config` หลักตั้ง `rootDir: src` จึงไม่รวมไว้ใน `npm test` ปกติ

ผลสำคัญ: ยืนยันว่าการแก้ `phase5-returns.int-spec.ts` ของผมตอน P0 (envelope ของ RQ23) **ถูกต้องจริง** ซึ่งเป็นจุดที่ gate ทั้ง 4 ตัวมองไม่เห็นมาตลอด

**รวมการทดสอบตอนนี้: unit 919 + integration 227 = 1,146 tests**

### ✅ RQ20 — ยืนยันด้วยตัวเลขจริง 3 ความกว้าง

| viewport | dialog | ระยะขอบ ซ้าย/ขวา | ล้นแนวนอน | control ที่โดนตัด | คอลัมน์ |
|---|---|---|---|---|---|
| 375 (มือถือ) | 330 | 23 / 22 | ไม่ | ไม่มี | 1 |
| 723 | 723 | 0 / 0 | ไม่ | ไม่มี | 1 |
| 1280 | 768 (cap) | 256 / 256 | ไม่ | ไม่มี | **2** |

**AWB และ RMA Reference No ซึ่งเป็นสองฟิลด์ที่โดนตัดในภาพ bug เดิม แสดงครบทุกความกว้าง** · header คงที่ body เลื่อน footer ติดล่าง

ข้อสังเกตเล็ก: ที่ viewport 640–768px dialog ชิดขอบจอไม่มีระยะขอบ (เพราะ `sm:max-w-3xl` = 768 กว้างกว่าจอ) **ไม่มีอะไรโดนตัด** เป็นเรื่องความสวยงามเท่านั้น

### ✅ RQ4 — ยืนยันด้วยข้อมูลจริง

ตาราง Rack Details ของ DEMO-WH1 แสดงจริงว่า:
- `Rack Size` → `Not entered` (เดิม "Data Unavailable")
- ช่องพื้นที่/utilization 5 ช่อง → **รวมเป็นช่องเดียว** `No rack size yet — enter its length and width`
- หัวคอลัมน์ → `Empty Slots` ตามที่ตกลง

### 🔴 สิ่งที่เห็นเฉพาะตอนดูของจริง (test มองไม่เห็น)

**1. "Data Unavailable" ยังเหลืออีก 8 จุดบนหน้าจอเดียวกัน** — อยู่ในการ์ดด้านบน (Warehouse Floor Space, Rack Storage Space) และ **Warehouse Summary table ซึ่งแสดง 7 ช่องต่อแถว** นี่คือสิ่งแรกที่ผู้ใช้เห็นเมื่อเปิดหน้านี้ ส่วน Rack Details ที่แก้ไปแล้วต้องคลิกเข้าไปอีกชั้น

P0-C ระบุไว้ตรง ๆ ว่า `WarehouseSummaryTable` อยู่นอกขอบเขตที่ RQ4 เขียน ซึ่งถูกต้องตามตัวหนังสือ **แต่ความสับสนที่ผู้ใช้บ่นอยู่บนหน้าจอนี้ และจุดที่หนักที่สุดยังไม่ได้แก้**

น่าสนใจคือ **แอปมีรูปแบบที่ดีกว่าอยู่แล้วในหน้าเดียวกัน** — Planning View ใช้ `—` พร้อมบรรทัด "No warehouse size entered" ใต้ตัวเลข ซึ่งอ่านรู้เรื่องกว่า "Data Unavailable" มาก เพียงแต่ตารางสรุปไม่ได้ใช้

→ **ไม่แก้เองเพราะอยู่นอกขอบเขต RQ4** รายงานไว้ให้ตัดสิน งานเล็กถ้าสั่ง

**2. `Capacity Used` แสดง `1,961.9%`** — "412 units in 21 slot capacity" เป็นผลจาก demo seed ที่ใส่ของมากกว่าความจุ slot ที่สร้างไว้ แต่ UI ก็ยังเรนเดอร์เป็น KPI ตรง ๆ โดยไม่มีการเตือนหรือ cap ตัวเลขเปอร์เซ็นต์เกิน 1900% ที่โผล่เป็น KPI ไม่ช่วยใครตัดสินใจ ควรมีเพดานหรือข้อความแทน · ไม่ใช่ของที่งานรอบนี้ทำพัง แต่เห็นเพราะได้ดูของจริง

---

### P2-B · Frontend · RQ1 + RQ25 + RQ26 UI — ✅ ผ่าน (เสร็จครบก่อนคำสั่งหยุด)

**RQ1** — `lib/length.ts` + `components/ui/length-input.tsx` เป็นตัวแปลงหน่วยตัวเดียวของทั้งแอป

เก็บ cm ทศนิยม 2 ตำแหน่ง แล้วให้แต่ละหน่วยแสดงจำนวนทศนิยมที่พอดีจะไม่สูญข้อมูล (m→4, cm→2, mm→1) ทำให้ `toCm(fromCm(cm,u),u) === cm` ทุกค่า · **ปัดเศษผ่าน exponent (`Number(\`${v}e2\`)`) ไม่ใช่ `Math.round(v*100)/100`** เพราะแบบหลังมี IEEE-754 noise (`12.3456 * 100` ได้ `1234.5600000000002`) — agent ไม่ลอกความแม่นยำของโค้ดเดิมมาดื้อ ๆ ซึ่งถูกต้อง

`<LengthInput>` **emit เฉพาะตอนพิมพ์** การสลับหน่วยดูจะคำนวณข้อความใหม่จาก cm ที่เก็บไว้โดยไม่เรียก `onChange` เลย → **การมองค่าในอีกหน่วยไม่มีทางเขียนทับค่าเดิม** ซึ่งปิดความเสี่ยงเดียวที่เหลือของการปัดเศษ

จำหน่วยที่เลือกผ่าน `localStorage` ด้วย `useSyncExternalStore` + server snapshot จึงไม่มี hydration mismatch · ทุก read/write อยู่ใน `try/catch`

**ลบตัวแปลงส่วนตัวทิ้งทั้ง 2 ชุด** (`forms.tsx` และสำเนาใน `setup-wizard.tsx`) พร้อม grep ยืนยันว่าไม่เหลือที่อื่น

**RQ25 UI** — step 2 เป็นการ์ด 2 ใบที่เลือกได้อย่างเดียว และ **ส่งทั้งสองอย่างพร้อมกันไม่ได้ในระดับ type** (`SetupRacksBody` เป็น discriminated union) 400 ของ server จึงเข้าไม่ถึงจาก UI · ค่าตั้งต้นเป็นโหมดขนาดเมื่อไม่มี Rack Type ที่ใช้งานอยู่ → **ทางตันเดิม ("ไปสร้าง Rack Type ก่อน") กลายเป็นทางที่เดินได้**

มีแบนเนอร์เตือนก่อนกด Create เมื่อ `willBeCreated` และบรรทัดเงียบกว่าเมื่อระบบใช้ type ที่ wizard เคยสร้างไว้ซ้ำ

**RQ26 UI** — ตาราง Rack code / Length / Width / Floor area + แถว Total ที่ใช้ `newFootprintM2` ของ server เอง ตัวเลขจึงตรงกับสรุปด้านล่างเสมอ · รันใหญ่แสดง 20 แถวแรกแล้วยุบที่เหลือเป็นบรรทัดเดียวพร้อมพื้นที่รวม

ใส่ข้อความเตือนตามที่สั่ง: **"พื้นที่นี้นับเฉพาะตัว rack ไม่รวมทางเดิน พื้นที่ทำงาน และระยะเผื่อ พื้นที่คลังที่ต้องใช้จริงมากกว่านี้"**

**ยืนยันกับแอปจริง** — สลับหน่วยแล้ว 250/100/200 cm แสดงเป็น 2.5 / 1 / 2 m · wizard เดินถึง step 4 โหมดขนาดเห็นแบนเนอร์ ตาราง 4 racks × 2.5 m² Total 10 m² ตรงกับ `newFootprintM2` · ใช้แต่ `preview: true` และกดยกเลิกทุกครั้ง ไม่เขียนอะไรลง DB

**Gate (Main Agent รันยืนยันเอง):** typecheck 0 · i18n **3,443** · build 55 routes

**ไฟล์นอกรายการที่แตะและรายงานตรง ๆ:** `i18n/*/space.ts` 2 string ต่อภาษา เพราะมี "(cm)" ฝังอยู่ในป้ายของช่องที่ตอนนี้ตามหน่วยผู้ใช้แล้ว — รับไว้

**สิ่งที่เจอเพราะได้รันแอปจริง:** `wizard.sizeHint` เขียนว่า "in metres" และ `form.slotTooSmall` กับ `form.warn.*` ทั้ง 5 ตัวเขียนว่า "Check the size is in cm/metres" ซึ่งผิดทันทีที่หน่วยเปลี่ยนได้ → แก้เป็นข้อความที่ไม่ผูกกับหน่วยแล้ว **ควร grep หาข้อความลักษณะนี้เพิ่มตอนแปลงช่องที่เหลือ**

**CSV export จงใจคงเป็น cm** (`Pallet L x W cm`, `L cm` ฯลฯ) เพราะหัวตารางส่งออกเป็นของที่เครื่องอ่าน ไม่ควรตามค่าที่ผู้ใช้เลือกดู — การตัดสินใจนี้ถูกต้อง

### ✅ ต่อ UI รายการ "ลบแล้ว" — ผ่าน · **P2 ปิดเฟส**

ลบ session store (`deletedBin`) และข้อความ "แสดงเฉพาะรายการที่ลบหลังเปิดหน้านี้" ทิ้งทั้งคู่ เพราะทั้งสองอย่างมีอยู่เพราะตอนนั้นยังไม่มี endpoint เท่านั้น · ตอนนี้อ่านจาก server จริง **restore ไม่หายเมื่อ refresh แล้ว**

`canRestore: false` แสดงเป็น**ปุ่มที่กดไม่ได้พร้อมเหตุผล** ไม่ใช่ปุ่มที่กดแล้ว 409 แน่นอน · แปลเฉพาะ code ที่ contract ระบุ (`WAREHOUSE_DELETED`) ส่วน code อื่นในอนาคตแสดงข้อความจาก server ตรง ๆ ไม่กลืนหาย

**แก้ถ้อยคำที่เคยโกหก:** `tree.deletedTitle` เดิมเขียนว่า "ลบแล้ว — {count} กู้คืนได้" ซึ่งไม่จริงตั้งแต่มี `canRestore: false` → เปลี่ยนเป็น "ลบแล้ว — {count}" แล้วย้ายจำนวนที่กู้คืนได้จริงไปบรรทัดใหม่ที่ใช้ `totals.restorable` จาก server

**ไฟล์นอกรายการที่ agent แตะและรายงาน:** `forms.tsx` — ลบการเรียก `deletedBin.add()` ออก ถ้าไม่ลบ build พัง รับไว้ · Main Agent แก้คอมเมนต์ที่ตัวเองเขียนไว้ใน `warehouse-master/page.tsx` ซึ่งอ้างถึง session store ที่ไม่มีแล้ว

**Gate (Main Agent รันยืนยันเอง):** typecheck 0 · i18n **3,448** · build 55 routes

---

## ✅ P2 — ปิดเฟส

| Gate | ผล |
|---|---|
| Backend tests | ✅ 57 suites / 919 tests |
| Backend integration | ✅ 20 suites / 227 tests |
| Backend / Frontend typecheck | ✅ 0 errors |
| i18n TH / ZH-CN | ✅ 3,448 · 100% |
| Production build | ✅ 55 routes |
| **Migration** | **ยังไม่มีเลย** |

**RQ ที่ปิดแล้วรวม 13 จาก 27:** RQ1, 2, 3, 4, 5, 6, 7, 19, 20, 22, 23, 25, 26

---

## 11. Phase P3 — Layout 2D (กำลังดำเนินการ)

| Agent | ขอบเขต | RQ |
|---|---|---|
| **P3-A** Backend | `warehouse-layout/**` · `warehouse-master/floor-geometry.ts` · schema enum · migration | RQ8 DOOR · RQ10 overlap/boundary · RQ27 auto-place |
| **P3-B** Frontend | `warehouse-layout/{layout-canvas,layout-toolbar,property-panel,use-layout-editor,floor-geometry}` · i18n | RQ9 grid/snap/rotation · RQ12 measure+scale · RQ11 UI |

แบ่งแบบนี้เพราะ RQ9/RQ12/RQ11-UI **ไม่ต้องรอ contract จาก backend** จึงเริ่มขนานได้ทันที ส่วน RQ10/RQ27 ฝั่ง UI ต้องรอ P3-A ให้ contract ก่อน

### ⚠️ migration ตัวแรกของโปรเจกต์

RQ8 ต้องเพิ่ม `DOOR` เข้า enum `LayoutObjectType` — สั่งให้ **เขียนไฟล์ migration แต่ห้ามรันกับ database ใด ๆ รวมทั้ง local** เพราะ `ALTER TYPE ... ADD VALUE` ของ Postgres มีข้อจำกัดเรื่อง transaction ที่ต้องอธิบายให้ชัด และต้องรันซ้ำได้โดยไม่พัง

### P3-A · Backend · RQ8 + RQ10 + RQ27 — ✅ ผ่าน

**Gate:** 59 suites / **972 tests** (+53) · typecheck 0

#### 🗄️ Migration ตัวแรกของโปรเจกต์ — `database/schema/37_layout_object_door.sql`

```sql
ALTER TYPE "LayoutObjectType" ADD VALUE IF NOT EXISTS 'DOOR';
```

**เขียนแล้วแต่ยังไม่รันกับ database ใด ๆ** ตามที่สั่ง · idempotent ด้วย `IF NOT EXISTS` · additive ล้วน ไม่แตะตาราง คอลัมน์ constraint หรือแถวใด

**3 เรื่องที่คนรัน migration ต้องรู้ (เขียนไว้ในหัวไฟล์แล้ว):**

1. **ไม่มี `BEGIN`/`COMMIT` โดยตั้งใจ** ต่างจากทุกไฟล์ในโฟลเดอร์นี้ เพราะ `ALTER TYPE ... ADD VALUE` รันใน transaction block ไม่ได้บน PG ≤ 11 และบน PG 12+ ก็ยังใช้ label ใหม่ใน transaction เดียวกันไม่ได้ · คำสั่งเดี่ยวเป็น atomic อยู่แล้วจึงไม่มีอะไรต้อง rollback — **ห้ามเอาไปครอบ transaction หรือรวมกับ migration ที่มี**
2. **ลำดับ: รัน migration ก่อน deploy API** การเพิ่ม label ที่ API เก่าไม่เคยส่งไม่เป็นอันตราย แต่ deploy ก่อนจะพังทันทีเพราะ API จะส่ง label ที่ DB ไม่รู้จัก
3. **ย้อนกลับไม่ได้ในที่** Postgres ลบ enum label ไม่ได้ ถ้าจะยกเลิกต้องสร้าง type ใหม่และเขียนทั้งตาราง `LayoutObject` ใหม่ → **ไม่มี rollback script โดยตั้งใจ** ถ้าเลิก Phase 3 ให้ปล่อย label ที่ไม่ได้ใช้ทิ้งไว้

#### การแยก "บรรจุกันปกติ" ออกจาก "ชนกัน"

แบ่ง object type เป็น 3 บทบาท: **SOLID** (RACK/SHELF/BIN) · **KEEP_CLEAR** (AISLE/DOOR) · **AREA** (ZONE และพื้นที่อื่น ๆ)

- รายงานว่าชนกัน**เฉพาะ SOLID × SOLID** เท่านั้น → ผังที่วาดปกติจะได้คำเตือน **ศูนย์รายการ**
- การบรรจุที่ถูกต้อง: RACK มี SHELF/BIN ได้ · SHELF มี BIN ได้ · AREA มีอะไรก็ได้ → **แต่ rack ซ้อน rack ยังถูกรายงาน** และ bin ที่วาดคร่อม rack อื่นก็ถูกรายงาน
- ยอมรับว่าบรรจุก็ต่อเมื่อ**อยู่ข้างในจริง ๆ** (`rectInPolygon` กับมุมที่หมุนแล้ว) — bin ที่โผล่ครึ่งหนึ่งออกนอก rack ยังนับว่าชน ซึ่งเป็นจุดเสี่ยงหลักของทั้ง false positive และ false negative
- คู่ที่ผูกกันด้วย `parentObjectId` ไม่นับว่าชนเลย เพราะเป็นการที่ผู้ใช้บอกเองว่า "อันนี้อยู่ในนั้น"
- **walkway zone เป็น opt-in ผ่าน metadata `{"walkway": true}`** agent **ไม่เดาจากชื่อ object** ซึ่งถูกต้อง — การเดาว่า "Zone W" คือทางเดินคือการประดิษฐ์กติกาที่ไม่มีใครสั่ง

ทุกปัญหามี `severity: 'WARNING'` และ **ไม่มีอะไรในเส้นทาง save เรียกใช้เลย** — `problems()` เป็น GET แยก ผังที่ยังไม่เรียบร้อยจึงบันทึกได้เสมอตามมติ C5

#### 🔍 การค้นพบที่สำคัญ — `floor-geometry.ts` เป็นไฟล์กระจก

agent **ไม่แก้** `backend/src/warehouse-master/floor-geometry.ts` ตามที่ผมสั่ง และให้เหตุผลที่ถูกต้องกว่าคำสั่งของผม: `floor-geometry.spec.ts:195` มี test ที่ assert ว่าไฟล์นี้**เหมือนกันทุกไบต์**กับ `frontend/src/components/warehouse-layout/floor-geometry.ts` (normalise CRLF ก่อนเทียบ) การแก้ฝั่งเดียวจะทำให้ test แดงทันที

> ⚠️ **ข้อผิดพลาดของ Main Agent:** ผมให้ P3-B เป็นเจ้าของไฟล์ฝั่ง frontend และบอกให้แก้ได้ ซึ่งจะทำให้ backend suite พัง → ส่งข้อความแจ้ง P3-B ทันทีให้ถือว่าไฟล์นั้น read-only และถ้าต้องการ helper ใหม่ให้สร้างโมดูลใหม่แยก

agent แก้ด้วยการสร้าง `backend/src/warehouse-layout/layout-geometry.ts` ที่ **import ของเดิมมาใช้** (`rectsOverlap`, `rectInPolygon`, `rectCorners`, `bbox`, `outlineOf`) ไม่ก๊อปกติกา → 2D plan, 3D arrange และ frontend ตัดสินการชนกันด้วยโค้ดชุดเดียวกันทั้งหมด

มี test ครอบการหมุนโดยเฉพาะ: สี่เหลี่ยมคู่เดิมชนกันที่ 0° แต่ไม่ชนที่ 45° ทั้งที่ bounding box ยังทับกัน — พิสูจน์ว่าถ้าเทียบ x/y/width/height ดิบ ๆ จะได้คำตอบผิด

#### การพิสูจน์มติ C5 (ห้ามเขียน inventory)

mock ของ Prisma ให้ `Warehouse` / `Rack` / `Slot` / `StockItem` มีแต่เมธอดอ่าน ส่วน `create`/`createMany`/`update`/`updateMany`/`upsert`/`delete`/`deleteMany` **ทั้ง 32 ตัว เป็น spy ที่ throw พร้อมข้อความ `"C5 violation: the layout must never write <model>"`** → ถ้าอนาคตมีใครเผลอเขียน จะได้ error ที่ระบุชื่อ model และเมธอดตรง ๆ ไม่ใช่แค่ assert ว่าผลลัพธ์ดูถูก

#### API contract สำหรับฝั่ง frontend

- `GET /warehouse-layout/:warehouseId/problems` → `{ warehouseId, layoutId, floor { source: OUTLINE|CANVAS|NONE, points }, counts, problems[] }` · `problems[].kind` = `OUT_OF_BOUNDS | OVERLAP | BLOCKS_AISLE | BLOCKS_DOOR | BLOCKS_WALKWAY` · `severity` เป็น `WARNING` เสมอ · `points` เป็นหน่วย grid ใช้กับพิกัดของ editor ได้ตรง ๆ
- `POST /warehouse-layout/:warehouseId/place-racks` → body `{ version?, rackIds?, gap?, metersPerUnit?, dryRun? }` · response `{ dryRun, layout, objects[], placed[], skipped[] }` · `skipped[].reason` = `ALREADY_DRAWN | NO_SIZE | NO_ROOM` · **ไม่มีการวางซ้อนเงียบ ๆ ไม่มีที่ว่างคือ `NO_ROOM`** · มี test ยืนยันว่าเรียก `problems()` หลังวางเสร็จต้องได้รายการว่าง

### ❓ เรื่องที่ต้องให้เจ้าของระบบตัดสิน (เพิ่มใหม่)

**rack ที่ระบบวางให้อัตโนมัติถูกติดป้าย `{"source":"auto-place"}` และปุ่ม "Back to auto layout" เดิมจะไม่ลบมันออก** (ปุ่มนั้นลบเฉพาะ `source: "3d"`) เป็นทางเลือกที่ระมัดระวังไว้ก่อน แต่แปลว่าผู้ใช้ที่กดวางอัตโนมัติแล้วไม่พอใจ จะย้อนกลับด้วยปุ่มเดียวไม่ได้ ต้องลบทีละตัว — จะให้ปุ่มนั้นลบของ auto-place ด้วยไหม

### P3-B · Frontend · RQ9 + RQ12 + RQ11 UI — ✅ ผ่าน

**Gate:** typecheck 0 · i18n **3,484** (+36) · build 55 routes

**RQ9 grid 10 cm** — เปิดที่ `pxPerUnit >= 70` โดย**ใช้หลักการเดียวกับของเดิม**: ชั้น grid จะถูกวาดเมื่อช่องของมันกว้างอย่างน้อย 7 px บนจอ (ยกค่า 7 เดิมออกมาเป็นค่าคงที่ `GRID_REVEAL_PX`) → ที่ 70 px/m ช่อง 10 cm อ่านง่ายพอ ๆ กับช่อง 1 m ที่เกณฑ์เดิม จึงไม่มีทางรกตอนซูมปกติ · เป็น `<pattern>` ซ้อนใน pattern เดิม ต้นทุนคือ fill เพิ่มหนึ่งชั้น ไม่ใช่ node ต่อช่อง

**snap 0.1 m** — ใช้ `Math.round(n*10)/10` ไม่ใช่ `n/0.1` เพื่อเลี่ยง `3.3000000000000003` · ตรวจ call site ของ `snapVal` ทั้งสองสาขาก่อนแก้

**`MIN_SIZE` 0.5 → 0.1** เหตุผลที่ดี: ถ้า snap ละเอียด 10 cm แต่ขนาดเล็กสุดเป็น 50 cm จะ snap ไปที่ 0.1 ได้แต่ *เป็น* 0.1 ไม่ได้ ซึ่งขัดกันเอง · หนึ่ง snap step คือพื้นที่ที่เป็นธรรมชาติ และ 10 cm คือขนาดที่ถูกต้องสำหรับบานประตูหรือเสา

**rotation** — ยืนยันว่า renderer กับ `floor-geometry` ใช้ convention เดียวกันจริง (บวก = ตามเข็ม รอบจุดกึ่งกลางของตัวเอง) โดยไล่คณิตศาสตร์ให้ดู ไม่ใช่เดา · **ข้อควรระวังที่รายงานไว้:** `scene-geometry.ts:564` เพิ่ม −90° ให้ rack ที่ linked เมื่อ `height > width` การหมุน rack 90° โดยไม่สลับ width/height จะทำให้แกนยาวใน 3D พลิกสองครั้ง — ไม่แตะเพราะเป็นเรขาคณิต 3D นอกขอบเขตและเป็นการตัดสินใจเชิงธุรกิจ

**เครื่องมือวัดระยะ** — แก้ปัญหาการชนกับการลาก/วาดด้วยวิธีที่สะอาด: วาง `<rect>` โปร่งใสเต็ม viewBox เป็นลูกตัวสุดท้ายของ SVG ขณะเปิดไม้บรรทัด คลิกจึง**ไปไม่ถึง object ในทางกายภาพ** ไม่ต้องให้โค้ดระดับ object รู้จักไม้บรรทัดเลย (`layout-object.tsx` ไม่ถูกแตะ) · เข้า/ออกด้วยปุ่ม, M, หรือ Esc · ใช้ได้ทั้งโหมดอ่านอย่างเดียวและโหมดแก้ไข

**scale bar** — คำนวณใหม่จาก `pxPerUnit` ทุกครั้งที่ render จึงถูกต้องทุกระดับซูม · **แสดงอัตราส่วนจริง ไม่ปัดให้สวย** เพราะบนจอที่ซูมได้ อัตราส่วนที่ปัดแล้วคือตัวเลขที่ผิด

**RQ11 (มติ C5)** — `/occupancy` คืนเฉพาะ object ที่ผูกกับ slot ดังนั้น RACK จึงไม่มีแถวของตัวเอง → canvas **ไล่รวมขึ้นตามสาย `parentObjectId`** (มี cycle guard) เพื่อให้ rack แสดงยอดรวมของตัวเองได้ · **ไม่มีการเพิ่ม guard ห้ามลาก** ตามมติ C5

ย้าย save confirmation ออกจาก toolbar เป็น `SaveDrawingDialog` เพื่อให้ **Ctrl+S ผ่านข้อความเดียวกัน** (เดิม Ctrl+S เรียก `save()` ตรง ๆ แบบเงียบ ๆ) ข้อความไทย: *"การบันทึกนี้บันทึกเฉพาะแบบวาด ไม่มีการย้ายสินค้า และไม่มีตัวเลขสต็อกใดเปลี่ยน"* พร้อมนับจำนวน object ที่แก้ซึ่งมีของอยู่ และลิงก์ไปหน้าย้ายตำแหน่งจัดเก็บจริง

### 🔴 ช่องโหว่ที่ทำให้ RQ8 ยังไม่เสร็จจริง

`DOOR` มีใน enum ของ backend และใน migration แล้ว **แต่ฝั่ง frontend วาดไม่ได้เลย** — Main Agent ตรวจยืนยันแล้ว:

| จุด | ปัญหา |
|---|---|
| `lib/api.ts:431-434` | union `LayoutObjectType` มี 12 ตัว **ไม่มี `DOOR`** |
| `layout-object.tsx` STYLES | key ตาม union นั้น จึงไม่มีสไตล์ของประตู |
| `layout-toolbar.tsx:27` | ไม่มีในพาเลตต์ |
| `property-panel.tsx:16` | ไม่มีใน dropdown |
| `floor-plan.tsx:43,104` | ไม่มีขนาดตั้งต้นและไม่อยู่ในกลุ่มของพาเลตต์ |

P3-B ไม่แก้เพราะไฟล์เหล่านี้อยู่นอกขอบเขตที่ได้รับ ซึ่งถูกต้องตามกติกา → **สั่งรอบใหม่ (P3-C)** รวมกับงาน UI ที่เหลือของ RQ10 และ RQ27 เป็นรอบเดียว

สั่งให้ **ยึดแนวของ AISLE ไม่ใช่แนวของ area** เพราะใน backend geometry ทั้ง `DOOR` และ `AISLE` เป็น KEEP_CLEAR ส่วน ZONE กับ `*_AREA` เป็น region · และถ้า AISLE จงใจไม่อยู่ในแมปไหน DOOR ก็ไม่ควรอยู่ ให้รายงานแทนการใส่ทุกที่แบบกลไก

### P3-C · Frontend · DOOR + UI ของ RQ10/RQ27 — ✅ ผ่าน

`DOOR` เพิ่มครบ 5 จุด คือ**ที่เดียวกับที่ AISLE อยู่** ตามที่สั่ง: union ใน `api.ts` (ต่อท้ายสุด ให้ตรงลำดับ enum จริงของ Postgres) · `STYLES` · พาเลตต์ (ต่อจาก Aisle) · dropdown ใน property panel · `DEFAULT_SIZE.DOOR = [1.2, 0.3]`

**ไม่ใส่ใน `scene-3d.tsx` / `scene-geometry.ts` / `warehouse-3d.tsx` เพราะ AISLE ก็ไม่อยู่ที่นั่น** — 3D สร้างฉากจาก Rack/Slot ไม่ได้อ่าน plan object การใส่ DOOR เข้าไปจะเป็นการประดิษฐ์เรขาคณิต 3D ให้กับสิ่งที่ 3D ไม่ได้ใช้ · เป็นการตัดสินใจที่ถูกและรายงานมาพร้อมเหตุผล

**สัญลักษณ์ประตู** วาดแบบสถาปนิก: บานที่เปิดอยู่ + arc เส้นประที่บานกวาด · `pointerEvents="none"` จึงไม่ขยายพื้นที่คลิกและไม่กวนการลาก · อยู่ใน `<g>` ของการหมุน ประตูหมุนแล้ว arc หมุนตาม

**RQ10 UI** — ปุ่ม "Check the plan" ที่หัวหน้าจอ เปลี่ยนเป็นสีเหลืองอำพันพร้อม badge นับเมื่อมีปัญหา · **เหลืองไม่ใช่แดง เพราะเป็นคำเตือน** · คลิกปัญหาแล้วไปที่วัตถุได้ (เพิ่ม prop `focus` ที่ canvas พร้อม `nonce` เพื่อให้คลิกซ้ำแล้วเลื่อนกลับไปได้อีก) · **แปลตาม `kind` ใช้ข้อความอังกฤษของ server เฉพาะ kind ที่ build นี้ไม่รู้จัก**

**RQ27 UI** — รัน dry run ทุกครั้งที่เปิดกล่อง ไม่เขียนอะไรจนกว่าจะกดยืนยัน · ปิดปุ่มเมื่อมีงานที่ยังไม่บันทึก เพราะ response แทนที่รายการ object ทั้งก้อน · แจ้งตรง ๆ ว่า **ไม่มีปุ่มย้อนกลับในคลิกเดียว**

**Gate (Main Agent รันยืนยันเอง):** backend 59 suites / 972 tests · typecheck 0 ทั้งสองฝั่ง · i18n **3,528** · build 55 routes

---

## 12. 🧪 Browser QA ของ P3 + ทดสอบ migration จริง

### ✅ migration 37 ทดสอบกับ Postgres จริงแล้ว

รันกับ local PGlite (อยู่ในขอบเขตที่อนุญาต: *"ทดสอบ Migration กับ Local/Test Database ได้"*) ผลยืนยันทุกข้ออ้างในหัวไฟล์:

| ตรวจ | ผล |
|---|---|
| ก่อนรัน enum มี 12 label ไม่มี DOOR | ✓ |
| รันแล้วได้ 13 label | ✓ |
| **รันซ้ำครั้งที่สอง ไม่เปลี่ยนอะไร** | ✓ idempotent จริง |
| **DOOR ต่อท้ายสุด** ตรงกับลำดับใน `schema.prisma` | ✓ |

### ✅ ยืนยันด้วยของจริงบนหน้าจอ

| RQ | หลักฐาน |
|---|---|
| RQ8 | **Door อยู่ในพาเลตต์ต่อจาก Aisle** · วางแล้วได้ rect `1.2 × 0.3 m` พื้นขาวเส้นเข้ม · **arc บานสวิงเส้นประ `stroke-dasharray="3 2"` รัศมี 1.2 เท่าความกว้างช่องเปิด** · dropdown ใน Properties มี `DOOR` ครบใน 13 options |
| RQ9/RQ12 | **SCALE 1:550 → 1:440 เมื่อซูม** พิสูจน์ว่าคำนวณใหม่จริงทุกระดับซูม · scale bar มีแถบ 10 m · ไม้บรรทัดเปิดได้พร้อมคำแนะนำ "Click the start point, then click again to finish. Esc or M puts the ruler away." |
| RQ10 | `GET /problems` ตอบจริง `floor.source: CANVAS` **ถูกต้อง** เพราะคลัง demo ยังไม่ใส่ขนาด จึงถอยไปใช้ขอบเขตของผังแทน · counts เป็นศูนย์บนผังเปล่า |
| RQ27 | dry run ตอบ 201 วาง 0 ข้าม 4 ด้วยเหตุผล `NO_SIZE` — **ถูกต้อง** เพราะ rack ของ demo ไม่มีขนาด · **ไม่ส่ง `version` → 409 "This layout changed elsewhere"** พิสูจน์ว่า guard ทำงาน |

### 🔴 เรื่องสำคัญที่พบ: P3 ทั้งเฟสถูกซ่อนอยู่หลัง feature flag

หน้า Floor Plan **ไม่ปรากฏเลยโดยค่าตั้งต้น** — อยู่หลัง module flag `floorPlan2d` ซึ่งปิดไว้:

```
frontend/src/lib/feature-flags.ts:21
floorPlan2d: false, // P1 1.8 — 2D floor plan editor hidden; 3D view stays

backend/src/settings/setting-definitions.ts:55
DEFAULT_HIDDEN_MODULES = ['warranty', 'mrp', 'floorPlan2d']
```

แปลว่า **RQ8, RQ9, RQ10, RQ12, RQ27 ที่เพิ่งทำเสร็จ ผู้ใช้จะมองไม่เห็นเลย** จนกว่าจะมีคนเปิด module นี้ใน System Settings

เปิดใน local เพื่อทำ QA แล้ว (ตั้ง `ui.hiddenModules = "warranty,mrp"` — warranty กับ mrp ยังซ่อนตามค่าตั้งต้นเดิม) แต่ **การเปิดบน production เป็นการตัดสินใจของเจ้าของระบบ ไม่ใช่ของผม**

> ⚠️ **เกร็ดสำหรับคนที่จะตั้งค่านี้:** ค่าเป็น **comma-separated ไม่ใช่ JSON array** (`hiddenModulesFrom` ใช้ `value.split(',')`) ผมใส่เป็น JSON รอบแรกแล้วเงียบไปเฉย ๆ เพราะ parse ไม่ผ่านแล้วถอยไปใช้ค่าตั้งต้นคือซ่อนทั้งหมด

### ❓ คำถามเพิ่มสำหรับเจ้าของระบบ

**จะเปิด module `floorPlan2d` บน production ด้วยไหม** — requirement RQ8 ขอ "สร้าง Layout แบบ Grid พร้อมเพิ่ม Rack, Aisle, Working Zone และ Door" ซึ่งบอกเป็นนัยว่าต้องการใช้งานจริง แต่คอมเมนต์ในโค้ดระบุว่าเคยปิดไว้โดยตั้งใจ (P1 1.8) จึงต้องให้คุณยืนยัน

### 📌 คิวถัดไป · ต่อ UI เข้ากับ endpoint นี้

ต้องแก้ `structure-tree.tsx` (ว่างแล้ว) · `api-warehouse.ts` และ `i18n/*/warehouseMaster.ts` (**P2-B ถืออยู่**) → รอ P2-B ปล่อยก่อน

Contract ที่จะส่งต่อ: `GET /warehouse-master/deleted` → `{ generatedAt, warehouses[], racks[], totals { warehouses, racks, restorable } }` โดยแต่ละแถวมี `kind` · `code` · `name` · `isDeleted: true` · `isActive` (สถานะหลัง restore) · `warehouse` (ของ rack ใช้แยก code ซ้ำข้ามคลัง) · `zone` · `deletedAt` · `deletedBy { id, username, fullName }` · `slotsDeleted` · `canRestore` · `blocked { code: 'WAREHOUSE_DELETED', message }`
