// Demo data catalogs + helpers. All identifiers are DEMO- prefixed.
export const DEMO_PREFIX = 'DEMO-';

export const DEMO_USERS = [
  { username: 'demo_admin',      fullName: 'Demo Administrator',      role: 'SYSTEM_ADMIN',         department: 'IT',        password: 'Demo@Admin1' },
  { username: 'demo_manager',    fullName: 'Demo Warehouse Manager',  role: 'WAREHOUSE_MANAGER',    department: 'Warehouse',  password: 'Demo@Manager1' },
  { username: 'demo_supervisor', fullName: 'Demo Supervisor',         role: 'WAREHOUSE_SUPERVISOR', department: 'Warehouse',  password: 'Demo@Super1' },
  { username: 'demo_operator',   fullName: 'Demo Operator',           role: 'WAREHOUSE_STAFF',      department: 'Warehouse',  password: 'Demo@Operator1' },
  { username: 'demo_requester',  fullName: 'Demo Requester',          role: 'REQUESTER',            department: 'IT Support', password: 'Demo@Request1' },
] as const;

export const DEMO_BRANDS = [
  { code: 'DEMO-BR-CSCO', name: 'Cisco (Demo)' },
  { code: 'DEMO-BR-DELL', name: 'Dell (Demo)' },
  { code: 'DEMO-BR-HPE',  name: 'HPE (Demo)' },
  { code: 'DEMO-BR-APC',  name: 'APC (Demo)' },
  { code: 'DEMO-BR-UBNT', name: 'Ubiquiti (Demo)' },
  { code: 'DEMO-BR-SYNO', name: 'Synology (Demo)' },
];

export const DEMO_VENDORS = [
  { code: 'DEMO-SUP-1', name: 'Acme Distribution (Demo)',   email: 'sales@acme.demo' },
  { code: 'DEMO-SUP-2', name: 'TechSource Co. (Demo)',      email: 'sales@techsource.demo' },
  { code: 'DEMO-SUP-3', name: 'Global Networks (Demo)',     email: 'sales@globalnet.demo' },
  { code: 'DEMO-SUP-4', name: 'DataCenter Supply (Demo)',   email: 'sales@dcsupply.demo' },
  { code: 'DEMO-SUP-5', name: 'PowerGrid Vendors (Demo)',   email: 'sales@powergrid.demo' },
  { code: 'DEMO-SUP-6', name: 'CableWorks (Demo)',          email: 'sales@cableworks.demo' },
];

export const DEMO_CATEGORIES = ['Networking', 'Server', 'Storage', 'Power', 'Cabling', 'Peripheral', 'Security', 'Cooling'];
export const DEMO_UNITS = ['unit', 'box', 'pcs', 'set'];
export const DEMO_MODELS = ['X100', 'Pro-200', 'MX-9', 'RT-48', 'S3', 'Edge-12', 'V2', 'Lite', 'Max', 'Nano'];
export const DEMO_DEPARTMENTS = ['IT Support', 'Network Ops', 'Data Center', 'Field Service', 'Facilities'];

export const DEMO_WAREHOUSE = { code: 'DEMO-WH1', name: 'Demo Distribution Center', location: 'Bangkok (Demo)' };

export const r = {
  int: (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min,
  pick: <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)],
  chance: (p: number) => Math.random() < p,
  daysAgo: (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; },
  today: () => { const d = new Date(); d.setHours(9, 0, 0, 0); return d; },
};

export const pad = (n: number, w = 4) => String(n).padStart(w, '0');
