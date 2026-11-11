-- 34_relocation_role_grants.sql — FOR REVIEW. Run only after 34_location_relocation.sql.
--
-- Grants the PR7 relocation permissions to the system roles, as decided on 11 Nov 2026:
--   relocation.request (create + confirm the move): ADMIN, WAREHOUSE_MANAGER, PICKER (warehouse staff)
--   relocation.approve (approve / reject):          ADMIN, WAREHOUSE_MANAGER
-- SUPER_ADMIN already has every permission. Users without a DB role fall back to the
-- legacy role enum in backend/src/auth/access.ts (request: operators; approve: supervisors).
-- INVENTORY_CONTROL is NOT granted (not in the decision) — add it here if wanted.
--
-- Safe to run twice. Step 1 is read-only: check the role keys exist before granting.

-- 1) Preview (read-only)
SELECT r."key", p."code",
       EXISTS (SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id") AS already_granted
FROM "Role" r CROSS JOIN "Permission" p
WHERE p."code" IN ('relocation.request', 'relocation.approve')
  AND r."key" IN ('ADMIN', 'WAREHOUSE_MANAGER', 'PICKER')
ORDER BY r."key", p."code";

-- 2) Grant
BEGIN;
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r JOIN "Permission" p ON
     (p."code" = 'relocation.request' AND r."key" IN ('ADMIN', 'WAREHOUSE_MANAGER', 'PICKER'))
  OR (p."code" = 'relocation.approve' AND r."key" IN ('ADMIN', 'WAREHOUSE_MANAGER'))
ON CONFLICT DO NOTHING;
COMMIT;
