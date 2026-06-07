// Phase 1 barcode scan + label E2E
const BASE = 'http://localhost:3001/api';
let token = '';
const results = [];
function log(n, ok, d = '') { results.push({ n, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); }
async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, data };
}
async function pdf(path, body) {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, ok: res.ok, buf };
}
const isPdf = (b) => b.length > 4 && b.slice(0, 4).toString() === '%PDF';

async function main() {
  console.log('\n========== BARCODE SCAN — PHASE 1 ==========\n');
  token = (await call('POST', '/auth/login', { username: 'admin', password: 'Admin@123' })).data?.accessToken;
  log('Login', !!token);

  // reference data
  const whs = await call('GET', '/warehouse');
  const wh = whs.data?.[0];
  const prods = await call('GET', '/warehouse/products');
  const product = prods.data?.[0];

  // ── Resolve / Parse ──
  console.log('\n[ Resolve / Parse ]');
  const r1 = await call('GET', `/barcode/resolve/${encodeURIComponent('SKU|' + product.code)}`);
  log('Resolve SKU| prefix → product', r1.data?.found && r1.data?.entityType === 'product', `parsed=${r1.data?.parsed?.symbology}`);
  const rPlain = await call('GET', `/barcode/resolve/${encodeURIComponent(product.code)}`);
  log('Resolve plain code (fallback) → product', rPlain.data?.found && rPlain.data?.entityType === 'product');
  const rGs1 = await call('POST', '/scan/validate', { rawValue: '(01)09501234500001(21)SER-TEST-1' });
  log('Parse GS1 (AI 21 serial)', rGs1.data?.parsed?.symbology === 'GS1' && rGs1.data?.parsed?.gs1?.serial === 'SER-TEST-1');

  // ── LOOKUP scan + idempotency + history ──
  console.log('\n[ Scan LOOKUP + Idempotency + History ]');
  const csid = 'qa-' + Date.now();
  const s1 = await call('POST', '/scan', { workflow: 'LOOKUP', rawValue: 'SKU|' + product.code, clientScanId: csid });
  log('LOOKUP scan logs SUCCESS', s1.data?.result === 'SUCCESS' || s1.data?.event?.result === 'SUCCESS');
  const s2 = await call('POST', '/scan', { workflow: 'LOOKUP', rawValue: 'SKU|' + product.code, clientScanId: csid });
  log('Idempotent replay (same clientScanId → duplicate)', s2.data?.duplicate === true);
  const hist = await call('GET', '/scan/history?workflow=LOOKUP&limit=20');
  log('Scan history records the scan', (hist.data ?? []).some((h) => h.clientScanId === csid));
  // unknown barcode → NOT_FOUND
  const sNF = await call('POST', '/scan', { workflow: 'LOOKUP', rawValue: 'SKU|NOPE-' + Date.now() });
  log('Unknown barcode → NOT_FOUND', sNF.data?.result === 'NOT_FOUND');

  // ── PUTAWAY via scan ──
  console.log('\n[ Scan PUTAWAY ]');
  const recv = await call('POST', '/receiving', { sourceType: 'Vendor', items: [{ productId: product.id, quantity: 1, condition: 'good', warehouseId: wh.id }] });
  const stockItemId = recv.data?.items?.[0]?.stockItemId;
  const locKey = `${wh.code}|R-01|S-A1`;
  const put = await call('POST', '/scan', { workflow: 'PUTAWAY', rawValue: 'ITM|' + stockItemId, context: { locationKey: locKey } });
  log('PUTAWAY scan → AVAILABLE', put.data?.result === 'SUCCESS' && put.data?.entity?.status === 'AVAILABLE', `status=${put.data?.entity?.status}`);

  // ── PICK guard (non-reserved item cannot be picked) ──
  console.log('\n[ Scan PICK guard ]');
  const pickBad = await call('POST', '/scan', { workflow: 'PICK', rawValue: 'ITM|' + stockItemId, context: { requestId: 'REQ-NONE' } });
  log('PICK non-reserved item blocked', pickBad.data?.result === 'ERROR', pickBad.data?.message);

  // ── Labels (PDF) ──
  console.log('\n[ Label PDF ]');
  const lp = await pdf('/labels/product/print', { ids: [product.id] });
  log('Product label PDF (CODE128)', lp.ok && isPdf(lp.buf), `${lp.buf.length} bytes`);
  const lb = await pdf('/labels/bin/print', { locations: [locKey] });
  log('Bin label PDF (QR)', lb.ok && isPdf(lb.buf), `${lb.buf.length} bytes`);
  if (stockItemId) {
    const ls = await pdf('/labels/serial/print', { ids: [stockItemId] });
    log('Serial label PDF', ls.ok && isPdf(ls.buf), `${ls.buf.length} bytes`);
  }

  const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
  console.log('\n========== RESULT ==========');
  console.log(`  TOTAL: ${results.length}   PASS: ${pass}   FAIL: ${fail}`);
  if (fail) { console.log('\n  Failed:'); results.filter((r) => !r.ok).forEach((r) => console.log(`   - ${r.n}`)); }
  console.log('============================\n');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
