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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate } from '@/lib/utils';

const ENUM_ROLES = ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR', 'WAREHOUSE_STAFF', 'REQUESTER', 'DEPT_APPROVER', 'RTV_OFFICER', 'AUDITOR'];

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [addForm, setAddForm] = useState<{ roleId: string; expiresAt: string }>({ roleId: '', expiresAt: '' });
  const [form, setForm] = useState<any>({ username: '', fullName: '', email: '', role: 'REQUESTER', roleId: '', department: '', password: '', warehouseIds: [] as string[] });

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
      toast.success('สร้างผู้ใช้สำเร็จ'); setCreateOpen(false);
      setForm({ username: '', fullName: '', email: '', role: 'REQUESTER', roleId: '', department: '', password: '', warehouseIds: [] });
      load();
    } catch (e: any) { toast.error(e.message); }
  }

  async function saveEdit() {
    try {
      await usersApi.update(editUser.id, { fullName: editUser.fullName, email: editUser.email, department: editUser.department, role: editUser.role, roleId: editUser.roleId || null });
      await usersApi.setWarehouses(editUser.id, editUser.warehouseIds);
      toast.success('บันทึกแล้ว'); setEditUser(null); load();
    } catch (e: any) { toast.error(e.message); }
  }

  async function toggle(id: string) { try { await usersApi.toggle(id); load(); } catch (e: any) { toast.error(e.message); } }
  async function reset(id: string) {
    try { const r = await usersApi.resetPassword(id); toast.success(`รหัสชั่วคราว: ${r.tempPassword}`, { duration: 10000 }); }
    catch (e: any) { toast.error(e.message); }
  }
  async function remove(id: string) { try { await usersApi.remove(id); toast.success('ลบแล้ว'); load(); } catch (e: any) { toast.error(e.message); } }

  async function openEdit(u: any) {
    setEditUser({ ...u, roleId: u.roleId ?? '', warehouseIds: (u.warehouses ?? []).map((w: any) => w.warehouse.id) });
    try { setAssignments(await userRolesApi.list(u.id)); } catch { setAssignments([]); }
    setAddForm({ roleId: '', expiresAt: '' });
  }
  async function addAssignment() {
    if (!editUser || !addForm.roleId) return;
    try {
      await userRolesApi.assign(editUser.id, { roleId: addForm.roleId, expiresAt: addForm.expiresAt || undefined });
      toast.success('เพิ่ม role แล้ว');
      setAssignments(await userRolesApi.list(editUser.id));
      setAddForm({ roleId: '', expiresAt: '' });
    } catch (e: any) { toast.error(e.message); }
  }
  async function removeAssignment(aid: string) {
    if (!editUser) return;
    try { await userRolesApi.unassign(editUser.id, aid); setAssignments(await userRolesApi.list(editUser.id)); toast.success('ถอน role แล้ว'); }
    catch (e: any) { toast.error(e.message); }
  }
  function toggleWh(list: string[], id: string) { return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]; }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="User & Role Management" subtitle="จัดการผู้ใช้ บทบาท และสิทธิ์เข้าถึงคลัง" icon={UsersIcon}
        action={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger render={<Button className="bg-blue-600 hover:bg-blue-700 text-white" />}>+ สร้างผู้ใช้</DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>สร้างผู้ใช้ใหม่</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Username</Label><Input value={form.username} onChange={(e) => setForm((f: any) => ({ ...f, username: e.target.value }))} /></div>
                <div className="space-y-1"><Label>Full Name</Label><Input value={form.fullName} onChange={(e) => setForm((f: any) => ({ ...f, fullName: e.target.value }))} /></div>
                <div className="space-y-1"><Label>Email</Label><Input value={form.email} onChange={(e) => setForm((f: any) => ({ ...f, email: e.target.value }))} /></div>
                <div className="space-y-1"><Label>Department</Label><Input value={form.department} onChange={(e) => setForm((f: any) => ({ ...f, department: e.target.value }))} /></div>
                <div className="space-y-1">
                  <Label>RBAC Role</Label>
                  <Select value={form.roleId} onValueChange={(v) => setForm((f: any) => ({ ...f, roleId: v ?? '' }))}>
                    <SelectTrigger><SelectValue placeholder="เลือก role" /></SelectTrigger>
                    <SelectContent>{roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Legacy Role</Label>
                  <Select value={form.role} onValueChange={(v) => setForm((f: any) => ({ ...f, role: v ?? 'REQUESTER' }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{ENUM_ROLES.map((r) => <SelectItem key={r} value={r}>{r.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 col-span-2"><Label>Password (ว่าง = ตั้ง default + บังคับเปลี่ยน)</Label><Input type="text" value={form.password} onChange={(e) => setForm((f: any) => ({ ...f, password: e.target.value }))} placeholder="Welcome@123" /></div>
                <div className="col-span-2 space-y-1">
                  <Label>คลังที่เข้าถึงได้</Label>
                  <div className="flex flex-wrap gap-2">
                    {warehouses.map((w) => (
                      <button key={w.id} type="button" onClick={() => setForm((f: any) => ({ ...f, warehouseIds: toggleWh(f.warehouseIds, w.id) }))}
                        className={`px-2.5 py-1 rounded-md text-xs border ${form.warehouseIds.includes(w.id) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300'}`}>
                        {w.code}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter><Button onClick={createUser} className="bg-blue-600 hover:bg-blue-700 text-white">สร้าง</Button></DialogFooter>
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
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0" title="แก้ไข" onClick={() => openEdit(u)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0" title="reset password" onClick={() => reset(u.id)}><KeyRound className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0" title="เปิด/ปิด" onClick={() => toggle(u.id)}><Power className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-red-600" title="ลบ" onClick={() => remove(u.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editUser} onOpenChange={(o) => !o && setEditUser(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>แก้ไขผู้ใช้: {editUser?.username}</DialogTitle></DialogHeader>
          {editUser && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Full Name</Label><Input value={editUser.fullName} onChange={(e) => setEditUser((u: any) => ({ ...u, fullName: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Email</Label><Input value={editUser.email ?? ''} onChange={(e) => setEditUser((u: any) => ({ ...u, email: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Department</Label><Input value={editUser.department ?? ''} onChange={(e) => setEditUser((u: any) => ({ ...u, department: e.target.value }))} /></div>
              <div className="space-y-1">
                <Label>RBAC Role</Label>
                <Select value={editUser.roleId} onValueChange={(v) => setEditUser((u: any) => ({ ...u, roleId: v ?? '' }))}>
                  <SelectTrigger><SelectValue placeholder="เลือก role" /></SelectTrigger>
                  <SelectContent>{roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1">
                <Label>คลังที่เข้าถึงได้</Label>
                <div className="flex flex-wrap gap-2">
                  {warehouses.map((w) => (
                    <button key={w.id} type="button" onClick={() => setEditUser((u: any) => ({ ...u, warehouseIds: toggleWh(u.warehouseIds, w.id) }))}
                      className={`px-2.5 py-1 rounded-md text-xs border ${editUser.warehouseIds.includes(w.id) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300'}`}>
                      {w.code}
                    </button>
                  ))}
                </div>
              </div>

              {/* Multi-role assignments (with expiry) */}
              <div className="col-span-2 space-y-2 border-t pt-3">
                <Label>Multi-Role Assignments (เพิ่มได้หลาย role + กำหนดวันหมดอายุ)</Label>
                <div className="flex flex-wrap gap-2">
                  {assignments.length === 0 && <span className="text-xs text-slate-400">ยังไม่มี role assignment เพิ่มเติม (นอกจาก primary role)</span>}
                  {assignments.map((a) => (
                    <Badge key={a.id} variant="outline" className="bg-slate-100 gap-1">
                      {a.role?.name}{a.expiresAt ? ` · หมดอายุ ${new Date(a.expiresAt).toLocaleDateString()}` : ''}
                      <button onClick={() => removeAssignment(a.id)} className="ml-1 text-red-600 font-bold">×</button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2 items-end">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">Role</Label>
                    <Select value={addForm.roleId} onValueChange={(v) => setAddForm((f) => ({ ...f, roleId: v ?? '' }))}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="เลือก role" /></SelectTrigger>
                      <SelectContent>{roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">หมดอายุ (optional)</Label>
                    <Input type="date" className="h-8" value={addForm.expiresAt} onChange={(e) => setAddForm((f) => ({ ...f, expiresAt: e.target.value }))} />
                  </div>
                  <Button size="sm" className="h-8 bg-slate-700 hover:bg-slate-800 text-white" onClick={addAssignment} disabled={!addForm.roleId}>เพิ่ม</Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter><Button onClick={saveEdit} className="bg-blue-600 hover:bg-blue-700 text-white">บันทึก</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
