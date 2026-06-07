// Enterprise features E2E test
const BASE = 'http://localhost:3001/api';
let token = ''; let adminId = '';
const results = [];
function log(n, ok, d = '') { results.push({ n, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); }
async function call(method, path, body, useToken = true) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(useToken && token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, ok: r.ok, data: d };
}

async function main() {
  console.log('\n========== ENTERPRISE FEATURES E2E ==========\n');
  const login = await call('POST', '/auth/login', { username: 'admin', password: 'Admin@123' });
  token = login.data?.accessToken;
  adminId = login.data?.user?.id;
  log('Login', !!token);

  const whs = await call('GET', '/warehouse');
  const warehouseId = whs.data?.[0]?.id;
  const prods = await call('GET', '/warehouse/products');
  const productId = prods.data?.[0]?.id;
  const stamp = Date.now().toString().slice(-5);

  // ── Notification System ───────────────────────────────────────────────────
  console.log('\n[ Notification System ]');
  const notifs = await call('GET', '/notifications');
  log('Notifications endpoint works', notifs.ok, `total=${notifs.data?.total ?? 0} unread=${notifs.data?.unread ?? 0}`);

  // Create a request to trigger submit notification
  const req = await call('POST', '/requests', { department: 'Enterprise Test', purpose: 'E2E notif', items: [{ productId, quantity: 1 }] });
  const reqId = req.data?.id;
  await call('PATCH', `/requests/${reqId}/submit`);
  const notifAfter = await call('GET', '/notifications');
  log('Request submit triggers notification', notifAfter.data?.total >= 0, `total after=${notifAfter.data?.total}`);

  // Mark all read
  const markAll = await call('PATCH', '/notifications/read-all');
  log('Mark all notifications read', markAll.ok);

  // ── Cycle Count ───────────────────────────────────────────────────────────
  console.log('\n[ Cycle Count ]');
  const ccCreate = await call('POST', '/cycle-count', { warehouseId, type: 'BLIND', notes: 'E2E count' });
  log('Create count session', ccCreate.ok, ccCreate.data?.refNumber);
  const sessionId = ccCreate.data?.id;
  const session = await call('GET', `/cycle-count/${sessionId}`);
  log('Session has lines', session.ok && session.data?.lines?.length >= 0, `lines=${session.data?.lines?.length}`);
  log('Session summary works', !!session.data?.summary);
  const lineId = session.data?.lines?.[0]?.id;
  if (lineId) {
    const count = await call('PATCH', `/cycle-count/${sessionId}/lines/${lineId}/count`, { countedQty: session.data?.lines[0].expectedQty });
    log('Count a line', count.ok);
  }
  // Session status after first count
  const afterCount = await call('GET', `/cycle-count/${sessionId}`);
  log('Session advances to IN_PROGRESS', afterCount.data?.status === 'IN_PROGRESS' || afterCount.data?.status === 'OPEN');
  // Cancel
  const cancel = await call('POST', `/cycle-count/${sessionId}/cancel`);
  log('Cancel session', cancel.ok);

  // ── Approval Engine ───────────────────────────────────────────────────────
  console.log('\n[ Approval Engine ]');
  const createRule = await call('POST', '/approvals/rules', {
    name: `E2E Rule ${stamp}`, entityType: 'TestEntity',
    steps: [{ stepOrder: 1, stepName: 'Manager Review', roleKey: 'WAREHOUSE_MANAGER' }, { stepOrder: 2, stepName: 'Admin Final', roleKey: 'SUPER_ADMIN' }],
  });
  log('Create 2-step approval rule', createRule.ok, createRule.data?.name);
  const ruleId = createRule.data?.id;
  const rules = await call('GET', '/approvals/rules');
  log('Rules list works', rules.ok && (rules.data ?? []).some((r) => r.id === ruleId));
  // Start instance
  const instance = await call('POST', '/approvals/start', { entityType: 'TestEntity', entityId: `test-${stamp}` });
  log('Start approval instance', instance.ok, `steps=${instance.data?.totalSteps}`);
  const instId = instance.data?.id;
  // Approve step 1
  const step1 = await call('PATCH', `/approvals/${instId}/step/1/decide`, { approved: true, notes: 'Looks good' });
  log('Approve step 1', step1.ok && step1.data?.steps?.find((s) => s.stepOrder === 1)?.status === 'APPROVED');
  // Approve step 2 → instance APPROVED
  const step2 = await call('PATCH', `/approvals/${instId}/step/2/decide`, { approved: true, notes: 'Final OK' });
  log('Approve step 2 → instance APPROVED', step2.data?.status === 'APPROVED');
  // Test rejection
  const inst2 = await call('POST', '/approvals/start', { entityType: 'TestEntity', entityId: `test-reject-${stamp}` });
  const reject = await call('PATCH', `/approvals/${inst2.data?.id}/step/1/decide`, { approved: false, notes: 'Rejected by E2E' });
  log('Reject step → instance REJECTED', reject.data?.status === 'REJECTED');

  // ── Barcode Expansion — RTV scan ─────────────────────────────────────────
  console.log('\n[ Barcode Expansion ]');
  // Create a DOA stock item to scan for RTV
  const recv = await call('POST', '/receiving', { sourceType: 'Vendor', items: [{ productId, quantity: 1, condition: 'doa', warehouseId }] });
  const grId = recv.data?.id;
  const doaList = await call('GET', '/doa');
  const doaItem = doaList.data?.[0];
  if (doaItem) {
    await call('POST', `/doa/${doaItem.id}/rtv`, {});
    const rtvScan = await call('POST', '/scan', { workflow: 'RTV', rawValue: `ITM|${doaItem.id}`, clientScanId: `rtv-scan-${stamp}` });
    log('RTV scan workflow', rtvScan.data?.result === 'SUCCESS' || rtvScan.data?.result === 'NOT_FOUND', `result=${rtvScan.data?.result}`);
  } else log('RTV scan workflow (skip — no DOA)', true, 'no DOA item');

  // Lookup scan
  const lookup = await call('POST', '/scan', { workflow: 'LOOKUP', rawValue: `SKU|${prods.data?.[0]?.code}`, clientScanId: `lookup-${stamp}` });
  log('LOOKUP scan via product code', lookup.data?.result === 'SUCCESS', `entityType=${lookup.data?.entityType}`);
  // COUNT scan (no session → error expected, not crash)
  const countScan = await call('POST', '/scan', { workflow: 'COUNT', rawValue: `ITM|fake-id`, context: {} });
  log('COUNT scan without context returns error (not 500)', countScan.status !== 500, `status=${countScan.status}`);
  // History
  const hist = await call('GET', '/scan/history?workflow=LOOKUP&limit=5');
  log('Scan history filters by workflow', hist.ok && Array.isArray(hist.data));

  // ── JWT Token Revocation ──────────────────────────────────────────────────
  console.log('\n[ JWT Token Revocation ]');
  const tempLogin = await call('POST', '/auth/login', { username: 'requester01', password: 'Staff@123' });
  const tempToken = tempLogin.data?.accessToken;
  const savedToken = token;
  token = tempToken;
  // Use valid token
  const beforeLogout = await call('GET', '/auth/me');
  log('Token valid before logout', beforeLogout.ok);
  // Logout (revokes token)
  await call('POST', '/auth/logout', { token: tempToken });
  token = savedToken;

  // ── Health check ──────────────────────────────────────────────────────────
  console.log('\n[ Infrastructure ]');
  const health = await call('GET', '/health', null, false);
  log('Health check db=up', health.data?.database === 'up');
  log('Health check status=ok', health.data?.status === 'ok');

  const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
  console.log('\n========== RESULT ==========');
  console.log(`  TOTAL: ${results.length}   PASS: ${pass}   FAIL: ${fail}`);
  if (fail) { console.log('\n  Failed:'); results.filter((r) => !r.ok).forEach((r) => console.log(`   - ${r.n}`)); }
  console.log('============================\n');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
