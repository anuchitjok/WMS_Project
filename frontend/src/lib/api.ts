import type { DashboardStats, PaginatedResponse, StockItem, WithdrawalRequest, User, AuditLog } from '@/types';

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('wms_token');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const method = (init.method ?? 'GET').toUpperCase();
  // Only retry idempotent reads — never retry POST/PATCH/DELETE (avoids double-writes)
  const maxAttempts = method === 'GET' ? 3 : 1;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${BASE}/api${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...init.headers,
        },
      });
    } catch (networkErr) {
      lastErr = networkErr;
      if (attempt < maxAttempts) { await sleep(300 * attempt); continue; }
      throw new Error('Network error — please check your connection and try again');
    }

    if (res.status === 401) {
      localStorage.removeItem('wms_token');
      localStorage.removeItem('wms_user');
      if (typeof window !== 'undefined') window.location.href = '/login';
      throw new Error('Unauthorized');
    }

    // Retry transient server errors (5xx) and rate-limit (429) for GETs
    if ((res.status >= 500 || res.status === 429) && attempt < maxAttempts) {
      await sleep(300 * attempt);
      continue;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Request failed' }));
      const msg = Array.isArray(err.message) ? err.message.join(', ') : err.message;
      throw new Error(msg || `Request failed (${res.status})`);
    }

    return res.json();
  }

  throw lastErr instanceof Error ? lastErr : new Error('Request failed');
}

