# HSNT WMS — Enterprise Barcode Scanning Architecture
> Author: WMS Solution Architect · Stack: Next.js · NestJS · PostgreSQL/Prisma · React Native (planned) · JWT+RBAC
> Status: Design blueprint (no breaking change to existing modules)

---

## 0. Guiding Principles (enterprise best practice)

1. **Scan = a transaction, not a lookup.** Every meaningful scan creates an immutable `ScanEvent` row → full traceability.
2. **Validate server-side, always.** The device is untrusted; the backend is the source of truth (prevents wrong-warehouse, double-pick, expired serials).
3. **One barcode → one canonical resolver.** A single `BarcodeParserService` decodes any symbology into a typed entity (`product | stockItem | location | request | shipment | asset`).
4. **Idempotency keys** on every scan write → safe retries, safe offline replay (no duplicates).
5. **Context-driven scanning.** The same barcode means different things in Receiving vs Picking; the *workflow context* drives validation.
6. **Offline-first on mobile.** Queue locally, sync with conflict resolution; the warehouse never stops because Wi-Fi did.

---

## 1. Use-Case Inventory (where scanning happens)

| Domain | Primary scans | Goal |
|---|---|---|
| Receiving | ASN/PO, product, serial, carton | Confirm what physically arrived |
| Putaway | stock item/license-plate, destination bin | Place stock + confirm location |
| Picking | request, location, product/serial | Pick the *right* unit from the *right* bin |
| Packing | picked item, carton/tote, shipment | Build verified parcels |
| Shipping | shipment, carrier label | Hand-off confirmation |
| Transfer | stock item, source bin, dest bin | Move between locations/warehouses |
| Cycle Count | bin, product/serial | Reconcile system vs physical |
| Stock Adjustment | stock item/bin | Controlled correction w/ reason |
| RTV | defective serial, vendor RA | Return-to-vendor traceability |
| Serial Tracking | serial barcode | Cradle-to-grave unit history |
| Asset Tracking | asset tag (QR) | Fixed-asset / tool custody |

---

## 2. Barcode Workflows (scan → validate → effect → tables → audit)

> Notation: **U** = what the user scans, **V** = system validation, **A** = after-scan effect, **T** = tables, **L** = audit action.

### 2.1 Receiving
- **U:** (1) Source ref (PO/ASN/RA) → (2) product code → (3) serial (if serial-controlled) → (4) condition.
- **V:** product exists; serial NOT already active in stock (dup check); quantity ≥ 1; warehouse in user scope.
- **A:** create `GoodsReceiving` (+ items) and `StockItem(status=PENDING_RECEIVING)`.
- **T:** `GoodsReceiving`, `GoodsReceivingItem`, `StockItem`, `ScanEvent`.
- **L:** `GOODS_RECEIVED`, `SCAN_RECEIVE`.

### 2.2 Putaway
- **U:** stock item / license-plate → destination **bin barcode** (`LOC|<whCode>|<rack>|<slot>`).
- **V:** item is PENDING_INSPECTION/PENDING_RECEIVING; bin belongs to a warehouse in user scope; bin not FULL/quarantine.
- **A:** set `StockItem.warehouseId/rackId/slotId`, `status=AVAILABLE`.
- **T:** `StockItem`, `ScanEvent`.
- **L:** `PUTAWAY_CONFIRMED`, `SCAN_PUTAWAY`.

### 2.3 Picking
- **U:** request ref → suggested bin → product/serial.
- **V:** request APPROVED/PICKING; **scanned serial is the RESERVED unit** for this request; bin matches reservation; not already picked (double-pick guard).
- **A:** `WithdrawalRequestItem.stockItemId` confirmed; `StockItem.status=PICKED`; request → PICKING/PICKED.
- **T:** `WithdrawalRequest(Item)`, `StockItem`, `ScanEvent`.
- **L:** `PICK_CONFIRMED`, `SCAN_PICK`.

### 2.4 Packing
- **U:** picked serial → carton/tote barcode → (optional) weight.
- **V:** item is PICKED and belongs to the open request; carton not already shipped.
- **A:** `status=PACKED`; associate to carton (Shipment line).
- **T:** `StockItem`, `WithdrawalRequest`, (`Shipment`), `ScanEvent`.
- **L:** `PACK_CONFIRMED`, `SCAN_PACK`.

### 2.5 Shipping
- **U:** shipment barcode → carrier tracking label.
- **V:** all lines PACKED; receiver/handover present.
- **A:** `status=SHIPPED` → `ISSUED_TO_RMA` on handover.
- **T:** `WithdrawalRequest`, `StockItem`, `ScanEvent`.
- **L:** `SHIPPED`, `HANDOVER_CONFIRMED`, `SCAN_SHIP`.

