# WMS improvement roadmap — Phase 0 to Phase 6

Branch `claude/vibrant-chandrasekhar-0b11d4` (base `c44e00b`). Nothing here is committed, pushed or deployed. No production data or production database was used. All tests ran on PGlite (in-process Postgres) or a local UAT database.

## What each phase changed

| Phase | Summary |
|---|---|
| P0 | Decisions only. A request's `stage` is derived and never written. Auto-pick is limited to removing the pack/dispatch fallbacks. A putaway slot is required. Reservation mode is read at runtime. Read-only production review queries are in `database/previews/`. |
| P1 | Legacy data fixes and the read-only review `database/previews/phase1_legacy_data.sql`. Approval rule 86194 is to be **disabled in the UI after review, never deleted**. |
| P2 | Step 5 stock writes retired (answer `410 Gone` and point to where to look). `/inventory` now goes to Reports › Balance. Read-only stock detail drawer. |
| P3 | Audit entries record old → new values (`AuditLog.changes`, migration 27). New audit timeline (`GET /audit/timeline`). Notifications can be filtered by category. |
| P4 | Work queue page. Unit-of-measure picker. Receive Goods refuses incomplete lines. Warehouse scope labels. |
| P5 | Usage is recorded per unit (`IssuedUnitUsage`, migration 28). Returned units go through receipt → putaway before they are Available. DOA → RTV → replacement link. Scrap: Approved vs Disposed (disposal method required). Reason codes. Double-submit guards. |
| P6 | Setup checklist. Imports follow the same rules as the screens. One import per file, with an explicit re-import option. Controlled reversal of a mistaken receipt. |

## Database migrations (production approval required)

Run on production **before** deploying the API. Both migrations are additive and idempotent: running one twice does nothing.

| # | Apply | Rollback | Effect |
|---|---|---|---|
| 27 | `database/schema/27_audit_changes.sql` | `database/rollback/27_audit_changes_rollback.sql` | Adds nullable `changes JSONB` to `AuditLog` and `AuditLogArchive`. Existing rows are untouched. |
| 28 | `database/schema/28_issued_unit_usage.sql` | `database/rollback/28_issued_unit_usage_rollback.sql` | New table `IssuedUnitUsage`, with a unique key (`requestId`, `stockItemId`) and a foreign key to `WithdrawalRequest`. No existing table is changed. |

Order:
1. Back up the database.
2. Run 27, then 28.
3. Check the columns and table exist.
4. Deploy the API.
5. Deploy the web app.

To roll back: first redeploy the previous API, then run the rollback scripts in reverse order (28, then 27). Each rollback script explains how to export its data first.

Migration 28 was tested locally: apply, re-apply, duplicate row refused, rollback, re-apply. Existing request rows were kept.

## Production configuration

| Setting | Value | Notes |
|---|---|---|
| `ENABLE_STEP5_LEGACY` | unset (or `false`) | Retired Step 5 routes answer 410. Set it to `true` only to roll back Phase 2. |
| Role permissions | no change required | Reversing a receipt uses the existing `inventory.adjust` permission (legacy roles: SYSTEM_ADMIN, WAREHOUSE_MANAGER, WAREHOUSE_SUPERVISOR). The setup checklist uses `settings.manage` or `product.manage`. |

The Phase 2 rollback switch must not be left on: it re-enables direct stock writes.

## Phase 6 behaviour

- **Setup checklist** (`/setup-checklist`, `GET /api/settings/setup-checklist`). Read-only. Each status is computed from the data every time the page loads.
  - Statuses: Not started, In progress, Ready, Needs fix, Review.
  - Test-looking users and rules show as **Review**, with "disable after review, do not delete".
- **Import rules** match the screens:
  - Products: unit must be a listed unit of measure; numbers must be ≥ 0; `serialControlled` must be true or false.
  - Users: only a system administrator can grant SYSTEM_ADMIN; email format and uniqueness are checked; department must be a listed department; password policy applies. With no password, the user must change it at first sign-in.
  - Receiving: inactive products are refused; a serial number must have quantity 1.
- **One import per file**:
  - The file's content is fingerprinted (sha256), so the same file under another name is still caught.
  - A second commit of the same file answers `409` and the preview shows when and by whom it was first imported.
  - Re-importing needs explicit confirmation (`?allowReimport=true`, or `allowReimport=true` for receiving). The audit entry records which batch it repeats.
  - Simultaneous uploads of the same file are serialised by an advisory lock.
- **Receipt reversal** (`POST /api/receiving/:id/reverse`, with a reason of at least 5 characters):
  - Supervisors only, and not the person who received the goods.
  - Allowed only while every unit is still at the dock or in QC, and none is in an RTV or scrap case.
  - The receipt and its lines are kept and marked Cancelled. The units become Cancelled, which frees their serials.
  - Audit entries are written per unit and for the receipt.
  - If the receipt was an RTV replacement, the RTV case goes back to waiting for its replacement.

## Open business decisions and known limits

1. RTV `REJECTED_BY_VENDOR` leaves the unit's stock status unchanged. Decide where a rejected unit goes (scrap, back to DOA, or returned to us).
2. A bulk line (quantity > 1 on one stock row) cannot be partly returned. Usage and returns work per stock row.
3. A repaired unit coming back with the same serial while the old row is `RTV_SHIPPED` conflicts with the serial guard. The rule needs deciding.
4. Vendor is not mandatory on the server for vendor receipts (the screen asks for it).
5. Scrap `findOne` is not limited by warehouse scope.
6. The role-permission API silently ignores unknown permission codes (found in earlier phases; not changed).
7. Reversal covers receipts only. Mistakes after putaway are corrected through adjustment or cycle count, which keep their own approval and audit.
