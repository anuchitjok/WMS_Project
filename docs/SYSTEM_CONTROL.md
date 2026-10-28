# System Control & Security — Operations Notes

Scope: the Oct 2026 system-control remediation (procurement, PO and accounting excluded).
Everything here is enforced in the backend; the UI only reflects it.

## 1. Accounts and roles

- **Privileged** = DB role `SUPER_ADMIN`, or (for users with no DB role yet) the legacy enum `SYSTEM_ADMIN`.
- Only a privileged user may create, promote, edit, reset, deactivate or delete a privileged account.
  This applies to `/auth/register`, `POST/PATCH /users`, `/users/:id/role`, `/users/:id/role-assignments`,
  password reset, warehouses and delete (`src/auth/role-grant.ts`).
- A non-privileged user with `user.manage` may only assign DB roles whose permissions they hold themselves.
- **Initial administrator provisioning**: the seed scripts (`prisma/seed.ts` + `prisma/seed-rbac.ts`) create
  `admin` and map it to `SUPER_ADMIN`. They must be run by an operator against the intended database only
  (they read `DIRECT_URL`). After that, every further administrator is created by an existing one.
- Access and refresh tokens carry a `jti`; logout revokes the bearer token actually used (TokenBlocklist).
  Refresh refuses deactivated/deleted accounts and revoked refresh tokens.

## 2. Realtime (Socket.IO `/ws`)

- Handshake must carry the REST access token: `io(url, { auth: { token } })`. Same validation as HTTP
  (signature, expiry, blocklist, active user).
- Sockets disconnect at token expiry and are re-validated every 2 minutes (logout / deactivation / role change).
- Events are delivered by permission (`inventory.read`, `request.read`) and warehouse scope. Payloads carry
  only an action name and ids — clients re-fetch through REST.

## 3. Rate limiting

| Throttler | Key | Default | Env |
|---|---|---|---|
| `default` | authenticated user (verified JWT), else client IP | 100 / min | `THROTTLE_USER_LIMIT` |
| `ip` | client IP | 600 / min | `THROTTLE_IP_LIMIT` |
| login | client IP (always) | 5 / min | — |

`req.ip` honours `TRUST_PROXY_HOPS` (default 1 in production behind Render, 0 elsewhere), so a client cannot
pick its bucket with `X-Forwarded-For`.

## 4. Separation of duties

The maker can never approve: withdrawal requests (requester), stock adjustments (creator), cycle-count variances
(anyone who counted a line), scrap cases (requester), approval-engine steps (requester; and one person cannot
approve two steps of one item). No override exists because the requirements define none.

## 5. Approval engine (`ENABLE_APPROVAL_ENGINE`)

Still **off** by default. When on: steps run in order; each step needs its role (`SUPER_ADMIN` excepted;
legacy-only users match by enum name); concurrent decisions resolve to one winner; WithdrawalRequest approvals
cannot be started/decided through `/approvals/*` (only via `/requests/:id/approve`, which applies the stock effect).

**Prerequisites before enabling in production**
1. Create at least one active rule on *Approval Rules* (the save validates roles and permissions).
2. Every role used in a step holds `request.approve`, and at least one active user holds each role
   **with a DB role** (legacy users match only by enum name).
3. Approvers have warehouse/department assignments consistent with who should approve.
4. Run the integration suite (`npm run test:integration`) on the release build; check on staging that a request
   goes PENDING_APPROVAL → APPROVED through all steps.
5. Rule *conditions* are not evaluated — every active rule applies to all requests of its type.

## 6. Warehouse scope

Rule (same as the original Inventory/Scan/Layout model): `SUPER_ADMIN` → all; a user with assigned warehouses
(UserWarehouse or warehouse-scoped role assignment) → only those; **a user with no assignment → all**
(legacy convention, kept to avoid locking out existing users — see Risks).

Enforced for reads, writes, approvals, exports and aggregates in: inventory (all endpoints), receiving (+ import),
putaway, transfer, adjustment, cycle count, RTV, scrap, DOA, reports (rows + exports), dashboard, data export.
An explicit `warehouseId` outside the scope returns 403 instead of being silently widened.
Not warehouse-scoped by design: withdrawal requests (no warehouse until allocation; fulfillment is scoped),
audit log, product/master data.

## 7. Settings

