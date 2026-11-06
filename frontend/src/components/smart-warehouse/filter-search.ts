// Filter and search rules. Pure functions over the data contract, shared by
// the scene, the navigation tree, the toolbar and the panels.

import { SLOT_STATUSES, type RackNode, type SlotNode, type SlotStatus, type SmartWarehouseData } from './types';

export interface Filters {
  warehouseId: string;
  zoneId: string | null;
  aisleId: string | null;
  rackId: string | null;
  /** Statuses shown. All five = no status filter. */
  statuses: SlotStatus[];
}

export const allStatuses = (): SlotStatus[] => [...SLOT_STATUSES];

export function hasActiveFilter(f: Filters) {
  return !!(f.zoneId || f.aisleId || f.rackId || f.statuses.length < SLOT_STATUSES.length);
}

/** Rack is inside the zone / aisle / rack filter (status is per slot). */
export function rackMatches(r: Pick<RackNode, 'id' | 'zoneId' | 'aisleId' | 'warehouseId'>, f: Filters) {
  return r.warehouseId === f.warehouseId
    && (!f.zoneId || r.zoneId === f.zoneId)
    && (!f.aisleId || r.aisleId === f.aisleId)
    && (!f.rackId || r.id === f.rackId);
}

export function slotMatches(s: SlotNode, f: Filters, statusSet?: Set<SlotStatus>) {
  const set = statusSet ?? new Set(f.statuses);
  return s.warehouseId === f.warehouseId
    && (!f.zoneId || s.zoneId === f.zoneId)
    && (!f.aisleId || s.aisleId === f.aisleId)
    && (!f.rackId || s.rackId === f.rackId)
    && set.has(s.status);
}

// ─── Search ────────────────────────────────────────────────────────────────────

export type SearchField = 'sku' | 'product' | 'rackId' | 'slotId';

export interface SearchHit {
  kind: 'rack' | 'slot';
  id: string;
  warehouseId: string;
  field: SearchField;
  /** Main line (ID). */
  title: string;
  /** Second line (SKU · product, or rack summary). */
  detail: string;
  status?: SlotStatus;
}

export interface SearchIndex {
  racks: { rack: RackNode; key: string }[];
  slots: { slot: SlotNode; id: string; sku: string; product: string }[];
}

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().normalize('NFKC');

export function buildSearchIndex(data: SmartWarehouseData): SearchIndex {
  return {
    racks: data.racks.map((rack) => ({ rack, key: norm(rack.id) })),
    slots: data.slots.map((slot) => ({ slot, id: norm(slot.id), sku: norm(slot.sku), product: norm(slot.productName) })),
  };
}

/**
 * Search racks by ID and slots by ID, SKU or product name (case-insensitive,
 * substring). Racks first, then slots — exact and prefix matches first.
 * Warehouse in view first, so a common SKU shows local slots before others.
 */
export function search(index: SearchIndex, query: string, currentWarehouseId: string, limit = 40): { hits: SearchHit[]; total: number } {
  const q = norm(query.trim());
  if (q.length < 2) return { hits: [], total: 0 };
  const scored: { hit: SearchHit; score: number }[] = [];
  const rank = (text: string) => (text === q ? 0 : text.startsWith(q) ? 1 : text.endsWith(q) ? 2 : 3);

  for (const { rack, key } of index.racks) {
    if (!key.includes(q)) continue;
    scored.push({
      score: rank(key) + (rack.warehouseId === currentWarehouseId ? 0 : 10),
      hit: { kind: 'rack', id: rack.id, warehouseId: rack.warehouseId, field: 'rackId', title: rack.id, detail: `${rack.levels} × ${rack.bays}` },
    });
  }
  for (const s of index.slots) {
    let field: SearchField | null = null;
    let score = 0;
    if (s.id.includes(q)) { field = 'slotId'; score = rank(s.id); }
    else if (s.sku && s.sku.includes(q)) { field = 'sku'; score = 4 + rank(s.sku); }
    else if (s.product && s.product.includes(q)) { field = 'product'; score = 8 + rank(s.product); }
    if (!field) continue;
    const sl = s.slot;
    scored.push({
      score: 1 + score + (sl.warehouseId === currentWarehouseId ? 0 : 20),
      hit: {
        kind: 'slot', id: sl.id, warehouseId: sl.warehouseId, field, title: sl.id,
        detail: sl.sku ? `${sl.sku} · ${sl.productName ?? ''}` : '',
        status: sl.status,
      },
    });
  }
  scored.sort((a, b) => a.score - b.score || a.hit.title.localeCompare(b.hit.title, undefined, { numeric: true }));
  return { hits: scored.slice(0, limit).map((s) => s.hit), total: scored.length };
}

/**
 * Filters that make a search result visible: keep the current filter when it
 * already shows the target, otherwise switch to the target's warehouse with
 * no zone/aisle/rack/status filter.
 */
export function filtersToShow(f: Filters, target: { warehouseId: string; zoneId: string; aisleId: string; rackId: string; status?: SlotStatus }): Filters {
  const shown = rackMatches({ id: target.rackId, zoneId: target.zoneId, aisleId: target.aisleId, warehouseId: target.warehouseId }, f)
    && (!target.status || f.statuses.includes(target.status));
  return shown ? f : { warehouseId: target.warehouseId, zoneId: null, aisleId: null, rackId: null, statuses: allStatuses() };
}

/** Count of slots per status. */
export function statusCounts(slots: SlotNode[]): Record<SlotStatus, number> {
  const c = { available: 0, occupied: 0, reserved: 0, blocked: 0, inactive: 0 } as Record<SlotStatus, number>;
  for (const s of slots) c[s.status]++;
  return c;
}

/** Share of usable slots (not inactive/blocked) that hold stock or are reserved. */
export function utilPercent(c: Record<SlotStatus, number>) {
  const usable = c.available + c.occupied + c.reserved;
  return usable ? Math.round(((c.occupied + c.reserved) / usable) * 100) : 0;
}
