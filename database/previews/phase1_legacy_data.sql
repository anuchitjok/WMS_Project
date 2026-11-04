-- Phase 1 — legacy data preview (READ-ONLY). No data is changed by this file.
-- With the Phase 1 code, none of these rows needs a direct data fix:
--   * 1.1 requests re-appear under Fulfillment → Allocate (shown as "Approved");
--   * 1.3 tasks are resolved in the UI: Mark Exception → Cancelled releases the stock and reopens the request.
BEGIN TRANSACTION READ ONLY;

-- 1.1  Requests stuck at PICKING whose latest task is CANCELLED (pre-fix rows; re-allocatable after deploy).
SELECT r."refNumber", r.status, t."refNumber" AS last_task, t.status AS task_status, t."updatedAt" AS task_updated
FROM "WithdrawalRequest" r
JOIN LATERAL (SELECT * FROM "FulfillmentTask" ft WHERE ft."requestId" = r.id ORDER BY ft."createdAt" DESC LIMIT 1) t ON true
WHERE r.status = 'PICKING' AND t.status = 'CANCELLED'
  AND NOT EXISTS (SELECT 1 FROM "FulfillmentTask" x WHERE x."requestId" = r.id AND x.status <> 'CANCELLED');

-- 1.2  Requests at PICKING with no task at all (NOT re-allocatable: use Requests → Recover after checking stock).
SELECT r."refNumber", r.status, r."approvedAt",
       (SELECT string_agg(si.id || ':' || si.status, ', ') FROM "WithdrawalRequestItem" i
          JOIN "StockItem" si ON si.id = i."stockItemId" WHERE i."requestId" = r.id) AS linked_stock
FROM "WithdrawalRequest" r
WHERE r.status = 'PICKING' AND NOT EXISTS (SELECT 1 FROM "FulfillmentTask" t WHERE t."requestId" = r.id);

-- 1.3  Tasks past picking (PACKING / PACKED / READY_TO_SHIP) with stock lines never picked.
--      After deploy, packing and dispatch refuse these (409). Resolve each: confirm the pick if the goods
--      really were picked, otherwise Mark Exception → Cancelled and re-allocate.
SELECT t."refNumber", t."requestRef", t.status,
       count(*) FILTER (WHERE i."pickedAt" IS NULL AND i."stockItemId" IS NOT NULL) AS unpicked_lines,
       count(*) AS lines,
       string_agg(DISTINCT si.status::text, ', ') AS stock_statuses
FROM "FulfillmentTask" t
JOIN "FulfillmentTaskItem" i ON i."taskId" = t.id
LEFT JOIN "StockItem" si ON si.id = i."stockItemId"
WHERE t.status IN ('PACKING', 'PACKED', 'READY_TO_SHIP')
GROUP BY t.id
HAVING count(*) FILTER (WHERE i."pickedAt" IS NULL AND i."stockItemId" IS NOT NULL) > 0;

-- 1.4  Closed / shipped tasks that issued goods without a recorded pick (history check only — do not change).
SELECT t."refNumber", t.status, count(*) AS unpicked_lines
FROM "FulfillmentTask" t JOIN "FulfillmentTaskItem" i ON i."taskId" = t.id
WHERE t.status IN ('SHIPPED', 'DELIVERED', 'CLOSED') AND i."pickedAt" IS NULL AND i."stockItemId" IS NOT NULL
GROUP BY t.id;

-- 1.5  Which reservation model production has actually used (both shapes may exist).
--      Approval-time: approved requests whose lines point at RESERVED stock before any task exists.
SELECT count(*) AS approved_requests_holding_stock_without_task
FROM "WithdrawalRequest" r JOIN "WithdrawalRequestItem" i ON i."requestId" = r.id
JOIN "StockItem" si ON si.id = i."stockItemId"
WHERE r.status = 'APPROVED' AND si.status = 'RESERVED'
  AND NOT EXISTS (SELECT 1 FROM "FulfillmentTask" t WHERE t."requestId" = r.id AND t.status <> 'CANCELLED');
-- The running mode itself is the Render environment variable ENABLE_UNIFIED_RESERVATION
-- (not stored in the database). After deploy, GET /api/fulfillment/reservation-mode reports it.

COMMIT;
