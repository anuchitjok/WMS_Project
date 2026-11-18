// Warehouse Master API — rack types, space summary / planner / simulator, slot
// generation and bulk edit (plan P1 1.1–1.7). Existing tree/CRUD calls stay on
// `warehouseMasterApi` in api.ts.
//
// api.ts does not export its `request` helper, so this file has a small copy with
// the same contract (base URL, bearer token, 401 → /login, server message on error).
import { localizeError } from '@/lib/api';
import { getT } from '@/i18n';

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('wms_token');
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
    });
  } catch {
    throw Object.assign(new Error(getT().m.errors.network), { rawMessage: 'Network error' });
  }
  if (res.status === 401) {
    localStorage.removeItem('wms_token');
    localStorage.removeItem('wms_user');
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw Object.assign(new Error(getT().m.errors.requestFailed), { status: 401 });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: '' }));
    const raw = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw Object.assign(new Error(raw ? localizeError(raw) : getT().t(getT().m.errors.requestFailedStatus, { status: res.status })), { status: res.status, body, rawMessage: raw });
  }
  return res.json();
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

// ── Types (mirror backend/src/warehouse-master/space-math.ts) ────────────────
export type RackCategory = 'STANDARD_RACK' | 'PALLET_ON_FLOOR';
export const RACK_CATEGORIES: RackCategory[] = ['STANDARD_RACK', 'PALLET_ON_FLOOR'];

export interface RackTypeMaster {
  id: string;
  code: string;
  name: string;
  category: RackCategory;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  levels: number;
  columns: number;
  slotCapacity: number;
  maxStackHeightCm: number | null;
  description: string | null;
  isActive: boolean;
  _count?: { racks: number };
}

export interface SlotSize { lengthCm: number | null; widthCm: number | null; heightCm: number | null; areaM2: number | null; volumeM3: number | null }

export interface SlotCounts { total: number; empty: number; occupied: number; reserved: number; blocked: number; other: number; capacity: number }

export interface WarehouseSpaceSummary {
  warehouseId: string;
  code: string;
  name: string;
  isActive: boolean;
  dimensions: { lengthCm: number | null; widthCm: number | null; heightCm: number | null; usableAreaPct: number };
  hasSize: boolean;
  totalAreaM2: number | null;
  usableAreaM2: number | null;
  volumeM3: number | null;
  rackFootprintM2: number;
  standardFootprintM2: number;
  palletFootprintM2: number;
  freeAreaM2: number | null;
  overAllocatedM2: number;
  usedAreaPct: number | null;
  racks: { total: number; standard: number; pallet: number; withoutSize: number; withoutSizeCodes: string[] };
  slots: SlotCounts;
  stockQty: number;
  capacityUsedPct: number | null;
  /** Layer 1 — floor space vs the FULL warehouse area (100%). */
  floor: FloorSpace;
  /** Layer 2 — rack storage space estimated from slot status share. */
  storage: StorageSpace;
}

/** OCCUPIED = has stock, RESERVED = booked, available = EMPTY, blockedOther = BLOCKED / QUARANTINE / RTV / unknown. */
export type StorageBucket = 'occupied' | 'reserved' | 'available' | 'blockedOther';
export type BucketValues = Record<StorageBucket, number>;

export interface FloorSpace {
  totalAreaM2: number | null;
  rackFootprintM2: number;
  /** Not clamped: negative when racks exceed the warehouse area. */
  availableM2: number | null;
  /** Not clamped: can exceed 100. */
  utilPct: number | null;
  overCapacity: boolean;
  racksWithoutSize: number;
  racksWithoutSizeCodes: string[];
}

export interface StorageSpace {
  totalRackAreaM2: number;
  areaM2: BucketValues;
  slots: BucketValues & { total: number };
  utilPct: number | null;
  racksCounted: number;
  racksWithoutSizeCodes: string[];
  racksWithoutSlotsCodes: string[];
}

export interface RackSpaceRow {
  rackId: string;
  rackCode: string;
  zone: string | null;
  isActive: boolean;
  hasSize: boolean;
  rackSizeM2: number | null;
  counted: boolean;
  slots: BucketValues & { total: number };
  areaM2: BucketValues | null;
  utilPct: number | null;
}

export interface RackSpaceResponse {
  generatedAt: string;
  warehouse: WarehouseSpaceSummary;
  racks: RackSpaceRow[];
}

export interface SpaceSummaryResponse {
  generatedAt: string;
  warehouses: WarehouseSpaceSummary[];
  totals: {
    warehouses: number; withSize: number; totalAreaM2: number; usableAreaM2: number; rackFootprintM2: number;
    freeAreaM2: number; volumeM3: number; racksWithoutSize: number; slots: SlotCounts; stockQty: number; capacityUsedPct: number | null;
  };
}

export interface CapacityPlan {
  warehouseId: string;
  template: { id?: string; code?: string; name?: string; category: RackCategory; lengthCm: number; widthCm: number; heightCm: number; levels: number; columns: number; slotCapacity: number };
  templateFootprintM2: number | null;
  freeAreaM2: number | null;
  racksThatFit: number | null;
  slotsPerRack: number;
  slotsThatFit: number | null;
  slotSize: SlotSize;
  racksWithoutSize: number;
  racksWithoutSizeCodes: string[];
}

