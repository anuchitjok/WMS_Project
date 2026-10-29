'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  BookCheck, ChevronRight, ClipboardList, Copy, FileText, GitCompare, History as History_, LayoutDashboard, Pencil, Play, Save, ShieldCheck, SlidersHorizontal, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { planningApi, productsApi, warehouseApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FlagPills, PROJECT_TYPES, Pill, PlanStatusPill, RunStatusPill, SalesPill, Section, SelectInput, TextInput, fmt, money } from '@/components/planning/shared';
import { Inputs, MaterialsEditor, SetupEditor, SpaceCostEditor, WorkflowEditor } from '@/components/planning/inputs-editor';
import { ResultsView } from '@/components/planning/results-view';

type Mode = 'dashboard' | 'inputs' | 'compare' | 'history';
const MODES: [Mode, string, LucideIcon][] = [
  ['dashboard', 'Dashboard', LayoutDashboard], ['inputs', 'Edit inputs', SlidersHorizontal], ['compare', 'Compare scenarios', GitCompare], ['history', 'History', History_],
];
const INPUT_TABS = [
  ['project', 'Project'], ['setup', 'Calendar & manpower'], ['workflow', 'Workflow'], ['materials', 'Materials'], ['space', 'Space & cost'],
] as const;

function Workspace() {
  const id = useSearchParams().get('id') ?? '';
  const [p, setP] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode | null>(null);
  const [inputTab, setInputTab] = useState<string>('setup');
  const [scenarioId, setScenarioId] = useState<string>('');
  const [draft, setDraft] = useState<Inputs | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<any>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [dialog, setDialog] = useState<null | 'scenario' | 'submit' | 'approve' | 'reject' | 'template'>(null);

  const load = useCallback(async (keepScenario?: string) => {
    if (!id) return;
    try {
      const data = await planningApi.get(id);
      setP(data);
      // First load: open the dashboard when a calculation exists, otherwise the inputs.
      setMode((m) => m ?? (data.runs.length ? 'dashboard' : 'inputs'));
      const sid = keepScenario && data.scenarios.some((s: any) => s.id === keepScenario) ? keepScenario : data.scenarios[0]?.id;
      setScenarioId(sid);
      setDraft(data.scenarios.find((s: any) => s.id === sid)?.inputs ?? null);
      setDirty(false);
      return data;
    } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    planningApi.templates().then(setTemplates).catch(() => {});
    warehouseApi.list().then(setWarehouses).catch(() => {});
    productsApi.list().then(setProducts).catch(() => setProducts([]));
  }, []);

  const scenario = p?.scenarios.find((s: any) => s.id === scenarioId);
  const scenarioRuns = useMemo(() => (p?.runs ?? []).filter((r: any) => r.scenarioId === scenarioId), [p, scenarioId]);

  // Show the latest run of the selected scenario.
  useEffect(() => {
    const latest = scenarioRuns[0];
    if (!latest) { setRun(null); return; }
    if (run?.id === latest.id) return;
    planningApi.run(id, latest.id).then(setRun).catch((e) => toast.error(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioRuns, id]);

  const readOnly = !p?.canManage || ['IN_REVIEW', 'ARCHIVED'].includes(p?.planStatus);
  const set = useCallback((fn: (i: Inputs) => Inputs) => { setDraft((d) => (d ? fn(d) : d)); setDirty(true); }, []);

  function switchScenario(sid: string) {
    if (dirty && !confirm('Discard unsaved changes to this scenario?')) return;
    setScenarioId(sid);
    setDraft(p.scenarios.find((s: any) => s.id === sid)?.inputs ?? null);
    setDirty(false);
  }

  async function save(): Promise<boolean> {
    if (!draft || !scenario) return false;
    setBusy(true);
    try {
      await planningApi.updateScenario(id, scenario.id, { inputs: draft, version: scenario.version });
      if (p.planStatus === 'PLAN_APPROVED') toast.info('The plan approval was withdrawn because the inputs changed');
      await load(scenario.id);
      toast.success('Scenario saved');
      return true;
    } catch (e: any) { toast.error(e.message); return false; } finally { setBusy(false); }
  }

  async function calculate() {
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      const r = await planningApi.calculate(id, scenarioId);
      setRun(r);
      await load(scenarioId);
      setMode('dashboard');
      toast.success(`Run #${r.runNumber} calculated`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  async function act(fn: () => Promise<any>, msg: string) {
    setBusy(true);
    try { await fn(); toast.success(msg); setDialog(null); await load(scenarioId); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  if (!id) return <div className="p-6 text-slate-500">No project selected. <Link className="text-green-700" href="/planning">Back to projects</Link></div>;
  if (loading || !p) return <div className="p-6 space-y-3"><Skeleton className="h-16" /><Skeleton className="h-64" /></div>;

  const userName = (uid?: string | null) => p.users.find((u: any) => u.id === uid)?.fullName ?? '—';
  const sales = p.purpose === 'SALES';

  const card = <ProjectCard p={p} quantity={draft?.quantity ?? run?.result?.summary?.quantity} userName={userName} onEdit={!readOnly ? () => { setMode('inputs'); setInputTab('project'); } : undefined} />;

  return (
    <div className="p-6 space-y-4">
      <nav className="flex items-center gap-1.5 text-xs text-slate-500">
        <Link href="/planning" className="text-green-700 hover:underline">Project Planning</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-slate-700 truncate">{p.name}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3 min-w-0">
          <span className="h-11 w-11 rounded-xl bg-green-50 text-green-700 grid place-items-center shrink-0"><ClipboardList className="h-6 w-6" /></span>
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-slate-900">{p.name}</h1>
              {sales ? <SalesPill status={p.planStatus} /> : <PlanStatusPill status={p.planStatus} />}
            </div>
            <p className="text-xs text-slate-500">
              <span className="font-mono">{p.code}</span> · {PROJECT_TYPES[p.projectType] ?? p.projectType} · {p.warehouse?.code ?? 'No warehouse'} · {p.plannedStart.slice(0, 10)} → {p.targetEnd.slice(0, 10)}
            </p>
            {sales && <p className="text-xs text-slate-500">Sales simulation — stock is not read, it is never submitted for approval and it never counts as demand for real plans.</p>}
            {p.planStatus === 'IN_REVIEW' && <p className="text-xs text-amber-700">Submitted by {userName(p.submittedById)} — waiting for a reviewer. Return to draft to change inputs.</p>}
            {p.reviewNote && p.planStatus !== 'IN_REVIEW' && <p className="text-xs text-slate-500">Review note: {p.reviewNote} ({userName(p.reviewedById)})</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
          {run && run.overallStatus !== 'INSUFFICIENT_DATA' && (
            <Link href={`/planning/summary?id=${id}&run=${run.id}`} className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50">
              <FileText className="h-4 w-4 mr-1.5" />Customer summary
            </Link>
          )}
          {p.canManage && run && run.overallStatus !== 'INSUFFICIENT_DATA' && !run.stale && !dirty && (
            <Button variant="outline" onClick={() => setDialog('template')}><BookCheck className="h-4 w-4 mr-1.5" />Save as template</Button>
          )}
          {!sales && p.canManage && ['DRAFT', 'PLAN_REJECTED'].includes(p.planStatus) && run && run.overallStatus !== 'INSUFFICIENT_DATA' && !run.stale && !dirty && (
            <Button variant="outline" onClick={() => setDialog('submit')}>Submit for planning review</Button>
          )}
          {p.canApprove && p.planStatus === 'IN_REVIEW' && (
            <>
              <Button variant="outline" onClick={() => setDialog('reject')}>Reject</Button>
              <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => setDialog('approve')}><ShieldCheck className="h-4 w-4 mr-1" />Approve plan</Button>
            </>
          )}
          {p.canManage && ['IN_REVIEW', 'PLAN_APPROVED', 'PLAN_REJECTED', 'ARCHIVED'].includes(p.planStatus) && (
            <Button variant="outline" onClick={() => act(() => planningApi.reopen(id), 'Returned to draft')}>Return to draft</Button>
          )}
          {!readOnly && <Button variant="outline" className="border-green-600 text-green-700 hover:bg-green-50" disabled={!dirty || busy} onClick={save}><Save className="h-4 w-4 mr-1" />Save draft</Button>}
          {p.canManage && p.planStatus !== 'ARCHIVED' && (
            <Button className="bg-green-600 hover:bg-green-700 text-white" disabled={busy || (dirty && readOnly)} onClick={calculate}>
              <Play className="h-4 w-4 mr-1.5" />{busy ? 'Working…' : 'Run calculation'}
            </Button>
          )}
          {p.canManage && p.planStatus !== 'ARCHIVED' && (
            <Button variant="ghost" className="text-slate-500" onClick={() => confirm('Archive this project? It stays available under Archived.') && act(() => planningApi.archive(id), 'Archived')}>Archive</Button>
          )}
        </div>
      </div>

      {/* Scenario + view switch */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500 ml-1 mr-1">Scenario</span>
        {p.scenarios.map((s: any) => (
          <button key={s.id} onClick={() => switchScenario(s.id)}
            className={cn('h-8 px-3 rounded-md border text-sm', s.id === scenarioId ? 'bg-green-50 border-green-300 text-green-800 font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
            {s.name}{s.isBaseline && <span className="ml-1.5 text-[11px] text-slate-400">baseline</span>}
          </button>
        ))}
        {p.canManage && p.planStatus !== 'ARCHIVED' && <Button size="sm" variant="ghost" className="h-8" onClick={() => setDialog('scenario')}><Copy className="h-3.5 w-3.5 mr-1" />Copy as new scenario</Button>}
        <div className="flex-1" />
        <div className="flex max-w-full overflow-x-auto rounded-lg bg-slate-100 p-0.5">
          {MODES.map(([k, label, Icon]) => (
            <button key={k} onClick={() => setMode(k)}
              className={cn('h-8 px-3 rounded-md text-sm inline-flex items-center gap-1.5 whitespace-nowrap', mode === k ? 'bg-white text-green-700 font-medium shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
              <Icon className="h-3.5 w-3.5" />{label}
              {k === 'dashboard' && run && <span className={cn('inline-block h-2 w-2 rounded-full', run.overallStatus === 'READY_FOR_PLANNING_REVIEW' ? 'bg-green-500' : run.overallStatus === 'NOT_READY' ? 'bg-amber-500' : 'bg-slate-400')} />}
            </button>
          ))}
        </div>
      </div>

      {mode === 'dashboard' && (run ? <ResultsView run={run} aside={card} /> : (
        <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)] items-start">
          {card}
          <Section title="No calculation yet"><p className="text-sm text-slate-500">Enter the inputs under Edit inputs, then click Run calculation.</p></Section>
        </div>
      ))}

      {mode === 'inputs' && (
        <>
          <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
            {INPUT_TABS.map(([k, label]) => (
              <button key={k} onClick={() => setInputTab(k)} className={cn('px-4 py-2 text-sm -mb-px border-b-2 whitespace-nowrap', inputTab === k ? 'border-green-600 text-green-700 font-medium' : 'border-transparent text-slate-500 hover:text-slate-800')}>{label}</button>
            ))}
          </div>
          {readOnly && (
            <p className="text-xs text-slate-500">{p.canManage ? 'Inputs are locked while the plan is in review or archived.' : 'You can view this plan but not change it.'}</p>
          )}
          {inputTab === 'project' && <ProjectInfo p={p} warehouses={warehouses} readOnly={readOnly} onSaved={() => load(scenarioId)} />}
          {draft && inputTab === 'setup' && <SetupEditor inputs={draft} set={set} warehouses={warehouses} defaultWarehouseId={p.warehouseId} readOnly={readOnly} canCost={p.canViewCost} currency={p.currency} sales={sales} />}
          {draft && inputTab === 'workflow' && <WorkflowEditor inputs={draft} set={set} readOnly={readOnly} templates={templates} />}
          {draft && inputTab === 'materials' && <MaterialsEditor inputs={draft} set={set} readOnly={readOnly} products={products} canCost={p.canViewCost} currency={p.currency} sales={sales} />}
          {draft && inputTab === 'space' && <SpaceCostEditor inputs={draft} set={set} readOnly={readOnly} canCost={p.canViewCost} currency={p.currency} />}
        </>
      )}
      {mode === 'compare' && <Compare p={p} />}
      {mode === 'history' && <History p={p} userName={userName} onOpen={(rid) => planningApi.run(id, rid).then((r) => { setRun(r); setScenarioId(r.scenarioId); setDraft(p.scenarios.find((s: any) => s.id === r.scenarioId)?.inputs ?? null); setDirty(false); setMode('dashboard'); })} />}

      <NewScenarioDialog open={dialog === 'scenario'} onClose={() => setDialog(null)} busy={busy}
        onCreate={(name) => act(async () => { const s = await planningApi.createScenario(id, { name, cloneFromId: scenarioId }); setScenarioId(s.id); }, 'Scenario created')} />
      {dialog === 'template' && run && <SaveTemplateDialog p={p} run={run} onClose={() => setDialog(null)} />}
      <DecisionDialog open={dialog === 'submit'} onClose={() => setDialog(null)} busy={busy} title="Submit for planning review"
        description={`Run #${run?.runNumber} (${run?.scenarioName}) will be reviewed by someone else. Submitting does not reserve stock, create orders or start the project.`}
        confirm="Submit" onConfirm={(note) => act(() => planningApi.submit(id, run.id, note), 'Submitted for review')} />
      <DecisionDialog open={dialog === 'approve'} onClose={() => setDialog(null)} busy={busy} title="Approve plan"
        description="Approves this plan for planning purposes only. It does not release work, reserve stock or create purchase orders — those follow the normal operational approvals."
        confirm="Approve plan" onConfirm={(note) => act(() => planningApi.approve(id, note), 'Plan approved')} />
      <DecisionDialog open={dialog === 'reject'} onClose={() => setDialog(null)} busy={busy} title="Reject plan" description="Give the reason so the planner can revise it."
        confirm="Reject" requireNote onConfirm={(note) => act(() => planningApi.reject(id, note), 'Plan rejected')} />
    </div>
  );
}

const PRIORITY_CLS: Record<string, string> = {
  LOW: 'bg-slate-50 text-slate-600 border-slate-200', NORMAL: 'bg-slate-50 text-slate-700 border-slate-200',
  HIGH: 'bg-amber-50 text-amber-800 border-amber-200', URGENT: 'bg-red-50 text-red-700 border-red-200',
};

/** Read-only project summary shown beside the dashboard. Editing happens under Edit inputs → Project. */
function ProjectCard({ p, quantity, userName, onEdit }: { p: any; quantity?: number | null; userName: (id?: string | null) => string; onEdit?: () => void }) {
  const rows: [string, React.ReactNode][] = [
    ['Project ID', <span key="c" className="font-mono">{p.code}</span>],
    ['Purpose', p.purpose === 'SALES' ? 'Sales simulation' : 'Operational plan'],
    ...(p.companyTemplate ? [['Started from', <Link key="t" href="/planning/templates" className="text-green-700 hover:underline">{p.companyTemplate.code} — {p.companyTemplate.name}{p.companyTemplate.status !== 'CONFIRMED' ? ` (${p.companyTemplate.status.toLowerCase()})` : ''}</Link>] as [string, React.ReactNode]] : []),
    ['Project type', PROJECT_TYPES[p.projectType] ?? p.projectType],
    ['Customer / business unit', p.customer || '—'],
    ['Requesting department', p.department || '—'],
    ['Product', p.product ? `${p.product.code} — ${p.product.name}` : '—'],
    ['Planned quantity', quantity ? `${fmt(quantity, 0)} units` : '—'],
    ['Planned start', p.plannedStart.slice(0, 10)],
    ['Target completion', p.targetEnd.slice(0, 10)],
    ['Warehouse', p.warehouse ? `${p.warehouse.code}${p.warehouse.name ? ` — ${p.warehouse.name}` : ''}` : '—'],
    ['Work location', p.workLocation || '—'],
    ['Priority', <Pill key="p" className={PRIORITY_CLS[p.priority] ?? PRIORITY_CLS.NORMAL}>{p.priority.charAt(0) + p.priority.slice(1).toLowerCase()}</Pill>],
    ['Owner', userName(p.ownerId)],
    ['Cost currency', p.currency],
  ];
  return (
    <Section title="Project information" action={onEdit && (
      <button onClick={onEdit} className="h-7 w-7 grid place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-green-700" aria-label="Edit project information"><Pencil className="h-3.5 w-3.5" /></button>
    )}>
      <dl className="space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[120px_minmax(0,1fr)] gap-2 text-xs">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-slate-800 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {p.scope && <p className="text-xs text-slate-600 mt-3 pt-3 border-t border-slate-100">{p.scope}</p>}
    </Section>
  );
}

function ProjectInfo({ p, warehouses, readOnly, onSaved }: { p: any; warehouses: any[]; readOnly: boolean; onSaved: () => void }) {
  const [f, setF] = useState<any>(() => ({
    name: p.name, projectType: p.projectType, description: p.description ?? '', customer: p.customer ?? '', department: p.department ?? '', scope: p.scope ?? '',
    warehouseId: p.warehouseId ?? '', workLocation: p.workLocation ?? '', priority: p.priority, teams: p.teams ?? '', plannedStart: p.plannedStart.slice(0, 10), targetEnd: p.targetEnd.slice(0, 10), currency: p.currency,
  }));
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  async function save() {
    setSaving(true);
    try { await planningApi.update(p.id, { ...f, version: p.version }); toast.success('Project saved'); onSaved(); } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Section title="Project information" action={!readOnly && <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" disabled={saving} onClick={save}>Save project</Button>}>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label="Name" className="sm:col-span-2"><TextInput value={f.name} disabled={readOnly} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Type"><SelectInput value={f.projectType} disabled={readOnly} onChange={(e) => set('projectType', e.target.value)}>{Object.entries(PROJECT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</SelectInput></Field>
        <Field label="Priority"><SelectInput value={f.priority} disabled={readOnly} onChange={(e) => set('priority', e.target.value)}>{['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((x) => <option key={x} value={x}>{x.charAt(0) + x.slice(1).toLowerCase()}</option>)}</SelectInput></Field>
        <Field label="Warehouse"><SelectInput value={f.warehouseId} disabled={readOnly} onChange={(e) => set('warehouseId', e.target.value)}>
          {p.purpose === 'SALES' && <option value="">No warehouse</option>}
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
        </SelectInput></Field>
        <Field label="Work location"><TextInput value={f.workLocation} disabled={readOnly} onChange={(e) => set('workLocation', e.target.value)} /></Field>
        <Field label="Planned start"><TextInput type="date" value={f.plannedStart} disabled={readOnly} onChange={(e) => set('plannedStart', e.target.value)} /></Field>
        <Field label="Target completion"><TextInput type="date" value={f.targetEnd} disabled={readOnly} onChange={(e) => set('targetEnd', e.target.value)} /></Field>
        <Field label="Customer / business unit"><TextInput value={f.customer} disabled={readOnly} onChange={(e) => set('customer', e.target.value)} /></Field>
        <Field label="Requesting department"><TextInput value={f.department} disabled={readOnly} onChange={(e) => set('department', e.target.value)} /></Field>
        <Field label="Responsible teams"><TextInput value={f.teams} disabled={readOnly} onChange={(e) => set('teams', e.target.value)} /></Field>
        <Field label="Cost currency"><TextInput value={f.currency} maxLength={3} disabled={readOnly} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></Field>
        <Field label="Scope" className="sm:col-span-2"><TextInput value={f.scope} disabled={readOnly} onChange={(e) => set('scope', e.target.value)} /></Field>
        <Field label="Description" className="sm:col-span-2"><TextInput value={f.description} disabled={readOnly} onChange={(e) => set('description', e.target.value)} /></Field>
      </div>
    </Section>
  );
}

function Compare({ p }: { p: any }) {
  const latestPerScenario = useMemo(() => p.scenarios.map((s: any) => p.runs.find((r: any) => r.scenarioId === s.id)).filter(Boolean).map((r: any) => r.id), [p]);
  const [sel, setSel] = useState<string[]>(latestPerScenario.slice(0, 6));
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    if (!sel.length) { setRows([]); return; }
    planningApi.compare(p.id, sel).then(setRows).catch((e) => toast.error(e.message));
  }, [p.id, sel]);
  const metrics: [string, (r: any) => React.ReactNode][] = [
    ['Status', (r) => <RunStatusPill status={r.overallStatus} />],
    ['Quantity', (r) => fmt(r.quantity, 0)],
    ['Shifts per day', (r) => r.shifts ?? '—'],
    ['Required / available people', (r) => `${fmt(r.requiredHeadcount, 0)} / ${r.availableHeadcount ?? '—'}`],
    ['Estimated completion', (r) => <span className={r.scheduleVarianceWorkingDays > 0 ? 'text-red-700' : 'text-green-700'}>{r.estimatedFinish ?? '—'}</span>],
    ['vs target (working days)', (r) => (r.scheduleVarianceWorkingDays === null ? '—' : r.scheduleVarianceWorkingDays > 0 ? `${r.scheduleVarianceWorkingDays} late` : `${-r.scheduleVarianceWorkingDays} spare`)],
    ['Bottleneck', (r) => r.bottleneckStage ?? '—'],
    ['Labour hours', (r) => fmt(r.totalLaborHours)],
    ['Materials short', (r) => r.materialShortageLines],
    ['Peak space utilization', (r) => (r.maxSpaceUtilizationPct === null ? '—' : `${r.maxSpaceUtilizationPct}%`)],
    ['Estimated cost', (r) => (r.estimatedCost === null ? 'Hidden' : `${money(r.estimatedCost, r.currency)}${r.costComplete ? '' : ' (incomplete)'}`)],
    ['Flags', (r) => <FlagPills flags={r.flags} />],
    ['Major risks', (r) => r.highRisks.length ? <ul className="list-disc pl-4 text-xs space-y-0.5">{r.highRisks.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul> : 'None'],
  ];
  return (
    <div className="space-y-4">
      <Section title="Choose runs to compare" hint="Up to 6. By default the latest run of each scenario is selected. Recommendations are never applied automatically.">
        <div className="flex flex-wrap gap-2">
          {p.runs.slice(0, 30).map((r: any) => {
            const on = sel.includes(r.id);
            const sname = p.scenarios.find((s: any) => s.id === r.scenarioId)?.name;
            return (
              <button key={r.id} onClick={() => setSel(on ? sel.filter((x) => x !== r.id) : sel.length < 6 ? [...sel, r.id] : sel)}
                className={cn('h-8 px-3 rounded-md border text-xs', on ? 'bg-green-50 border-green-300 text-green-800' : 'border-slate-200 text-slate-500')}>
                {sname} #{r.runNumber}
              </button>
            );
          })}
          {!p.runs.length && <p className="text-sm text-slate-400">No calculations yet.</p>}
        </div>
      </Section>
      {!!rows.length && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="px-4 py-3 text-left text-xs uppercase text-slate-500 font-medium w-56">Measure</th>
              {rows.map((r) => <th key={r.runId} className="px-4 py-3 text-left text-sm font-semibold text-slate-800">{r.scenarioName} <span className="text-xs font-normal text-slate-400">#{r.runNumber}</span></th>)}</tr></thead>
            <tbody className="divide-y divide-slate-50">
              {metrics.map(([label, fn]) => (
                <tr key={label}><td className="px-4 py-3 text-xs text-slate-500">{label}</td>{rows.map((r) => <td key={r.runId} className="px-4 py-3 align-top">{fn(r)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function History({ p, userName, onOpen }: { p: any; userName: (id?: string | null) => string; onOpen: (runId: string) => void }) {
  const [verify, setVerify] = useState<Record<string, any>>({});
  return (
    <Section title="Calculation history" hint="Every calculation is stored with its exact inputs and the WMS data it read. Verify recalculates a run from that snapshot.">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-slate-50"><tr className="text-left text-xs uppercase text-slate-500">
            {['Run', 'Scenario', 'When', 'By', 'Result', 'Flags', ''].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {p.runs.map((r: any) => (
              <tr key={r.id}>
                <td className="px-3 py-2.5">#{r.runNumber}{p.approvedRunId === r.id && <Pill className="ml-1.5 bg-green-50 border-green-200 text-green-700">{p.planStatus === 'PLAN_APPROVED' ? 'approved' : 'submitted'}</Pill>}</td>
                <td className="px-3 py-2.5">{p.scenarios.find((s: any) => s.id === r.scenarioId)?.name}</td>
                <td className="px-3 py-2.5 text-xs">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2.5 text-xs">{userName(r.createdById)}</td>
                <td className="px-3 py-2.5"><RunStatusPill status={r.overallStatus} /></td>
                <td className="px-3 py-2.5"><FlagPills flags={r.flags} /></td>
                <td className="px-3 py-2.5 whitespace-nowrap text-right">
                  {verify[r.id] && <span className={cn('text-xs mr-2', verify[r.id].resultMatches && verify[r.id].inputsIntact ? 'text-green-700' : 'text-amber-700')}>
                    {verify[r.id].resultMatches && verify[r.id].inputsIntact ? 'Reproduced exactly' : verify[r.id].sameEngine ? 'Differs' : 'Older engine version'}
                  </span>}
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => planningApi.verify(p.id, r.id).then((v) => setVerify((x) => ({ ...x, [r.id]: v }))).catch((e) => toast.error(e.message))}>Verify</Button>
                  <Button size="sm" variant="outline" className="h-7" onClick={() => onOpen(r.id)}>Open</Button>
                </td>
              </tr>
            ))}
            {!p.runs.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No calculations yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function NewScenarioDialog({ open, onClose, onCreate, busy }: { open: boolean; onClose: () => void; onCreate: (name: string) => void; busy: boolean }) {
  const [name, setName] = useState('');
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>New scenario</DialogTitle><DialogDescription>Copies the current scenario&apos;s saved inputs. Change one thing (shifts, headcount, warehouse…) to compare.</DialogDescription></DialogHeader>
        <Field label="Scenario name"><TextInput value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Two shifts" /></Field>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button className="bg-green-600 hover:bg-green-700 text-white" disabled={!name.trim() || busy} onClick={() => { onCreate(name.trim()); setName(''); }}>Create</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Saves the calculated run's standards (never its costs) as a draft company template. */
function SaveTemplateDialog({ p, run, onClose }: { p: any; run: any; onClose: () => void }) {
  const [form, setForm] = useState({ name: p.name, description: '', basis: '', replacesId: '' });
  const [confirmed, setConfirmed] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<any>(null);
  useEffect(() => { planningApi.companyTemplates('CONFIRMED').then((r) => setConfirmed(r.rows)).catch(() => setConfirmed([])); }, []);
  async function save() {
    setBusy(true);
    try {
      const dto: any = { runId: run.id, name: form.name.trim(), projectType: p.projectType };
      for (const k of ['description', 'basis', 'replacesId'] as const) if (form[k].trim()) dto[k] = form[k].trim();
      setSaved(await planningApi.createTemplate(dto));
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Save as company template</DialogTitle>
          <DialogDescription>
            Saves the stage times, workstations, yields, calendar, labour factors, packaging and per-unit materials of run #{run.runNumber}.
            Costs, rates, prices, headcount and holidays are not saved. The template is a draft until a second person with approval rights confirms it.
          </DialogDescription>
        </DialogHeader>
        {saved ? (
          <div className="space-y-3 text-sm">
            <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-green-800"><b>{saved.code}</b> saved as a draft. Ask an approver to confirm it on the Company templates page.</p>
            <DialogFooter>
              <Link href="/planning/templates" className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50">Open Company templates</Link>
              <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <Field label="Template name"><TextInput value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Description (optional)"><TextInput value={form.description} maxLength={2000} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Laptop main board repair, standard line" /></Field>
              <Field label="Basis of the standard values" hint="Required before it can be confirmed: time study, completed project, supplier agreement…">
                <TextInput value={form.basis} maxLength={1000} onChange={(e) => setForm({ ...form, basis: e.target.value })} placeholder="e.g. Time study line A, Sep 2026" />
              </Field>
              {!!confirmed.length && (
                <Field label="Replaces (optional)" hint="The selected template is retired when this one is confirmed">
                  <SelectInput value={form.replacesId} onChange={(e) => setForm({ ...form, replacesId: e.target.value })}>
                    <option value="">Nothing — a new template</option>
                    {confirmed.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
                  </SelectInput>
                </Field>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button className="bg-green-600 hover:bg-green-700 text-white" disabled={!form.name.trim() || busy} onClick={save}>{busy ? 'Saving…' : 'Save draft template'}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DecisionDialog({ open, onClose, title, description, confirm, onConfirm, requireNote, busy }: {
  open: boolean; onClose: () => void; title: string; description: string; confirm: string; onConfirm: (note: string) => void; requireNote?: boolean; busy: boolean;
}) {
  const [note, setNote] = useState('');
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <Field label={requireNote ? 'Reason' : 'Note (optional)'}>
          <textarea aria-label="Note" className="w-full min-h-[72px] rounded-md border border-slate-200 px-2.5 py-1.5 text-sm" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button className="bg-green-600 hover:bg-green-700 text-white" disabled={busy || (requireNote && !note.trim())} onClick={() => { onConfirm(note.trim()); setNote(''); }}>{confirm}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PlanningProjectPage() {
  return (
    <Suspense fallback={<div className="p-6"><Skeleton className="h-64" /></div>}>
      <Workspace />
    </Suspense>
  );
}
