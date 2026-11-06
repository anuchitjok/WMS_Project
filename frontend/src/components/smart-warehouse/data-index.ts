// Lookups by ID and status counts per node, built once per data load.

import { statusCounts } from './filter-search';
import type { AisleNode, RackNode, SlotNode, SlotStatus, SmartWarehouseData, WarehouseNode, ZoneNode } from './types';

export interface DataIndex {
  warehouse: Map<string, WarehouseNode>;
  zone: Map<string, ZoneNode>;
  aisle: Map<string, AisleNode>;
  rack: Map<string, RackNode>;
  slot: Map<string, SlotNode>;
  /** Slots per rack ID, in level/bay order. */
  slotsOfRack: Map<string, SlotNode[]>;
  /** Status counts per warehouse / zone / aisle / rack ID. */
  counts: Map<string, Record<SlotStatus, number>>;
}

function group<T>(items: T[], key: (t: T) => string) {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    let list = m.get(k);
    if (!list) { list = []; m.set(k, list); }
    list.push(it);
  }
  return m;
}

export function buildIndex(data: SmartWarehouseData): DataIndex {
  const slotsOfRack = group(data.slots, (s) => s.rackId);
  for (const list of slotsOfRack.values()) list.sort((a, b) => a.level - b.level || a.bay - b.bay);
  const counts = new Map<string, Record<SlotStatus, number>>();
  const keys: ((s: SlotNode) => string)[] = [(s) => s.warehouseId, (s) => s.zoneId, (s) => s.aisleId, (s) => s.rackId];
  for (const fn of keys) {
    for (const [id, list] of group(data.slots, fn)) counts.set(id, statusCounts(list));
  }
  return {
    warehouse: new Map(data.warehouses.map((w) => [w.id, w])),
    zone: new Map(data.zones.map((z) => [z.id, z])),
    aisle: new Map(data.aisles.map((a) => [a.id, a])),
    rack: new Map(data.racks.map((r) => [r.id, r])),
    slot: new Map(data.slots.map((s) => [s.id, s])),
    slotsOfRack,
    counts,
  };
}