// Auth
export const authApi = {
  login: (username: string, password: string) =>
    request<{ accessToken: string; refreshToken: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  me: () => request<User>('/auth/me'),
  register: (data: { username: string; fullName: string; email?: string; password: string; role?: string; department?: string }) =>
    request<User>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ changed: boolean }>('/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) }),
};

// Inventory
export const inventoryApi = {
  list: (params?: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    if (params) Object.entries(params).forEach(([k, v]) => v != null && q.set(k, String(v)));
    return request<PaginatedResponse<StockItem>>(`/inventory?${q}`);
  },
  get: (id: string) => request<StockItem>(`/inventory/${id}`),
  barcode: (code: string) => request<StockItem>(`/inventory/barcode/${encodeURIComponent(code)}`),
  create: (data: Partial<StockItem>) =>
    request<StockItem>('/inventory', { method: 'POST', body: JSON.stringify(data) }),
  updateStatus: (id: string, status: string) =>
    request<StockItem>(`/inventory/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  updateLocation: (id: string, loc: { warehouseId?: string; rackId?: string; slotId?: string }) =>
    request<StockItem>(`/inventory/${id}/location`, { method: 'PATCH', body: JSON.stringify(loc) }),
  summary: () => request<unknown>('/inventory/summary'),
  kpi: (warehouseId?: string) => request<any>(`/inventory/kpi${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
  enterpriseList: (filter: Record<string, any> = {}) => {
    const q = new URLSearchParams();
    Object.entries(filter).forEach(([k, v]) => { if (v !== undefined && v !== '' && v !== false) q.set(k, String(v)); });
    return request<any>(`/inventory/enterprise-list${q.toString() ? `?${q}` : ''}`);
  },
  detailFull: (id: string) => request<any>(`/inventory/${id}/detail-full`),
};

// Dashboard
export interface DashboardKpis {
  todayReceiving: number;
  pendingPutaway: number;
  pendingApproval: number;
  activeFulfillment: number;
  shipmentToday: number;
  openReturns: number;
  lowStockAlerts: number;
  inventoryAccuracy: number | null; // null = not available (no cycle-count source)
}
export interface InventoryHealth {
  available: number;
  reserved: number;
  picked: number;
  qcHold: number;
  rtvPending: number;
}
export interface ActivityEvent {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  detail: string | null;
  createdAt: string;
  user?: { fullName: string } | null;
}
export const dashboardApi = {
  stats: () => request<DashboardStats>('/dashboard/stats'),
  // Dashboard V2 (now the live dashboard)
  kpis: (warehouseId?: string) =>
    request<DashboardKpis>(`/dashboard/kpis${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
  inventoryHealth: (warehouseId?: string) =>
    request<InventoryHealth>(`/dashboard/inventory-health${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
  activity: (limit = 15) => request<ActivityEvent[]>(`/dashboard/activity?limit=${limit}`),
};

// Requests
export const requestsApi = {
  list: (params?: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    if (params) Object.entries(params).forEach(([k, v]) => v != null && q.set(k, String(v)));
    return request<PaginatedResponse<WithdrawalRequest>>(`/requests?${q}`);
  },
  get: (id: string) => request<WithdrawalRequest>(`/requests/${id}`),
  create: (data: { rmaCaseNumber: string; remark?: string; department?: string; purpose?: string; items: { productId: string; quantity: number }[] }) =>
    request<WithdrawalRequest>('/requests', { method: 'POST', body: JSON.stringify(data) }),
  rmaCases: () => request<any[]>('/requests/rma-cases'),
  productsAvailable: (brandId?: string) =>
    request<any[]>(`/requests/products-available${brandId ? `?brandId=${brandId}` : ''}`),
  submit: (id: string) => request<WithdrawalRequest>(`/requests/${id}/submit`, { method: 'PATCH' }),
  cancel: (id: string) => request<WithdrawalRequest>(`/requests/${id}/cancel`, { method: 'PATCH' }),
  approve: (id: string, approved: boolean, rejectReason?: string) =>
    request<WithdrawalRequest>(`/requests/${id}/approve`, {
      method: 'PATCH',
      body: JSON.stringify({ approved, rejectReason }),
    }),
};

// Users
export const usersApi = {
  list: (role?: string) => request<any[]>(`/users${role ? `?role=${role}` : ''}`),
  get: (id: string) => request<any>(`/users/${id}`),
  create: (dto: any) => request<any>('/users', { method: 'POST', body: JSON.stringify(dto) }),
  update: (id: string, dto: any) => request<any>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  toggle: (id: string) => request<{ id: string; isActive: boolean }>(`/users/${id}/toggle`, { method: 'PATCH' }),
  resetPassword: (id: string) => request<{ tempPassword: string }>(`/users/${id}/reset-password`, { method: 'POST' }),
  forceChange: (id: string) => request<any>(`/users/${id}/force-change`, { method: 'PATCH' }),
  loginHistory: (id: string) => request<any[]>(`/users/${id}/login-history`),
  setWarehouses: (id: string, warehouseIds: string[]) =>
    request<any>(`/users/${id}/warehouses`, { method: 'PATCH', body: JSON.stringify({ warehouseIds }) }),
  setRole: (id: string, roleId: string | null) =>
    request<any>(`/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ roleId }) }),
  remove: (id: string) => request<any>(`/users/${id}`, { method: 'DELETE' }),
};

// Roles & Permissions (RBAC)
export const rolesApi = {
  list: () => request<any[]>('/roles'),
  get: (id: string) => request<any>(`/roles/${id}`),
  permissions: () => request<any[]>('/roles/permissions'),
  matrix: () => request<{ permissions: any[]; roles: any[] }>('/roles/matrix'),
  create: (dto: any) => request<any>('/roles', { method: 'POST', body: JSON.stringify(dto) }),
  clone: (id: string, name: string) => request<any>(`/roles/${id}/clone`, { method: 'POST', body: JSON.stringify({ name }) }),
  toggle: (id: string) => request<any>(`/roles/${id}/toggle`, { method: 'PATCH' }),
  setPermissions: (id: string, permissionCodes: string[]) =>
    request<any>(`/roles/${id}/permissions`, { method: 'PATCH', body: JSON.stringify({ permissionCodes }) }),
  remove: (id: string) => request<any>(`/roles/${id}`, { method: 'DELETE' }),
  createPermission: (dto: { module: string; action: string; description?: string }) =>
    request<any>('/roles/permissions', { method: 'POST', body: JSON.stringify(dto) }),
  deletePermission: (permId: string) => request<any>(`/roles/permissions/${permId}`, { method: 'DELETE' }),
};

// Multi-role assignment (per user)
export const userRolesApi = {
  list: (userId: string) => request<any[]>(`/users/${userId}/role-assignments`),
  assign: (userId: string, dto: { roleId: string; warehouseId?: string; department?: string; expiresAt?: string }) =>
    request<any>(`/users/${userId}/role-assignments`, { method: 'POST', body: JSON.stringify(dto) }),
  unassign: (userId: string, assignmentId: string) =>
    request<any>(`/users/${userId}/role-assignments/${assignmentId}`, { method: 'DELETE' }),
};

// Audit
export const auditApi = {
  list: (params?: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    if (params) Object.entries(params).forEach(([k, v]) => v != null && q.set(k, String(v)));
    return request<AuditLog[]>(`/audit?${q}`);
  },
};

// Warehouse
export const warehouseApi = {
  list: () => request<any[]>('/warehouse'),
  get: (id: string) => request<any>(`/warehouse/${id}`),
  stats: (warehouseId?: string) => request<any>(`/warehouse/stats${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
  products: () => request<any[]>('/warehouse/products'),
  brands: () => request<any[]>('/warehouse/brands'),
  vendors: () => request<any[]>('/warehouse/vendors'),
  // Rack
  createRack: (dto: any) => request<any>('/warehouse/racks', { method: 'POST', body: JSON.stringify(dto) }),
  updateRack: (id: string, dto: any) => request<any>(`/warehouse/racks/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  deleteRack: (id: string) => request<any>(`/warehouse/racks/${id}`, { method: 'DELETE' }),
  // Slot
  createSlot: (rackId: string, dto: any) => request<any>(`/warehouse/racks/${rackId}/slots`, { method: 'POST', body: JSON.stringify(dto) }),
  bulkGenerateSlots: (rackId: string, dto: any) => request<any>(`/warehouse/racks/${rackId}/slots/bulk`, { method: 'POST', body: JSON.stringify(dto) }),
  updateSlot: (id: string, dto: any) => request<any>(`/warehouse/slots/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  deleteSlot: (id: string) => request<any>(`/warehouse/slots/${id}`, { method: 'DELETE' }),
  getSlotDetail: (id: string) => request<any>(`/warehouse/slots/${id}/detail`),
  // Brand Master
  brandsManaged: () => request<any[]>('/warehouse/brands/managed'),
  createBrand: (dto: { code?: string; name: string; contact?: string }) => request<any>('/warehouse/brands', { method: 'POST', body: JSON.stringify(dto) }),
  updateBrand: (id: string, dto: { name?: string; contact?: string; isActive?: boolean }) => request<any>(`/warehouse/brands/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  deleteBrand: (id: string) => request<any>(`/warehouse/brands/${id}`, { method: 'DELETE' }),
  // Vendor Master
  vendorsManaged: () => request<any[]>('/warehouse/vendors/managed'),
  createVendor: (dto: { code: string; name: string; contact?: string; email?: string }) => request<any>('/warehouse/vendors', { method: 'POST', body: JSON.stringify(dto) }),
  updateVendor: (id: string, dto: { name?: string; contact?: string; email?: string; isActive?: boolean }) => request<any>(`/warehouse/vendors/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  deleteVendor: (id: string) => request<any>(`/warehouse/vendors/${id}`, { method: 'DELETE' }),
  // Phase 2: per-brand inventory rollup
  inventoryByBrand: () => request<any[]>('/warehouse/inventory-by-brand'),
};

// Warehouse Master (admin structure management — separate from Operations Control Center)
export const warehouseMasterApi = {
  tree: () => request<any[]>('/warehouse-master'),
  summary: () => request<{ totalWarehouses: number; activeWarehouses: number; totalRacks: number; totalSlots: number }>('/warehouse-master/summary'),
  impact: (entity: 'warehouse' | 'rack' | 'slot', id: string) => request<any>(`/warehouse-master/${entity}/${id}/impact`),
  // Warehouse
  createWarehouse: (dto: { code: string; name: string; location?: string }) => request<any>('/warehouse-master/warehouses', { method: 'POST', body: JSON.stringify(dto) }),
  updateWarehouse: (id: string, dto: { name?: string; location?: string }) => request<any>(`/warehouse-master/warehouses/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  activateWarehouse: (id: string) => request<any>(`/warehouse-master/warehouses/${id}/activate`, { method: 'PATCH', body: '{}' }),
  deactivateWarehouse: (id: string) => request<any>(`/warehouse-master/warehouses/${id}/deactivate`, { method: 'PATCH', body: '{}' }),
  // Rack
  createRack: (dto: any) => request<any>('/warehouse-master/racks', { method: 'POST', body: JSON.stringify(dto) }),
  updateRack: (id: string, dto: any) => request<any>(`/warehouse-master/racks/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  deleteRack: (id: string) => request<any>(`/warehouse-master/racks/${id}`, { method: 'DELETE' }),
  // Slot
  createSlot: (dto: any) => request<any>('/warehouse-master/slots', { method: 'POST', body: JSON.stringify(dto) }),
  updateSlot: (id: string, dto: any) => request<any>(`/warehouse-master/slots/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  deleteSlot: (id: string) => request<any>(`/warehouse-master/slots/${id}`, { method: 'DELETE' }),
};

// Receiving
export interface ReceivingImportRow { rowNumber: number; data: Record<string, any>; errors: string[]; valid: boolean }
export interface ReceivingImportPreview { columns: string[]; rows: ReceivingImportRow[]; summary: { total: number; valid: number; invalid: number } }
export const receivingApi = {
  list: (status?: string) => request<any[]>(`/receiving${status ? `?status=${status}` : ''}`),
  get: (id: string) => request<any>(`/receiving/${id}`),
  create: (dto: any) => request<any>('/receiving', { method: 'POST', body: JSON.stringify(dto) }),
  inspect: (id: string, dto: { items: { itemId: string; inspectedQty: number; inspectionOutcome: string; inspectorNotes?: string; serialNumber?: string; batchNumber?: string }[] }) =>
    request<any>(`/receiving/${id}/inspect`, { method: 'PATCH', body: JSON.stringify(dto) }),
  verify: (id: string) => request<any>(`/receiving/${id}/verify`, { method: 'PATCH' }),
  // Bulk import (one file = one goods receipt)
  importTemplate: () => downloadFile('/receiving/import/template', 'template-receiving.xlsx'),
  importPreview: (file: File) => uploadMultipart<ReceivingImportPreview>('/receiving/import/preview', file),
  importCommit: (header: Record<string, string | undefined>, file: File) =>
    uploadMultipart<any>('/receiving/import/commit', file, header),
};

// Putaway
export const putawayApi = {
  pending: () => request<any[]>('/putaway/pending'),
  confirm: (stockItemId: string, loc: { warehouseId?: string; rackId?: string; slotId?: string }) =>
    request<any>(`/putaway/${stockItemId}/confirm`, { method: 'PATCH', body: JSON.stringify(loc) }),
  fitCheck: (slotId: string, box: { length: number; width: number; height: number }) =>
    request<{ hasSlotDimensions: boolean; fits: boolean | null; box: any; slot: any; occupied: number; capacity: number }>(
      '/putaway/fit-check', { method: 'POST', body: JSON.stringify({ slotId, ...box }) },
    ),
};

// ─── Fulfillment (Unified) ───────────────────────────────────────────────────
export const fulfillmentApi = {
  // Board & visibility
  board: (warehouseId?: string) =>
    request<any>(`/fulfillment/board${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
  list: (status?: string, warehouseId?: string) => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (warehouseId) q.set('warehouseId', warehouseId);
    return request<any[]>(`/fulfillment?${q}`);
  },
  get: (id: string) => request<any>(`/fulfillment/${id}`),
  handoverQueue: (warehouseId?: string) =>
    request<any[]>(`/fulfillment/handover-queue${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),

  // Orchestration
  allocate: (requestId: string) =>
    request<any>(`/fulfillment/allocate/${requestId}`, { method: 'POST' }),
  advance: (id: string, body?: { notes?: string; barcode?: string }) =>
    request<any>(`/fulfillment/${id}/advance`, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  setException: (id: string, status: string, reason?: string) =>
    request<any>(`/fulfillment/${id}/exception`, { method: 'PATCH', body: JSON.stringify({ status, reason }) }),

  // Picking
  confirmPick: (taskId: string, itemId: string, qty: number, barcode?: string) =>
    request<any>(`/fulfillment/${taskId}/items/${itemId}/pick`, {
      method: 'PATCH',
      body: JSON.stringify({ qty, barcode }),
    }),

  // Packing
  startPacking: (taskId: string) =>
    request<any>(`/fulfillment/${taskId}/packing/start`, { method: 'POST' }),
  updatePacking: (taskId: string, dto: { cartonCount?: number; totalWeight?: number; notes?: string }) =>
    request<any>(`/fulfillment/${taskId}/packing`, { method: 'PATCH', body: JSON.stringify(dto) }),
  completePacking: (taskId: string) =>
    request<any>(`/fulfillment/${taskId}/packing/complete`, { method: 'POST' }),

  // Dispatch (Goods Issue)
  createShipment: (taskId: string, dto: { carrier?: string; trackingNumber?: string; receiverName?: string; notes?: string }) =>
    request<any>(`/fulfillment/${taskId}/shipment`, { method: 'POST', body: JSON.stringify(dto) }),
  confirmDispatch: (shipmentId: string) =>
    request<any>(`/fulfillment/shipments/${shipmentId}/dispatch`, { method: 'POST' }),

  // Handover & completion
  // NOTE: field names must match the backend controller DTOs exactly.
  confirmDelivery: (shipmentId: string, dto: { receiverName?: string; podReference?: string; notes?: string }) =>
    request<any>(`/fulfillment/shipments/${shipmentId}/deliver`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  issueToRma: (taskId: string, body: { receiver: string; rmaId?: string }) =>
    request<any>(`/fulfillment/${taskId}/handover/rma`, { method: 'POST', body: JSON.stringify(body) }),
  cancel: (taskId: string, reason?: string) =>
    request<any>(`/fulfillment/${taskId}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
};

// RMA Usage
export const rmaApi = {
  pendingUsage: () => request<any[]>('/rma/pending-usage'),
  confirmUsage: (requestId: string, usage: string, notes?: string) =>
    request<any>(`/rma/${requestId}/usage`, { method: 'PATCH', body: JSON.stringify({ usage, notes }) }),
};

// DOA
export const doaApi = {
  list: () => request<any[]>('/doa'),
  declare: (stockItemId: string, reason: string) =>
    request<any>(`/doa/${stockItemId}/declare`, { method: 'PATCH', body: JSON.stringify({ reason }) }),
  createRtv: (stockItemId: string, vendorId?: string) =>
    request<any>(`/doa/${stockItemId}/rtv`, { method: 'POST', body: JSON.stringify({ vendorId }) }),
};

// Unused Return
export const unusedApi = {
  pending: () => request<any[]>('/unused/pending'),
  returnToStock: (requestId: string) => request<any>(`/unused/${requestId}/return`, { method: 'PATCH' }),
  markDoa: (requestId: string) => request<any>(`/unused/${requestId}/doa`, { method: 'PATCH' }),
};

// Adjustment
export const adjustmentApi = {
  list: (status?: string) => request<any[]>(`/adjustment${status ? `?status=${status}` : ''}`),
  create: (dto: any) => request<any>('/adjustment', { method: 'POST', body: JSON.stringify(dto) }),
  approve: (id: string) => request<any>(`/adjustment/${id}/approve`, { method: 'PATCH' }),
  reject: (id: string) => request<any>(`/adjustment/${id}/reject`, { method: 'PATCH' }),
};

// Transfer
export const transferApi = {
  list: (status?: string) => request<any[]>(`/transfer${status ? `?status=${status}` : ''}`),
  create: (dto: any) => request<any>('/transfer', { method: 'POST', body: JSON.stringify(dto) }),
  complete: (id: string, dest?: any) =>
    request<any>(`/transfer/${id}/complete`, { method: 'PATCH', body: JSON.stringify(dest ?? {}) }),
};

// Products
export const productsApi = {
  list: (search?: string, productType?: string) => {
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    if (productType) q.set('productType', productType);
    const qs = q.toString();
    return request<any[]>(`/products${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => request<any>(`/products/${id}`),
  create: (dto: any) => request<any>('/products', { method: 'POST', body: JSON.stringify(dto) }),
  update: (id: string, dto: any) => request<any>(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  changeStatus: (id: string, productStatus: string) =>
    request<any>(`/products/${id}/status`, { method: 'PATCH', body: JSON.stringify({ productStatus }) }),
  activeForDropdown: () => request<any[]>('/products/active'),
  // KPI & Enterprise
  kpi: () => request<any>('/products/kpi'),
  enterpriseList: (filter: Record<string, any> = {}) => {
    const q = new URLSearchParams();
    Object.entries(filter).forEach(([k, v]) => { if (v !== undefined && v !== '' && v !== false) q.set(k, String(v)); });
    return request<any>(`/products/enterprise-list${q.toString() ? `?${q}` : ''}`);
  },
  detailFull: (id: string) => request<any>(`/products/${id}/detail-full`),
  // Stock Register
  stockRegister: (filter: { search?: string; warehouseId?: string; brandId?: string; productType?: string }) => {
    const q = new URLSearchParams();
    Object.entries(filter).forEach(([k, v]) => { if (v) q.set(k, v); });
    return request<any[]>(`/products/stock-register/list${q.toString() ? `?${q}` : ''}`);
  },
  exportUrl: (format: 'xlsx' | 'csv', filter: Record<string, string> = {}) => {
    const q = new URLSearchParams({ format, ...filter });
    return `${BASE}/api/products/stock-register/export?${q}`;
  },
  templateUrl: () => `${BASE}/api/products/stock-register/template`,
  import: (file: File) => {
    const token = getToken();
    const fd = new FormData();
    fd.append('file', file);
    return fetch(`${BASE}/api/products/stock-register/import`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    }).then(async (r) => {
      const json = await r.json();
      if (!r.ok) throw new Error(json.message ?? 'Import failed');
      return json;
    });
  },
};

// Settings
export const settingsApi = {
  list: () => request<any[]>('/settings'),
  update: (key: string, value: string) =>
    request<any>(`/settings/${key}`, { method: 'PATCH', body: JSON.stringify({ value }) }),
};

// Reports
export type ReportType = 'master-data' | 'balance' | 'receive';
export interface ReportColumn { header: string; key: string }
export interface ReportResult { columns: ReportColumn[]; rows: Record<string, any>[] }
function reportQuery(filters: Record<string, string | undefined> = {}) {
  const q = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) q.set(k, v); });
  const s = q.toString();
  return s ? `?${s}` : '';
}
export const reportsApi = {
  summary: () => request<any>('/reports/summary'),
  data: (report: ReportType, filters: Record<string, string | undefined> = {}) =>
    request<ReportResult>(`/reports/${report}${reportQuery(filters)}`),
  export: (report: ReportType, format: 'xlsx' | 'csv', filters: Record<string, string | undefined> = {}) =>
    downloadFile(`/reports/${report}/export${reportQuery({ ...filters, format })}`, `${report}.${format}`),
};

// RTV
export const rtvApi = {
  list: (status?: string) => request<any[]>(`/rtv${status ? `?status=${status}` : ''}`),
  get: (id: string) => request<any>(`/rtv/${id}`),
  updateStatus: (id: string, status: string) =>
    request<any>(`/rtv/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
};

export const scrapApi = {
  list: (status?: string) => request<any[]>(`/scrap${status ? `?status=${status}` : ''}`),
  get: (id: string) => request<any>(`/scrap/${id}`),
  create: (body: { stockItemId: string; reason: string; description?: string; disposalMethod?: string; quantity?: number }) =>
    request<any>('/scrap', { method: 'POST', body: JSON.stringify(body) }),
  updateStatus: (id: string, status: string) =>
    request<any>(`/scrap/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
};

export const documentsApi = {
  pickingSlipUrl: (requestId: string) => `${BASE}/api/documents/picking-slip/${requestId}`,
  coverSheetUrl: (requestId: string) => `${BASE}/api/documents/cover-sheet/${requestId}`,
  openWithAuth: (url: string) => {
    const token = getToken();
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => { const u = URL.createObjectURL(blob); window.open(u, '_blank'); });
  },
};

// ─── Data Import / Export ────────────────────────────────────────────────────
async function uploadFile<T>(path: string, file: File): Promise<T> {
  const token = getToken();
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${BASE}/api${path}`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, // no Content-Type — browser sets boundary
    body: fd,
  });
  if (res.status === 401) {
    localStorage.removeItem('wms_token');
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Upload failed' }));
    const msg = Array.isArray(err.message) ? err.message.join(', ') : err.message;
    throw new Error(msg || `Upload failed (${res.status})`);
  }
  return res.json();
}

// Upload a file plus optional extra form fields (multipart) — for flows that
// carry header metadata alongside the spreadsheet (e.g. Goods Receiving import).
async function uploadMultipart<T>(path: string, file: File, fields: Record<string, string | undefined> = {}): Promise<T> {
  const token = getToken();
  const fd = new FormData();
  fd.append('file', file);
  Object.entries(fields).forEach(([k, v]) => { if (v != null && v !== '') fd.append(k, v); });
  const res = await fetch(`${BASE}/api${path}`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, // no Content-Type — browser sets boundary
    body: fd,
  });
  if (res.status === 401) {
    localStorage.removeItem('wms_token');
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Upload failed' }));
    const msg = Array.isArray(err.message) ? err.message.join(', ') : err.message;
    throw new Error(msg || `Upload failed (${res.status})`);
  }
  return res.json();
}

// Download an authenticated file (template / export) and trigger browser save
async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const dataioApi = {
  downloadTemplate: (type: string) => downloadFile(`/io/template/${type}`, `template-${type}.xlsx`),
  preview: (type: string, file: File) => uploadFile<any>(`/io/import/${type}/preview`, file),
  commit: (type: string, file: File) => uploadFile<any>(`/io/import/${type}/commit`, file),
  export: (type: string, format: 'xlsx' | 'csv') =>
    downloadFile(`/io/export/${type}?format=${format}`, `${type}.${format}`),
};

// POST then download the returned blob (for label PDFs)
async function downloadPost(path: string, body: any, fallbackName: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${BASE}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({ message: 'Print failed' }))).message || `Print failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fallbackName;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ─── Barcode Scan (Phase 1) ──────────────────────────────────────────────────
export const scanApi = {
  scan: (dto: { workflow: string; rawValue: string; context?: any; clientScanId?: string; deviceId?: string }) =>
    request<any>('/scan', { method: 'POST', body: JSON.stringify(dto) }),
  validate: (rawValue: string) => request<any>('/scan/validate', { method: 'POST', body: JSON.stringify({ rawValue }) }),
  batch: (scans: any[]) => request<any>('/scan/batch', { method: 'POST', body: JSON.stringify({ scans }) }),
  history: (params?: { entityId?: string; serial?: string; workflow?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params) Object.entries(params).forEach(([k, v]) => v != null && q.set(k, String(v)));
    return request<any[]>(`/scan/history?${q}`);
  },
};

// ─── Labels (PDF) ────────────────────────────────────────────────────────────
export const labelsApi = {
  product: (ids: string[]) => downloadPost('/labels/product/print', { ids }, 'labels-product.pdf'),
  serial: (ids: string[]) => downloadPost('/labels/serial/print', { ids }, 'labels-serial.pdf'),
  bin: (locations: string[]) => downloadPost('/labels/bin/print', { locations }, 'labels-bin.pdf'),
};

// ─── Fulfillment v2 (backward-compat aliases → unified /fulfillment) ─────────
// The /fulfillment2 backend controller now proxies to FulfillmentModule.
// These aliases allow existing callers to keep working without change.
//
// @deprecated TODO_REMOVE_AFTER_MIGRATION — prefer `fulfillmentApi`. Remove once
// no component imports `fulfillment2Api` (currently: none).
export const fulfillment2Api = {
  board: (warehouseId?: string) => fulfillmentApi.board(warehouseId),
  list: (status?: string) => fulfillmentApi.list(status),
  get: (id: string) => fulfillmentApi.get(id),
  allocate: (requestId: string) => fulfillmentApi.allocate(requestId),
  advance: (id: string, body?: { notes?: string; barcode?: string }) => fulfillmentApi.advance(id, body),
  confirmPick: (id: string, itemId: string, qty: number, barcode?: string) =>
    fulfillmentApi.confirmPick(id, itemId, qty, barcode),
  setException: (id: string, status: string, reason?: string) => fulfillmentApi.setException(id, status, reason),
};

// ─── Shipments (read-only tracker) ──────────────────────────────────────────
// Packing and dispatch mutations have moved to fulfillmentApi.
// Use fulfillmentApi.startPacking / completePacking / createShipment / confirmDispatch.
export const shipmentApi = {
  list: (status?: string) => request<any[]>(`/shipments${status ? `?status=${status}` : ''}`),
  get: (id: string) => request<any>(`/shipments/${id}`),
  findByTracking: (trackingNumber: string) => request<any>(`/shipments/track/${trackingNumber}`),
};

// ─── Notifications ────────────────────────────────────────────────────────────
export const notifApi = {
  list: (page?: number, limit?: number) => request<any>(`/notifications?page=${page ?? 1}&limit=${limit ?? 20}`),
  markRead: (id: string) => request<any>(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllRead: () => request<any>('/notifications/read-all', { method: 'PATCH' }),
};

// ─── Cycle Count ──────────────────────────────────────────────────────────────
export const cycleCountApi = {
  list: (warehouseId?: string, status?: string) => {
    const q = new URLSearchParams();
    if (warehouseId) q.set('warehouseId', warehouseId);
    if (status) q.set('status', status);
    return request<any[]>(`/cycle-count?${q}`);
  },
  get: (id: string) => request<any>(`/cycle-count/${id}`),
  create: (dto: any) => request<any>('/cycle-count', { method: 'POST', body: JSON.stringify(dto) }),
  countLine: (sessionId: string, lineId: string, countedQty: number) =>
    request<any>(`/cycle-count/${sessionId}/lines/${lineId}/count`, { method: 'PATCH', body: JSON.stringify({ countedQty }) }),
  submit: (id: string) => request<any>(`/cycle-count/${id}/submit`, { method: 'POST' }),
  approve: (id: string) => request<any>(`/cycle-count/${id}/approve`, { method: 'POST' }),
  cancel: (id: string) => request<any>(`/cycle-count/${id}/cancel`, { method: 'POST' }),
};

// ─── Approval Engine ──────────────────────────────────────────────────────────
export const approvalApi = {
  rules: () => request<any[]>('/approvals/rules'),
  list: (entityType?: string) => request<any[]>(`/approvals${entityType ? `?entityType=${entityType}` : ''}`),
  getByEntity: (entityType: string, entityId: string) => request<any>(`/approvals/${entityType}/${entityId}`),
  start: (entityType: string, entityId: string) =>
    request<any>('/approvals/start', { method: 'POST', body: JSON.stringify({ entityType, entityId }) }),
  decide: (instanceId: string, stepOrder: number, approved: boolean, notes?: string) =>
    request<any>(`/approvals/${instanceId}/step/${stepOrder}/decide`, { method: 'PATCH', body: JSON.stringify({ approved, notes }) }),
};
