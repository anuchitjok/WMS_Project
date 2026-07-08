'use client';

import { useEffect, useState, useCallback } from 'react';
import { Users as UsersIcon, KeyRound, Power, Trash2, Pencil } from 'lucide-react';
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
import { formatDate, cn, hasUnsavedChanges } from '@/lib/utils';

const ENUM_ROLES = ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR', 'WAREHOUSE_STAFF', 'REQUESTER', 'DEPT_APPROVER', 'RTV_OFFICER', 'AUDITOR'];

const BLANK_USER_FORM = { username: '', fullName: '', email: '', role: 'REQUESTER', roleId: '', department: '', password: '', warehouseIds: [] as string[] };

export default function UsersPage() {
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

  async function createUser() {
    try {
      await usersApi.create({ ...form, roleId: form.roleId || undefined, password: form.password || undefined });
      toast.success('User created successfully'); setCreateOpen(false);
      setForm(BLANK_USER_FORM);
      load();
    } catch (e: any) { toast.error(e.message); }
  }

  async function saveEdit() {
    if (newPassword && newPassword.length < 8) { toast.error('Password must be at least 8 characters'); return; }
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
      toast.success(newPassword ? 'Saved — password updated' : 'Saved'); setEditUser(null); setEditUserBaseline(null); load();
    } catch (e: any) { toast.error(e.message); }
  }

  async function toggle(id: string) { try { await usersApi.toggle(id); load(); } catch (e: any) { toast.error(e.message); } }
  async function reset(id: string) {
    try { const r = await usersApi.resetPassword(id); toast.success(`Temporary password: ${r.tempPassword}`, { duration: 10000 }); }
    catch (e: any) { toast.error(e.message); }
  }
  async function remove(id: string) { try { await usersApi.remove(id); toast.success('Deleted'); load(); } catch (e: any) { toast.error(e.message); } }

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
      toast.success('Role added');
      setAssignments(await userRolesApi.list(editUser.id));
      setAddForm({ roleId: '', expiresAt: '' });
    } catch (e: any) { toast.error(e.message); }
  }
  async function removeAssignment(aid: string) {
    if (!editUser) return;
    try { await userRolesApi.unassign(editUser.id, aid); setAssignments(await userRolesApi.list(editUser.id)); toast.success('Role removed'); }
    catch (e: any) { toast.error(e.message); }
  }
  function toggleWh(list: string[], id: string) { return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]; }

  const createGuard = useDiscardGuard(hasUnsavedChanges(form, BLANK_USER_FORM), () => { setCreateOpen(false); setForm(BLANK_USER_FORM); });
  const editGuard = useDiscardGuard(
    hasUnsavedChanges({ ...editUser, newPassword }, { ...editUserBaseline, newPassword: '' }),
    () => { setEditUser(null); setEditUserBaseline(null); setNewPassword(''); },
  );

  return (
    <div className="p-6 space-y-5">
      <DiscardChangesDialog open={createGuard.confirming} onKeepEditing={createGuard.keepEditing} onDiscard={createGuard.confirmDiscard} />
      <DiscardChangesDialog open={editGuard.confirming} onKeepEditing={editGuard.keepEditing} onDiscard={editGuard.confirmDiscard} />
      <PageHeader title="User & Role Management" subtitle="Manage users, roles, and warehouse access" icon={UsersIcon}
        action={
          <Dialog open={createOpen} onOpenChange={(o) => { if (o) setCreateOpen(true); else createGuard.requestClose(); }}>
            <DialogTrigger render={<Button className="bg-green-600 hover:bg-green-700 text-white" />}>+ Create User</DialogTrigger>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Create New User</DialogTitle></DialogHeader>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1 min-w-0"><Label>Username</Label><Input value={form.username} onChange={(e) => setForm((f: any) => ({ ...f, username: e.target.value }))} /></div>
                <div className="space-y-1 min-w-0"><Label>Full Name</Label><Input value={form.fullName} onChange={(e) => setForm((f: any) => ({ ...f, fullName: e.target.value }))} /></div>
                <div className="space-y-1 min-w-0"><Label>Email</Label><Input value={form.email} onChange={(e) => setForm((f: any) => ({ ...f, email: e.target.value }))} /></div>
                <div className="space-y-1 min-w-0"><Label>Department</Label><Input value={form.department} onChange={(e) => setForm((f: any) => ({ ...f, department: e.target.value }))} /></div>
                <div className="space-y-1 min-w-0">
                  <Label>RBAC Role</Label>
                  <Select value={form.roleId} onValueChange={(v) => setForm((f: any) => ({ ...f, roleId: v ?? '' }))}>
                    <SelectTrigger className="w-full min-w-0">
                      <span className={cn('flex flex-1 text-left truncate text-sm', !form.roleId && 'text-muted-foreground')}>
                        {roles.find((r) => r.id === form.roleId)?.name || 'Select role'}
                      </span>
                    </SelectTrigger>
                    <SelectContent>{roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 min-w-0">
                  <Label>Legacy Role</Label>
                  <Select value={form.role} onValueChange={(v) => setForm((f: any) => ({ ...f, role: v ?? 'REQUESTER' }))}>
                    <SelectTrigger className="w-full min-w-0">
                      <span className="flex flex-1 text-left truncate text-sm">{(form.role ?? '').replace(/_/g, ' ') || 'Select role'}</span>
                    </SelectTrigger>
                    <SelectContent>{ENUM_ROLES.map((r) => <SelectItem key={r} value={r}>{r.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 sm:col-span-2"><Label>Password (blank = set default + force change)</Label><Input type="text" value={form.password} onChange={(e) => setForm((f: any) => ({ ...f, password: e.target.value }))} placeholder="Welcome@123" /></div>
                <div className="sm:col-span-2 space-y-1">
                  <Label>Accessible Warehouses</Label>
                  <div className="flex flex-wrap gap-2">
                    {warehouses.map((w) => (
                      <button key={w.id} type="button" onClick={() => setForm((f: any) => ({ ...f, warehouseIds: toggleWh(f.warehouseIds, w.id) }))}
                        className={`px-2.5 py-1 rounded-md text-xs border ${form.warehouseIds.includes(w.id) ? 'bg-green-600 text-white border-green-600' : 'bg-white text-slate-600 border-slate-300'}`}>
                        {w.code}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter><Button onClick={createUser} className="bg-green-600 hover:bg-green-700 text-white">Create</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Username</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">RBAC Role</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Warehouses</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Last Login</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{u.fullName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{u.username}</td>
                  <td className="px-4 py-3"><Badge variant="outline">{u.rbacRole?.name ?? u.role?.replace(/_/g, ' ')}</Badge></td>
                  <td className="px-4 py-3 text-xs text-slate-500">{(u.warehouses ?? []).map((w: any) => w.warehouse.code).join(', ') || '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{u.lastLoginAt ? formatDate(u.lastLoginAt) : '—'}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className={u.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>{u.isActive ? 'Active' : 'Inactive'}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0" title="Edit" onClick={() => openEdit(u)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0" title="reset password" onClick={() => reset(u.id)}><KeyRound className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0" title="Enable/Disable" onClick={() => toggle(u.id)}><Power className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-red-600" title="Delete" onClick={() => remove(u.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editUser} onOpenChange={(o) => { if (!o) editGuard.requestClose(); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit User: {editUser?.username}</DialogTitle></DialogHeader>
          {editUser && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1 min-w-0"><Label>Login Username</Label><Input value={editUser.username ?? ''} onChange={(e) => setEditUser((u: any) => ({ ...u, username: e.target.value }))} /></div>
              <div className="space-y-1 min-w-0"><Label>Full Name</Label><Input value={editUser.fullName} onChange={(e) => setEditUser((u: any) => ({ ...u, fullName: e.target.value }))} /></div>
              <div className="space-y-1 min-w-0"><Label>Email</Label><Input value={editUser.email ?? ''} onChange={(e) => setEditUser((u: any) => ({ ...u, email: e.target.value }))} /></div>
              <div className="space-y-1 min-w-0"><Label>Department</Label><Input value={editUser.department ?? ''} onChange={(e) => setEditUser((u: any) => ({ ...u, department: e.target.value }))} /></div>
              <div className="space-y-1 min-w-0 sm:col-span-2">
                <Label>RBAC Role</Label>
                <Select value={editUser.roleId} onValueChange={(v) => setEditUser((u: any) => ({ ...u, roleId: v ?? '' }))}>
                  <SelectTrigger className="w-full min-w-0">
                    <span className={cn('flex flex-1 text-left truncate text-sm', !editUser.roleId && 'text-muted-foreground')}>
                      {roles.find((r) => r.id === editUser.roleId)?.name || 'Select role'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>{roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              {/* Password — set a new one directly, or reset to a temporary password */}
              <div className="space-y-1 min-w-0 sm:col-span-2 border-t pt-3">
                <Label>Password</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="text"
                    className="flex-1 min-w-[180px]"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Set a new password (min 8 chars) — leave blank to keep current"
                  />
                  <Button type="button" variant="outline" className="gap-1.5 shrink-0" onClick={() => reset(editUser.id)}>
                    <KeyRound className="h-4 w-4" /> Reset to temp
                  </Button>
                </div>
                <p className="text-xs text-slate-400">Typing a password sets it immediately on Save. &ldquo;Reset to temp&rdquo; generates a one-time password and forces a change at next login.</p>
              </div>

              <div className="sm:col-span-2 space-y-1">
                <Label>Accessible Warehouses</Label>
                <div className="flex flex-wrap gap-2">
                  {warehouses.map((w) => (
                    <button key={w.id} type="button" onClick={() => setEditUser((u: any) => ({ ...u, warehouseIds: toggleWh(u.warehouseIds, w.id) }))}
                      className={`px-2.5 py-1 rounded-md text-xs border ${editUser.warehouseIds.includes(w.id) ? 'bg-green-600 text-white border-green-600' : 'bg-white text-slate-600 border-slate-300'}`}>
                      {w.code}
                    </button>
                  ))}
                </div>
              </div>

              {/* Multi-role assignments (with expiry) */}
              <div className="sm:col-span-2 space-y-2 border-t pt-3">
                <Label>Multi-Role Assignments (add multiple roles + set expiry date)</Label>
                <div className="flex flex-wrap gap-2">
                  {assignments.length === 0 && <span className="text-xs text-slate-400">No additional role assignments yet (besides the primary role)</span>}
                  {assignments.map((a) => (
                    <Badge key={a.id} variant="outline" className="bg-slate-100 gap-1">
                      {a.role?.name}{a.expiresAt ? ` · expires ${new Date(a.expiresAt).toLocaleDateString()}` : ''}
                      <button onClick={() => removeAssignment(a.id)} className="ml-1 text-red-600 font-bold">×</button>
                    </Badge>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 items-end">
                  <div className="flex-1 min-w-[160px] space-y-1">
                    <Label className="text-xs">Role</Label>
                    <Select value={addForm.roleId} onValueChange={(v) => setAddForm((f) => ({ ...f, roleId: v ?? '' }))}>
                      <SelectTrigger className="h-8 w-full min-w-0">
                        <span className={cn('flex flex-1 text-left truncate text-sm', !addForm.roleId && 'text-muted-foreground')}>
                          {roles.find((r) => r.id === addForm.roleId)?.name || 'Select role'}
                        </span>
                      </SelectTrigger>
                      <SelectContent>{roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Expires (optional)</Label>
                    <Input type="date" className="h-8 w-[150px]" value={addForm.expiresAt} onChange={(e) => setAddForm((f) => ({ ...f, expiresAt: e.target.value }))} />
                  </div>
                  <Button size="sm" className="h-8 bg-slate-700 hover:bg-slate-800 text-white" onClick={addAssignment} disabled={!addForm.roleId}>Add</Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter><Button onClick={saveEdit} className="bg-green-600 hover:bg-green-700 text-white">Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
