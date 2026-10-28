'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ClipboardList, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { planningApi, warehouseApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Field, FlagPills, NumInput, PROJECT_TYPES, PlanStatusPill, RunStatusPill, SelectInput, TextInput } from '@/components/planning/shared';

const today = () => new Date().toISOString().slice(0, 10);

export default function PlanningListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [filter, setFilter] = useState({ search: '', status: '', warehouseId: '' });
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await planningApi.list(filter)); } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { warehouseApi.list().then(setWarehouses).catch(() => setWarehouses([])); }, []);

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Project Planning"
        subtitle="Plan manpower, materials, space, timeline and cost before a project starts. Planning only — nothing here reserves stock or creates orders."
        icon={ClipboardList}
        action={<Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />New project</Button>}
      />

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 text-slate-400 absolute left-2.5 top-2.5" />
          <TextInput aria-label="Search projects" className="pl-8" placeholder="Search by name or code" value={filter.search} onChange={(e) => setFilter({ ...filter, search: e.target.value })} />
        </div>
        <SelectInput aria-label="Plan status" className="w-48" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
          <option value="">All active statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="IN_REVIEW">In planning review</option>
          <option value="PLAN_APPROVED">Plan approved</option>
          <option value="PLAN_REJECTED">Plan rejected</option>
          <option value="ARCHIVED">Archived</option>
        </SelectInput>
        <SelectInput aria-label="Warehouse" className="w-48" value={filter.warehouseId} onChange={(e) => setFilter({ ...filter, warehouseId: e.target.value })}>
          <option value="">All warehouses</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
        </SelectInput>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr className="text-left text-xs uppercase text-slate-500">
              <th className="px-4 py-3 font-medium">Project</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Warehouse</th>
              <th className="px-4 py-3 font-medium">Dates</th>
              <th className="px-4 py-3 font-medium">Plan status</th>
              <th className="px-4 py-3 font-medium">Latest calculation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(4)].map((_, i) => <tr key={i}><td colSpan={6} className="px-4 py-3"><Skeleton className="h-6" /></td></tr>)
              : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No projects yet. Create one to start planning.</td></tr>
              : rows.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/60 cursor-pointer" onClick={() => router.push(`/planning/project?id=${p.id}`)}>
                  <td className="px-4 py-3">
                    <Link href={`/planning/project?id=${p.id}`} className="font-medium text-slate-900 hover:text-green-700" onClick={(e) => e.stopPropagation()}>{p.name}</Link>
                    <p className="text-xs text-slate-400 font-mono">{p.code}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{PROJECT_TYPES[p.projectType] ?? p.projectType}</td>
                  <td className="px-4 py-3 text-slate-600">{p.warehouse?.code ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{p.plannedStart?.slice(0, 10)} → {p.targetEnd?.slice(0, 10)}</td>
                  <td className="px-4 py-3"><PlanStatusPill status={p.planStatus} /></td>
                  <td className="px-4 py-3 space-y-1">
                    {p.latestRun ? <><RunStatusPill status={p.latestRun.overallStatus} /><FlagPills flags={p.latestRun.flags.filter((f: string) => f !== 'INSUFFICIENT_DATA')} /></> : <span className="text-xs text-slate-400">Not calculated</span>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <CreateDialog open={open} onOpenChange={setOpen} warehouses={warehouses} onCreated={(id) => router.push(`/planning/project?id=${id}`)} />
    </div>
  );
}

function CreateDialog({ open, onOpenChange, warehouses, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; warehouses: any[]; onCreated: (id: string) => void }) {
  const [form, setForm] = useState<any>({ name: '', projectType: 'REPAIR', warehouseId: '', plannedStart: today(), targetEnd: '', quantity: null, currency: 'THB', customer: '', priority: 'NORMAL', description: '' });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const valid = form.name.trim() && form.warehouseId && form.plannedStart && form.targetEnd && form.quantity >= 1 && form.targetEnd >= form.plannedStart;

  async function save() {
    setSaving(true);
    try {
      const dto: any = { ...form, name: form.name.trim() };
      for (const k of ['customer', 'description']) if (!dto[k]) delete dto[k];
      const p = await planningApi.create(dto);
      toast.success(`Project ${p.code} created`);
      onCreated(p.id);
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New planning project</DialogTitle>
          <DialogDescription>The workflow template gives the stage structure only — you enter the times, workstations and yields.</DialogDescription>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Project name" className="sm:col-span-2"><TextInput value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={120} /></Field>
          <Field label="Project type / workflow template">
            <SelectInput value={form.projectType} onChange={(e) => set('projectType', e.target.value)}>
              {Object.entries(PROJECT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </SelectInput>
          </Field>
          <Field label="Warehouse">
            <SelectInput value={form.warehouseId} onChange={(e) => set('warehouseId', e.target.value)}>
              <option value="">Choose…</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </SelectInput>
          </Field>
          <Field label="Planned quantity (good units)"><NumInput value={form.quantity} onChange={(v) => set('quantity', v)} step="1" /></Field>
          <Field label="Priority">
            <SelectInput value={form.priority} onChange={(e) => set('priority', e.target.value)}>
              {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>)}
            </SelectInput>
          </Field>
          <Field label="Planned start"><TextInput type="date" value={form.plannedStart} onChange={(e) => set('plannedStart', e.target.value)} /></Field>
          <Field label="Target completion"><TextInput type="date" value={form.targetEnd} onChange={(e) => set('targetEnd', e.target.value)} /></Field>
          <Field label="Customer / requesting department"><TextInput value={form.customer} onChange={(e) => set('customer', e.target.value)} maxLength={120} /></Field>
          <Field label="Cost currency" hint="All project costs are calculated in this currency"><TextInput value={form.currency} maxLength={3} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></Field>
          <Field label="Description" className="sm:col-span-2"><TextInput value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={2000} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-green-600 hover:bg-green-700 text-white" disabled={!valid || saving} onClick={save}>{saving ? 'Creating…' : 'Create project'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
