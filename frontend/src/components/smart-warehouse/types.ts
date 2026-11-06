// Data contract for the Interactive 3D Smart Warehouse.
//
// The scene, panels, search and filters only read this shape. Today it is filled
// by mock-data.ts; to go live, implement WarehouseDataSource against the WMS API
// (warehouse tree + slot contents) and pass it to the page — nothing in the 3D
// code needs to change.
//
// Every record has a stable, human-readable ID built from its parent IDs, so a
// slot ID alone tells you where it is: WH01-A-A01-R02-L3-B04.

export type SlotStatus = 'available' | 'occupied' | 'reserved' | 'blocked' | 'inactive';

export const SLOT_STATUSES: readonly SlotStatus[] = ['available', 'occupied', 'reserved', 'blocked', 'inactive'];

export interface WarehouseNode {
  id: string;   // e.g. WH01
  code: string;
  name: string;
}

export interface ZoneNode {
  id: string;   // e.g. WH01-A
  warehouseId: string;
  code: string; // e.g. A
  name: string;
}

export interface AisleNode {
  id: string;   // e.g. WH01-A-A01
  zoneId: string;
  warehouseId: string;
  code: string; // e.g. A01
}

export interface RackNode {
  id: string;   // e.g. WH01-A-A01-R02
  aisleId: string;
  zoneId: string;
  warehouseId: string;
  code: string; // e.g. R02 (unique within the aisle)
  /** Which side of the aisle the rack stands on. */
  side: 'left' | 'right';
  levels: number;
  bays: number;
  /**
   * Optional placement in metres (centre of the footprint, rotation around Y).
   * When missing, layout.ts arranges racks by zone and aisle.
   */
  placement?: { x: number; z: number; rotY: number };
}

export interface SlotNode {
  id: string;   // e.g. WH01-A-A01-R02-L3-B04
  rackId: string;
  aisleId: string;
  zoneId: string;
  warehouseId: string;
  level: number; // 1 = lowest beam
  bay: number;   // 1 = left end of the rack, seen from the aisle
  status: SlotStatus;
  sku: string | null;
  productName: string | null;
  qty: number;
  capacity: number;
}

export interface SmartWarehouseData {
  warehouses: WarehouseNode[];
  zones: ZoneNode[];
  aisles: AisleNode[];
  racks: RackNode[];
  slots: SlotNode[];
  /** When the data was read (ISO). */
  asOf: string;
}

/** Where the page gets its data. Swap the mock for an API-backed one later. */
export interface WarehouseDataSource {
  load(signal?: AbortSignal): Promise<SmartWarehouseData>;
}
