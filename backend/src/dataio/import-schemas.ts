// Central column definitions for each importable entity.
// Used to generate templates, parse uploads, and validate rows.

export interface ColumnSpec {
  key: string;
  header: string;
  required?: boolean;
  example?: string | number;
  hint?: string;
}

export type ImportType = 'products' | 'inventory' | 'users' | 'warehouse' | 'serials';

export const IMPORT_SCHEMAS: Record<ImportType, { label: string; columns: ColumnSpec[] }> = {
  products: {
    label: 'Product Master',
    columns: [
      { key: 'code', header: 'code', required: true, example: 'SW-2960X', hint: 'Unique part number' },
      { key: 'name', header: 'name', example: 'Cisco Catalyst 2960-X', hint: 'Required unless description is filled (the description is then used as the name)' },
      { key: 'category', header: 'category', example: 'Network' },
      { key: 'unit', header: 'unit', example: 'unit' },
      { key: 'unitCost', header: 'unitCost', example: 4500, hint: 'Number >= 0' },
      { key: 'minStock', header: 'minStock', example: 2, hint: 'Number >= 0' },
      { key: 'serialControlled', header: 'serialControlled', example: 'false', hint: 'true / false' },
      { key: 'brandCode', header: 'brandCode', example: 'CISCO', hint: 'Existing brand code (optional). Brand + SKU must be unique' },
      // Added in plan P2 (2.1/2.4/2.5) — appended after the original headers, which never change.
      { key: 'partNumber', header: 'partNumber', example: 'WS-C2960X-24TS-L', hint: 'Inventory ID / SKU (optional, unique). Brand + SKU must be unique' },
      { key: 'description', header: 'description', example: 'Cisco Catalyst 2960-X 24 port switch', hint: 'Description (optional). Used as the name when name is blank' },
      { key: 'model', header: 'model', example: '2960-X', hint: 'Model, free text (optional)' },
      { key: 'productType', header: 'productType', example: 'SPARE_PART', hint: 'Item Type: SPARE_PART or FINISHED_GOODS (default SPARE_PART)' },
      { key: 'partType', header: 'partType', example: 'Mainboard', hint: 'Part Type, free text (optional)' },
      { key: 'defaultPrice', header: 'defaultPrice', example: 5900, hint: 'Default Price, number >= 0 (optional)' },
      { key: 'lengthCm', header: 'lengthCm', example: 45, hint: 'Box length in cm, number >= 0 (optional)' },
      { key: 'widthCm', header: 'widthCm', example: 30, hint: 'Box width in cm, number >= 0 (optional)' },
      { key: 'heightCm', header: 'heightCm', example: 8, hint: 'Box height in cm, number >= 0 (optional)' },
    ],
  },
  inventory: {
    label: 'Inventory Stock',
    columns: [
      { key: 'productCode', header: 'productCode', required: true, example: 'SW-2960X', hint: 'Existing product code' },
      { key: 'serialNumber', header: 'serialNumber', example: 'CSC-001-2024' },
      { key: 'batchNumber', header: 'batchNumber', example: 'BATCH-01' },
      { key: 'quantity', header: 'quantity', required: true, example: 1, hint: 'Number >= 1' },
      { key: 'status', header: 'status', example: 'AVAILABLE', hint: 'AVAILABLE / RESERVED / ...' },
      { key: 'ownershipType', header: 'ownershipType', example: 'OWN', hint: 'OWN / CONSIGNMENT / RMA / CUSTOMER' },
      { key: 'warehouseCode', header: 'warehouseCode', example: 'WH-MAIN', hint: 'Existing warehouse code' },
    ],
  },
  users: {
    label: 'Users',
    columns: [
      { key: 'username', header: 'username', required: true, example: 'jdoe' },
      { key: 'fullName', header: 'fullName', required: true, example: 'John Doe' },
      { key: 'email', header: 'email', example: 'jdoe@hsnt.co.th' },
      { key: 'role', header: 'role', required: true, example: 'WAREHOUSE_STAFF', hint: 'Valid UserRole enum' },
      { key: 'department', header: 'department', example: 'Warehouse' },
      { key: 'password', header: 'password', example: 'Welcome@123', hint: 'Default if blank: Welcome@123' },
    ],
  },
  warehouse: {
    label: 'Warehouse Locations',
    columns: [
      { key: 'warehouseCode', header: 'warehouseCode', required: true, example: 'WH-MAIN' },
      { key: 'warehouseName', header: 'warehouseName', required: true, example: 'Main Warehouse' },
      { key: 'location', header: 'location', example: 'Building A' },
      { key: 'rackCode', header: 'rackCode', example: 'R-01', hint: 'Creates rack under warehouse' },
      { key: 'slotCode', header: 'slotCode', example: 'S-A1', hint: 'Creates slot under rack' },
    ],
  },
  serials: {
    label: 'Serial Numbers',
    columns: [
      { key: 'productCode', header: 'productCode', required: true, example: 'SW-2960X' },
      { key: 'serialNumber', header: 'serialNumber', required: true, example: 'CSC-001-2024' },
      { key: 'warehouseCode', header: 'warehouseCode', example: 'WH-MAIN' },
      { key: 'status', header: 'status', example: 'AVAILABLE' },
    ],
  },
};

export type ExportType = 'inventory' | 'audit' | 'requests' | 'reports';
