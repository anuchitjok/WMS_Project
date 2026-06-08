// Dashboard V2 — Activity Timeline architecture (Phase 1: design scaffold).
// Classifies AuditLog actions into operational domains with display metadata.
// Rendering is implemented in Phase 3; this taxonomy is the shared contract.

export type ActivityDomain =
  | 'RECEIVING' | 'PUTAWAY' | 'APPROVAL' | 'FULFILLMENT'
  | 'SHIPMENT' | 'RMA' | 'INVENTORY' | 'OTHER';

export interface ActivityMeta {
  domain: ActivityDomain;
  label: string;   // human-friendly label
  tone: 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'slate';
}

// AuditLog.action → domain + display. Extend as new audit actions are added.
const ACTION_MAP: Record<string, ActivityMeta> = {
  // Receiving
  GOODS_RECEIVED:            { domain: 'RECEIVING',   label: 'Goods received',        tone: 'blue' },
  RECEIVING_VERIFIED:        { domain: 'RECEIVING',   label: 'Receiving verified',    tone: 'blue' },
  // Putaway
  PUTAWAY_CONFIRMED:         { domain: 'PUTAWAY',     label: 'Putaway confirmed',     tone: 'green' },
  // Approval
  REQUEST_SUBMITTED:         { domain: 'APPROVAL',    label: 'Request submitted',     tone: 'slate' },
  REQUEST_APPROVED:          { domain: 'APPROVAL',    label: 'Request approved',      tone: 'green' },
  REQUEST_REJECTED:          { domain: 'APPROVAL',    label: 'Request rejected',      tone: 'red' },
  REQUEST_CANCELLED:         { domain: 'APPROVAL',    label: 'Request cancelled',     tone: 'slate' },
  APPROVAL_COMPLETED:        { domain: 'APPROVAL',    label: 'Approval completed',    tone: 'green' },
  APPROVAL_REJECTED:         { domain: 'APPROVAL',    label: 'Approval rejected',     tone: 'red' },
  // Fulfillment
  FULFILLMENT_ALLOCATED:     { domain: 'FULFILLMENT', label: 'Task allocated',        tone: 'violet' },
  FULFILLMENT_ADVANCE:       { domain: 'FULFILLMENT', label: 'Task advanced',         tone: 'violet' },
  FULFILLMENT_EXCEPTION:     { domain: 'FULFILLMENT', label: 'Fulfillment exception', tone: 'red' },
  STOCK_PICKED:              { domain: 'FULFILLMENT', label: 'Item picked',           tone: 'violet' },
  PACKING_COMPLETED:         { domain: 'FULFILLMENT', label: 'Packing completed',     tone: 'violet' },
  // Shipment / Goods Issue
  SHIPMENT_CREATED:          { domain: 'SHIPMENT',    label: 'Shipment created',      tone: 'amber' },
  SHIPMENT_DISPATCHED:       { domain: 'SHIPMENT',    label: 'Shipment dispatched',   tone: 'amber' },
  SHIPMENT_GOODS_ISSUED:     { domain: 'SHIPMENT',    label: 'Goods issued (GI)',     tone: 'amber' },
  GOODS_ISSUED:              { domain: 'SHIPMENT',    label: 'Stock issued',          tone: 'amber' },
  // RMA / Returns
  RMA_USAGE_CONFIRMED:       { domain: 'RMA',         label: 'RMA usage confirmed',   tone: 'green' },
  HANDOVER_CONFIRMED:        { domain: 'RMA',         label: 'Handover to RMA',       tone: 'green' },
  UNUSED_RETURNED_TO_STOCK:  { domain: 'RMA',         label: 'Unused returned',       tone: 'green' },
  UNUSED_MARKED_DOA:         { domain: 'RMA',         label: 'Return marked DOA',     tone: 'red' },
  // Inventory movements
  STOCK_RESERVED:            { domain: 'INVENTORY',   label: 'Stock reserved',        tone: 'slate' },
  STOCK_RESERVATION_RELEASED:{ domain: 'INVENTORY',   label: 'Reservation released',  tone: 'slate' },
};

export function classifyActivity(action: string): ActivityMeta {
  return ACTION_MAP[action] ?? { domain: 'OTHER', label: action.replace(/_/g, ' ').toLowerCase(), tone: 'slate' };
}

export const ACTIVITY_DOMAINS: ActivityDomain[] = [
  'RECEIVING', 'PUTAWAY', 'APPROVAL', 'FULFILLMENT', 'SHIPMENT', 'RMA', 'INVENTORY', 'OTHER',
];
