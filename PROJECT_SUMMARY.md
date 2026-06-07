# HSNT WMS — Project Summary
> สร้างเมื่อ: 2026-06-03 | สถานะ: Production-Ready Demo

---

## 📌 Overview

ระบบ **Warehouse Management System (WMS)** สำหรับ HSNT (Highpoint Service Network)  
สร้างเป็น production-ready full-stack demo สำหรับ Board Presentation

---

## 🏗️ Architecture

```
D:\WMS_Project\
├── frontend/          ← Next.js 16 (TypeScript, TailwindCSS v4, Shadcn/Base UI)
├── backend/           ← NestJS 11 (Prisma 7, PostgreSQL, JWT, Socket.IO)
├── mobile/            ← React Native (scaffold เท่านั้น ยังไม่ implement)
├── database/          ← SQL schemas เดิม (ใช้อ้างอิง domain model)
├── app/               ← Python/FastAPI prototype เดิม (reference)
├── e2e-test.js        ← (อยู่ใน backend/) ทดสอบ 35 test cases
├── start-dev.ps1      ← one-click dev launcher
└── PROJECT_SUMMARY.md ← ไฟล์นี้
```

---

## ⚙️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 16, TypeScript, TailwindCSS v4, Shadcn UI (Base UI), Zustand, TanStack Table |
| **Backend** | NestJS 11, TypeScript, Prisma 7 |
| **Database** | Supabase PostgreSQL 17.6 (cloud) |
| **ORM** | Prisma 7 + `@prisma/adapter-pg` (driver adapter สำหรับ Prisma 7) |
| **Auth** | JWT (access token 8h + refresh token 7d), passport-jwt, bcryptjs |
| **Realtime** | Socket.IO via NestJS WebSocketGateway |
| **Deploy** | Vercel (frontend), Render (backend), Supabase (DB) |
| **Node.js** | v22.16.0 LTS (portable install ที่ `%LOCALAPPDATA%\Programs\nodejs`) |

---

## 🗄️ Database — Supabase

| ข้อมูล | ค่า |
|---|---|
| Project | hsnt-wms-v2 |
| Project Ref | `gkbkukddgjzboxwjwczo` |
| Region | ap-southeast-1 (Singapore) |
| Host | `aws-1-ap-southeast-1.pooler.supabase.com` |
| Port | 5432 (session mode — ใช้ทั้ง runtime และ migration) |

> ⚠️ ใช้ `aws-1` ไม่ใช่ `aws-0` — สำคัญมาก

### Connection Strings (backend/.env)
```env
DATABASE_URL="postgresql://postgres.gkbkukddgjzboxwjwczo:WmsAdmin2024!@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"
DIRECT_URL="postgresql://postgres.gkbkukddgjzboxwjwczo:WmsAdmin2024!@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"
```

---

## 🗂️ Database Schema — 17 Tables

```
User              — ผู้ใช้ระบบ + role
Brand             — แบรนด์สินค้า
Vendor            — ผู้จำหน่าย
Product           — master data สินค้า
Warehouse         — คลังสินค้า
Rack              — ชั้นวาง
Slot              — ช่องเก็บสินค้า
StockItem         — รายการสินค้าในคลัง (unit of inventory)
GoodsReceiving    — ใบรับสินค้า
GoodsReceivingItem — รายการในใบรับ
WithdrawalRequest — ใบขอเบิกสินค้า
WithdrawalRequestItem — รายการในใบขอเบิก
RTVCase           — คดีส่งคืนสินค้า (Return to Vendor)
AuditLog          — บันทึกทุก action
StockAdjustment   — การปรับปริมาณสินค้า (ต้องอนุมัติ)
StockTransfer     — การย้ายสินค้าระหว่างสถานที่
Setting           — ตั้งค่าระบบ (9 rules)
```

### Stock Status Lifecycle
```
PENDING_RECEIVING
  → (verify receiving) → PENDING_INSPECTION
  → (putaway confirm) → AVAILABLE
  → (request reserved) → RESERVED
  → (picking) → PICKING → PICKED → PACKED
  → (ship/handover) → ISSUED_TO_RMA
  → (usage confirm USED) → CONSUMED
  → (usage confirm DOA/DEFECTIVE) → RTV_PENDING
  → (unused return) → AVAILABLE
  → QUARANTINE / DAMAGED / DOA
```

---

## 🔧 Backend — NestJS Modules (21 modules)

