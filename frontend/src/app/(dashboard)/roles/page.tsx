'use client';

// P7 7.3: Role & Permission Matrix — grouped by module (collapsible), sticky role header
// and permission column, search, "select all in module", translated descriptions and a
// per-role count. Ticking only changes the screen; a role's permissions change only when
// its Save button is pressed (same PATCH /roles/:id/permissions as before).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, Save, Copy, Power, Trash2, Plus, Search, ChevronRight, ChevronsDownUp, ChevronsUpDown, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { rolesApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { getT, humanize, useT, type Messages } from '@/i18n';
import { cn } from '@/lib/utils';

type RolesMessages = Messages['roles'];
interface Perm { id: string; code: string; module: string; action: string; description?: string | null }
interface Role { id: string; key: string; name: string; isSystem: boolean; isActive: boolean; permissionIds: string[] }

const SUPER = 'SUPER_ADMIN';

function moduleLabel(R: RolesMessages, module: string) {
  return (R.modules as Record<string, string>)[module] ?? humanize(module);
}

/** Translated description; derived from the code when there is no specific text. */
function describe(R: RolesMessages, p: Perm, t: (s: string, v?: Record<string, string | number>) => string) {
  const specific = (R.perm as Record<string, string>)[p.code];
  if (specific) return specific;
  const verb = (R.verbs as Record<string, string>)[p.action];
  if (verb) return t(R.derived, { action: verb, module: moduleLabel(R, p.module) });
  return p.description || t(R.derived, { action: humanize(p.action ?? p.code), module: moduleLabel(R, p.module) });
}

