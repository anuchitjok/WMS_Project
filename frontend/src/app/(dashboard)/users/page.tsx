'use client';

import { useEffect, useState, useCallback } from 'react';
import { Users as UsersIcon, KeyRound, Power, Trash2, Pencil, Upload, Download, Building2, X } from 'lucide-react';
import { toast } from 'sonner';
import { usersApi, rolesApi, warehouseApi, userRolesApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { DiscardChangesDialog } from '@/components/ui/discard-changes-dialog';
import { useDiscardGuard } from '@/hooks/use-discard-guard';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { cn, hasUnsavedChanges } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getT, labelOf, useT, type Messages } from '@/i18n';
import { governanceApi, type UsersCapabilities } from '@/lib/api-governance';
import { useAuthStore } from '@/store/auth.store';
import { ImportUsersDialog } from './import-users-dialog';

const ENUM_ROLES = ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR', 'WAREHOUSE_STAFF', 'REQUESTER', 'DEPT_APPROVER', 'RTV_OFFICER', 'AUDITOR'];

// Phase 4: say what the warehouse scope means instead of showing "—".
// Same rule as the API (common/warehouse-scope.ts): Super Admin and users with no
// assigned warehouse can reach every warehouse; otherwise only the listed ones.
type UsersMessages = Messages['users'];

function warehouseScopeLabel(u: any, U: UsersMessages, t: (s: string, p?: Record<string, string | number>) => string): { text: string; open: boolean } {
  const codes = (u.warehouses ?? []).map((w: any) => w.warehouse.code);
  if (u.rbacRole?.key === 'SUPER_ADMIN') return { text: U.scope.superAdmin, open: true };
  if (!codes.length) return { text: U.scope.noneAssigned, open: true };
  return { text: t(U.scope.only, { codes: codes.join(', ') }), open: false };
}

function WarehouseScopeHint({ selected }: { selected: number }) {
  const { m, t } = useT();
  const S = m.users.scope;
  return (
    <p className="text-xs text-slate-500">
      {selected === 0 ? S.hintNone : t(S.hintSome, { count: selected })}{' '}{S.hintSuper}
    </p>
  );
}

function WarehouseChips({ warehouses, selected, onToggle }: { warehouses: any[]; selected: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {warehouses.map((w) => (
        <button key={w.id} type="button" onClick={() => onToggle(w.id)} aria-pressed={selected.includes(w.id)} title={w.name}
          className={`px-2.5 py-1 rounded-md text-sm border ${selected.includes(w.id) ? 'bg-green-600 text-white border-green-600' : 'bg-white text-slate-600 border-slate-300'}`}>
          {w.code}
        </button>
      ))}
    </div>
  );
}

// Fallback while /users/capabilities is unknown: the menu role decides (the API enforces the real rule).
function fallbackCaps(role?: string): UsersCapabilities {
  const admin = role === 'SYSTEM_ADMIN';
  return { manageUsers: admin, assignWarehouses: true, exportUsers: true, importUsers: admin };
}

const BLANK_USER_FORM = { username: '', fullName: '', email: '', role: 'REQUESTER', roleId: '', department: '', password: '', warehouseIds: [] as string[] };