### Original (Session 1)
| Module | Endpoints | หน้าที่ |
|---|---|---|
| Auth | POST /login, /register, /refresh · GET /me | JWT auth, account lockout |
| Dashboard | GET /dashboard/stats | KPI aggregations |
| Inventory | GET/POST/PATCH /inventory + /barcode/:code | Stock CRUD + barcode lookup |
| Warehouse | GET /warehouse, /products, /brands, /vendors | Master data |
| Requests | GET/POST/PATCH /requests | Withdrawal request lifecycle |
| RTV | GET/POST/PATCH /rtv | Return-to-vendor cases |
| Users | GET/PATCH/DELETE /users | User management |
| Audit | GET /audit | Audit trail |
| Realtime | Socket.IO /ws | inventory/request/dashboard events |

### Gap-fill (Session 2)
| Module | Endpoints | หน้าที่ |
|---|---|---|
| Receiving | GET/POST /receiving · PATCH /:id/verify | รับสินค้า + ตรวจสอบ |
| Putaway | GET /pending · PATCH /:id/confirm | วางสินค้าเข้าที่ |
| Fulfillment | GET /board, /handover-queue · PATCH /:id/advance, /handover | Pick/Pack/Ship + Handover |
| RMA | GET /pending-usage · PATCH /:id/usage | ยืนยันการใช้สินค้า RMA |
| DOA | GET / · PATCH /:id/declare · POST /:id/rtv | DOA management |
| Unused | GET /pending · PATCH /:id/return, /doa | คืนสินค้าที่ไม่ได้ใช้ |
| Adjustment | GET/POST /adjustment · PATCH /:id/approve, /reject | ปรับปริมาณ (maker-checker) |
| Transfer | GET/POST /transfer · PATCH /:id/complete | ย้ายสินค้า |
| Products | GET/POST/PATCH /products | Product Master CRUD |
| Settings | GET /settings · PATCH /:key | System settings (9 rules) |
| Reports | GET /reports/summary | SLA, DOA rate, low stock |

---

## 🎨 Frontend — Pages (22 pages)

### Layout
- **Sidebar**: จัดกลุ่มเป็น Overview / Warehouse / Requester / RTV / Admin  
- **Role-based visibility**: เห็นเฉพาะ menu ที่ role อนุญาต  
- **Auth guard**: `(dashboard)/layout.tsx` redirect ไป /login ถ้า token หมด

### Pages
| Route | หน้า | สถานะ |
|---|---|---|
| `/login` | Login (dark theme) | ✅ |
| `/dashboard` | Executive Dashboard (KPI + activity) | ✅ |
| `/reports` | Reports & Dashboard (SLA, DOA, low stock) | ✅ |
| `/inventory` | Inventory Stock Inquiry | ✅ |
| `/receiving` | Goods Receiving & Verification | ✅ |
| `/putaway` | Putaway Management | ✅ |
| `/fulfillment` | Pick/Pack/Ship (Kanban board) | ✅ |
| `/handover` | Handover Confirmation | ✅ |
| `/transfer` | Stock Transfer | ✅ |
| `/adjustment` | Stock Adjustment | ✅ |
| `/scanner` | Barcode Scanner (html5-qrcode + manual) | ✅ |
| `/requests` | Withdrawal Requests | ✅ |
| `/approval` | Approval Queue | ✅ |
| `/rma-usage` | RMA Usage Confirmation | ✅ |
| `/unused` | Unused Goods Return | ✅ |
| `/doa` | DOA / Defective Management | ✅ |
| `/rtv` | RTV Case Management | ✅ |
| `/products` | Product Master (CRUD) | ✅ |
| `/users` | User & Role Management | ✅ |
| `/settings` | System Settings | ✅ |
| `/audit` | Audit Trail | ✅ |

---

## 👥 Demo Login Credentials

| Username | Password | Role |
|---|---|---|
| `admin` | `Admin@123` | SYSTEM_ADMIN |
| `wm_manager` | `Manager@123` | WAREHOUSE_MANAGER |
| `requester01` | `Staff@123` | REQUESTER |

---

## 🔐 Role-Based Access

