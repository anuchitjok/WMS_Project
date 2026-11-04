-- Phase 0 — production configuration review (READ-ONLY).
-- Every statement is a SELECT. Run in a read-only session; nothing here changes data.
-- Paste the results back before any follow-up script in this folder is run.
BEGIN TRANSACTION READ ONLY;

-- 0.1  Approval rules: is "E2E Rule 86194" a test rule, and does anything depend on it?
SELECT r.id, r.name, r."entityType", r."isActive", r.priority, r."createdAt",
       (SELECT count(*) FROM "ApprovalStep" s WHERE s."ruleId" = r.id)                          AS steps,
       (SELECT count(*) FROM "ApprovalInstance" i WHERE i."ruleId" = r.id)                      AS instances_total,
       (SELECT count(*) FROM "ApprovalInstance" i WHERE i."ruleId" = r.id AND i.status = 'PENDING') AS instances_pending
FROM "ApprovalRule" r
ORDER BY r."isActive" DESC, r."entityType", r.priority;

-- 0.2  Which document types the engine would actually see (real entity types in use).
SELECT "entityType", status, count(*) FROM "ApprovalInstance" GROUP BY 1, 2 ORDER BY 1, 2;

-- 0.3  Active rules for real withdrawal requests (expected entityType for requests).
SELECT r.name, r."isActive", s."stepOrder", s."stepName", s."roleKey", s."isMandatory", s."timeoutHours",
       (SELECT count(*) FROM "User" u JOIN "Role" ro ON ro.id = u."roleId"
         WHERE ro.key = s."roleKey" AND u."isActive") AS active_approvers
FROM "ApprovalRule" r JOIN "ApprovalStep" s ON s."ruleId" = r.id
WHERE r."entityType" ILIKE '%withdraw%' OR r."entityType" ILIKE '%request%'
ORDER BY r.name, s."stepOrder";

-- 0.4  Super Admin and test-looking accounts (no password columns selected).
SELECT u.id, u.username, u."fullName", u.role AS legacy_role, ro.key AS role_key, u."isActive",
       u."createdAt", u."lastLoginAt",
       (u.username ILIKE '%test%' OR u."fullName" ILIKE '%test%' OR u.username ILIKE '%e2e%') AS looks_like_test,
       (SELECT count(*) FROM "AuditLog" a WHERE a."userId" = u.id)                               AS audit_events,
       (SELECT count(*) FROM "UserWarehouse" w WHERE w."userId" = u.id)                          AS warehouses
FROM "User" u LEFT JOIN "Role" ro ON ro.id = u."roleId"
ORDER BY (ro.key = 'SUPER_ADMIN') DESC, u.username;

-- 0.5  Settings that differ from the code defaults (compare with backend/src/settings/setting-definitions.ts).
SELECT key, value, category, "isActive", "updatedAt" FROM "Setting" ORDER BY category, key;

-- 0.6  Step 5 records that must be preserved (Phase 2).
SELECT 'ADJ' AS kind, "refNumber", status, "stockItemId", "quantityBefore", "quantityAfter", reason, "createdAt"
FROM "StockAdjustment" ORDER BY "createdAt";
SELECT s."refNumber", s.status, s."createdAt",
       count(l.id)                                          AS lines,
       count(l.id) FILTER (WHERE l."excludedAt" IS NULL AND l."stockItemId" IS NOT NULL) AS locking_lines
FROM "CycleCountSession" s LEFT JOIN "CycleCountLine" l ON l."sessionId" = s.id
GROUP BY s.id ORDER BY s."createdAt";
SELECT status, count(*) FROM "StockTransfer" GROUP BY 1;

-- 0.7  Stock rows currently held by an active cycle count (should be 0 before retiring Cycle Count).
SELECT ccs."refNumber", ccs.status, ccl."stockItemId", si.status AS stock_status, si.quantity
FROM "CycleCountLine" ccl
JOIN "CycleCountSession" ccs ON ccs.id = ccl."sessionId"
JOIN "StockItem" si ON si.id = ccl."stockItemId"
WHERE ccl."excludedAt" IS NULL AND ccs.status::text IN ('OPEN', 'IN_PROGRESS', 'REVIEW');

COMMIT;
