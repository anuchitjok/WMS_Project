// Mock data for the Interactive 3D Smart Warehouse. Demo only — nothing here is
// real inventory and nothing is read from or written to the WMS API.
//
// Deterministic: a seeded random generator gives the same warehouse on every
// load, so IDs used in tests and bookmarks stay valid.
//
// Three warehouses:
//   WH01  a typical DC          3 zones, 36 racks,   720 slots
//   WH02  a small hub           2 zones,  8 racks,   128 slots
//   WH03  a large site          4 zones, 128 racks, 3,840 slots (performance check)

import type {
  AisleNode, RackNode, SlotNode, SlotStatus, SmartWarehouseData, WarehouseDataSource, WarehouseNode, ZoneNode,
} from './types';

const PRODUCTS: [string, string][] = [
  ['SKU-10021', 'Air filter 20×25 in'],
  ['SKU-10034', 'Copper cable 2.5 mm² (100 m)'],
  ['SKU-10057', 'LED panel 60×60 40 W'],
  ['SKU-10088', 'Circuit breaker 32 A'],
  ['SKU-10112', 'PVC conduit 20 mm'],
  ['SKU-10140', 'Distribution board 12-way'],
  ['SKU-10163', 'Cable tray 300 mm'],
  ['SKU-10190', 'Smoke detector'],
  ['SKU-10214', 'Ceiling fan 56 in'],
  ['SKU-10239', 'Water pump 1 HP'],
  ['SKU-10261', 'Solar inverter 5 kW'],
  ['SKU-10288', 'Lithium battery 48 V'],
  ['SKU-10302', 'Network switch 24-port'],
  ['SKU-10325', 'CCTV camera 4 MP'],
  ['SKU-10349', 'Fire extinguisher 15 lb'],
  ['SKU-10371', 'Air conditioner 18,000 BTU'],
  ['SKU-10396', 'Steel shelf bracket'],
  ['SKU-10418', 'Safety helmet'],
  ['SKU-10443', 'Cable tie 300 mm (pack)'],
  ['SKU-10467', 'Packing tape 48 mm'],
];

/** mulberry32 — small, fast, seeded. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

interface WarehouseSpec {
  code: string;
  name: string;
  zones: { code: string; name: string }[];
  aislesPerZone: number;
  racksPerSide: number;
  levels: number;
  bays: number;
  seed: number;
}

const SPECS: WarehouseSpec[] = [
  {
    code: 'WH01', name: 'Bangkok DC', seed: 11,
    zones: [{ code: 'A', name: 'Fast movers' }, { code: 'B', name: 'Bulk storage' }, { code: 'C', name: 'Returns & QC' }],
    aislesPerZone: 2, racksPerSide: 3, levels: 4, bays: 5,
  },
  {
    code: 'WH02', name: 'Chonburi Hub', seed: 23,
    zones: [{ code: 'A', name: 'Inbound buffer' }, { code: 'B', name: 'Pick face' }],
    aislesPerZone: 1, racksPerSide: 2, levels: 4, bays: 4,
  },
  {
    code: 'WH03', name: 'Ayutthaya Mega Site', seed: 37,
    zones: [{ code: 'A', name: 'Electrical' }, { code: 'B', name: 'HVAC' }, { code: 'C', name: 'Safety' }, { code: 'D', name: 'Solar' }],
    aislesPerZone: 4, racksPerSide: 4, levels: 5, bays: 6,
  },
];

function pickStatus(r: number, level: number, levels: number): SlotStatus {
  // Upper levels are a little emptier, like a real pick-face layout.
  const lift = ((level - 1) / Math.max(1, levels - 1)) * 0.12;
  if (r < 0.04) return 'blocked';
  if (r < 0.09) return 'inactive';
  if (r < 0.19) return 'reserved';
  if (r < 0.62 - lift) return 'occupied';
  return 'available';
}

export function generateMockWarehouses(): SmartWarehouseData {
  const warehouses: WarehouseNode[] = [];
  const zones: ZoneNode[] = [];
  const aisles: AisleNode[] = [];
  const racks: RackNode[] = [];
  const slots: SlotNode[] = [];

  for (const spec of SPECS) {
    const rand = rng(spec.seed);
    const whId = spec.code;
    warehouses.push({ id: whId, code: spec.code, name: spec.name });
    for (const z of spec.zones) {
      const zoneId = `${whId}-${z.code}`;
      zones.push({ id: zoneId, warehouseId: whId, code: z.code, name: z.name });
      for (let a = 0; a < spec.aislesPerZone; a++) {
        const aisleCode = `${z.code}${pad(a + 1)}`;
        const aisleId = `${zoneId}-${aisleCode}`;
        aisles.push({ id: aisleId, zoneId, warehouseId: whId, code: aisleCode });
        // Odd rack numbers on the left of the aisle, even on the right.
        for (let i = 0; i < spec.racksPerSide * 2; i++) {
          const side = i % 2 === 0 ? 'left' : 'right';
          const rackCode = `R${pad(i + 1)}`;
          const rackId = `${aisleId}-${rackCode}`;
          racks.push({ id: rackId, aisleId, zoneId, warehouseId: whId, code: rackCode, side, levels: spec.levels, bays: spec.bays });
          for (let l = 1; l <= spec.levels; l++) {
            for (let b = 1; b <= spec.bays; b++) {
              const status = pickStatus(rand(), l, spec.levels);
              const capacity = l === 1 ? 60 : 40;
              const [sku, productName] = PRODUCTS[Math.floor(rand() * PRODUCTS.length)];
              const hasStock = status === 'occupied' || (status === 'blocked' && rand() < 0.5);
              const qty = hasStock ? Math.max(1, Math.round(capacity * (0.15 + rand() * 0.85))) : 0;
              const assigned = hasStock || status === 'reserved';
              slots.push({
                id: `${rackId}-L${l}-B${pad(b)}`,
                rackId, aisleId, zoneId, warehouseId: whId,
                level: l, bay: b, status,
                sku: assigned ? sku : null,
                productName: assigned ? productName : null,
                qty, capacity,
              });
            }
          }
        }
      }
    }
  }

  return { warehouses, zones, aisles, racks, slots, asOf: new Date().toISOString() };
}

/**
 * Mock data source with a short delay, so the loading state is visible.
 * `?mockError=1` in the page URL makes it fail, to check the error state.
 */
export const mockDataSource: WarehouseDataSource = {
  load(signal) {
    return new Promise((resolve, reject) => {
      const fail = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mockError') === '1';
      const timer = setTimeout(() => {
        if (fail) reject(new Error('Mock data source failed (mockError=1)'));
        else resolve(generateMockWarehouses());
      }, 450);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); });
    });
  },
};
