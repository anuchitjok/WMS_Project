// Phase 1 + 2 comprehensive E2E test
const BASE = 'http://localhost:3001/api';
let token = '';
const results = [];
function log(n, ok, d = '') { results.push({ n, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); }
async function call(method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, ok: r.ok, data: d };
}

async function main() {
  console.log('\n========== PHASE 1 + 2 E2E ==========\n');
  token = (await call('POST', '/auth/login', { username: 'admin', password: 'Admin@123' })).data?.accessToken;
  log('Login', !!token);

  const whs = await call('GET', '/warehouse');
  const warehouseId = whs.data?.[0]?.id;
  const brands = await call('GET', '/warehouse/brands');
  const stamp = Date.now().toString().slice(-6);

  // ── Phase 1: Product fields ──────────────────────────────────────────────
  console.log('\n[ Phase 1: Product Master Enhancement ]');
  const p1 = await call('POST', '/products', {
    code: `P1-${stamp}`, name: 'Test Scanner Model X',
    manufacturer: 'Zebra Technologies', model: `TC52-${stamp}`, partNumber: `PN-${stamp}`,
    productType: 'SPARE_PART', serialControlled: true,
    description: 'A'.repeat(500) + ' detailed description for testing long text',
    brandId: brands.data?.[0]?.id, unitCost: 999, minStock: 3,
  });
  log('Create product with new fields', p1.ok && p1.data?.manufacturer === 'Zebra Technologies', `code=${p1.data?.code}`);
  log('productType SPARE_PART', p1.data?.productType === 'SPARE_PART');
  log('serialControlled = true', p1.data?.serialControlled === true);
  log('partNumber unique set', !!p1.data?.partNumber);
  log('description long text stored', (p1.data?.description?.length ?? 0) > 100);
  const productId = p1.data?.id;

  // partNumber uniqueness
  const dupPn = await call('POST', '/products', { code: `DUP-${stamp}`, name: 'dup', partNumber: `PN-${stamp}` });
  log('Duplicate partNumber rejected (409)', dupPn.status === 409, `got ${dupPn.status}`);

  // search by manufacturer
  const srch = await call('GET', `/products?search=Zebra`);
  log('Search by manufacturer works', (srch.data ?? []).some((p) => p.manufacturer === 'Zebra Technologies'));

  // productType filter
  const filtered = await call('GET', '/products?productType=SPARE_PART');
  log('productType filter works', Array.isArray(filtered.data) && filtered.data.every((p) => p.productType === 'SPARE_PART'));

  // serialRequired enforcement in receiving
  const recvBadSerial = await call('POST', '/receiving', { sourceType: 'Vendor', items: [{ productId, quantity: 1, condition: 'good', warehouseId }] });
  log('serialRequired blocks receiving without serial (400)', recvBadSerial.status === 400, recvBadSerial.data?.message);

  // receiving with serial passes
  const sn = `SN-P1-${stamp}`;
  const recvOk = await call('POST', '/receiving', { sourceType: 'Vendor', items: [{ productId, quantity: 1, condition: 'good', warehouseId, serialNumber: sn }] });
  log('Receiving with serial passes', recvOk.ok, recvOk.data?.refNumber);
  const grId = recvOk.data?.id;
  await call('PATCH', `/receiving/${grId}/verify`);
  const pend = await call('GET', '/putaway/pending');
  const putItem = (pend.data || []).find((i) => i.product?.code === `P1-${stamp}`);
  if (putItem) await call('PATCH', `/putaway/${putItem.id}/confirm`, { warehouseId });

  // ── Phase 2: FulfillmentTask ──────────────────────────────────────────────
  console.log('\n[ Phase 2: Fulfillment v2 — Allocation ]');
  // Create a product without serial + another stock for the request
  const p2 = await call('POST', '/products', { code: `P2-${stamp}`, name: 'P2 No Serial', unitCost: 100, minStock: 1 });
  const pid2 = p2.data?.id;
  const rcv2 = await call('POST', '/receiving', { sourceType: 'Vendor', items: [{ productId: pid2, quantity: 3, condition: 'good', warehouseId }] });
  await call('PATCH', `/receiving/${rcv2.data?.id}/verify`);
  const pnd2 = await call('GET', '/putaway/pending');
  const pi2 = (pnd2.data || []).find((i) => i.product?.code === `P2-${stamp}`);
  if (pi2) await call('PATCH', `/putaway/${pi2.id}/confirm`, { warehouseId });

  // Create + approve request
  const req = await call('POST', '/requests', { department: 'Phase2 Test', purpose: 'E2E P2', items: [{ productId: pid2, quantity: 1 }] });
  const reqId = req.data?.id;
  await call('PATCH', `/requests/${reqId}/submit`);
  const approved = await call('PATCH', `/requests/${reqId}/approve`, { approved: true });
  log('Request approved', approved.ok);

  // Allocate FulfillmentTask
  const alloc = await call('POST', `/fulfillment2/allocate/${reqId}`);
  log('FulfillmentTask created (ALLOCATED)', alloc.ok && alloc.data?.status === 'ALLOCATED', alloc.data?.refNumber);
  const taskId = alloc.data?.id;

  // Double-allocate blocked
  const dblAlloc = await call('POST', `/fulfillment2/allocate/${reqId}`);
  log('Double-allocate blocked (409)', dblAlloc.status === 409, `got ${dblAlloc.status}`);

  // Kanban board includes new task
  const board = await call('GET', '/fulfillment2/board');
  log('Board includes allocated task', board.ok && (board.data?.allocated ?? []).some((t) => t.id === taskId));

  // Advance: ALLOCATED → PICKING → PICKED
  await call('PATCH', `/fulfillment2/${taskId}/advance`); // → PICKING
  const advanced = await call('PATCH', `/fulfillment2/${taskId}/advance`); // → PICKED
  log('Advanced to PICKED', advanced.data?.status === 'PICKED');

  // Confirm individual item pick
  const taskDetail = await call('GET', `/fulfillment2/${taskId}`);
  const itemId = taskDetail.data?.items?.[0]?.id;
  const pickConfirm = await call('PATCH', `/fulfillment2/${taskId}/items/${itemId}/pick`, { qty: 1, barcode: 'TEST-SCAN' });
  log('Item pick confirmed', pickConfirm.ok && pickConfirm.data?.qtyPicked === 1);

  // Double-pick prevented
  const dblPick = await call('PATCH', `/fulfillment2/${taskId}/items/${itemId}/pick`, { qty: 1 });
  log('Double-pick blocked (409)', dblPick.status === 409, `got ${dblPick.status}`);

  // Progress % updated
  const afterPick = await call('GET', `/fulfillment2/${taskId}`);
  log('Progress % calculated', (afterPick.data?.progressPct ?? 0) > 0, `pct=${afterPick.data?.progressPct}`);

  // Advance → PACKING
  await call('PATCH', `/fulfillment2/${taskId}/advance`); // PICKED → PACKING

  // Packing session
  const pack = await call('POST', `/shipments/packing/${taskId}/start`);
  log('Packing session created', pack.ok);
  await call('PATCH', `/shipments/packing/${taskId}`, { cartonCount: 2, totalWeight: 1.5, notes: 'Fragile' });
  const packDone = await call('POST', `/shipments/packing/${taskId}/complete`);
  log('Packing completed → PACKED', packDone.ok, packDone.data?.task?.status);

  // Create Shipment
  const sh = await call('POST', `/shipments/${taskId}/create`, { carrier: 'DHL', trackingNumber: `DHL-${stamp}`, receiverName: 'Test Receiver' });
  log('Shipment created', sh.ok, sh.data?.refNumber);
  const shipId = sh.data?.id;
  log('Shipment has carrier+tracking', sh.data?.carrier === 'DHL' && sh.data?.trackingNumber === `DHL-${stamp}`);

  // Confirm ship
  const shipped = await call('POST', `/shipments/${shipId}/ship`);
  log('Confirmed shipped', shipped.ok && shipped.data?.shippedAt !== null);

  // Delivery
  const delivered = await call('POST', `/shipments/${shipId}/deliver`);
  log('Confirmed delivered', delivered.ok && delivered.data?.deliveredAt !== null);

  // Task timeline audit
  const finalTask = await call('GET', `/fulfillment2/${taskId}`);
  log('Timeline recorded all steps', (finalTask.data?.timeline?.length ?? 0) >= 4, `entries=${finalTask.data?.timeline?.length}`);

  // Exception handling — first receive more stock
  const rcv3 = await call('POST', '/receiving', { sourceType: 'Vendor', items: [{ productId: pid2, quantity: 2, condition: 'good', warehouseId }] });
  await call('PATCH', `/receiving/${rcv3.data?.id}/verify`);
  const pnd3 = await call('GET', '/putaway/pending');
  const pi3 = (pnd3.data || []).find((i) => i.product?.code === `P2-${stamp}`);
  if (pi3) await call('PATCH', `/putaway/${pi3.id}/confirm`, { warehouseId });

  const excReq = await call('POST', '/requests', { department: 'Exception Test', purpose: 'E2E exc', items: [{ productId: pid2, quantity: 1 }] });
  const excId = excReq.data?.id;
  await call('PATCH', `/requests/${excId}/submit`);
  await call('PATCH', `/requests/${excId}/approve`, { approved: true });
  const excAlloc = await call('POST', `/fulfillment2/allocate/${excId}`);
  const excTaskId = excAlloc.data?.id;
  const exc = await call('PATCH', `/fulfillment2/${excTaskId}/exception`, { status: 'DAMAGED', reason: 'Dropped during pick' });
  log('Exception status set (DAMAGED)', exc.ok && exc.data?.status === 'DAMAGED');

  // ── Summary ───────────────────────────────────────────────────────────────
  const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
  console.log('\n========== RESULT ==========');
  console.log(`  TOTAL: ${results.length}   PASS: ${pass}   FAIL: ${fail}`);
  if (fail) { console.log('\n  Failed:'); results.filter((r) => !r.ok).forEach((r) => console.log(`   - ${r.n}`)); }
  console.log('============================\n');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
