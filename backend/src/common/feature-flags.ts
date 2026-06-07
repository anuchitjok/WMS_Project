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

/**
 * When true, withdrawal-request approval is driven by the ApprovalService engine
 * (multi-step rules, governance). The legacy single-click approve still works as a
 * fallback when no rule exists. When false (default), approval uses the legacy
 * inline path only. Toggle via env: ENABLE_APPROVAL_ENGINE=true
 */
export function isApprovalEngineEnabled(): boolean {
  return process.env.ENABLE_APPROVAL_ENGINE === 'true';
}
