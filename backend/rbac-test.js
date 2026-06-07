// RBAC + warehouse scope + password policy E2E
const BASE = 'http://localhost:3001/api';
const results = [];
function log(n, ok, d = '') { results.push({ n, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); }

async function call(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, data };
}
const login = async (u, p) => (await call('POST', '/auth/login', null, { username: u, password: p })).data;

async function main() {
  console.log('\n========== RBAC / SCOPE / PASSWORD POLICY ==========\n');

  const adminAuth = await login('admin', 'Admin@123');
  const admin = adminAuth?.accessToken;
  const reqAuth = await login('requester01', 'Staff@123');
  const requester = reqAuth?.accessToken;
  log('Admin + requester login', !!admin && !!requester);

  // ── Permission enforcement ──
  console.log('\n[ Permission Enforcement ]');
  log('Admin can list roles (role.manage)', (await call('GET', '/roles', admin)).status === 200);
  log('Requester BLOCKED from roles (403)', (await call('GET', '/roles', requester)).status === 403);
  log('Requester BLOCKED from users (403)', (await call('GET', '/users', requester)).status === 403);
  log('Admin can list users', (await call('GET', '/users', admin)).status === 200);
  const matrix = await call('GET', '/roles/matrix', admin);
  log('Permission matrix returns roles+perms', matrix.ok && matrix.data?.roles?.length === 7 && matrix.data?.permissions?.length >= 21,
    `roles=${matrix.data?.roles?.length} perms=${matrix.data?.permissions?.length}`);

  // ── Warehouse scope ──
  console.log('\n[ Warehouse Scope ]');
  const adminInv = await call('GET', '/inventory?limit=100', admin);
  const reqInv = await call('GET', '/inventory?limit=100', requester);
  const reqWh = new Set((reqInv.data?.data ?? []).map((i) => i.warehouseId));
  const me = await call('GET', '/auth/me', requester);
  log('Requester inventory is scoped (subset of admin)', (reqInv.data?.total ?? 0) <= (adminInv.data?.total ?? 0),
    `admin=${adminInv.data?.total} requester=${reqInv.data?.total}`);
  log('Requester sees only assigned warehouse(s)', reqWh.size <= 1, `distinct warehouses=${reqWh.size}`);

  // ── Role management ──
  console.log('\n[ Role Management ]');
  const newRole = await call('POST', '/roles', admin, { key: `TEST_ROLE_${Date.now().toString().slice(-5)}`, name: 'Test Role', permissionCodes: ['inventory.read'] });
  log('Create custom role', newRole.ok, newRole.data?.key);
  const setPerm = await call('PATCH', `/roles/${newRole.data?.id}/permissions`, admin, { permissionCodes: ['inventory.read', 'report.read'] });
  log('Update role permissions', setPerm.ok && setPerm.data?.permissionCodes?.length === 2);
  const delRole = await call('DELETE', `/roles/${newRole.data?.id}`, admin);
  log('Delete custom role', delRole.ok);
  // system role cannot be deleted
  const sysRole = (await call('GET', '/roles', admin)).data?.find((r) => r.key === 'AUDITOR');
  const delSys = await call('DELETE', `/roles/${sysRole?.id}`, admin);
  log('System role delete BLOCKED', delSys.status === 400, `status ${delSys.status}`);

  // ── User management + password policy ──
  console.log('\n[ User Mgmt + Password Policy ]');
  const uname = `qauser_${Date.now().toString().slice(-5)}`;
  const created = await call('POST', '/users', admin, { username: uname, fullName: 'QA User', role: 'REQUESTER' }); // no password → forceChange
  log('Create user (no pw → forceChange)', created.ok && created.data?.forcePasswordChange === true);
  const resetR = await call('POST', `/users/${created.data?.id}/reset-password`, admin);
  log('Reset password returns temp', resetR.ok && !!resetR.data?.tempPassword, resetR.data?.tempPassword);
  // login with temp → forcePasswordChange flag in response
  const tempLogin = await login(uname, resetR.data?.tempPassword);
  log('Temp login flags forcePasswordChange', tempLogin?.forcePasswordChange === true);
  const utoken = tempLogin?.accessToken;
  // weak new password rejected
  const weak = await call('POST', '/auth/change-password', utoken, { oldPassword: resetR.data?.tempPassword, newPassword: 'weak' });
  log('Weak password rejected (policy)', weak.status === 400, weak.data?.message);
  // strong new password accepted
  const strong = await call('POST', '/auth/change-password', utoken, { oldPassword: resetR.data?.tempPassword, newPassword: 'Strong@2026' });
  log('Strong password accepted', strong.ok && strong.data?.changed === true);
  // login history recorded
  const hist = await call('GET', `/users/${created.data?.id}/login-history`, admin);
  log('Login history recorded', hist.ok && hist.data?.length >= 1, `${hist.data?.length} entries`);
  // cleanup
  await call('DELETE', `/users/${created.data?.id}`, admin);

  const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
  console.log('\n========== RESULT ==========');
  console.log(`  TOTAL: ${results.length}   PASS: ${pass}   FAIL: ${fail}`);
  if (fail) { console.log('\n  Failed:'); results.filter((r) => !r.ok).forEach((r) => console.log(`   - ${r.n}`)); }
  console.log('============================\n');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
