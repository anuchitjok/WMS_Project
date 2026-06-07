export type UserRole =
  | 'SYSTEM_ADMIN' | 'WAREHOUSE_MANAGER' | 'WAREHOUSE_SUPERVISOR'
  | 'WAREHOUSE_STAFF' | 'REQUESTER' | 'DEPT_APPROVER'
  | 'RMA_TEAM' | 'RTV_OFFICER' | 'FINANCE_VIEWER'
  | 'BRAND_VIEWER' | 'MGMT_VIEWER' | 'AUDITOR';

export type StockStatus =
  | 'PENDING_RECEIVING' | 'PENDING_INSPECTION' | 'AVAILABLE' | 'RESERVED'
  | 'PICKING' | 'PICKED' | 'PACKED' | 'READY_FOR_PICKUP' | 'SHIPPED'
  | 'ISSUED_TO_RMA' | 'CONSUMED' | 'RETURNED_UNUSED' | 'QUARANTINE'
  | 'DAMAGED' | 'DOA' | 'RTV_PENDING' | 'RTV_SHIPPED' | 'CLOSED' | 'CANCELLED';

export type RequestStatus =
  | 'DRAFT' | 'SUBMITTED' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED'
  | 'PICKING' | 'PICKED' | 'PACKED' | 'READY_FOR_PICKUP' | 'SHIPPED'
  | 'ISSUED_TO_RMA' | 'COMPLETED' | 'CANCELLED';

export type RTVStatus =
  | 'RTV_REQUIRED' | 'PENDING_REVIEW' | 'APPROVED' | 'PENDING_SHIPMENT'
  | 'SHIPPED_TO_VENDOR' | 'VENDOR_RECEIVED' | 'REPLACEMENT_PENDING'
  | 'CREDIT_NOTE_PENDING' | 'COMPLETED' | 'REJECTED_BY_VENDOR' | 'CANCELLED';

export interface User {
  id: string;
  username: string;
  fullName: string;
  email?: string;
  role: UserRole;
  department?: string;
  avatarUrl?: string;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  description?: string;
  category?: string;
  unit: string;
  unitCost: number;
  serialControlled: boolean;
  minStock: number;
  isActive: boolean;
  brand?: Brand;
}

export interface Brand {
  id: string;
  code: string;
  name: string;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  location?: string;
  racks?: Rack[];
}

export interface Rack {
  id: string;
  code: string;
  name?: string;
  slots?: Slot[];
}

export interface Slot {
  id: string;
  code: string;
  name?: string;
}

export interface StockItem {
  id: string;
  productId: string;
  serialNumber?: string;
  batchNumber?: string;
  quantity: number;
  status: StockStatus;
  ownershipType: string;
  warehouseId?: string;
  rackId?: string;
  slotId?: string;
  receivedDate: string;
  expiryDate?: string;
  notes?: string;
  updatedAt: string;
  product: Product;
  warehouse?: Warehouse;
  rack?: Rack;
  slot?: Slot;
}

export interface WithdrawalRequest {
  id: string;
  refNumber: string;
  requesterId: string;
  department: string;
  status: RequestStatus;
  priority: string;
  purpose?: string;
  requiredDate?: string;
  rmaCaseNumber?: string;
  approvedAt?: string;
  rejectReason?: string;
  createdAt: string;
  updatedAt: string;
  requester: Pick<User, 'id' | 'fullName' | 'department'>;
  approver?: Pick<User, 'id' | 'fullName'>;
  items: RequestItem[];
}

export interface RequestItem {
  id: string;
  productId: string;
  quantityRequested: number;
  quantityApproved?: number;
  quantityIssued: number;
  serialNumber?: string;
  product: Product;
}

export interface AuditLog {
  id: string;
  userId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  detail?: string;
  ipAddress?: string;
  createdAt: string;
  user?: Pick<User, 'fullName' | 'username'>;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface DashboardStats {
  totals: {
    totalStock: number;
    availableStock: number;
    pendingRequests: number;
    totalProducts: number;
  };
  stockByStatus: { status: StockStatus; _count: { _all: number } }[];
  requestsByStatus: { status: RequestStatus; _count: { _all: number } }[];
  recentAuditLogs: AuditLog[];
  lowStockAlerts: (Product & { _count: { stockItems: number } })[];
}