export default function UsersPage() {
  const { m, t, fmt } = useT();
  const U = m.users;
  const myRole = useAuthStore((s) => s.user?.role);
  const [caps, setCaps] = useState<UsersCapabilities | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [whUser, setWhUser] = useState<any>(null); // warehouse-only dialog (Warehouse Manager)
  const [whSaving, setWhSaving] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [editUserBaseline, setEditUserBaseline] = useState<any>(null); // snapshot at open-time, for the unsaved-changes guard
  const [assignments, setAssignments] = useState<any[]>([]);
  const [addForm, setAddForm] = useState<{ roleId: string; expiresAt: string }>({ roleId: '', expiresAt: '' });
  const [newPassword, setNewPassword] = useState('');
  const [form, setForm] = useState<any>(BLANK_USER_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, r, w] = await Promise.all([usersApi.list(), rolesApi.list().catch(() => []), warehouseApi.list()]);
      setUsers(u); setRoles(r); setWarehouses(w);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    governanceApi.usersCapabilities().then(setCaps).catch(() => setCaps(null));
  }, []);
  const can = caps ?? fallbackCaps(myRole);

  async function createUser() {
    try {
      await usersApi.create({ ...form, roleId: form.roleId || undefined, password: form.password || undefined });
      toast.success(getT().m.users.toast.created); setCreateOpen(false);
      setForm(BLANK_USER_FORM);
      load();
    } catch (e: any) { toast.error(e.message); }
  }

  async function saveEdit() {
    if (newPassword && newPassword.length < 8) { toast.error(getT().m.users.toast.passwordShort); return; }
    try {
      await usersApi.update(editUser.id, {
        username: editUser.username,
        fullName: editUser.fullName,
        email: editUser.email,
        department: editUser.department,
        role: editUser.role,
        roleId: editUser.roleId || null,
        password: newPassword || undefined,
      });
      await usersApi.setWarehouses(editUser.id, editUser.warehouseIds);
      toast.success(newPassword ? getT().m.users.toast.savedPassword : getT().m.users.toast.saved); setEditUser(null); setEditUserBaseline(null); load();
    } catch (e: any) { toast.error(e.message); }
  }

  async function toggle(id: string) { try { await usersApi.toggle(id); load(); } catch (e: any) { toast.error(e.message); } }
  async function reset(id: string) {
    try { const r = await usersApi.resetPassword(id); const T = getT(); toast.success(T.t(T.m.users.toast.tempPassword, { password: r.tempPassword }), { duration: 10000 }); }
    catch (e: any) { toast.error(e.message); }
  }
  async function remove(id: string) { try { await usersApi.remove(id); toast.success(getT().m.users.toast.deleted); load(); } catch (e: any) { toast.error(e.message); } }

  async function doExport(format: 'xlsx' | 'csv') {
    try { await governanceApi.exportUsers(format); const T = getT(); toast.success(T.t(T.m.users.toast.exported, { file: `users.${format}` })); }
    catch (e: any) { toast.error(e.message); }
  }
  async function saveWarehouses() {
    if (!whUser) return;
    setWhSaving(true);
    try {
      await usersApi.setWarehouses(whUser.id, whUser.warehouseIds);
      toast.success(getT().m.users.toast.warehousesSaved); setWhUser(null); load();
    } catch (e: any) { toast.error(e.message); } finally { setWhSaving(false); }
  }

  async function openEdit(u: any) {
    const loaded = { ...u, roleId: u.roleId ?? '', warehouseIds: (u.warehouses ?? []).map((w: any) => w.warehouse.id) };
    setEditUser(loaded);
    setEditUserBaseline(loaded);
    setNewPassword('');
    try { setAssignments(await userRolesApi.list(u.id)); } catch { setAssignments([]); }
    setAddForm({ roleId: '', expiresAt: '' });
  }
  async function addAssignment() {
    if (!editUser || !addForm.roleId) return;
    try {
      await userRolesApi.assign(editUser.id, { roleId: addForm.roleId, expiresAt: addForm.expiresAt || undefined });
      toast.success(getT().m.users.toast.roleAdded);
      setAssignments(await userRolesApi.list(editUser.id));
      setAddForm({ roleId: '', expiresAt: '' });
    } catch (e: any) { toast.error(e.message); }
  }
  async function removeAssignment(aid: string) {
    if (!editUser) return;
    try { await userRolesApi.unassign(editUser.id, aid); setAssignments(await userRolesApi.list(editUser.id)); toast.success(getT().m.users.toast.roleRemoved); }
    catch (e: any) { toast.error(e.message); }
  }
  function toggleWh(list: string[], id: string) { return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]; }

  const createGuard = useDiscardGuard(hasUnsavedChanges(form, BLANK_USER_FORM), () => { setCreateOpen(false); setForm(BLANK_USER_FORM); });
  const editGuard = useDiscardGuard(
    hasUnsavedChanges({ ...editUser, newPassword }, { ...editUserBaseline, newPassword: '' }),
    () => { setEditUser(null); setEditUserBaseline(null); setNewPassword(''); },
  );


  function roleSelect(value: string, onChange: (v: string) => void, triggerClass = 'w-full min-w-0') {
    return (
      <Select value={value} onValueChange={(v) => onChange(v ?? '')}>
        <SelectTrigger className={triggerClass}>
          <span className={cn('flex flex-1 text-left truncate text-sm', !value && 'text-muted-foreground')}>
            {roles.find((r) => r.id === value)?.name || U.fields.selectRole}
          </span>
        </SelectTrigger>
        <SelectContent>{roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
      </Select>
    );
  }

  const headerActions = (
    <div className="flex flex-wrap gap-2">
      {can.importUsers && (
        <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4 mr-1.5" />{U.import}</Button>
      )}
      {can.exportUsers && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" />}><Download className="h-4 w-4 mr-1.5" />{U.export}</DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuItem onClick={() => doExport('xlsx')}>{U.exportXlsx}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => doExport('csv')}>{U.exportCsv}</DropdownMenuItem>
            <p className="px-2 py-1.5 text-xs text-slate-400">{U.exportNote}</p>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {can.manageUsers && (
        <Dialog open={createOpen} onOpenChange={(o) => { if (o) setCreateOpen(true); else createGuard.requestClose(); }}>
          <DialogTrigger render={<Button className="bg-green-600 hover:bg-green-700 text-white" />}>+ {U.create}</DialogTrigger>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{U.createTitle}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1 min-w-0"><Label>{U.fields.username}</Label><Input value={form.username} onChange={(e) => setForm((f: any) => ({ ...f, username: e.target.value }))} /></div>
              <div className="space-y-1 min-w-0"><Label>{U.fields.fullName}</Label><Input value={form.fullName} onChange={(e) => setForm((f: any) => ({ ...f, fullName: e.target.value }))} /></div>
              <div className="space-y-1 min-w-0"><Label>{U.fields.email}</Label><Input value={form.email} onChange={(e) => setForm((f: any) => ({ ...f, email: e.target.value }))} /></div>
              <div className="space-y-1 min-w-0"><Label>{U.fields.department}</Label><Input value={form.department} onChange={(e) => setForm((f: any) => ({ ...f, department: e.target.value }))} /></div>
              <div className="space-y-1 min-w-0">
                <Label>{U.fields.rbacRole}</Label>
                {roleSelect(form.roleId, (v) => setForm((f: any) => ({ ...f, roleId: v })))}
              </div>
              <div className="space-y-1 min-w-0">
                <Label>{U.fields.legacyRole}</Label>
                <Select value={form.role} onValueChange={(v) => setForm((f: any) => ({ ...f, role: v ?? 'REQUESTER' }))}>
                  <SelectTrigger className="w-full min-w-0">
                    <span className="flex flex-1 text-left truncate text-sm">{labelOf(m.nav.roles, form.role) || U.fields.selectRole}</span>
                  </SelectTrigger>
                  <SelectContent>{ENUM_ROLES.map((r) => <SelectItem key={r} value={r}>{labelOf(m.nav.roles, r)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2"><Label>{U.fields.passwordCreate}</Label><Input type="text" value={form.password} onChange={(e) => setForm((f: any) => ({ ...f, password: e.target.value }))} placeholder="Welcome@123" /></div>
              <div className="sm:col-span-2 space-y-1">
                <Label>{U.fields.warehouses}</Label>
                <WarehouseChips warehouses={warehouses} selected={form.warehouseIds} onToggle={(id) => setForm((f: any) => ({ ...f, warehouseIds: toggleWh(f.warehouseIds, id) }))} />
                <WarehouseScopeHint selected={form.warehouseIds.length} />
              </div>
            </div>
            <DialogFooter><Button onClick={createUser} className="bg-green-600 hover:bg-green-700 text-white">{U.createButton}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <DiscardChangesDialog open={createGuard.confirming} onKeepEditing={createGuard.keepEditing} onDiscard={createGuard.confirmDiscard} />
      <DiscardChangesDialog open={editGuard.confirming} onKeepEditing={editGuard.keepEditing} onDiscard={editGuard.confirmDiscard} />
      <PageHeader title={U.title} subtitle={can.manageUsers ? U.subtitle : U.subtitleManager} icon={UsersIcon} action={headerActions} />
      {can.importUsers && <ImportUsersDialog open={importOpen} onOpenChange={setImportOpen} onImported={load} />}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <th className="text-left px-4 py-3 font-medium">{U.cols.name}</th>
            <th className="text-left px-4 py-3 font-medium">{U.cols.username}</th>
            <th className="text-left px-4 py-3 font-medium">{U.cols.role}</th>
            <th className="text-left px-4 py-3 font-medium">{U.cols.warehouses}</th>
            <th className="text-left px-4 py-3 font-medium">{U.cols.lastLogin}</th>
            <th className="text-left px-4 py-3 font-medium">{U.cols.status}</th>
            <th className="text-left px-4 py-3 font-medium">{U.cols.actions}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : users.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">{U.empty}</td></tr>
              ) : users.map((u) => {
                const scope = warehouseScopeLabel(u, U, t);
                return (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{u.fullName}</td>
                    <td className="px-4 py-3 font-mono text-sm text-slate-500">{u.username}</td>
                    <td className="px-4 py-3"><Badge variant="outline" className="rounded-full">{u.rbacRole?.name ?? labelOf(m.nav.roles, u.role)}</Badge></td>
                    <td className="px-4 py-3 text-sm"><span className={scope.open ? 'text-slate-500' : 'text-slate-800 font-medium'}>{scope.text}</span></td>
                    <td className="px-4 py-3 text-sm text-slate-500 whitespace-nowrap">{u.lastLoginAt ? fmt.dateTime(u.lastLoginAt) : '—'}</td>
                    <td className="px-4 py-3"><Badge variant="outline" className={cn('rounded-full', u.isActive ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-100 text-slate-600')}>{u.isActive ? U.status.active : U.status.inactive}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {can.manageUsers ? (
                          <>
                            <Button size="sm" variant="outline" className="h-8 w-8 p-0" title={U.actions.edit} aria-label={U.actions.edit} onClick={() => openEdit(u)}><Pencil className="h-3.5 w-3.5" /></Button>
                            <Button size="sm" variant="outline" className="h-8 w-8 p-0" title={U.actions.resetPassword} aria-label={U.actions.resetPassword} onClick={() => reset(u.id)}><KeyRound className="h-3.5 w-3.5" /></Button>
                            <Button size="sm" variant="outline" className="h-8 w-8 p-0" title={U.actions.toggle} aria-label={U.actions.toggle} onClick={() => toggle(u.id)}><Power className="h-3.5 w-3.5" /></Button>
                            <Button size="sm" variant="outline" className="h-8 w-8 p-0 text-red-600" title={U.actions.delete} aria-label={U.actions.delete} onClick={() => remove(u.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </>
                        ) : can.assignWarehouses && (
                          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setWhUser({ ...u, warehouseIds: (u.warehouses ?? []).map((w: any) => w.warehouse.id) })}>
                            <Building2 className="h-3.5 w-3.5" />{U.actions.assignWarehouses}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Warehouse-only dialog (P1 1.7: Warehouse Manager) */}
      <Dialog open={!!whUser} onOpenChange={(o) => { if (!o) setWhUser(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{t(U.warehouseDialog.title, { name: whUser?.fullName ?? '' })}</DialogTitle></DialogHeader>
          {whUser && (
            <div className="space-y-2">
              <Label>{U.fields.warehouses}</Label>
              <WarehouseChips warehouses={warehouses} selected={whUser.warehouseIds} onToggle={(id) => setWhUser((u: any) => ({ ...u, warehouseIds: toggleWh(u.warehouseIds, id) }))} />
              <WarehouseScopeHint selected={whUser.warehouseIds.length} />
              <p className="text-xs text-slate-500">{U.scope.managerHint}</p>
            </div>
          )}
          <DialogFooter><Button onClick={saveWarehouses} disabled={whSaving} className="bg-green-600 hover:bg-green-700 text-white">{U.warehouseDialog.save}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editUser} onOpenChange={(o) => { if (!o) editGuard.requestClose(); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t(U.edit.title, { username: editUser?.username ?? '' })}</DialogTitle></DialogHeader>
          {editUser && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1 min-w-0"><Label>{U.fields.loginUsername}</Label><Input value={editUser.username ?? ''} onChange={(e) => setEditUser((u: any) => ({ ...u, username: e.target.value }))} /></div>
              <div className="space-y-1 min-w-0"><Label>{U.fields.fullName}</Label><Input value={editUser.fullName} onChange={(e) => setEditUser((u: any) => ({ ...u, fullName: e.target.value }))} /></div>
              <div className="space-y-1 min-w-0"><Label>{U.fields.email}</Label><Input value={editUser.email ?? ''} onChange={(e) => setEditUser((u: any) => ({ ...u, email: e.target.value }))} /></div>
              <div className="space-y-1 min-w-0"><Label>{U.fields.department}</Label><Input value={editUser.department ?? ''} onChange={(e) => setEditUser((u: any) => ({ ...u, department: e.target.value }))} /></div>
              <div className="space-y-1 min-w-0 sm:col-span-2">
                <Label>{U.fields.rbacRole}</Label>
                {roleSelect(editUser.roleId, (v) => setEditUser((u: any) => ({ ...u, roleId: v })))}
              </div>

              {/* Password — set a new one directly, or reset to a temporary password */}
              <div className="space-y-1 min-w-0 sm:col-span-2 border-t pt-3">
                <Label>{U.fields.password}</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input type="text" className="flex-1 min-w-[180px]" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={U.edit.passwordPlaceholder} />
                  <Button type="button" variant="outline" className="gap-1.5 shrink-0" onClick={() => reset(editUser.id)}>
                    <KeyRound className="h-4 w-4" /> {U.edit.resetTemp}
                  </Button>
                </div>
                <p className="text-xs text-slate-500">{U.edit.passwordHint}</p>
              </div>

              <div className="sm:col-span-2 space-y-1">
                <Label>{U.fields.warehouses}</Label>
                <WarehouseChips warehouses={warehouses} selected={editUser.warehouseIds} onToggle={(id) => setEditUser((u: any) => ({ ...u, warehouseIds: toggleWh(u.warehouseIds, id) }))} />
                <WarehouseScopeHint selected={editUser.warehouseIds.length} />
              </div>

              {/* Multi-role assignments (with expiry) */}
              <div className="sm:col-span-2 space-y-2 border-t pt-3">
                <Label>{U.edit.extraRoles}</Label>
                <div className="flex flex-wrap gap-2">
                  {assignments.length === 0 && <span className="text-xs text-slate-500">{U.edit.noExtraRoles}</span>}
                  {assignments.map((a) => (
                    <Badge key={a.id} variant="outline" className="rounded-full bg-slate-50 gap-1">
                      {a.role?.name}{a.expiresAt ? ` · ${t(U.edit.expires, { date: fmt.date(a.expiresAt) })}` : ''}
                      <button onClick={() => removeAssignment(a.id)} className="ml-1 text-slate-400 hover:text-red-600" title={U.edit.removeRole} aria-label={U.edit.removeRole}><X className="h-3 w-3" /></button>
                    </Badge>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 items-end">
                  <div className="flex-1 min-w-[160px] space-y-1">
                    <Label className="text-xs">{U.edit.role}</Label>
                    {roleSelect(addForm.roleId, (v) => setAddForm((f) => ({ ...f, roleId: v })), 'h-8 w-full min-w-0')}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{U.edit.expiresOptional}</Label>
                    <Input type="date" className="h-8 w-[150px]" value={addForm.expiresAt} onChange={(e) => setAddForm((f) => ({ ...f, expiresAt: e.target.value }))} />
                  </div>
                  <Button size="sm" className="h-8 bg-slate-700 hover:bg-slate-800 text-white" onClick={addAssignment} disabled={!addForm.roleId}>{U.edit.add}</Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter><Button onClick={saveEdit} className="bg-green-600 hover:bg-green-700 text-white">{U.edit.save}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
