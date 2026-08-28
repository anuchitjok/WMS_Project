// Placement-based occupancy derivations, shared by the Control Center and the
// Floor Plan. Extracted verbatim from warehouse-layout/page.tsx (Sprint 4) so
// both tabs colour and count locations identically.
//
// Source of truth is ACTUAL STOCK PLACEMENT (slot._count.stockItems, i.e.
// StockItem.slotId) — never slot.status, which no write path keeps in sync.

// ─── Types ────────────────────────────────────────────────────────────────────

export type SlotStatus = 'EMPTY' | 'OCCUPIED' | 'RESERVED' | 'QUARANTINE' | 'RTV' | 'BLOCKED';

export interface SlotData {
  id: string; code: string; name?: string; level: number; column: number;
  status: SlotStatus; slotType: string; capacity: number;
  _count?: { stockItems: number }; updatedAt?: string;
}
export interface RackData {
  id: string; code: string; name?: string; zone?: string; rackType: string;
  levels: number; columns: number; isActive: boolean; updatedAt?: string;
  slots: SlotData[];
  _count?: { slots: number; stockItems: number };
}
export interface WarehouseData {
  id: string; code: string; name: string; location?: string;
  racks: RackData[];
  _count?: { racks: number; stockItems: number };
}

// ─── Placement-based derivations (source of truth = stock items in slot) ────────

export const slotItems = (s: SlotData) => s._count?.stockItems ?? 0;
export const isOccupied = (s: SlotData) => slotItems(s) > 0;
export const isBlocked = (s: SlotData) => s.status === 'BLOCKED';
export const slotUtil = (s: SlotData) => (s.capacity > 0 ? Math.min(100, Math.round((slotItems(s) / s.capacity) * 100)) : (isOccupied(s) ? 100 : 0));

export interface Metrics { total: number; occupied: number; available: number; blocked: number; items: number; utilPct: number; }
export function rackMetrics(r: RackData): Metrics {
  const slots = r.slots ?? [];
  const total = slots.length;
  const occupied = slots.filter(isOccupied).length;
  const blocked = slots.filter(isBlocked).length;
  const items = r._count?.stockItems ?? slots.reduce((a, s) => a + slotItems(s), 0);
  return { total, occupied, blocked, available: Math.max(0, total - occupied - blocked), items, utilPct: total ? Math.round((occupied / total) * 100) : 0 };
}
export function whMetrics(w: WarehouseData): Metrics {
  return (w.racks ?? []).reduce((acc, r) => {
    const m = rackMetrics(r);
    return { total: acc.total + m.total, occupied: acc.occupied + m.occupied, blocked: acc.blocked + m.blocked,
      available: acc.available + m.available, items: acc.items + m.items, utilPct: 0 };
  }, { total: 0, occupied: 0, blocked: 0, available: 0, items: 0, utilPct: 0 } as Metrics);
}
export const withRate = (m: Metrics): Metrics => ({ ...m, utilPct: m.total ? Math.round((m.occupied / m.total) * 100) : 0 });

export type StatusLevel = 'normal' | 'warning' | 'critical';
export function levelOf(util: number, blocked: number, total: number): StatusLevel {
  const blockShare = total ? blocked / total : 0;
  if (util >= 90 || blockShare >= 0.2) return 'critical';
  if (util >= 70 || blockShare >= 0.1) return 'warning';
  return 'normal';
}
export const LEVEL_CFG: Record<StatusLevel, { label: string; pill: string; dot: string; bar: string }> = {
  normal:   { label: 'Normal',   pill: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
  warning:  { label: 'Warning',  pill: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-500',   bar: 'bg-amber-500' },
  critical: { label: 'Critical', pill: 'bg-red-100 text-red-700',         dot: 'bg-red-500',     bar: 'bg-red-500' },
};

// Heatmap color scale (Green=Available, Yellow=Medium, Orange=High, Red=Critical).
export function heatCell(util: number, occupied: boolean) {
  if (!occupied) return 'bg-emerald-100 border-emerald-200 text-emerald-700';
  if (util >= 90) return 'bg-red-500 border-red-600 text-white';
  if (util >= 60) return 'bg-orange-500 border-orange-600 text-white';
  if (util >= 30) return 'bg-yellow-400 border-yellow-500 text-yellow-900';
  return 'bg-emerald-500 border-emerald-600 text-white';
}

export const SLOT_CFG: Record<SlotStatus, { label: string; pill: string }> = {
  EMPTY:      { label: 'Available',  pill: 'bg-emerald-100 text-emerald-700' },
  OCCUPIED:   { label: 'Occupied',   pill: 'bg-amber-100 text-amber-700' },
  RESERVED:   { label: 'Reserved',   pill: 'bg-yellow-100 text-yellow-700' },
  QUARANTINE: { label: 'On Hold',    pill: 'bg-purple-100 text-purple-700' },
  RTV:        { label: 'RTV',        pill: 'bg-orange-100 text-orange-700' },
  BLOCKED:    { label: 'Blocked',    pill: 'bg-red-100 text-red-700' },
};
