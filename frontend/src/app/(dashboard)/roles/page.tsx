'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { ShieldCheck, Save, Copy, Power, Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { rolesApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';

export default function RolesPage() {
  const [permissions, setPermissions] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [matrix, setMatrix] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [newRole, setNewRole] = useState({ key: '', name: '', description: '' });
  const [newPerm, setNewPerm] = useState({ module: '', action: '', description: '' });
  const [roleOpen, setRoleOpen] = useState(false);
  const [permOpen, setPermOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const m = await rolesApi.matrix();
      setPermissions(m.permissions);
      setRoles(m.roles);
      const map: Record<string, Set<string>> = {};
      m.roles.forEach((r: any) => { map[r.id] = new Set(r.permissionIds); });
      setMatrix(map);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const g: Record<string, any[]> = {};
    permissions.forEach((p) => { (g[p.module] ??= []).push(p); });
    return g;
  }, [permissions]);
  const idToCode = useMemo(() => new Map(permissions.map((p) => [p.id, p.code])), [permissions]);

  function toggle(roleId: string, permId: string) {
    setMatrix((prev) => {
      const next = { ...prev }; const s = new Set(next[roleId]);
      s.has(permId) ? s.delete(permId) : s.add(permId); next[roleId] = s; return next;
    });
  }
  async function saveRole(roleId: string) {
    setSavingRole(roleId);
    try {
      const codes = [...(matrix[roleId] ?? [])].map((id) => idToCode.get(id)).filter(Boolean) as string[];
      await rolesApi.setPermissions(roleId, codes);
      toast.success('Permissions saved');
    } catch (e: any) { toast.error(e.message); } finally { setSavingRole(null); }
  }
  async function createRole() {
    try { await rolesApi.create(newRole); toast.success('Role created'); setRoleOpen(false); setNewRole({ key: '', name: '', description: '' }); load(); }
    catch (e: any) { toast.error(e.message); }
  }
  async function createPerm() {
    try { await rolesApi.createPermission(newPerm); toast.success('Permission created'); setPermOpen(false); setNewPerm({ module: '', action: '', description: '' }); load(); }
    catch (e: any) { toast.error(e.message); }
  }
  async function clone(id: string) {
    const name = window.prompt('New role name (clone):');
    if (!name) return;
    try { await rolesApi.clone(id, name); toast.success('Cloned'); load(); } catch (e: any) { toast.error(e.message); }
  }
  async function toggleActive(id: string) {
    try { await rolesApi.toggle(id); toast.success('Status updated'); load(); } catch (e: any) { toast.error(e.message); }
  }
  async function removeRole(id: string) {
    try { await rolesApi.remove(id); toast.success('Deleted'); load(); } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Role & Permission Matrix" subtitle="Create/edit roles and permissions dynamically (RBAC)" icon={ShieldCheck}
        action={
          <div className="flex gap-2">
            <Dialog open={permOpen} onOpenChange={setPermOpen}>
              <DialogTrigger render={<Button variant="outline" />}><Plus className="h-4 w-4 mr-1" />Permission</DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create New Permission</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1"><Label>Module</Label><Input value={newPerm.module} onChange={(e) => setNewPerm((p) => ({ ...p, module: e.target.value }))} placeholder="inventory" /></div>
                  <div className="space-y-1"><Label>Action</Label><Input value={newPerm.action} onChange={(e) => setNewPerm((p) => ({ ...p, action: e.target.value }))} placeholder="export" /></div>
                  <div className="space-y-1"><Label>Description</Label><Input value={newPerm.description} onChange={(e) => setNewPerm((p) => ({ ...p, description: e.target.value }))} /></div>
                  <p className="text-xs text-slate-400">code = module.action (e.g. inventory.export)</p>
                </div>
                <DialogFooter><Button className="bg-green-600 hover:bg-green-700 text-white" onClick={createPerm}>Create</Button></DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={roleOpen} onOpenChange={setRoleOpen}>
              <DialogTrigger render={<Button className="bg-green-600 hover:bg-green-700 text-white" />}><Plus className="h-4 w-4 mr-1" />Role</DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create New Role</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1"><Label>Key</Label><Input value={newRole.key} onChange={(e) => setNewRole((r) => ({ ...r, key: e.target.value }))} placeholder="STORE_KEEPER" /></div>
                  <div className="space-y-1"><Label>Name</Label><Input value={newRole.name} onChange={(e) => setNewRole((r) => ({ ...r, name: e.target.value }))} placeholder="Store Keeper" /></div>
                  <div className="space-y-1"><Label>Description</Label><Input value={newRole.description} onChange={(e) => setNewRole((r) => ({ ...r, description: e.target.value }))} /></div>
                </div>
                <DialogFooter><Button className="bg-green-600 hover:bg-green-700 text-white" onClick={createRole}>Create</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {loading ? <Skeleton className="h-96 rounded-xl" /> : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0">
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-medium text-slate-600 min-w-52">Permission</th>
                {roles.map((r) => (
                  <th key={r.id} className="px-3 py-3 font-medium text-slate-700 text-center min-w-32">
                    <div className={r.isActive ? '' : 'opacity-40 line-through'}>{r.name}</div>
                    <div className="flex gap-1 justify-center mt-1">
                      {r.isSystem && <Badge variant="outline" className="text-[11px]">system</Badge>}
                      {!r.isActive && <Badge variant="outline" className="text-[11px] bg-red-100 text-red-700">disabled</Badge>}
                    </div>
                    <div className="flex gap-1 justify-center mt-1.5">
                      <button title="clone" onClick={() => clone(r.id)} className="p-1 hover:bg-slate-200 rounded"><Copy className="h-3 w-3" /></button>
                      {r.key !== 'SUPER_ADMIN' && <button title="enable/disable" onClick={() => toggleActive(r.id)} className="p-1 hover:bg-slate-200 rounded"><Power className="h-3 w-3" /></button>}
                      {!r.isSystem && <button title="delete" onClick={() => removeRole(r.id)} className="p-1 hover:bg-red-100 text-red-600 rounded"><Trash2 className="h-3 w-3" /></button>}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(grouped).map(([module, perms]) => (
                <>
                  <tr key={module} className="bg-slate-100/60">
                    <td colSpan={roles.length + 1} className="px-4 py-1.5 font-semibold text-slate-500 uppercase text-[10px] tracking-wider">{module}</td>
                  </tr>
                  {perms.map((p) => (
                    <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-2"><span className="font-mono text-slate-700">{p.code}</span>{p.description && <span className="text-slate-400 ml-2">{p.description}</span>}</td>
                      {roles.map((r) => (
                        <td key={r.id} className="px-3 py-2 text-center">
                          <input type="checkbox" className="h-4 w-4 accent-green-600 cursor-pointer disabled:opacity-30"
                            disabled={r.key === 'SUPER_ADMIN'}
                            checked={r.key === 'SUPER_ADMIN' ? true : (matrix[r.id]?.has(p.id) ?? false)}
                            onChange={() => toggle(r.id, p.id)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t border-slate-200">
                <td className="px-4 py-3 font-medium text-slate-600">Save per role →</td>
                {roles.map((r) => (
                  <td key={r.id} className="px-3 py-3 text-center">
                    {r.key !== 'SUPER_ADMIN' && (
                      <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white" disabled={savingRole === r.id} onClick={() => saveRole(r.id)}><Save className="h-3.5 w-3.5" /></Button>
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-400">SUPER_ADMIN always has full access (immutable) · clone/disable/delete via the column header · add permissions/roles dynamically</p>
    </div>
  );
}