```
SYSTEM_ADMIN        — Full access (all modules)
WAREHOUSE_MANAGER   — All warehouse + approval + reports
WAREHOUSE_SUPERVISOR — Warehouse operations
WAREHOUSE_STAFF     — Receiving, putaway, pick/pack, scanner
REQUESTER           — Requests + RMA usage + scanner
DEPT_APPROVER       — Approval queue only
RTV_OFFICER         — DOA + RTV management
RMA_TEAM            — RMA usage + DOA
FINANCE_VIEWER      — Reports (read-only)
BRAND_VIEWER        — Reports (read-only)
MGMT_VIEWER         — Dashboard + reports (read-only)
AUDITOR             — Audit trail (read-only)
```

---

## 🧪 E2E Test Results

**ไฟล์:** `D:\WMS_Project\backend\e2e-test.js`  
**รัน:** `node e2e-test.js`

### ผลลัพธ์ล่าสุด: **35/35 PASS ✅**

```
[ Auth ]                           1/1
[ Master Data ]                    2/2
[ Receiving → Putaway ]            5/5
[ Request → Approve → Fulfillment → Handover ]  7/7
[ RMA Usage ]                      2/2
[ DOA → RTV ]                      4/4  ← full DOA lifecycle
[ Unused Return ]                  4/4  ← full unused lifecycle
[ Stock Adjustment ]               3/3  ← maker-checker
[ Stock Transfer ]                 2/2
[ Settings / Reports / Dashboard / Audit ]  5/5
[ RBAC Enforcement ]               1/1  ← 403 enforced
────────────────────────────────
TOTAL: 35  PASS: 35  FAIL: 0
```

### Test Coverage
- ✅ Full workflow chain (receive → putaway → request → approve → pick → pack → ship → handover → RMA usage)
- ✅ DOA lifecycle (receive DOA → declare → create RTV → advance status)
- ✅ Unused return lifecycle (issue → mark unused → return to stock)
- ✅ Adjustment approval (maker-checker pattern)
- ✅ Transfer completion
- ✅ Settings auto-seed on first access
- ✅ RBAC enforcement (403 for unauthorized role)

---

## 🛠️ Key Technical Notes

### Prisma 7 Breaking Changes
```typescript
// ❌ OLD — ไม่ใช้แล้ว
const prisma = new PrismaClient();  // ไม่มี url ใน schema

// ✅ NEW — Prisma 7 ต้องใช้ driver adapter
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
```

### Shadcn UI (Base UI edition)
```tsx
// ❌ Radix pattern — ไม่ใช้กับ project นี้
<DialogTrigger asChild><Button>Open</Button></DialogTrigger>

// ✅ Base UI pattern — ใช้อันนี้
<DialogTrigger render={<Button />}>Open</DialogTrigger>
```

### Supabase db push
```powershell
# ❌ Transaction pooler (6543) ทำ DDL ไม่ได้
# ✅ Session pooler (5432) เท่านั้น
$env:DATABASE_URL = "...pooler.supabase.com:5432/postgres"
npx prisma db push
```

---

## 🚀 Local Development

### First-time setup
```powershell
# 1. เปิด PATH สำหรับ Node.js
$env:PATH = "$env:LOCALAPPDATA\Programs\nodejs;$env:PATH"

# 2. Backend dependencies (ถ้ายังไม่ install)
cd D:\WMS_Project\backend && npm install

# 3. Frontend dependencies
cd D:\WMS_Project\frontend && npm install

# 4. Push schema & seed (ถ้า DB ว่าง)
cd D:\WMS_Project\backend
npx prisma db push
npx ts-node -r tsconfig-paths/register prisma/seed.ts
```

### Start servers
```powershell
# Option 1: one-click launcher
.\start-dev.ps1

# Option 2: manual
# Terminal 1
cd D:\WMS_Project\backend && npm run start:dev

# Terminal 2
cd D:\WMS_Project\frontend && npm run dev
```

### URLs
| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:3001/api |
| Swagger Docs | http://localhost:3001/api/docs |
| Supabase Dashboard | https://supabase.com/dashboard/project/gkbkukddgjzboxwjwczo |

---

## 🚢 Production Deployment (Planned)

```
Frontend → Vercel
Backend  → Render (NestJS persistent server)
Database → Supabase (already live)
```

### Checklist ก่อน Deploy
- [ ] เปลี่ยน JWT_SECRET ให้ random และยาว
- [ ] เปลี่ยน DATABASE_URL เป็น production (transaction pooler 6543 + pgbouncer=true)
- [ ] ตั้ง FRONTEND_URL ใน backend/.env เป็น Vercel domain
- [ ] ตั้ง NEXT_PUBLIC_API_URL ใน frontend เป็น Render URL
- [ ] แก้ `backend/src/main.ts` CORS origin เป็น Vercel domain
- [ ] Render: add `prisma generate` ใน build command
- [ ] Render build command: `npm run build`
- [ ] Render start command: `node dist/main`

