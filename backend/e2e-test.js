// End-to-end API test for HSNT WMS — full workflow + all new modules
const BASE = 'http://localhost:3001/api';
let token = '';
const results = [];

async function call(method, path, body, expectFail = false) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { ok: res.ok, status: res.status, data };
}

function log(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function main() {
  console.log('\n========== HSNT WMS — END-TO-END TEST ==========\n');

  // 1. AUTH
  console.log('[ Auth ]');
  const login = await call('POST', '/auth/login', { username: 'admin', password: 'Admin@123' });
  token = login.data?.accessToken;
  log('Login admin', login.ok && !!token);

  // 2. MASTER DATA
  console.log('\n[ Master Data ]');
  const brands = await call('GET', '/warehouse/brands');
  const whs = await call('GET', '/warehouse');
  const prodCode = 'TEST-' + Date.now().toString().slice(-6);
  const createProd = await call('POST', '/products', {
    code: prodCode, name: 'E2E Test Product', category: 'Spare Part',
    brandId: brands.data?.[0]?.id, unitCost: 100, minStock: 2,
  });
  log('Create product master', createProd.ok, prodCode);
  const productId = createProd.data?.id;
  const warehouseId = whs.data?.[0]?.id;
  log('Product list', (await call('GET', '/products')).ok);

  // 3. RECEIVING -> VERIFY -> PUTAWAY
  console.log('\n[ Receiving → Putaway ]');
  const recv = await call('POST', '/receiving', {
    sourceType: 'Vendor',
    items: [{ productId, quantity: 10, condition: 'good', warehouseId }],
  });
  log('Create goods receiving', recv.ok, recv.data?.refNumber);
  const grId = recv.data?.id;
  const verify = await call('PATCH', `/receiving/${grId}/verify`);
  log('Verify receiving', verify.ok);
  const putawayPending = await call('GET', '/putaway/pending');
  log('Putaway pending list', putawayPending.ok, `${putawayPending.data?.length} items`);
  const toPutaway = putawayPending.data?.find((i) => i.product?.code === prodCode);
  if (toPutaway) {
    const conf = await call('PATCH', `/putaway/${toPutaway.id}/confirm`, { warehouseId });
    log('Confirm putaway → AVAILABLE', conf.ok && conf.data?.status === 'AVAILABLE');
  } else log('Confirm putaway → AVAILABLE', false, 'item not found in queue');

  // 4. REQUEST -> APPROVE -> FULFILLMENT -> HANDOVER
  console.log('\n[ Request → Approve → Fulfillment → Handover ]');
  const req = await call('POST', '/requests', {
    department: 'RMA Service', purpose: 'E2E test', rmaCaseNumber: 'RMA-E2E-001',
    items: [{ productId, quantity: 1 }],
  });
  log('Create withdrawal request', req.ok, req.data?.refNumber);
  const reqId = req.data?.id;
  log('Submit request', (await call('PATCH', `/requests/${reqId}/submit`)).ok);
  log('Approve request', (await call('PATCH', `/requests/${reqId}/approve`, { approved: true })).ok);
  // fulfillment: APPROVED -> PICKING -> PICKED -> PACKED -> READY_FOR_PICKUP
  let adv = 0;
  for (let i = 0; i < 4; i++) { const r = await call('PATCH', `/fulfillment/${reqId}/advance`); if (r.ok) adv++; }
  log('Fulfillment advance x4 (→ Ready for Pickup)', adv === 4, `${adv}/4 steps`);
  const board = await call('GET', '/fulfillment/board');
  log('Fulfillment board', board.ok);
  const hoQueue = await call('GET', '/fulfillment/handover-queue');
  log('Handover queue', hoQueue.ok, `${hoQueue.data?.length} items`);
  const ho = await call('PATCH', `/fulfillment/${reqId}/handover`, { receiver: 'E2E Tester' });
  log('Confirm handover → Issued to RMA', ho.ok && ho.data?.status === 'ISSUED_TO_RMA');

  // 5. RMA USAGE
  console.log('\n[ RMA Usage ]');
  const usageQueue = await call('GET', '/rma/pending-usage');
  log('RMA pending usage list', usageQueue.ok);
  const usage = await call('PATCH', `/rma/${reqId}/usage`, { usage: 'USED', notes: 'E2E consumed' });
  log('Confirm RMA usage USED → Completed', usage.ok && usage.data?.status === 'COMPLETED');

  // 6. DOA + RTV (separate stock item via receiving DOA)
  console.log('\n[ DOA → RTV ]');
  const doaRecv = await call('POST', '/receiving', { sourceType: 'Vendor', items: [{ productId, quantity: 1, condition: 'doa', warehouseId }] });
  log('Receive DOA item', doaRecv.ok);
  const doaList = await call('GET', '/doa');
  log('DOA list', doaList.ok, `${doaList.data?.length} items`);
  const doaItem = doaList.data?.[0];
  if (doaItem) {
    const rtv = await call('POST', `/doa/${doaItem.id}/rtv`, {});
    log('Create RTV from DOA', rtv.ok, rtv.data?.refNumber);
  } else log('Create RTV from DOA', false, 'no DOA item');
  const rtvList = await call('GET', '/rtv');
  log('RTV case list', rtvList.ok, `${rtvList.data?.length} cases`);
  if (rtvList.data?.[0]) {
    const adv = await call('PATCH', `/rtv/${rtvList.data[0].id}/status`, { status: 'PENDING_REVIEW' });
    log('Advance RTV status', adv.ok);
  }

  // 7. UNUSED RETURN (full cycle)
  console.log('\n[ Unused Return ]');
  const req2 = await call('POST', '/requests', { department: 'RMA Service', purpose: 'unused test', rmaCaseNumber: 'RMA-E2E-002', items: [{ productId, quantity: 1 }] });
  const req2Id = req2.data?.id;
  await call('PATCH', `/requests/${req2Id}/submit`);
  await call('PATCH', `/requests/${req2Id}/approve`, { approved: true });
  for (let i = 0; i < 5; i++) await call('PATCH', `/fulfillment/${req2Id}/advance`); // → ISSUED_TO_RMA
  const unusedSet = await call('PATCH', `/rma/${req2Id}/usage`, { usage: 'UNUSED' });
  log('Mark request UNUSED', unusedSet.ok);
  const unusedPending = await call('GET', '/unused/pending');
  log('Unused return queue', unusedPending.ok, `${unusedPending.data?.length} items`);
  const ret = await call('PATCH', `/unused/${req2Id}/return`);
  log('Return unused to stock', ret.ok && ret.data?.status === 'COMPLETED');

  // 8. ADJUSTMENT
  console.log('\n[ Stock Adjustment ]');
  const adj = await call('POST', '/adjustment', { productLabel: prodCode, reason: 'Cycle count', quantityBefore: 10, quantityAfter: 9 });
  log('Create adjustment', adj.ok, adj.data?.refNumber);
  log('Approve adjustment', (await call('PATCH', `/adjustment/${adj.data?.id}/approve`)).ok);
  log('Adjustment list', (await call('GET', '/adjustment')).ok);

  // 9. TRANSFER
  console.log('\n[ Stock Transfer ]');
  const trf = await call('POST', '/transfer', { productLabel: prodCode, quantity: 2, fromLocation: 'WH-MAIN/R-01/S-A1', toLocation: 'WH-MAIN/R-02/S-B1' });
  log('Create transfer', trf.ok, trf.data?.refNumber);
  log('Complete transfer', (await call('PATCH', `/transfer/${trf.data?.id}/complete`, {})).ok);

  // 10. SETTINGS + REPORTS + DASHBOARD + AUDIT
  console.log('\n[ Settings / Reports / Dashboard / Audit ]');
  const settings = await call('GET', '/settings');
  log('Settings list (auto-seed)', settings.ok, `${settings.data?.length} settings`);
  if (settings.data?.[0]) log('Update setting', (await call('PATCH', `/settings/${settings.data[0].key}`, { value: 'updated' })).ok);
  log('Reports summary', (await call('GET', '/reports/summary')).ok);
  log('Dashboard stats', (await call('GET', '/dashboard/stats')).ok);
  log('Audit trail', (await call('GET', '/audit')).ok);

  // 11. RBAC negative test — requester cannot create product
  console.log('\n[ RBAC Enforcement ]');
  const rLogin = await call('POST', '/auth/login', { username: 'requester01', password: 'Staff@123' });
  const savedToken = token;
  token = rLogin.data?.accessToken;
  const forbidden = await call('POST', '/products', { code: 'HACK', name: 'x' });
  log('Requester BLOCKED from creating product (403)', forbidden.status === 403, `got ${forbidden.status}`);
  token = savedToken;

  // SUMMARY
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log('\n========== RESULT ==========');
  console.log(`  TOTAL: ${results.length}   PASS: ${pass}   FAIL: ${fail}`);
  if (fail > 0) {
    console.log('\n  Failed tests:');
    results.filter((r) => !r.ok).forEach((r) => console.log(`   - ${r.name}`));
  }
  console.log('============================\n');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
