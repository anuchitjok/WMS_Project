// QC PROBE — adversarial / negative-path testing to find real defects
const BASE = 'http://localhost:3001/api';
let token = '';
const findings = [];

async function call(method, path, body, useToken = true) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(useToken && token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
function asArray(d) {
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.data)) return d.data;
  return [];
}
// severity: PASS = behaves correctly, BUG = defect, WARN = works but risky
function check(name, verdict, detail = '') {
  findings.push({ name, verdict, detail });
  const tag = verdict === 'PASS' ? 'PASS ' : verdict === 'BUG' ? 'BUG  ' : 'WARN ';
  console.log(`  ${tag} ${name}${detail ? '  — ' + detail : ''}`);
}

async function main() {
  console.log('\n========== QC ADVERSARIAL PROBE ==========\n');

  // ── AUTH / AUTHORIZATION ──────────────────────────────────────────
  console.log('[ Auth / Authorization ]');
  const noToken = await call('GET', '/inventory', null, false);
  check('Access without token blocked', noToken.status === 401 ? 'PASS' : 'BUG', `status ${noToken.status}`);

  token = 'Bearer.invalid.token';
  const badToken = await call('GET', '/inventory');
  check('Invalid token blocked', badToken.status === 401 ? 'PASS' : 'BUG', `status ${badToken.status}`);

  const login = await call('POST', '/auth/login', { username: 'admin', password: 'Admin@123' }, false);
  token = login.data?.accessToken;
  check('Admin login', token ? 'PASS' : 'BUG');

  // ── INPUT VALIDATION on new endpoints (suspected @Body() any gap) ──
  console.log('\n[ Input Validation — new endpoints ]');
  const brands = await call('GET', '/warehouse/brands');
  const whs = await call('GET', '/warehouse');
  const brandId = brands.data?.[0]?.id;
  const warehouseId = whs.data?.[0]?.id;

  // product with missing required fields
  const badProduct = await call('POST', '/products', { name: 'no code' });
  check('Product without code rejected', badProduct.status >= 400 && badProduct.status < 500 ? 'PASS' : 'BUG', `status ${badProduct.status}`);

  // make a valid product to test request validation
  const pcode = 'QC-' + Date.now().toString().slice(-6);
  const prod = await call('POST', '/products', { code: pcode, name: 'QC Product', brandId, minStock: 1 });
  const productId = prod.data?.id;

  // negative quantity request
  const negReq = await call('POST', '/requests', { department: 'QC', items: [{ productId, quantity: -5 }] });
  check('Negative quantity request rejected', negReq.status >= 400 && negReq.status < 500 ? 'PASS' : 'BUG', `status ${negReq.status} (created=${negReq.data?.refNumber ?? 'no'})`);

  // zero quantity
  const zeroReq = await call('POST', '/requests', { department: 'QC', items: [{ productId, quantity: 0 }] });
  check('Zero quantity request rejected', zeroReq.status >= 400 && zeroReq.status < 500 ? 'PASS' : 'BUG', `status ${zeroReq.status}`);

  // request referencing non-existent product
  const ghostReq = await call('POST', '/requests', { department: 'QC', items: [{ productId: 'does-not-exist', quantity: 1 }] });
  check('Request with invalid product handled (no 500)', ghostReq.status !== 500 ? 'PASS' : 'BUG', `status ${ghostReq.status}`);

  // ── WORKFLOW STATE GUARDS ─────────────────────────────────────────
  console.log('\n[ Workflow State Guards ]');
  // build a real available unit
  const recv = await call('POST', '/receiving', { sourceType: 'Vendor', items: [{ productId, quantity: 1, condition: 'good', warehouseId }] });
  await call('PATCH', `/receiving/${recv.data?.id}/verify`);
  const pend = await call('GET', '/putaway/pending');
  const it = asArray(pend.data).find((x) => x.product?.code === pcode);
  if (it) await call('PATCH', `/putaway/${it.id}/confirm`, { warehouseId });

  const req = await call('POST', '/requests', { department: 'QC', items: [{ productId, quantity: 1 }] });
  const reqId = req.data?.id;
  await call('PATCH', `/requests/${reqId}/submit`);
  // double submit
  const dblSubmit = await call('PATCH', `/requests/${reqId}/submit`);
  check('Double-submit handled', dblSubmit.status < 500 ? 'PASS' : 'WARN', `status ${dblSubmit.status}`);
  await call('PATCH', `/requests/${reqId}/approve`, { approved: true });
  // approve again (already approved)
  const reApprove = await call('PATCH', `/requests/${reqId}/approve`, { approved: true });
  check('Re-approve already-approved blocked', reApprove.status === 400 ? 'PASS' : 'BUG', `status ${reApprove.status}`);
  // advance fulfillment beyond end
  for (let i = 0; i < 8; i++) await call('PATCH', `/fulfillment/${reqId}/advance`);
  const overAdvance = await call('PATCH', `/fulfillment/${reqId}/advance`);
  check('Over-advance fulfillment blocked', overAdvance.status >= 400 ? 'PASS' : 'WARN', `status ${overAdvance.status}`);

  // ── DATA INTEGRITY: reserved stock release on rejection ───────────
  console.log('\n[ Data Integrity — reserved stock lifecycle ]');
  // fresh product + 1 available
  const pc2 = 'QC2-' + Date.now().toString().slice(-6);
  const prod2 = await call('POST', '/products', { code: pc2, name: 'QC2', brandId, minStock: 1 });
  const pid2 = prod2.data?.id;
  const rc2 = await call('POST', '/receiving', { sourceType: 'Vendor', items: [{ productId: pid2, quantity: 1, condition: 'good', warehouseId }] });
  await call('PATCH', `/receiving/${rc2.data?.id}/verify`);
  const pe2 = await call('GET', '/putaway/pending');
  const it2 = asArray(pe2.data).find((x) => x.product?.code === pc2);
  if (it2) await call('PATCH', `/putaway/${it2.id}/confirm`, { warehouseId });
  // approve a request to reserve it
  const r2 = await call('POST', '/requests', { department: 'QC', items: [{ productId: pid2, quantity: 1 }] });
  await call('PATCH', `/requests/${r2.data?.id}/submit`);
  await call('PATCH', `/requests/${r2.data?.id}/approve`, { approved: true });
  // now there should be 0 AVAILABLE. Try to find any cancel path...
  const invAfter = await call('GET', `/inventory?productId=${pid2}`);
  const avail = invAfter.data?.data?.filter((s) => s.status === 'AVAILABLE').length;
  const reserved = invAfter.data?.data?.filter((s) => s.status === 'RESERVED').length;
  check('Stock reserved after approval', reserved === 1 && avail === 0 ? 'PASS' : 'BUG', `avail=${avail} reserved=${reserved}`);
  // Cancel the approved request → reserved stock must return to AVAILABLE
  await call('PATCH', `/requests/${r2.data?.id}/cancel`);
  const invAfterCancel = await call('GET', `/inventory?productId=${pid2}`);
  const availAfter = invAfterCancel.data?.data?.filter((s) => s.status === 'AVAILABLE').length;
  check('Reserved stock released back on cancel', availAfter === 1 ? 'PASS' : 'BUG',
    `after cancel avail=${availAfter}`);
  // double-cancel must be blocked (no double rollback)
  const dblCancel = await call('PATCH', `/requests/${r2.data?.id}/cancel`);
  check('Double-cancel blocked', dblCancel.status === 400 ? 'PASS' : 'BUG', `status ${dblCancel.status}`);

  // ── SERIAL UNIQUENESS via /inventory POST (bypass receiving?) ─────
  console.log('\n[ Data Integrity — serial uniqueness via /inventory ]');
  const serial = 'QCSN-' + Date.now();
  await call('POST', '/inventory', { productId, serialNumber: serial, quantity: 1, status: 'AVAILABLE', warehouseId });
  const dup = await call('POST', '/inventory', { productId, serialNumber: serial, quantity: 1, status: 'AVAILABLE', warehouseId });
  check('Duplicate serial via /inventory blocked', dup.status === 409 ? 'PASS' : 'BUG',
    `status ${dup.status} (receiving blocks it, /inventory may not)`);

  // ── SUMMARY ───────────────────────────────────────────────────────
  const pass = findings.filter((f) => f.verdict === 'PASS').length;
  const bugs = findings.filter((f) => f.verdict === 'BUG');
  const warns = findings.filter((f) => f.verdict === 'WARN');
  console.log('\n========== QC RESULT ==========');
  console.log(`  CHECKS: ${findings.length}   PASS: ${pass}   BUG: ${bugs.length}   WARN: ${warns.length}`);
  if (bugs.length) { console.log('\n  DEFECTS:'); bugs.forEach((b) => console.log(`   [BUG]  ${b.name} — ${b.detail}`)); }
  if (warns.length) { console.log('\n  WARNINGS:'); warns.forEach((w) => console.log(`   [WARN] ${w.name} — ${w.detail}`)); }
  console.log('==============================\n');
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