function sameSet(a: Set<string> | undefined, b: Set<string> | undefined) {
  if (!a || !b) return a === b;
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function ModuleCheckbox({ checked, indeterminate, disabled, label, onChange }: { checked: boolean; indeterminate: boolean; disabled?: boolean; label: string; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return (
    <input ref={ref} type="checkbox" aria-label={label} title={label}
      className="h-4 w-4 accent-green-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
      checked={checked} disabled={disabled} onChange={onChange} />
  );
}

export default function RolesPage() {
  const { m, t } = useT();
  const R = m.roles;
  const [permissions, setPermissions] = useState<Perm[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [baseline, setBaseline] = useState<Record<string, Set<string>>>({});
  const [matrix, setMatrix] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [newRole, setNewRole] = useState({ key: '', name: '', description: '' });
  const [newPerm, setNewPerm] = useState({ module: '', action: '', description: '' });
  const [roleOpen, setRoleOpen] = useState(false);
  const [permOpen, setPermOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await rolesApi.matrix();
      setPermissions(res.permissions);
      setRoles(res.roles);
      const map: Record<string, Set<string>> = {};
      res.roles.forEach((r: Role) => { map[r.id] = new Set(r.permissionIds); });
      setBaseline(map);
      setMatrix(Object.fromEntries(Object.entries(map).map(([k, v]) => [k, new Set(v)])));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const idToCode = useMemo(() => new Map(permissions.map((p) => [p.id, p.code])), [permissions]);

  // Groups by module, filtered by the search box (code, module or translated description).
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const g = new Map<string, Perm[]>();
    for (const p of permissions) {
      if (q) {
        const hay = `${p.code} ${p.module} ${moduleLabel(R, p.module)} ${describe(R, p, t)} ${p.description ?? ''}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      if (!g.has(p.module)) g.set(p.module, []);
      g.get(p.module)!.push(p);
    }
    return [...g.entries()];
  }, [permissions, query, R, t]);

  const dirtyRoles = useMemo(
    () => roles.filter((r) => r.key !== SUPER && !sameSet(matrix[r.id], baseline[r.id])).map((r) => r.id),
    [roles, matrix, baseline],
  );

  function toggle(roleId: string, permId: string) {
    setMatrix((prev) => {
      const s = new Set(prev[roleId]);
      if (s.has(permId)) s.delete(permId); else s.add(permId);
      return { ...prev, [roleId]: s };
    });
  }
  function toggleModule(roleId: string, perms: Perm[]) {
    setMatrix((prev) => {
      const s = new Set(prev[roleId]);
      const all = perms.every((p) => s.has(p.id));
      perms.forEach((p) => (all ? s.delete(p.id) : s.add(p.id)));
      return { ...prev, [roleId]: s };
    });
  }
  function toggleGroup(module: string) {
    setCollapsed((prev) => { const n = new Set(prev); if (n.has(module)) n.delete(module); else n.add(module); return n; });
  }
  function discardAll() {
    setMatrix(Object.fromEntries(Object.entries(baseline).map(([k, v]) => [k, new Set(v)])));
  }

  async function saveRole(role: Role) {
    setSavingRole(role.id);
    try {
      const codes = [...(matrix[role.id] ?? [])].map((id) => idToCode.get(id)).filter(Boolean) as string[];
      await rolesApi.setPermissions(role.id, codes);
      setBaseline((prev) => ({ ...prev, [role.id]: new Set(matrix[role.id]) }));
      const T = getT();
      toast.success(T.t(T.m.roles.toast.saved, { role: role.name }));
    } catch (e: any) { toast.error(e.message); } finally { setSavingRole(null); }
  }
  async function createRole() {
    try { await rolesApi.create(newRole); toast.success(getT().m.roles.toast.roleCreated); setRoleOpen(false); setNewRole({ key: '', name: '', description: '' }); load(); }
    catch (e: any) { toast.error(e.message); }
  }
  async function createPerm() {
    try { await rolesApi.createPermission(newPerm); toast.success(getT().m.roles.toast.permissionCreated); setPermOpen(false); setNewPerm({ module: '', action: '', description: '' }); load(); }
    catch (e: any) { toast.error(e.message); }
  }
  async function clone(id: string) {
    const name = window.prompt(getT().m.roles.clonePrompt);
    if (!name) return;
    try { await rolesApi.clone(id, name); toast.success(getT().m.roles.toast.cloned); load(); } catch (e: any) { toast.error(e.message); }
  }
  async function toggleActive(id: string) {
    try { await rolesApi.toggle(id); toast.success(getT().m.roles.toast.statusUpdated); load(); } catch (e: any) { toast.error(e.message); }
  }
  async function removeRole(id: string) {
    try { await rolesApi.remove(id); toast.success(getT().m.roles.toast.deleted); load(); } catch (e: any) { toast.error(e.message); }
  }

  const total = permissions.length;
  const searching = query.trim().length > 0;
  const allCollapsed = groups.length > 0 && groups.every(([mod]) => collapsed.has(mod));

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeader title={R.title} subtitle={R.subtitle} icon={ShieldCheck}
        action={
          <div className="flex flex-wrap gap-2">
            <Dialog open={permOpen} onOpenChange={setPermOpen}>
              <DialogTrigger render={<Button variant="outline" />}><Plus className="h-4 w-4 mr-1" />{R.addPermission}</DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle>{R.newPermission.title}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1"><Label>{R.newPermission.module}</Label><Input value={newPerm.module} onChange={(e) => setNewPerm((p) => ({ ...p, module: e.target.value }))} placeholder="inventory" /></div>
                  <div className="space-y-1"><Label>{R.newPermission.action}</Label><Input value={newPerm.action} onChange={(e) => setNewPerm((p) => ({ ...p, action: e.target.value }))} placeholder="export" /></div>
                  <div className="space-y-1"><Label>{R.newPermission.description}</Label><Input value={newPerm.description} onChange={(e) => setNewPerm((p) => ({ ...p, description: e.target.value }))} /></div>
                  <p className="text-xs text-slate-500">{R.newPermission.hint}</p>
                </div>
                <DialogFooter><Button className="bg-green-600 hover:bg-green-700 text-white" onClick={createPerm}>{R.newPermission.create}</Button></DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={roleOpen} onOpenChange={setRoleOpen}>
              <DialogTrigger render={<Button className="bg-green-600 hover:bg-green-700 text-white" />}><Plus className="h-4 w-4 mr-1" />{R.addRole}</DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle>{R.newRole.title}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1"><Label>{R.newRole.key}</Label><Input value={newRole.key} onChange={(e) => setNewRole((r) => ({ ...r, key: e.target.value }))} placeholder="STORE_KEEPER" /></div>
                  <div className="space-y-1"><Label>{R.newRole.name}</Label><Input value={newRole.name} onChange={(e) => setNewRole((r) => ({ ...r, name: e.target.value }))} placeholder="Store Keeper" /></div>
                  <div className="space-y-1"><Label>{R.newRole.description}</Label><Input value={newRole.description} onChange={(e) => setNewRole((r) => ({ ...r, description: e.target.value }))} /></div>
                </div>
                <DialogFooter><Button className="bg-green-600 hover:bg-green-700 text-white" onClick={createRole}>{R.newRole.create}</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={R.search} aria-label={R.search} className="pl-8" />
        </div>
        <Button variant="outline" size="sm" disabled={searching || groups.length === 0}
          onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(groups.map(([mod]) => mod)))}>
          {allCollapsed ? <ChevronsUpDown className="h-4 w-4 mr-1.5" /> : <ChevronsDownUp className="h-4 w-4 mr-1.5" />}
          {allCollapsed ? R.expandAll : R.collapseAll}
        </Button>
        <div className="flex-1" />
        {dirtyRoles.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-medium text-amber-800">{t(R.unsavedCount, { count: dirtyRoles.length })}</span>
            <Button variant="outline" size="sm" onClick={discardAll}><Undo2 className="h-4 w-4 mr-1.5" />{R.discardAll}</Button>
          </div>
        )}
      </div>

      {loading ? <Skeleton className="h-96 rounded-xl" /> : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-auto max-h-[calc(100vh-15rem)] min-h-[320px]">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-30 bg-slate-50 border-b border-r border-slate-200 text-left px-4 py-3 min-w-[240px] sm:min-w-[320px] text-xs font-medium uppercase tracking-wide text-slate-500">
                  {R.permission}
                </th>
                {roles.map((r) => {
                  const isSuper = r.key === SUPER;
                  const count = isSuper ? total : (matrix[r.id]?.size ?? 0);
                  const dirty = dirtyRoles.includes(r.id);
                  return (
                    <th key={r.id} className="sticky top-0 z-20 bg-slate-50 border-b border-slate-200 px-3 py-2.5 text-center align-top min-w-[132px] font-normal">
                      <div className={cn('text-sm font-semibold text-slate-800 leading-tight', !r.isActive && 'opacity-50 line-through')}>{r.name}</div>
                      <div className="mt-1 text-xs text-slate-500 tabular-nums">{isSuper ? R.fullAccess : t(R.count, { count, total })}</div>
                      <div className="mt-1 flex flex-wrap justify-center gap-1">
                        {r.isSystem && <Badge variant="outline" className="rounded-full text-[11px] text-slate-500">{R.system}</Badge>}
                        {!r.isActive && <Badge variant="outline" className="rounded-full text-[11px] bg-slate-100 text-slate-600">{R.disabled}</Badge>}
                        {dirty && <Badge variant="outline" className="rounded-full text-[11px] bg-amber-50 text-amber-800 border-amber-200">{R.unsaved}</Badge>}
                      </div>
                      <div className="mt-1.5 flex justify-center gap-0.5">
                        <button type="button" title={R.actions.clone} aria-label={R.actions.clone} onClick={() => clone(r.id)} className="p-1 rounded text-slate-500 hover:bg-slate-200 hover:text-slate-800"><Copy className="h-3.5 w-3.5" /></button>
                        {!isSuper && <button type="button" title={R.actions.toggle} aria-label={R.actions.toggle} onClick={() => toggleActive(r.id)} className="p-1 rounded text-slate-500 hover:bg-slate-200 hover:text-slate-800"><Power className="h-3.5 w-3.5" /></button>}
                        {!r.isSystem && <button type="button" title={R.actions.delete} aria-label={R.actions.delete} onClick={() => removeRole(r.id)} className="p-1 rounded text-red-500 hover:bg-red-50 hover:text-red-700"><Trash2 className="h-3.5 w-3.5" /></button>}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && (
                <tr><td colSpan={roles.length + 1} className="px-4 py-10 text-center text-sm text-slate-500">{t(R.noMatch, { query: query.trim() })}</td></tr>
              )}
              {groups.map(([module, perms]) => {
                const open = searching || !collapsed.has(module);
                const label = moduleLabel(R, module);
                return (
                  <Fragment key={module}>
                    <tr className="bg-slate-50/70">
                      <td className="sticky left-0 z-10 bg-slate-50 border-b border-r border-slate-200 px-2 py-2">
                        <button type="button" onClick={() => toggleGroup(module)} aria-expanded={open} disabled={searching}
                          className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left hover:bg-slate-100 disabled:hover:bg-transparent">
                          <ChevronRight className={cn('h-4 w-4 text-slate-400 transition-transform', open && 'rotate-90')} />
                          <span className="font-semibold text-slate-700">{label}</span>
                          <span className="text-xs text-slate-400">· {t(R.permissionsInModule, { count: perms.length })}</span>
                        </button>
                      </td>
                      {roles.map((r) => {
                        const isSuper = r.key === SUPER;
                        const s = matrix[r.id];
                        const n = isSuper ? perms.length : perms.filter((p) => s?.has(p.id)).length;
                        return (
                          <td key={r.id} className="border-b border-slate-200 px-3 py-2 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <ModuleCheckbox
                                checked={n === perms.length && perms.length > 0}
                                indeterminate={n > 0 && n < perms.length}
                                disabled={isSuper}
                                label={t(R.selectModule, { module: label, role: r.name })}
                                onChange={() => toggleModule(r.id, perms)}
                              />
                              <span className="text-xs text-slate-400 tabular-nums">{n}/{perms.length}</span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                    {open && perms.map((p) => (
                      <tr key={p.id} className="group">
                        <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 border-b border-r border-slate-100 px-4 py-2 pl-9">
                          <div className="text-sm text-slate-800">{describe(R, p, t)}</div>
                          <div className="font-mono text-xs text-slate-400">{p.code}</div>
                        </td>
                        {roles.map((r) => {
                          const isSuper = r.key === SUPER;
                          const changed = !isSuper && (matrix[r.id]?.has(p.id) ?? false) !== (baseline[r.id]?.has(p.id) ?? false);
                          return (
                            <td key={r.id} className={cn('border-b border-slate-100 px-3 py-2 text-center group-hover:bg-slate-50', changed && 'bg-amber-50/60')}>
                              <input type="checkbox" aria-label={`${r.name}: ${p.code}`}
                                className="h-4 w-4 accent-green-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                                disabled={isSuper}
                                checked={isSuper ? true : (matrix[r.id]?.has(p.id) ?? false)}
                                onChange={() => toggle(r.id, p.id)} />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky bottom-0 left-0 z-30 bg-slate-50 border-t border-r border-slate-200 px-4 py-3 text-xs font-medium uppercase tracking-wide text-slate-500">{R.savePerRole}</td>
                {roles.map((r) => {
                  const dirty = dirtyRoles.includes(r.id);
                  return (
                    <td key={r.id} className="sticky bottom-0 z-20 bg-slate-50 border-t border-slate-200 px-3 py-2.5 text-center">
                      {r.key !== SUPER && (
                        <Button size="sm" className="h-8 bg-green-600 hover:bg-green-700 text-white" title={t(R.saveRole, { role: r.name })}
                          disabled={!dirty || savingRole === r.id} onClick={() => saveRole(r)}>
                          <Save className="h-3.5 w-3.5 mr-1" />{R.save}
                        </Button>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">{R.footnote}</p>
    </div>
  );
}
