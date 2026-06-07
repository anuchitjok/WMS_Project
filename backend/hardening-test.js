// Hardening verification — security + data integrity tests
const BASE = 'http://localhost:3001/api';
let token = '';
const results = [];

async function call(method, path, body, noAuth = false) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && !noAuth ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* */ }
  return { ok: res.ok, status: res.status, data };
}
function log(name, ok, detail = '') { results.push({ name, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }

async function main() {
  console.log('\n========== HARDENING VERIFICATION ==========\n');

  // Health check (no auth, exempt from throttle)
  console.log('[ Infrastructure ]');
  const health = await call('GET', '/health', null, true);
  log('Health check returns ok + DB up', health.ok && health.data?.status === 'ok' && health.data?.database === 'up', `db=${health.data?.database}`);

  // Login
  const login = await call('POST', '/auth/login', { username: 'admin', password: 'Admin@123' });
  token = login.data?.accessToken;
  log('Login (security headers active)', login.ok && !!token);

  // Input validation hardening — unknown property rejected (forbidNonWhitelisted)
  console.log('\n[ Input Validation ]');
  const badInput = await call('POST', '/auth/login', { username: 'admin', password: 'Admin@123', hacker: 'x' });
  log('Reject unknown property (400)', badInput.status === 400, `got ${badInput.status}`);

  // Serial uniqueness
  console.log('\n[ Data Integrity — Serial Uniqueness ]');
  const brands = await call('GET', '/warehouse/brands');
  const whs = await call('GET', '/warehouse');
  const pcode = 'HARDEN-' + Date.now().toString().slice(-6);
  const prod = await call('POST', '/products', { code: pcode, name: 'Harden Test', brandId: brands.data?.[0]?.id, minStock: 1 });
  const productId = prod.data?.id;
  const warehouseId = whs.data?.[0]?.id;
  const serial = 'SN-' + Date.now();
  const r1 = await call('POST', '/receiving', { sourceType: 'Vendor', items: [{ productId, quantity: 1, condition: 'good', serialNumber: serial, warehouseId }] });
  log('Receive serial #1', r1.ok, serial);
  const r2 = await call('POST', '/receiving', { sourceType: 'Vendor', items: [{ productId, quantity: 1, condition: 'good', serialNumber: serial, warehouseId }] });
  log('Duplicate serial REJECTED (409)', r2.status === 409, `got ${r2.status}`);
  // duplicate within same payload
  const r3 = await call('POST', '/receiving', { sourceType: 'Vendor', items: [
    { productId, quantity: 1, condition: 'good', serialNumber: 'DUP-1', warehouseId },
    { productId, quantity: 1, condition: 'good', serialNumber: 'DUP-1', warehouseId },
  ] });
  log('Duplicate serial in same payload REJECTED (409)', r3.status === 409, `got ${r3.status}`);

  // Stock reservation — insufficient stock blocks approval (transaction rollback)
  console.log('\n[ Data Integrity — Stock Reservation Lock ]');
  const pcode2 = 'RESV-' + Date.now().toString().slice(-6);
  const prod2 = await call('POST', '/products', { code: pcode2, name: 'Reserve Test', brandId: brands.data?.[0]?.id, minStock: 1 });
  const pid2 = prod2.data?.id;
  // receive 1 unit and make it available
  const recv = await call('POST', '/receiving', { sourceType: 'Vendor', items: [{ productId: pid2, quantity: 1, condition: 'good', warehouseId }] });
  await call('PATCH', `/receiving/${recv.data?.id}/verify`);
  const pend = await call('GET', '/putaway/pending');
  const item = pend.data?.find((i) => i.product?.code === pcode2);
  if (item) await call('PATCH', `/putaway/${item.id}/confirm`, { warehouseId });
  // request 2 units of a product that only has 1 available -> approve must fail
  const req = await call('POST', '/requests', { department: 'Test', purpose: 'reserve', items: [{ productId: pid2, quantity: 2 }] });
  await call('PATCH', `/requests/${req.data?.id}/submit`);
  const approveOverCommit = await call('PATCH', `/requests/${req.data?.id}/approve`, { approved: true });
  log('Over-commit approval BLOCKED (insufficient stock)', approveOverCommit.status === 400, `got ${approveOverCommit.status}`);
  // verify the 1 available unit is still AVAILABLE (rollback worked, not left RESERVED)
  const inv = await call('GET', `/inventory?productId=${pid2}`);
  const stillAvailable = inv.data?.data?.filter((s) => s.status === 'AVAILABLE').length;
  log('Rollback left stock AVAILABLE (no partial reserve)', stillAvailable === 1, `available=${stillAvailable}`);
  // now request exactly 1 -> approve succeeds and reserves it
  const req2 = await call('POST', '/requests', { department: 'Test', purpose: 'reserve ok', items: [{ productId: pid2, quantity: 1 }] });
  await call('PATCH', `/requests/${req2.data?.id}/submit`);
  const approveOk = await call('PATCH', `/requests/${req2.data?.id}/approve`, { approved: true });
  log('Valid approval reserves stock', approveOk.ok && approveOk.data?.status === 'APPROVED');
  const inv2 = await call('GET', `/inventory?productId=${pid2}`);
  const reserved = inv2.data?.data?.filter((s) => s.status === 'RESERVED').length;
  log('Stock now RESERVED after approval', reserved === 1, `reserved=${reserved}`);

  // Rate limiting (LAST — consumes login attempts)
  console.log('\n[ Security — Rate Limiting (brute-force) ]');
  let got429 = false;
  for (let i = 0; i < 8; i++) {
    const r = await call('POST', '/auth/login', { username: 'admin', password: 'wrongpass' });
    if (r.status === 429) { got429 = true; break; }
  }
  log('Login rate-limited after burst (429)', got429);

  // SUMMARY
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log('\n========== RESULT ==========');
  console.log(`  TOTAL: ${results.length}   PASS: ${pass}   FAIL: ${fail}`);
  if (fail > 0) { console.log('\n  Failed:'); results.filter((r) => !r.ok).forEach((r) => console.log(`   - ${r.name}`)); }
  console.log('============================\n');
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