States: **configured** (applied), **disabled** (`disabled`, feature off), **missing** (no row → built-in
behaviour), **invalid** (ignored, flagged in the UI).

| Key | Effect |
|---|---|
| `stock.lowThreshold` | Default minimum for products without their own Min Stock (dashboard, reports, low-stock job). Units are summed per warehouse scope. |
| `rtv.agingSla` | RTV case older than N days (elapsed 24 h days from creation) is overdue: RTV list (`?overdue=true`), case detail, dashboard `rtvOverdue`. |
| `serial.duplicate` | Locked to `strict` (requirement 7.1). Enforced under per-serial advisory locks in receiving, inspection corrections, manual stock creation and both imports. |
| `audit.retention` | Enables the manual archive job (below). |
| `cycleCount.frequency` | weekly/monthly/quarterly due & overdue per warehouse (`/cycle-count/schedule`). Never creates counts. |
| `approval.workflow`, `stock.reservation`, `notification.template`, `warehouse.capacityRule` | Informational — controlled elsewhere; edits are refused. |

> **Deployment note:** existing databases already hold the seeded values (`5`, `7`, `365`, `monthly`). They take
> effect on deploy. Review them first; set `disabled` to keep the previous behaviour.

## 8. Audit retention

`GET /api/audit/retention/preview` (dry run) and `POST /api/audit/retention/archive` with `{ "confirm": true }`
(settings.manage). Moves *operational* entries older than the retention to `AuditLogArchive` in 500-row
transactions (copy then delete, idempotent). Never archived: logins/logouts, password, user, role, permission,
setting, approval, audit, token, master-data, template, request approve/reject, adjustment and reservation-release
entries. No schedule. **Do not run against production until the archive table exists and a backup is taken.**

## 9. Cycle-count stock lock

Count-line level: while a session is OPEN / IN_PROGRESS / REVIEW, its stock rows are skipped by reservation and
allocation, and refused (409) by status change, relocation, transfer, adjustment approval and scrap disposal.
One active count per warehouse. Approval re-checks every counted row; if any changed, nothing is applied, the
lines are flagged and the API returns 409 with `conflicts`. Recovery: **Recount changed lines** (refreshes
expected quantity, or excludes lines whose stock left AVAILABLE) → count → submit → approve. Approve or cancel
releases the lock; a failed approval keeps it until the count is finished or cancelled.

## 10. Master data

Reason codes (ADJUSTMENT / DOA / SCRAP), departments, units of measure — *Lists & Codes* page.
Records store the code string; codes are immutable, deactivate instead. A list with no entries keeps free text
(databases the data migration has not reached). `CYCLE_COUNT` is a system code.

**Warranty rules — not implemented (blocked on decisions).** HSNT_WMS_SKILL.md lists "warranty rule setup" and
"warranty replacement" but defines no durations, start events (receipt / sale / installation), per-brand or
per-product variation, or what a rule should block or trigger. Decisions needed before building:
1. What a warranty rule is keyed on (brand, product, product type, vendor).
2. Start date source and duration unit.
3. Effect: informational on RTV/DOA, or does it gate RTV creation / vendor claims?
4. Whether replacement units inherit the original warranty.

## 11. Stalled request recovery

`PATCH /api/requests/:id/recover` `{ reason }` (supervisor, `reservationRelease`): for a request stuck in
PICKING/PICKED/PACKED/READY_FOR_PICKUP with no live task, no shipment, nothing picked and no stock still held →
CANCELLED, audited as `REQUEST_RECOVERED`. If stock is still held, release it first (Inventory → Release
Reservation), which already closes the request when its last unit is freed.

## 12. Deployment (staging first)

1. Back up the database.
2. Apply `database/schema/21_system_control.sql` (additive, idempotent; aborts if duplicate active fulfillment
   tasks exist). **Do not use `prisma db push`.**
3. Verify: `SELECT indexname FROM pg_indexes WHERE tablename='FulfillmentTask';` lists
   `ux_fulfillment_task_request_active`, `idx_ft_request_id`, `idx_ft_warehouse_status`; Department and
   UnitOfMeasure contain the values already in use.
4. Review the settings values (section 7).
5. Deploy backend, then frontend (the socket now requires the token; the old frontend falls back to polling).
6. Smoke test: login/logout, request → approve (by a different user) → allocate, cycle count create/approve,
   adjustment with reason code, reports as a warehouse-scoped user, websocket connects (browser devtools).
