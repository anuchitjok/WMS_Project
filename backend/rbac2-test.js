// Dynamic RBAC E2E: permission CRUD, clone, enable/disable, escalation, multi-role, expiry
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
  console.log('\n========== DYNAMIC RBAC ==========\n');
  const admin = (await login('admin', 'Admin@123'))?.accessToken;
  log('Admin login', !!admin);

  // ── Permission CRUD ──
  console.log('\n[ Permission CRUD ]');
  const cp = await call('POST', '/roles/permissions', admin, { module: 'qa', action: 'test', description: 'QA temp' });
  log('Create permission qa.test', cp.ok && cp.data?.code === 'qa.test');
  const plist = await call('GET', '/roles/permissions', admin);
  log('Permission appears in catalogue', (plist.data ?? []).some((p) => p.code === 'qa.test'));
  const dp = await call('DELETE', `/roles/permissions/${cp.data?.id}`, admin);
  log('Delete permission', dp.ok);

  // ── Role clone + enable/disable ──
  console.log('\n[ Role Clone + Enable/Disable ]');
  const rolesList = await call('GET', '/roles', admin);
  const picker = rolesList.data?.find((r) => r.key === 'PICKER');
  const cloned = await call('POST', `/roles/${picker?.id}/clone`, admin, { name: `Picker Copy ${Date.now().toString().slice(-4)}` });
  log('Clone role', cloned.ok, cloned.data?.key);
  const clonedFull = await call('GET', `/roles/${cloned.data?.id}`, admin);
  const pickerFull = await call('GET', `/roles/${picker?.id}`, admin);
  log('Clone copies permission set', clonedFull.data?.permissionCodes?.length === pickerFull.data?.permissionCodes?.length,
    `clone=${clonedFull.data?.permissionCodes?.length} src=${pickerFull.data?.permissionCodes?.length}`);
  const dis = await call('PATCH', `/roles/${cloned.data?.id}/toggle`, admin);
  log('Disable role', dis.ok && dis.data?.isActive === false);
  const en = await call('PATCH', `/roles/${cloned.data?.id}/toggle`, admin);
  log('Re-enable role', en.ok && en.data?.isActive === true);
  await call('DELETE', `/roles/${cloned.data?.id}`, admin);

  // ── SUPER_ADMIN protection ──
  console.log('\n[ SUPER_ADMIN Protection ]');
  const sa = rolesList.data?.find((r) => r.key === 'SUPER_ADMIN');
  log('SUPER_ADMIN setPermissions blocked', (await call('PATCH', `/roles/${sa?.id}/permissions`, admin, { permissionCodes: [] })).status === 403);
  log('SUPER_ADMIN disable blocked', (await call('PATCH', `/roles/${sa?.id}/toggle`, admin)).status === 403);

  // ── Privilege escalation prevention ──
  console.log('\n[ Privilege Escalation Prevention ]');
  // create a limited role-manager that holds only role.manage + inventory.read
  const limRole = await call('POST', '/roles', admin, { key: `LIMITED_${Date.now().toString().slice(-4)}`, name: 'Limited Admin', permissionCodes: ['role.manage', 'inventory.read'] });
  const limUser = `lim_${Date.now().toString().slice(-5)}`;
  const lu = await call('POST', '/users', admin, { username: limUser, fullName: 'Limited', password: 'Lim@2026xy', roleId: limRole.data?.id });
  const limTok = (await login(limUser, 'Lim@2026xy'))?.accessToken;
  log('Limited-admin login', !!limTok);
  // can grant a permission they hold
  const okGrant = await call('POST', '/roles', limTok, { key: `OKROLE_${Date.now().toString().slice(-4)}`, name: 'Ok', permissionCodes: ['inventory.read'] });
  log('Can create role granting held permission', okGrant.ok);
  // cannot grant a permission they DON'T hold (escalation)
  const escalate = await call('POST', '/roles', limTok, { key: `ESC_${Date.now().toString().slice(-4)}`, name: 'Esc', permissionCodes: ['user.manage'] });
  log('Escalation blocked (grant unheld permission → 403)', escalate.status === 403, `status ${escalate.status}`);
  // cleanup created ok role
  if (okGrant.data?.id) await call('DELETE', `/roles/${okGrant.data.id}`, admin);

  // ── Multi-role aggregation + expiry (same token, live recompute) ──
  console.log('\n[ Multi-Role Aggregation + Expiry ]');
  const inv = rolesList.data?.find((r) => r.key === 'INVENTORY_CONTROL');
  const auditor = rolesList.data?.find((r) => r.key === 'AUDITOR');
  const reqRole = rolesList.data?.find((r) => r.key === 'REQUESTER');
  const mUser = `multi_${Date.now().toString().slice(-5)}`;
  const mu = await call('POST', '/users', admin, { username: mUser, fullName: 'Multi', password: 'Multi@2026', roleId: reqRole?.id });
  const mTok = (await login(mUser, 'Multi@2026'))?.accessToken;
  const before = await call('GET', '/auth/permissions', mTok);
  log('Primary role perms (REQUESTER has request.create)', before.data?.permissions?.includes('request.create') && !before.data?.permissions?.includes('inventory.adjust'));
  // assign INVENTORY_CONTROL (no expiry) → live aggregation on same token
  await call('POST', `/users/${mu.data?.id}/role-assignments`, admin, { roleId: inv?.id });
  const after = await call('GET', '/auth/permissions', mTok);
  log('Multi-role aggregates (now has inventory.adjust)', after.data?.permissions?.includes('inventory.adjust'), `roles=${after.data?.roleKeys?.join(',')}`);
  // assign AUDITOR with PAST expiry → must NOT grant
  await call('POST', `/users/${mu.data?.id}/role-assignments`, admin, { roleId: auditor?.id, expiresAt: '2020-01-01' });
  const expired = await call('GET', '/auth/permissions', mTok);
  const auditorOnlyPerm = 'audit.read';
  // INVENTORY_CONTROL doesn't have audit.read; REQUESTER doesn't; so expired AUDITOR must not add it
  log('Expired role does NOT grant permissions', !expired.data?.permissions?.includes(auditorOnlyPerm), `has audit.read=${expired.data?.permissions?.includes(auditorOnlyPerm)}`);

  // ── Cache invalidation: change a role's perms reflects immediately ──
  console.log('\n[ Cache Invalidation ]');
  // give INVENTORY_CONTROL a temp extra perm, check multi user sees it live
  const invFull = await call('GET', `/roles/${inv?.id}`, admin);
  const newCodes = [...invFull.data.permissionCodes, 'audit.read'];
  await call('PATCH', `/roles/${inv?.id}/permissions`, admin, { permissionCodes: newCodes });
  const live = await call('GET', '/auth/permissions', mTok);
  log('Role permission change reflects live (cache invalidated)', live.data?.permissions?.includes('audit.read'));
  // restore
  await call('PATCH', `/roles/${inv?.id}/permissions`, admin, { permissionCodes: invFull.data.permissionCodes });

  // cleanup
  await call('DELETE', `/users/${mu.data?.id}`, admin);
  await call('DELETE', `/users/${lu.data?.id}`, admin);
  await call('DELETE', `/roles/${limRole.data?.id}`, admin);

  const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
  console.log('\n========== RESULT ==========');
  console.log(`  TOTAL: ${results.length}   PASS: ${pass}   FAIL: ${fail}`);
  if (fail) { console.log('\n  Failed:'); results.filter((r) => !r.ok).forEach((r) => console.log(`   - ${r.n}`)); }
  console.log('============================\n');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