### 2.6 Transfer
- **U:** stock item → source bin → destination bin (+ dest warehouse).
- **V:** item AVAILABLE; source matches current location; dest in scope; cross-warehouse may require approval.
- **A:** create `StockTransfer`; on confirm update location.
- **T:** `StockTransfer`, `StockItem`, `ScanEvent`.
- **L:** `TRANSFER_REQUESTED/COMPLETED`, `SCAN_TRANSFER`.

### 2.7 Cycle Count
- **U:** bin barcode → each product/serial in the bin.
- **V:** bin in scope; capture counted vs expected.
- **A:** build a count session; variances raise a `StockAdjustment` (maker-checker).
- **T:** `CycleCount(Session/Line)` (new), `StockAdjustment`, `ScanEvent`.
- **L:** `CYCLE_COUNT_*`, `SCAN_COUNT`.

### 2.8 Stock Adjustment
- **U:** stock item/bin → reason code.
- **V:** requires `inventory.adjust`; quantity ≥ 0; reason mandatory.
- **A:** create `StockAdjustment(PENDING_APPROVAL)`; on approve apply qty.
- **T:** `StockAdjustment`, `StockItem`, `ScanEvent`.
- **L:** `ADJUSTMENT_REQUESTED/APPROVED`, `SCAN_ADJUST`.

### 2.9 RTV
- **U:** defective serial → vendor RA barcode.
- **V:** item DOA/DAMAGED/RTV_PENDING; vendor exists.
- **A:** create/advance `RTVCase`; `status=RTV_SHIPPED` on dispatch.
- **T:** `RTVCase`, `StockItem`, `ScanEvent`.
- **L:** `RTV_CREATED/STATUS_UPDATED`, `SCAN_RTV`.

### 2.10 Serial Number Tracking (cross-cutting)
- Every serial scan appends to `ScanEvent` → a serial's **full timeline** = `SELECT * FROM ScanEvent WHERE serial = ? ORDER BY createdAt`. Receive → putaway → pick → pack → ship → (RMA/RTV).

### 2.11 Asset Tracking
- **U:** asset QR tag → custodian/location.
- **A:** custody transfer log (tools, PDAs, test equipment).
- **T:** `Asset`, `AssetMovement` (new), `ScanEvent`.

---

## 3. Barcode Standards

| Symbology | Use in WMS | Why |
|---|---|---|
| **CODE128** | Product SKU, internal license-plate, bin codes | High density, alphanumeric, ubiquitous on PDAs |
| **QR Code** | Locations, assets, mobile handover, deep-links | 2D, large payload, scannable by phone camera |
| **GS1-128 / GS1 DataMatrix** | Vendor/brand inbound, batch+expiry+serial | Industry standard Application Identifiers (AIs) |
| **Serial barcode** | Per-unit serial (CODE128 or DataMatrix) | Unit-level traceability |
| **Bin/Location barcode** | Rack/slot/bin | CODE128 of canonical location key |

**GS1 Application Identifiers parsed by the backend:**
`(01)` GTIN · `(10)` Batch/Lot · `(17)` Expiry (YYMMDD) · `(21)` Serial · `(00)` SSCC (pallet/license-plate) · `(37)` Qty.

**Internal canonical encodings (own labels):**
```
Product   : SKU|<code>                         e.g. SKU|SW-2960X
Stock unit: ITM|<stockItemId>                  e.g. ITM|clx...   (license-plate)
Location  : LOC|<whCode>|<rack>|<slot>         e.g. LOC|WH-MAIN|R-01|S-A1
Request   : REQ|<refNumber>
Shipment  : SHP|<refNumber>
Serial    : SN|<serial>
Asset     : AST|<assetTag>
```
A leading type prefix lets `BarcodeParserService` resolve in O(1) without ambiguity; GS1 strings are auto-detected by the `(AI)` pattern.

---

## 4. Label Printing System

| Label | Content | Symbology | Trigger |
|---|---|---|---|
| Product | code, name, brand | CODE128(SKU) | product master create / import |
| Serial/Unit (license-plate) | serial, SKU, received date | CODE128/DataMatrix(ITM/SN) | goods receiving |
| Rack/Bin | location key, warehouse | CODE128(LOC) + human text | location setup |
| Picking | request, lines, bins | QR(REQ) + line barcodes | request approved |
| Shipment/Carton | shipment ref, receiver, carrier | QR(SHP) + carrier label | packing complete |

**Engine:** server-side render → **PDF (PDFKit/Puppeteer)** or **ZPL** for Zebra direct-to-printer.
- Store reusable **`LabelTemplate`** rows (ZPL/HTML + variables) so admins edit layouts without redeploy.
- Endpoint returns `application/pdf` or `text/plain` (ZPL). Reuses the existing authenticated blob-download pattern (`dataioApi.downloadFile`).
- Batch printing: array of entity IDs → multi-page PDF / concatenated ZPL.

