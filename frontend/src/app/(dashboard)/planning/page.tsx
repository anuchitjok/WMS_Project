'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookCheck, ClipboardList, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { planningApi, warehouseApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Field, FlagPills, NumInput, PROJECT_TYPES, PlanStatusPill, RunStatusPill, SalesPill, SelectInput, TextInput } from '@/components/planning/shared';
import { cn } from '@/lib/utils';

const today = () => new Date().toISOString().slice(0, 10);

export default function PlanningListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [filter, setFilter] = useState({ search: '', status: '', warehouseId: '', purpose: '' });
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
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/planning/templates" className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"><BookCheck className="h-4 w-4 mr-1.5" />Company templates</Link>
            <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />New project</Button>
          </div>
        }
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
        <SelectInput aria-label="Purpose" className="w-44" value={filter.purpose} onChange={(e) => setFilter({ ...filter, purpose: e.target.value })}>
          <option value="">Plans and simulations</option>
          <option value="OPERATIONAL">Operational plans</option>
          <option value="SALES">Sales simulations</option>
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
                  <td className="px-4 py-3">{p.purpose === 'SALES' ? <SalesPill status={p.planStatus} /> : <PlanStatusPill status={p.planStatus} />}</td>
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
  const [form, setForm] = useState<any>({ purpose: 'OPERATIONAL', name: '', projectType: 'REPAIR', warehouseId: '', plannedStart: today(), targetEnd: '', quantity: null, currency: 'THB', customer: '', priority: 'NORMAL', description: '' });
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  useEffect(() => {
    if (open) planningApi.companyTemplates('CONFIRMED').then((r) => setTemplates(r.rows)).catch(() => setTemplates([]));
  }, [open]);
  const chosen = templates.find((t) => t.id === form.companyTemplateId);
  const sales = form.purpose === 'SALES';
  const valid = form.name.trim() && (form.warehouseId || sales) && form.plannedStart && form.targetEnd && form.quantity >= 1 && form.targetEnd >= form.plannedStart;

  async function save() {
    setSaving(true);
    try {
      const dto: any = { ...form, name: form.name.trim() };
      for (const k of ['customer', 'description', 'warehouseId', 'companyTemplateId']) if (!dto[k]) delete dto[k];
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
          <DialogDescription>Start from a company template to get confirmed standard times, or from a blank workflow where you enter the times, workstations and yields.</DialogDescription>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Purpose">
          {([
            ['OPERATIONAL', 'Operational plan', 'Real work: checks live stock, can be submitted for approval.'],
            ['SALES', 'Sales simulation', 'For quotes and presentations: no stock check, never approved, never counts as demand.'],
          ] as const).map(([k, label, hint]) => (
            <button key={k} type="button" role="radio" aria-checked={form.purpose === k} onClick={() => set('purpose', k)}
              className={cn('text-left rounded-lg border px-3 py-2', form.purpose === k ? 'border-green-500 bg-green-50 ring-1 ring-green-500' : 'border-slate-200 hover:bg-slate-50')}>
              <span className="block text-sm font-medium text-slate-900">{label}</span>
              <span className="block text-xs text-slate-500 mt-0.5">{hint}</span>
            </button>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Start from" className="sm:col-span-2"
            hint={chosen ? `${chosen.stageCount} stages with confirmed standard values${chosen.materialCount ? ` and ${chosen.materialCount} material${chosen.materialCount > 1 ? 's' : ''} per unit` : ''}. Confirmed by ${chosen.confirmedBy ?? '—'}. You still enter quantity, dates, people and costs.`
              : templates.length ? 'Blank workflow: stage structure only.' : 'No confirmed company template yet — see Company templates.'}>
            <SelectInput aria-label="Start from" value={form.companyTemplateId ?? ''} onChange={(e) => {
              const t = templates.find((x) => x.id === e.target.value);
              setForm((f: any) => ({ ...f, companyTemplateId: e.target.value, ...(t ? { projectType: t.projectType } : {}) }));
            }}>
              <option value="">Blank workflow (enter the standards yourself)</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
            </SelectInput>
          </Field>
          <Field label="Project name" className="sm:col-span-2"><TextInput value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={120} /></Field>
          <Field label={chosen ? 'Project type' : 'Project type / workflow template'}>
            <SelectInput value={form.projectType} disabled={!!chosen} onChange={(e) => set('projectType', e.target.value)}>
              {Object.entries(PROJECT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </SelectInput>
          </Field>
          <Field label={sales ? 'Warehouse (optional)' : 'Warehouse'}>
            <SelectInput value={form.warehouseId} onChange={(e) => set('warehouseId', e.target.value)}>
              <option value="">{sales ? 'No warehouse' : 'Choose…'}</option>
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
          <Field label={sales ? 'Customer' : 'Customer / requesting department'}><TextInput value={form.customer} onChange={(e) => set('customer', e.target.value)} maxLength={120} /></Field>
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