export interface PlannedSlot { code: string; level: number; column: number; exists: boolean }
export interface GenerateSlotsResult {
  rackId: string; rackCode: string; levels: number; columns: number;
  total: number; existing: number; toCreate: number; created: number; preview: boolean;
  slotType: string; capacity: number; slotSize: SlotSize; slots: PlannedSlot[];
}

export interface SimLine { productId?: string | null; label?: string; lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null; quantity: number; stackLayers?: number }
export interface SimulateInput {
  mode: 'AREA' | 'SLOTS' | 'ITEMS';
  warehouseIds?: string[];
  areaM2?: number;
  slots?: number;
  palletLengthCm?: number;
  palletWidthCm?: number;
  lines?: SimLine[];
}
export interface SimLineResult {
  label: string; productId: string | null; lengthCm: number | null; widthCm: number | null; heightCm: number | null;
  quantity: number; stackLayers: number; boxesPerLayer: number; boxesPerPallet: number; pallets: number; slots: number;
  areaM2: number; oversize: boolean; error: 'MISSING_SIZE' | null;
}
export interface SimWarehouseFit {
  warehouseId: string; code: string; name: string; freeAreaM2: number | null; emptySlots: number;
  fitsArea: boolean | null; freeAreaAfterM2: number | null; fitsSlots: boolean; emptySlotsAfter: number;
}
export interface SimulationResult {
  mode: 'AREA' | 'SLOTS' | 'ITEMS';
  pallet: { lengthCm: number; widthCm: number };
  requiredAreaM2: number; requiredSlots: number; pallets: number;
  lines: SimLineResult[];
  warehouses: SimWarehouseFit[];
}

export interface SlotChanges { slotType?: string; capacity?: number; maxWeight?: number | null; lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null }

/** DELETE /warehouse-master/racks/:id — soft delete; reports how many slots went with the rack. */
export interface DeleteRackResult { success: boolean; id: string; slotsDeleted: number }

// ── Calls ─────────────────────────────────────────────────────────────────────
export const warehouseSpaceApi = {
  rackTypes: (includeInactive = false) => request<RackTypeMaster[]>(`/warehouse-master/rack-types${includeInactive ? '?includeInactive=true' : ''}`),
  createRackType: (dto: Omit<Partial<RackTypeMaster>, 'id' | '_count' | 'isActive'>) => request<RackTypeMaster>('/warehouse-master/rack-types', json('POST', dto)),
  updateRackType: (id: string, dto: Partial<Omit<RackTypeMaster, 'id' | 'code' | '_count'>>) => request<RackTypeMaster>(`/warehouse-master/rack-types/${id}`, json('PATCH', dto)),

  spaceSummary: (warehouseId?: string) => request<SpaceSummaryResponse>(`/warehouse-master/space-summary${warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : ''}`),
  rackSpace: (warehouseId: string) => request<RackSpaceResponse>(`/warehouse-master/space-summary/${encodeURIComponent(warehouseId)}/racks`),
  planner: (warehouseId: string, rackTypeId: string) =>
    request<CapacityPlan>(`/warehouse-master/space-planner?warehouseId=${encodeURIComponent(warehouseId)}&rackTypeId=${encodeURIComponent(rackTypeId)}`),
  simulate: (input: SimulateInput) => request<SimulationResult>('/warehouse-master/space-simulate', json('POST', input)),

  createWarehouse: (dto: Record<string, unknown>) => request<any>('/warehouse-master/warehouses', json('POST', dto)),
  updateWarehouse: (id: string, dto: Record<string, unknown>) => request<any>(`/warehouse-master/warehouses/${id}`, json('PATCH', dto)),
  createRack: (dto: Record<string, unknown>) => request<any>('/warehouse-master/racks', json('POST', dto)),
  updateRack: (id: string, dto: Record<string, unknown>) => request<any>(`/warehouse-master/racks/${id}`, json('PATCH', dto)),

  // RQ5 — two different states. Inactive: the rack stays in the structure, out of
  // use for now. Deleted: the rack leaves the structure (soft delete) and can be
  // restored. A 409 means something still depends on it; the server says what.
  deactivateRack: (id: string) => request<any>(`/warehouse-master/racks/${id}/deactivate`, json('PATCH', {})),
  activateRack: (id: string) => request<any>(`/warehouse-master/racks/${id}/activate`, json('PATCH', {})),
  restoreRack: (id: string) => request<any>(`/warehouse-master/racks/${id}/restore`, json('PATCH', {})),
  restoreWarehouse: (id: string) => request<any>(`/warehouse-master/warehouses/${id}/restore`, json('PATCH', {})),
  /** Everything soft-deleted and still restorable, with who/when and whether a restore would be refused. */
  deletedRecords: () => request<DeletedRecordsResponse>('/warehouse-master/deleted'),
  /** Soft delete. The result says how many slots were deleted with the rack. */
  deleteRack: (id: string) => request<DeleteRackResult>(`/warehouse-master/racks/${id}`, { method: 'DELETE' }),

  generateSlots: (rackId: string, levels: number, columns: number, preview: boolean) =>
    request<GenerateSlotsResult>(`/warehouse-master/racks/${rackId}/generate-slots`, json('POST', { levels, columns, preview })),
  updateSlot: (id: string, dto: SlotChanges & { name?: string | null }) => request<any>(`/warehouse-master/slots/${id}`, json('PATCH', dto)),
  bulkUpdateSlots: (ids: string[], changes: SlotChanges) => request<{ updated: number }>('/warehouse-master/slots/bulk', json('PATCH', { ids, changes })),
  /** Setup wizard: preview or create whole zones of racks + slots (one transaction). */
  setupRacks: (warehouseId: string, body: SetupRacksBody) =>
    request<SetupRacksResult>(`/warehouse-master/warehouses/${encodeURIComponent(warehouseId)}/setup-racks`, json('POST', body)),
  /** Soft delete; slots with stock in them now are skipped and listed. preview = report only. */
  bulkDeleteSlots: (ids: string[], preview: boolean) => request<BulkDeleteSlotsResult>('/warehouse-master/slots/bulk-delete', json('POST', { ids, preview })),
};