---

## 📊 Module Coverage vs Requirement

| Portal | Module | สถานะ |
|---|---|---|
| **Overview** | Executive Dashboard | ✅ |
| | Workflow Center (ดูใน fulfillment board) | ✅ |
| **Admin** | Admin System Overview | ⚠️ (ใช้ Dashboard รวม) |
| | Product Master / Master Data | ✅ |
| | User & Role Management | ✅ |
| | System Settings | ✅ |
| | Audit Trail | ✅ |
| **Warehouse** | Warehouse Management Overview | ⚠️ (ใช้ Dashboard รวม) |
| | Warehouse / Rack / Slot map | ✅ API (ไม่มี visual map) |
| | Goods Receiving & Verification | ✅ |
| | Putaway Management | ✅ |
| | Inventory Stock Inquiry | ✅ |
| | Warehouse Approval | ✅ |
| | Pick / Pack / Ship | ✅ |
| | Handover Confirmation | ✅ |
| | Stock Transfer | ✅ |
| | Stock Adjustment | ✅ |
| **Requester** | Requester Portal Overview | ⚠️ (ใช้ Dashboard รวม) |
| | Withdrawal Request | ✅ |
| | RMA Usage Confirmation | ✅ |
| | Unused Goods Return | ✅ |
| **RTV** | RTV Management Overview | ⚠️ (ใช้ Dashboard รวม) |
| | DOA / Defective Management | ✅ |
| | RTV Case Management | ✅ |
| **Monitoring** | Reports & Dashboard | ✅ |

**ตำนาน:** ✅ = สมบูรณ์ · ⚠️ = ใช้หน้ารวมแทน portal overview แยก

---

## 📂 Key File Paths

```
backend/
├── src/
│   ├── prisma/prisma.service.ts     ← Prisma 7 + PrismaPg adapter
│   ├── auth/                        ← JWT, guards, decorators
│   ├── inventory/                   ← Stock CRUD + barcode
│   ├── receiving/                   ← Goods receiving + verify
│   ├── putaway/                     ← Pending + confirm
│   ├── fulfillment/                 ← Pick/pack/ship + handover board
│   ├── rma/                         ← Usage confirmation
│   ├── doa/                         ← DOA lifecycle
│   ├── unused/                      ← Unused return
│   ├── adjustment/                  ← Stock adjustment (maker-checker)
│   ├── transfer/                    ← Stock transfer
│   ├── products/                    ← Product master CRUD
│   ├── settings/                    ← System settings
│   ├── reports/                     ← Reports summary
│   ├── rtv/                         ← RTV case management
│   ├── requests/                    ← Withdrawal requests + approval
│   ├── dashboard/                   ← KPI stats
│   ├── realtime/                    ← Socket.IO gateway
│   ├── users/                       ← User management
│   └── audit/                       ← Audit trail
├── prisma/
│   ├── schema.prisma                ← 17 models
│   ├── seed.ts                      ← Demo data (3 users, 1 WH, 2 products)
│   └── migrations/                  ← DB migrations
├── prisma.config.ts                 ← Prisma 7 config (url here, not schema)
├── e2e-test.js                      ← 35-test E2E suite
└── .env                             ← DB + JWT + port config

frontend/
├── src/
│   ├── app/
│   │   ├── (auth)/login/           ← Login page
│   │   └── (dashboard)/            ← Protected pages (22 routes)
│   ├── components/
│   │   ├── layout/sidebar.tsx      ← Grouped nav + role filter
│   │   ├── layout/page-header.tsx  ← Reusable header
│   │   ├── dashboard/stat-card.tsx ← KPI card
│   │   └── barcode/barcode-scanner.tsx ← html5-qrcode
│   ├── lib/
│   │   ├── api.ts                  ← API client (all endpoints)
│   │   └── utils.ts                ← cn, formatDate, status colors
│   ├── store/auth.store.ts         ← Zustand auth (persist)
│   └── types/index.ts              ← TypeScript types
└── .env.local                      ← NEXT_PUBLIC_API_URL
```

---

*สร้างโดย Claude (Anthropic) · HSNT WMS v1.0 · 2026-06-03*
