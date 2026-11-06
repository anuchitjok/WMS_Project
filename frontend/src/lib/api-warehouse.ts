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

// ── Calls ─────────────────────────────────────────────────────────────────────
export const warehouseSpaceApi = {
  rackTypes: (includeInactive = false) => request<RackTypeMaster[]>(`/warehouse-master/rack-types${includeInactive ? '?includeInactive=true' : ''}`),
  createRackType: (dto: Omit<Partial<RackTypeMaster>, 'id' | '_count' | 'isActive'>) => request<RackTypeMaster>('/warehouse-master/rack-types', json('POST', dto)),
  updateRackType: (id: string, dto: Partial<Omit<RackTypeMaster, 'id' | 'code' | '_count'>>) => request<RackTypeMaster>(`/warehouse-master/rack-types/${id}`, json('PATCH', dto)),

  spaceSummary: (warehouseId?: string) => request<SpaceSummaryResponse>(`/warehouse-master/space-summary${warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : ''}`),
  planner: (warehouseId: string, rackTypeId: string) =>
    request<CapacityPlan>(`/warehouse-master/space-planner?warehouseId=${encodeURIComponent(warehouseId)}&rackTypeId=${encodeURIComponent(rackTypeId)}`),
  simulate: (input: SimulateInput) => request<SimulationResult>('/warehouse-master/space-simulate', json('POST', input)),

  createWarehouse: (dto: Record<string, unknown>) => request<any>('/warehouse-master/warehouses', json('POST', dto)),
  updateWarehouse: (id: string, dto: Record<string, unknown>) => request<any>(`/warehouse-master/warehouses/${id}`, json('PATCH', dto)),
  createRack: (dto: Record<string, unknown>) => request<any>('/warehouse-master/racks', json('POST', dto)),
  updateRack: (id: string, dto: Record<string, unknown>) => request<any>(`/warehouse-master/racks/${id}`, json('PATCH', dto)),

  generateSlots: (rackId: string, levels: number, columns: number, preview: boolean) =>
    request<GenerateSlotsResult>(`/warehouse-master/racks/${rackId}/generate-slots`, json('POST', { levels, columns, preview })),
  updateSlot: (id: string, dto: SlotChanges & { name?: string | null }) => request<any>(`/warehouse-master/slots/${id}`, json('PATCH', dto)),
  bulkUpdateSlots: (ids: string[], changes: SlotChanges) => request<{ updated: number }>('/warehouse-master/slots/bulk', json('PATCH', { ids, changes })),
};