---

## 5. Mobile Barcode Workflows (React Native)

| Mode | Description | Best for |
|---|---|---|
| **PDA hardware scan** | Zebra/Honeywell laser → keyboard-wedge / Zebra DataWedge intent | High-volume receiving/picking |
| **Camera scan** | `vision-camera` + MLKit / existing `html5-qrcode` on web | Ad-hoc, phone users |
| **Batch scan** | Collect N scans → one upload | Cycle count, bulk receive |
| **Continuous mode** | Auto-advance after each valid scan + audio cue | Picking walk-paths |
| **Offline queue** | Persist scans in SQLite/WatermelonDB → sync when online | Dead-zone aisles |

**DataWedge integration:** configure a profile that broadcasts scans as Android intents; RN listens and routes into the active workflow — zero-tap, glove-friendly.

**Offline model:** each scan gets a client UUID (`clientScanId`) + timestamp; queue replays via **Batch Scan Upload**; server dedupes by `clientScanId` (idempotent).

---

## 6. Frontend / Device UX

- **Scan screen:** big live viewfinder, current **workflow context banner** (“PICKING REQ-… · Bin R-01-S-A1”), running tally, last-scan card.
- **Confirmation:** green flash + ✓ + short beep + haptic; auto-advance in continuous mode.
- **Error UX:** red flash + distinct error beep + long vibration + plain-language reason (“Wrong bin — expected R-01-S-A1”).
- **Wrong/unknown barcode:** modal with the raw value + “rescan / manual entry / report”.
- **Feedback matrix:** success=short beep+light haptic; warning=double beep; error=low buzz+long haptic; (configurable, accessibility-friendly).
- **Manual fallback:** every scan field accepts typed entry (damaged labels) — already present on the web scanner page.

---

## 7. Backend Architecture (NestJS)

```
ScanController  ──▶  ScanService (orchestrator, per-workflow handlers)
                       ├─ BarcodeParserService     decode symbology → typed token
                       ├─ BarcodeValidationService context rules (scope, state, dup, double-pick)
                       ├─ InventoryLookupService    resolve product/stockItem/location
                       ├─ ScanLogService            append ScanEvent (immutable)
                       └─ RealtimeGateway           emit scan:* events (existing Socket.IO)
```
- **Transactions:** state-changing scans run in `prisma.$transaction` (reuse existing pattern: putaway, pick, transfer).
- **Idempotency:** `clientScanId` unique → retries return the original result, never double-apply.
- **RBAC:** guard each scan action with `@RequirePermissions('inventory.adjust' | 'request.read' | ...)` (existing PermissionsGuard) + warehouse-scope check (existing `req.user.warehouseIds`).
- **Realtime:** `scan:success`, `scan:error`, `inventory:update` → dashboards & supervisors update live.

---

## 8. Database Schema Additions (Prisma)

```prisma
model ScanEvent {                 // immutable scan ledger
  id           String   @id @default(cuid())
  clientScanId String?  @unique   // idempotency / offline replay key
  userId       String
  deviceId     String?
  workflow     String             // RECEIVE|PUTAWAY|PICK|PACK|SHIP|TRANSFER|COUNT|ADJUST|RTV
  rawValue     String
  symbology    String?            // CODE128|QR|GS1|DATAMATRIX
  entityType   String?            // product|stockItem|location|request|shipment|asset
  entityId     String?
  warehouseId  String?
  result       String             // SUCCESS|ERROR|DUPLICATE|OUT_OF_SCOPE
  message      String?
  createdAt    DateTime @default(now())
  @@index([entityType, entityId]); @@index([userId]); @@index([workflow]); @@index([createdAt])
}

model Barcode {                   // optional alias map (vendor barcode → product)
  id        String @id @default(cuid())
  code      String @unique
  symbology String
  entityType String
  entityId  String
  isPrimary Boolean @default(false)
  @@index([entityType, entityId])
}

model LabelTemplate {
  id        String  @id @default(cuid())
  key       String  @unique       // product|serial|bin|shipment|picking
  name      String
  engine    String                // ZPL|HTML
  content   String                // template w/ {{variables}}
  isActive  Boolean @default(true)
  updatedAt DateTime @updatedAt
}

model Device {                    // registered PDAs / scanners
  id           String   @id @default(cuid())
  code         String   @unique   // asset tag of the device
  name         String
  type         String             // PDA|PHONE|BLUETOOTH|RFID
  warehouseId  String?
  lastSeenAt   DateTime?
  isActive     Boolean  @default(true)
  registeredById String?
  createdAt    DateTime @default(now())
}

model CycleCountSession {
  id          String @id @default(cuid())
  refNumber   String @unique
  warehouseId String
  status      String  @default("OPEN")  // OPEN|REVIEW|CLOSED
  startedById String?
  createdAt   DateTime @default(now())
  lines       CycleCountLine[]
}
model CycleCountLine {
  id          String @id @default(cuid())
  sessionId   String
  productId   String
  locationKey String?
  expectedQty Float
  countedQty  Float
  variance    Float
  session     CycleCountSession @relation(fields:[sessionId], references:[id], onDelete: Cascade)
}
```
> Reuses existing `StockItem.serialNumber/batchNumber`, `Warehouse/Rack/Slot`, `AuditLog`, RBAC. No existing table is altered destructively.