/** Rack code pattern for racks created from now on (C4); a system setting. */
export type RackCodePattern = 'zone-r01' | 'rack-001';

export interface SetupZone { name: string; racks: number }

/**
 * POST /warehouse-master/warehouses/:id/setup-racks — **exactly one** of the two
 * forms (decision C3). Either an existing Rack Type, or a size the server turns
 * into one (found first, created second). Sending a size field beside a
 * `rackTypeId` is a 400 that names the offending fields, so the union here is
 * what stops the UI from ever building such a request.
 */
export type SetupRacksBody =
  | { rackTypeId: string; zones: SetupZone[]; preview?: boolean }
  | {
      lengthCm: number; widthCm: number; heightCm: number;
      /** Default STANDARD_RACK. */
      category?: RackCategory;
      levels?: number; columns?: number; slotCapacity?: number;
      zones: SetupZone[]; preview?: boolean;
    };

export interface SetupRacksResult {
  warehouseId: string;
  rackType: {
    id: string; code: string; name: string; category: RackCategory;
    lengthCm: number; widthCm: number; heightCm: number; levels: number; columns: number;
    /** Preview only: this Rack Type does not exist yet and this run will create it. */
    willBeCreated: boolean;
    /** The resolved Rack Type was made by the wizard from a typed size, not by hand. */
    autoCreated: boolean;
  };
  /** One row per planned rack (RQ26: code, size and its own floor area). */
  racks: { code: string; zone: string; lengthCm: number; widthCm: number; footprintM2: number | null }[];
  slotsPerRack: number;
  totalRacks: number;
  totalSlots: number;
  /** Floor one of these racks takes (m²); null when the size is unknown. */
  rackFootprintM2: number | null;
  /** Pattern the planned codes follow (C4) — new racks only. */
  rackCodePattern: RackCodePattern;
  newFootprintM2: number;
  usedFootprintM2: number;
  usableAreaM2: number | null;
  /** NO_WAREHOUSE_SIZE | OVER_AREA — warn only */
  warnings: string[];
  preview: boolean;
  created: number;
}

export interface BulkDeleteSlotsResult {
  deleted: { id: string; code: string }[];
  blocked: { id: string; code: string; stock: number }[];
  notFound: string[];
  preview: boolean;
}

// ── Deleted but restorable (RQ5) ─────────────────────────────────────────────
// Soft-deleted records are left out of the master tree, so `GET
// /warehouse-master/deleted` is the only way the UI can name them. It is
// read-only, warehouse-scoped, takes nothing and always answers 200 — empty
// lists when nothing is deleted. Because the list comes from the server, a
// record stays restorable after a reload.
export type DeletedKind = 'WAREHOUSE' | 'RACK';

export interface DeletedRecord {
  kind: DeletedKind;
  id: string;
  code: string;
  /** `Rack.name` is nullable. */
  name: string | null;
  isDeleted: true;
  /** What the record will STILL be after a restore — restore undoes the delete only. */
  isActive: boolean;
  /** Racks only: the warehouse it belonged to, so two racks sharing a code are told apart. */
  warehouse: { id: string; code: string; name: string; isDeleted: boolean } | null;
  /** Racks only. */
  zone: string | null;
  deletedAt: string | null;
  deletedBy: { id: string; username: string | null; fullName: string | null } | null;
  /** Racks only; 0 for warehouses. */
  slotsDeleted: number;
  canRestore: boolean;
  /** Set when a restore would be refused (409). WAREHOUSE_DELETED: restore the warehouse first. */
  blocked: { code: 'WAREHOUSE_DELETED'; message: string } | null;
}

export interface DeletedRecordsResponse {
  generatedAt: string;
  /** Newest deletion first, then code. */
  warehouses: DeletedRecord[];
  racks: DeletedRecord[];
  totals: { warehouses: number; racks: number; restorable: number };
}

