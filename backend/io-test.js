// Import/Export E2E test
const ExcelJS = require('exceljs');
const BASE = 'http://localhost:3001/api';
let token = '';
const results = [];
function log(name, ok, detail = '') { results.push({ name, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, data };
}
async function upload(path, buf, filename) {
  const fd = new FormData();
  fd.append('file', new Blob([buf]), filename);
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, data };
}
async function download(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, ok: res.ok, buf };
}
// xlsx files are zip → start with 'PK'
const isXlsx = (buf) => buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;

async function buildProductsXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('p');
  ws.columns = [
    { header: 'code', key: 'code' }, { header: 'name', key: 'name' },
    { header: 'category', key: 'category' }, { header: 'unitCost', key: 'unitCost' },
    { header: 'minStock', key: 'minStock' },
  ];
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function main() {
  console.log('\n========== IMPORT / EXPORT E2E ==========\n');
  token = (await api('POST', '/auth/login', { username: 'admin', password: 'Admin@123' })).data?.accessToken;
  log('Login', !!token);

  // ── Templates ──
  console.log('\n[ Templates ]');
  for (const t of ['products', 'inventory', 'users', 'warehouse', 'serials']) {
    const r = await download(`/io/template/${t}`);
    log(`Template ${t} is valid xlsx`, r.ok && isXlsx(r.buf), `${r.buf.length} bytes`);
  }

  // ── Import preview (mix valid + invalid) ──
  console.log('\n[ Import — Preview validation ]');
  const stamp = Date.now().toString().slice(-6);
  const rows = [
    { code: `IO-${stamp}-A`, name: 'Valid A', category: 'Test', unitCost: 100, minStock: 2 },   // valid
    { code: `IO-${stamp}-A`, name: 'Dup in file', unitCost: 50, minStock: 1 },                   // dup SKU in file
    { code: '', name: 'No code', unitCost: 10, minStock: 0 },                                    // missing code
    { code: `IO-${stamp}-B`, name: 'Bad cost', unitCost: 'abc', minStock: 1 },                   // invalid number
    { code: `IO-${stamp}-C`, name: 'Valid C', category: 'Test', unitCost: 0, minStock: 0 },      // valid
  ];
  const xlsx = await buildProductsXlsx(rows);
  const prev = await upload('/io/import/products/preview', xlsx, 'products.xlsx');
  const okPrev = prev.ok && prev.data?.summary?.total === 5 && prev.data?.summary?.valid === 2 && prev.data?.summary?.invalid === 3;
  log('Preview detects 2 valid / 3 invalid', okPrev, `valid=${prev.data?.summary?.valid} invalid=${prev.data?.summary?.invalid}`);
  const errRow = prev.data?.rows?.find((r) => !r.valid && r.data.code === '');
  log('Missing-code row flagged', errRow?.errors?.some((e) => /required/i.test(e)));
  const dupRow = prev.data?.rows?.find((r) => r.errors?.some((e) => /Duplicate SKU within file/i.test(e)));
  log('Duplicate SKU within file flagged', !!dupRow);

  // ── Import commit (partial) ──
  console.log('\n[ Import — Commit (partial) ]');
  const commit = await upload('/io/import/products/commit', xlsx, 'products.xlsx');
  const okCommit = commit.ok && commit.data?.inserted === 2 && commit.data?.skipped === 3;
  log('Commit inserts 2, skips 3', okCommit, `inserted=${commit.data?.inserted} skipped=${commit.data?.skipped}`);
  // verify in DB
  const check = await api('GET', `/products?search=IO-${stamp}`);
  const found = (check.data || []).filter((p) => p.code.startsWith(`IO-${stamp}`)).length;
  log('Imported products exist in DB', found === 2, `found=${found}`);

  // ── Re-commit same file → all skipped (now duplicates of DB) ──
  const recommit = await upload('/io/import/products/commit', xlsx, 'products.xlsx');
  log('Re-import blocked (all now duplicate)', recommit.status === 400, `status ${recommit.status}`);

  // ── Bad file type rejected ──
  const badType = await upload('/io/import/products/preview', Buffer.from('hello'), 'notes.txt');
  log('Non-excel file rejected', badType.status === 400, `status ${badType.status}`);

  // ── Exports ──
  console.log('\n[ Exports ]');
  for (const t of ['inventory', 'audit', 'requests', 'reports']) {
    const x = await download(`/io/export/${t}?format=xlsx`);
    log(`Export ${t} xlsx`, x.ok && isXlsx(x.buf), `${x.buf.length} bytes`);
    const c = await download(`/io/export/${t}?format=csv`);
    log(`Export ${t} csv`, c.ok && c.buf.length > 0, `${c.buf.length} bytes`);
  }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log('\n========== RESULT ==========');
  console.log(`  TOTAL: ${results.length}   PASS: ${pass}   FAIL: ${fail}`);
  if (fail) { console.log('\n  Failed:'); results.filter((r) => !r.ok).forEach((r) => console.log(`   - ${r.name}`)); }
  console.log('============================\n');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
