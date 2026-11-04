// Centralized runtime feature flags. Read at call-time so they pick up env
// loaded by ConfigModule/dotenv regardless of module import order.

/**
 * When true, stock reservation happens ONLY at fulfillment allocation.
 * Approval becomes governance-only and does not mutate StockItem.status.
 * When false (default), the legacy behavior is preserved: approval reserves stock.
 * Toggle via env: ENABLE_UNIFIED_RESERVATION=true
 */
export function isUnifiedReservationEnabled(): boolean {
  return process.env.ENABLE_UNIFIED_RESERVATION === 'true';
}

export type ReservationMode = 'ALLOCATION' | 'APPROVAL';

/** Where stock is reserved in the running server, plus a plain-language summary for the UI. */
export function getReservationMode(): { mode: ReservationMode; summary: string } {
  return isUnifiedReservationEnabled()
    ? {
        mode: 'ALLOCATION',
        summary:
          'Stock is reserved when the warehouse allocates an approved request (FIFO). Approval reserves nothing. ' +
          'Cancelling the request or its fulfillment task releases the reserved units.',
      }
    : {
        mode: 'APPROVAL',
        summary:
          'Stock is reserved when the request is approved (FIFO). Allocation hands those reserved units to the ' +
          'fulfillment task and tops up from available stock if needed. Cancelling releases the reserved units.',
      };
}

/**
 * Step 5 retirement rollback switch. Off (default): Stock Adjustment, Stock
 * Transfer, Cycle Count, direct Inventory edits, their scan workflows and the
 * stock imports answer 410 Gone. Set ENABLE_STEP5_LEGACY=true only to roll the
 * retirement back; existing records are never changed either way.
 */
export function isStep5LegacyEnabled(): boolean {
  return process.env.ENABLE_STEP5_LEGACY === 'true';
}

/**
 * When true, withdrawal-request approval is driven by the ApprovalService engine
 * (multi-step rules, governance). The legacy single-click approve still works as a
 * fallback when no rule exists. When false (default), approval uses the legacy
 * inline path only. Toggle via env: ENABLE_APPROVAL_ENGINE=true
 */
export function isApprovalEngineEnabled(): boolean {
  return process.env.ENABLE_APPROVAL_ENGINE === 'true';
}

/**
 * When true, the redesigned executive Dashboard V2 is active on the frontend.
 * Phase 1 ships the additive APIs only; the UI cutover happens in Phase 2.
 * Default OFF. Toggle via env: ENABLE_DASHBOARD_V2=true (frontend reads
 * NEXT_PUBLIC_ENABLE_DASHBOARD_V2).
 */
export function isDashboardV2Enabled(): boolean {
  return process.env.ENABLE_DASHBOARD_V2 === 'true';
}
