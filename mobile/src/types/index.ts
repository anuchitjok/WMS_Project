export interface User {
  id: string;
  username: string;
  email: string;
  role: string;
  warehouseIds: string[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
  statusCode?: number;
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  barcode: string;
  qty: number;
  location: string;
  status: 'ACTIVE' | 'QUARANTINE' | 'DOA' | 'RTV';
  serialNumber?: string;
  warehouseId: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  type: 'PICK' | 'PUTAWAY' | 'RECEIVE' | 'TRANSFER' | 'COUNT';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  dueAt: string;
  assignedTo: string;
  referenceNo: string;
  warehouseId: string;
}

export interface Notification {
  id: string;
  type: 'SLA_ALERT' | 'LOW_STOCK' | 'APPROVAL' | 'SYSTEM';
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export type ScanContext = 'item' | 'location' | 'pick' | 'receive' | 'transfer' | 'count';