---

## 9. Security & Anti-Error Controls

| Risk | Control |
|---|---|
| Invalid scan | Parser rejects unknown symbology/prefix → `result=ERROR`, no state change |
| Duplicate scan | `clientScanId` unique + state guard (already-PICKED, already-PACKED) |
| Wrong warehouse | Cross-check entity.warehouseId ∈ `req.user.warehouseIds` (RBAC scope) |
| Double picking | Reservation lock (`StockItem.status=RESERVED` via `FOR UPDATE SKIP LOCKED`) — already implemented; pick guard verifies it's the reserved unit |
| Wrong bin | Putaway/pick compares scanned `LOC` key to expected |
| Privilege | `@RequirePermissions` per workflow; device must be registered + active |
| Replay/forgery | Idempotency key + server-side validation; device JWT |

---

## 10. Future Scalability

- **RFID:** add `symbology=EPC`; readers post batch tag reads to **Batch Scan Upload** (same pipeline). Portal/dock-door reads = many ScanEvents per second → queue + bulk insert.
- **Bluetooth scanners (HID):** behave as keyboard-wedge → no app change.
- **Zebra PDA:** DataWedge intents + ZPL printing native.
- **Multi-warehouse:** warehouse scope already in RBAC; scans tagged with `warehouseId`.
- **Offline-first:** local queue + `clientScanId` dedupe + conflict policy (last-writer-wins for location, reject for state regressions).

---

## 11. API Surface (enterprise-grade, versioned `/api`)

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/scan` | Execute a scan in a workflow context `{ workflow, rawValue, contextId?, clientScanId, deviceId }` |
| POST | `/scan/validate` | Dry-run: parse + validate, **no** state change (UX pre-check) |
| POST | `/scan/batch` | Offline replay: array of scans, idempotent, returns per-item results |
| GET  | `/scan/history?entityId=&serial=&workflow=` | Scan timeline / audit |
| GET  | `/barcode/resolve/:raw` | Parse + resolve to entity (extends existing `/inventory/barcode/:code`) |
| POST | `/barcode/generate` | Create canonical barcode payload for an entity |
| POST | `/labels/:type/print` | Render PDF/ZPL for one or many entities |
| GET  | `/labels/templates` · PATCH `/labels/templates/:key` | Manage label templates |
| POST | `/devices/register` · GET `/devices` · PATCH `/devices/:id` | Device lifecycle |

All under JWT+RBAC; mutating scans rate-limited & transactional.

---

## 12. Implementation Roadmap

**Phase 1 — Basic scanning (web, online)** ⏱ ~1 wk
- `ScanEvent` table + `BarcodeParserService` (prefix + GS1) + `/scan`, `/scan/validate`, `/scan/history`.
- Wire existing web Scanner page to context workflows (receive/putaway/pick).
- Label printing v1: product + bin (PDF). *Builds directly on the existing `/inventory/barcode/:code` + html5-qrcode page.*

**Phase 2 — Mobile workflows** ⏱ ~2–3 wk
- React Native app: camera + DataWedge; continuous/batch modes; sound/haptic UX.
- Picking/packing/shipping guided flows; `/scan/batch`.

**Phase 3 — Enterprise PDA** ⏱ ~2 wk
- Zebra ZPL printing, `Device` registration, GS1 DataMatrix, RBAC-scoped devices, supervisor realtime board.

**Phase 4 — Offline-first** ⏱ ~3 wk
- Local SQLite queue + sync engine + conflict resolution; cycle-count sessions; RFID/Bluetooth ingestion via batch pipeline.

---

## 13. Best-Practice Checklist (what tier-1 WMS do)
- License-plate (LPN/SSCC) scanning to move many units with one scan.
- Directed putaway & directed picking (system suggests the bin; scan confirms).
- Confirm-by-scan everywhere (no manual qty typing on the floor).
- Immutable scan ledger = the audit backbone.
- Idempotent, offline-tolerant APIs.
- Server-authoritative validation; device is a dumb terminal.
- Template-driven labels (ZPL) editable by ops, not devs.
```
