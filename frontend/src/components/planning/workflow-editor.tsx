'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronRight, Circle, Flag, Maximize2, Minus, Network, Play, Plus, PlayCircle,
  ShieldCheck, SlidersHorizontal, Table2, Trash2, Undo2, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Check, Field, NumInput, Pill, RunStatusPill, Section, SelectInput, TextInput, fmt } from './shared';
import { STAGE_ICON } from './results-view';

type Inputs = Record<string, any>;
type SetInputs = (fn: (i: Inputs) => Inputs) => void;

// ── Stage data helpers (one source of truth: the scenario draft `inputs.stages`) ──

/** Values a new or reset stage starts with — the same defaults the editor always used. */
const STAGE_DEFAULTS = {
  timeBasis: 'MINUTES_PER_UNIT', stdMinutesPerUnit: null, unitsPerPersonShift: null, productivitySource: 'ESTIMATE',
  setupMinutes: 0, changeovers: 0, workstations: null, operatorsPerStation: 1, yieldPct: 100, reworkPct: 0, bufferPct: 0, benchAreaM2: null,
};
const blankStage = (n: number) => ({
  key: `S${n}`, name: `Stage ${n}`, dependsOn: [] as string[], ...STAGE_DEFAULTS, skill: 'General', isQualityGate: false, completionCriteria: '',
});

const empty = (v: unknown) => v === null || v === undefined || v === '';

/** The two inputs every stage needs before it can be calculated (mirrors the engine's validation). */
function missingRequired(s: any): string[] {
  const out: string[] = [];
  if (s.timeBasis === 'UNITS_PER_PERSON_SHIFT') { if (empty(s.unitsPerPersonShift)) out.push('units per person per shift'); }
  else if (empty(s.stdMinutesPerUnit)) out.push('minutes per unit');
  if (empty(s.workstations)) out.push('workstations');
  return out;
}

/**
 * Column of each stage = longest chain of "after" stages before it — the same rule the
 * engine uses for the results diagram. Unknown keys and loops are reported, not guessed.
 */
function layoutLevels(stages: any[]) {
  const byKey = new Map(stages.map((s) => [s.key, s]));
  const level = new Map<string, number>();
  const visiting = new Set<string>();
  let loop = false;
  const unknown: { stage: string; dep: string }[] = [];
  const visit = (k: string): number => {
    if (level.has(k)) return level.get(k)!;
    if (visiting.has(k)) { loop = true; return 0; }
    visiting.add(k);
    const s = byKey.get(k);
    const deps = (s?.dependsOn ?? []).filter((d: string) => byKey.has(d) && d !== k);
    const l = deps.length ? Math.max(...deps.map(visit)) + 1 : 0;
    visiting.delete(k);
    level.set(k, l);
    return l;
  };
  stages.forEach((s) => {
    visit(s.key);
    (s.dependsOn ?? []).forEach((d: string) => { if (!byKey.has(d) || d === s.key) unknown.push({ stage: s.name || s.key, dep: d }); });
  });
  return { level, loop, unknown };
}

function useStageOps(set: SetInputs) {
  const update = useCallback((idx: number, patch: Record<string, unknown>) =>
    set((i) => ({ ...i, stages: i.stages.map((s: any, j: number) => (j === idx ? { ...s, ...patch } : s)) })), [set]);
  const renameKey = useCallback((idx: number, raw: string) => set((i) => {
    const old = i.stages[idx].key;
    const nk = raw.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16);
    return { ...i, stages: i.stages.map((x: any, j: number) => (j === idx ? { ...x, key: nk } : { ...x, dependsOn: x.dependsOn.map((d: string) => (d === old ? nk : d)) })) };
  }), [set]);
  const move = useCallback((idx: number, dir: -1 | 1) => set((i) => {
    const arr = [...i.stages];
    const t = idx + dir;
    if (t < 0 || t >= arr.length) return i;
    [arr[idx], arr[t]] = [arr[t], arr[idx]];
    return { ...i, stages: arr };
  }), [set]);
  const remove = useCallback((idx: number) => set((i) => {
    const key = i.stages[idx].key;
    return { ...i, stages: i.stages.filter((_: any, j: number) => j !== idx).map((s: any) => ({ ...s, dependsOn: s.dependsOn.filter((d: string) => d !== key) })) };
  }), [set]);
  /** Adds a stage after `afterKey` (or after the last stage) and returns nothing; the new stage is last in the list. */
  const add = useCallback((afterKey?: string) => set((i) => {
    const list = i.stages ?? [];
    let n = list.length + 1;
    while (list.some((s: any) => s.key === `S${n}`)) n++;
    const prev = afterKey ?? list[list.length - 1]?.key;
    return { ...i, stages: [...list, { ...blankStage(n), dependsOn: prev ? [prev] : [] }] };
  }), [set]);
  return { update, renameKey, move, remove, add };
}

// ── Workspace ────────────────────────────────────────────────────────────────

export function WorkflowEditor({ inputs, set, readOnly, templates, run, dirty, busy, canRun, onRun, plannedStart, targetEnd }: {
  inputs: Inputs; set: SetInputs; readOnly: boolean; templates: any[];
  /** Latest stored run of this scenario (or null). */
  run: any; dirty: boolean; busy: boolean; canRun: boolean; onRun: () => void; plannedStart: string; targetEnd: string;
}) {
  const stages: any[] = useMemo(() => inputs.stages ?? [], [inputs.stages]);
  const ops = useStageOps(set);
  const [view, setView] = useState<'flow' | 'table'>('flow');
  const [selected, setSelected] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Results describe the inputs only when the run is newer than the saved scenario and nothing is unsaved.
  const fresh = !!run && !run.stale && !dirty;
  const result = run?.result;
  const stageResults = useMemo(() => new Map<string, any>(fresh ? (result?.stages ?? []).map((s: any) => [s.key, s]) : []), [fresh, result]);

  useEffect(() => { if (selected !== null && selected >= stages.length) setSelected(null); }, [selected, stages.length]);

  const select = (idx: number | null) => {
    setSelected(idx);
    // Below the large breakpoint the panel sits under the diagram — bring it into view.
    if (idx !== null && typeof window !== 'undefined' && window.innerWidth < 1024) setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const applyTemplate = (key: string) => {
    const t = templates.find((x) => x.key === key);
    if (!t) return;
    if (stages.length && !confirm('Replace the current stages with this template? Entered times will be lost.')) return;
    set((i) => ({ ...i, stages: t.stages.map((s: any, n: number) => ({ ...blankStage(n + 1), ...s })) }));
    setSelected(null);
  };
  const addStage = (afterKey?: string) => { ops.add(afterKey); select(stages.length); };
  const moveStage = (idx: number, dir: -1 | 1) => { ops.move(idx, dir); if (selected === idx) setSelected(idx + dir); else if (selected === idx + dir) setSelected(idx); };
  const removeStage = (idx: number) => {
    if (!confirm(`Remove stage "${stages[idx].name || stages[idx].key}"?`)) return;
    ops.remove(idx);
    setSelected(null);
  };

  const { level, loop, unknown } = useMemo(() => layoutLevels(stages), [stages]);
  const incomplete = stages.map((s, idx) => ({ idx, s, miss: missingRequired(s) })).filter((x) => x.miss.length);

  return (
    <div className="space-y-4">
      <WorkflowSummary inputs={inputs} stages={stages} run={run} fresh={fresh} dirty={dirty} targetEnd={targetEnd} />

      {(incomplete.length > 0 || empty(inputs.quantity) || loop || unknown.length > 0 || (fresh && result?.errors?.length > 0)) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 space-y-1">
          <p className="font-medium flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />Needed before the calculation can run</p>
          <ul className="text-xs space-y-0.5 list-disc pl-5">
            {empty(inputs.quantity) && <li>Planned quantity (Calendar &amp; manpower tab)</li>}
            {incomplete.length > 0 && (
              <li>
                {incomplete.length} stage{incomplete.length > 1 ? 's' : ''} missing required inputs:{' '}
                {incomplete.map(({ idx, s, miss }, n) => (
                  <span key={idx}>
                    {n > 0 && ', '}
                    <button type="button" className="underline underline-offset-2 hover:text-amber-700" onClick={() => select(idx)}>{s.name || s.key}</button>
                    {' '}({miss.map((m) => (m === 'workstations' ? 'stations' : m === 'minutes per unit' ? 'min/unit' : 'units/shift')).join(' + ')})
                  </span>
                ))}
              </li>
            )}
            {loop && <li>The stages form a loop — a stage cannot (indirectly) come after itself.</li>}
            {unknown.map((u, n) => <li key={`u${n}`}>{u.stage} comes after an unknown stage &quot;{u.dep}&quot;.</li>)}
            {fresh && result?.errors?.map((e: any, n: number) => <li key={`e${n}`}>{e.message} <span className="text-amber-700">(run #{run.runNumber})</span></li>)}
          </ul>
        </div>
      )}

      <Section
        title="Project workflow"
        hint="Every unit passes every stage. Stages after the same stage run in parallel. Click a stage to edit it."
        action={
          <div className="flex rounded-lg bg-slate-100 p-0.5 shrink-0" role="tablist" aria-label="Workflow view">
            {([['flow', 'Flow', Network], ['table', 'Table', Table2]] as const).map(([k, label, Icon]) => (
              <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
                className={cn('h-7 px-2.5 rounded-md text-xs inline-flex items-center gap-1.5', view === k ? 'bg-white text-green-700 font-medium shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
                <Icon className="h-3.5 w-3.5" />{label}
              </button>
            ))}
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {!readOnly && (
            <>
              <Button size="sm" variant="outline" onClick={() => addStage()}><Plus className="h-3.5 w-3.5" />Stage</Button>
              <SelectInput aria-label="Apply template" className="w-44 h-7 text-xs" value="" onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">Apply template…</option>
                {templates.filter((t) => t.stages.length).map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
              </SelectInput>
            </>
          )}
          <div className="flex-1" />
          {canRun && (
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" disabled={busy || (dirty && readOnly)} onClick={onRun}>
              <Play className="h-3.5 w-3.5" />{busy ? 'Working…' : dirty ? 'Save and run calculation' : 'Run calculation'}
            </Button>
          )}
        </div>

        {!stages.length ? (
          <div className="rounded-lg border border-dashed border-slate-300 py-10 text-center">
            <Network className="h-8 w-8 text-slate-300 mx-auto" />
            <p className="text-sm font-medium text-slate-700 mt-2">No workflow stages yet</p>
            <p className="text-xs text-slate-500 mt-1">Start from a template above, or add the first stage.</p>
            {!readOnly && <Button size="sm" variant="outline" className="mt-3" onClick={() => addStage()}><Plus className="h-3.5 w-3.5" />Add first stage</Button>}
          </div>
        ) : (
          // Flow: panel beside the diagram. Table: the table keeps the full width and the panel sits below it.
          <div className={cn('grid gap-4 items-start', selected !== null && view === 'flow' && 'lg:grid-cols-[minmax(0,1fr)_340px]')}>
            <div className="min-w-0">
              {view === 'flow'
                ? <FlowDiagram stages={stages} level={level} selected={selected} onSelect={select} results={stageResults} quantity={inputs.quantity} plannedStart={plannedStart} targetEnd={targetEnd} />
                : <StageTable stages={stages} selected={selected} onSelect={select} readOnly={readOnly} ops={ops} onMove={moveStage} onRemove={removeStage} results={stageResults} />}
              <Legend fresh={fresh} hasRun={!!run} />
            </div>
            {selected !== null && stages[selected] && (
              <div ref={panelRef} className={cn('scroll-mt-4', view === 'flow' ? 'lg:sticky lg:top-4' : 'max-w-xl')}>
                <StagePanel key={selected} idx={selected} stages={stages} readOnly={readOnly} ops={ops} result={stageResults.get(stages[selected].key)}
                  onClose={() => setSelected(null)} onMove={moveStage} onRemove={removeStage} onAddAfter={(k) => addStage(k)} />
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Summary ──────────────────────────────────────────────────────────────────

function WorkflowSummary({ inputs, stages, run, fresh, dirty, targetEnd }: { inputs: Inputs; stages: any[]; run: any; fresh: boolean; dirty: boolean; targetEnd: string }) {
  const s = run?.result?.summary;
  const ok = !!s && run.result.overallStatus !== 'INSUFFICIENT_DATA';
  const lab = inputs.labor ?? {};
  // Hands-on minutes per unit = plain sum of the entered stage minutes; only shown when every stage has one.
  const allMinutes = stages.length > 0 && stages.every((x) => x.timeBasis !== 'UNITS_PER_PERSON_SHIFT' && !empty(x.stdMinutesPerUnit));
  const workContent = allMinutes ? stages.reduce((t, x) => t + Number(x.stdMinutesPerUnit), 0) : null;
  const late = ok && (s.scheduleVarianceWorkingDays ?? 0) > 0;
  const old = !fresh;
  const val = (v: React.ReactNode) => (ok ? v : '—');
  const space = s?.spaceStatus;
  const tiles: { label: string; value: React.ReactNode; sub?: string; tone?: string; fromRun?: boolean }[] = [
    { label: 'Planned quantity', value: empty(inputs.quantity) ? 'Not entered' : `${fmt(inputs.quantity, 0)} units`, tone: empty(inputs.quantity) ? 'text-amber-700' : undefined },
    { label: 'Work content per unit', value: workContent !== null ? `${fmt(workContent, 1)} min` : '—', sub: workContent !== null ? 'Sum of stage minutes' : 'Needs minutes for every stage' },
    { label: 'People required / available', value: `${ok ? fmt(s.requiredHeadcount, 0) : '—'} / ${empty(lab.availableHeadcount) ? '—' : lab.availableHeadcount}`, fromRun: true },
    { label: 'Daily capacity', value: val(`${fmt(s?.lineThroughputPerDay)} units/day`), sub: ok ? 'Pace of the slowest stage' : undefined, fromRun: true },
    { label: 'Bottleneck', value: val(s?.bottleneckStage ?? '—'), fromRun: true },
    { label: 'Estimated finish', value: val(s?.estimatedFinish ?? '—'), sub: `Target ${targetEnd}`, tone: ok && !old ? (late ? 'text-red-700' : 'text-green-700') : undefined, fromRun: true },
    { label: 'Warehouse space', value: ok ? (space === 'OK' ? 'Sufficient' : space === 'NOT_CHECKED' ? 'Not checked' : space.charAt(0) + space.slice(1).toLowerCase()) : '—', fromRun: true },
  ];
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        {run ? (
          <>
            <RunStatusPill status={run.result.overallStatus} />
            <span>Run #{run.runNumber} · {String(run.createdAt ?? '').slice(0, 10) || run.result.asOf}</span>
            {old && <Pill className="bg-amber-50 text-amber-700 border-amber-200 whitespace-normal">{dirty ? 'Unsaved changes — results below are from the previous run' : 'Inputs changed since this run — calculate again'}</Pill>}
          </>
        ) : <Pill className="bg-slate-50 text-slate-600 border-slate-200 whitespace-normal">Not calculated yet — results appear after Run calculation</Pill>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="min-w-0">
            <p className="text-[11px] text-slate-500">{t.label}</p>
            <p className={cn('text-sm font-semibold truncate', t.fromRun && old && ok ? 'text-slate-400' : t.tone ?? 'text-slate-900')} title={t.fromRun && old && ok ? `From run #${run.runNumber}, before the latest changes` : undefined}>{t.value}</p>
            {t.sub && <p className="text-[11px] text-slate-400 truncate">{t.sub}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Legend({ fresh, hasRun }: { fresh: boolean; hasRun: boolean }) {
  return (
    <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
      Green outline = selected · dashed amber = required input missing · amber = bottleneck · Estimate / Validated = source of the time standard.
      {hasRun && !fresh && ' Capacity and bottleneck are hidden until the calculation is run with the current inputs.'}
    </p>
  );
}

// ── Flow diagram (plain HTML + SVG, no diagram library) ──────────────────────

const NODE_W = 176;
const NODE_H = 118;
const TERM_W = 128;
const TERM_H = 58;
const GAP_X = 40; // between columns (horizontal layout)
const GAP_Y = 18; // between stacked nodes
const GAP_V = 44; // between rows (vertical layout)

type Box = { id: string; x: number; y: number; w: number; h: number };

function FlowDiagram({ stages, level, selected, onSelect, results, quantity, plannedStart, targetEnd }: {
  stages: any[]; level: Map<string, number>; selected: number | null; onSelect: (i: number) => void; results: Map<string, any>;
  quantity: number | null | undefined; plannedStart: string; targetEnd: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null); // null = opening view, -1 = fit to screen

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const vertical = width > 0 && width < 640;

  const layout = useMemo(() => {
    // Columns: 0 = start, 1..n = stage levels, last = finish.
    const maxLevel = Math.max(0, ...stages.map((s) => level.get(s.key) ?? 0));
    const cols: number[][] = Array.from({ length: maxLevel + 1 }, () => []);
    stages.forEach((s, i) => cols[level.get(s.key) ?? 0].push(i));
    const rows = Math.max(1, ...cols.map((c) => c.length));
    const boxes = new Map<string, Box>();
    const slot = (col: number, row: number, count: number, w: number, h: number): Box => {
      if (!vertical) {
        const span = rows * NODE_H + (rows - 1) * GAP_Y;
        const used = count * NODE_H + (count - 1) * GAP_Y;
        const top = (span - used) / 2 + row * (NODE_H + GAP_Y);
        return { id: '', x: col * (NODE_W + GAP_X) + (NODE_W - w) / 2, y: top + (NODE_H - h) / 2, w, h };
      }
      const span = rows * NODE_W + (rows - 1) * GAP_Y;
      const used = count * NODE_W + (count - 1) * GAP_Y;
      const left = (span - used) / 2 + row * (NODE_W + GAP_Y);
      return { id: '', x: left + (NODE_W - w) / 2, y: col * (NODE_H + GAP_V) + (NODE_H - h) / 2, w, h };
    };
    boxes.set('__start', { ...slot(0, 0, 1, TERM_W, TERM_H), id: '__start' });
    cols.forEach((c, l) => c.forEach((i, r) => boxes.set(String(i), { ...slot(l + 1, r, c.length, NODE_W, NODE_H), id: String(i) })));
    boxes.set('__end', { ...slot(cols.length + 1, 0, 1, TERM_W, TERM_H), id: '__end' });
    const nCols = cols.length + 2;
    const W = vertical ? rows * NODE_W + (rows - 1) * GAP_Y : nCols * NODE_W + (nCols - 1) * GAP_X;
    const H = vertical ? nCols * NODE_H + (nCols - 1) * GAP_V : rows * NODE_H + (rows - 1) * GAP_Y;

    const keyIdx = new Map(stages.map((s, i) => [s.key, i]));
    const hasSuccessor = new Set<string>();
    const edges: { from: string; to: string }[] = [];
    stages.forEach((s, i) => {
      const deps = (s.dependsOn ?? []).filter((d: string) => keyIdx.has(d) && d !== s.key);
      if (!deps.length) edges.push({ from: '__start', to: String(i) });
      deps.forEach((d: string) => { edges.push({ from: String(keyIdx.get(d)), to: String(i) }); hasSuccessor.add(d); });
    });
    stages.forEach((s, i) => { if (!hasSuccessor.has(s.key)) edges.push({ from: String(i), to: '__end' }); });
    return { boxes, edges, W, H };
  }, [stages, level, vertical]);

  const PAD = 16;
  const fit = width > 0 ? Math.max(0.35, Math.min(1, (width - PAD * 2) / layout.W)) : 1;
  // Opening view: fit when that stays readable, otherwise 80% and scroll. "Fit" always fits.
  const scale = zoom === null ? Math.max(fit, 0.8) : zoom === -1 ? fit : zoom;
  const setScale = (z: number) => setZoom(Math.round(Math.max(0.35, Math.min(1.6, z)) * 100) / 100);

  // Drag the background to pan (scrolling also works).
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button') || e.pointerType !== 'mouse') return;
    const el = wrapRef.current!;
    drag.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
    el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const el = wrapRef.current!;
    el.scrollLeft = drag.current.l - (e.clientX - drag.current.x);
    el.scrollTop = drag.current.t - (e.clientY - drag.current.y);
  };
  const endDrag = () => { drag.current = null; };

  const port = (b: Box, out: boolean) => (vertical
    ? { x: b.x + b.w / 2, y: out ? b.y + b.h : b.y }
    : { x: out ? b.x + b.w : b.x, y: b.y + b.h / 2 });

  return (
    <div className="relative">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-0.5 shadow-sm">
        <Button size="icon-xs" variant="ghost" aria-label="Zoom out" onClick={() => setScale(scale - 0.1)}><Minus /></Button>
        <span className="w-10 text-center text-[11px] tabular-nums text-slate-500" aria-live="polite">{Math.round(scale * 100)}%</span>
        <Button size="icon-xs" variant="ghost" aria-label="Zoom in" onClick={() => setScale(scale + 0.1)}><Plus /></Button>
        <Button size="xs" variant="ghost" aria-label="Fit to screen" onClick={() => setZoom(-1)}><Maximize2 />Fit</Button>
      </div>
      <div
        ref={wrapRef}
        className="overflow-auto rounded-lg border border-slate-200 bg-slate-50/70 cursor-grab active:cursor-grabbing select-none"
        style={{ maxHeight: vertical ? '70vh' : 560 }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
        aria-label="Workflow diagram"
      >
        <div style={{ width: layout.W * scale + PAD * 2, height: layout.H * scale + PAD * 2 + 28, margin: '0 auto', position: 'relative' }}>
          <div style={{ position: 'absolute', left: PAD, top: PAD + 28, width: layout.W, height: layout.H, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
            <svg width={layout.W} height={layout.H} className="absolute inset-0 overflow-visible" aria-hidden="true">
              <defs>
                <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="#94a3b8" />
                </marker>
              </defs>
              {layout.edges.map((e, n) => {
                const a = port(layout.boxes.get(e.from)!, true);
                const b = port(layout.boxes.get(e.to)!, false);
                const d = vertical
                  ? `M${a.x},${a.y} C${a.x},${(a.y + b.y) / 2} ${b.x},${(a.y + b.y) / 2} ${b.x},${b.y - 2}`
                  : `M${a.x},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x - 2},${b.y}`;
                const hot = selected !== null && (e.from === String(selected) || e.to === String(selected));
                return <path key={n} d={d} fill="none" stroke={hot ? '#16a34a' : '#cbd5e1'} strokeWidth={hot ? 2 : 1.5} markerEnd="url(#wf-arrow)" />;
              })}
            </svg>
            <Terminal box={layout.boxes.get('__start')!} icon={PlayCircle} title="Start" sub={empty(quantity) ? `Quantity not entered · ${plannedStart}` : `${fmt(quantity, 0)} units · ${plannedStart}`} />
            {stages.map((s, i) => (
              <StageNode key={i} box={layout.boxes.get(String(i))!} stage={s} index={i} selected={selected === i} onSelect={onSelect} result={results.get(s.key)} />
            ))}
            <Terminal box={layout.boxes.get('__end')!} icon={Flag} title="Completed" sub={`Target ${targetEnd}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Terminal({ box, icon: Icon, title, sub }: { box: Box; icon: typeof Flag; title: string; sub: string }) {
  return (
    <div className="absolute rounded-full border border-slate-300 bg-white px-3 flex items-center gap-2" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
      <Icon className="h-4 w-4 text-green-700 shrink-0" />
      <div className="min-w-0 leading-tight">
        <p className="text-xs font-semibold text-slate-800">{title}</p>
        <p className="text-[10px] text-slate-500 truncate">{sub}</p>
      </div>
    </div>
  );
}

function StageNode({ box, stage: s, index, selected, onSelect, result }: { box: Box; stage: any; index: number; selected: boolean; onSelect: (i: number) => void; result?: any }) {
  const Icon = STAGE_ICON[s.key] ?? Circle;
  const miss = missingRequired(s);
  const bottleneck = !!result?.isBottleneck;
  const perShift = s.timeBasis === 'UNITS_PER_PERSON_SHIFT';
  const time = perShift ? s.unitsPerPersonShift : s.stdMinutesPerUnit;
  return (
    <button
      type="button"
      onClick={() => onSelect(index)}
      aria-pressed={selected}
      aria-label={`Stage ${index + 1}: ${s.name || s.key}${miss.length ? `, missing ${miss.join(' and ')}` : ''}${bottleneck ? ', bottleneck' : ''}`}
      className={cn(
        'absolute rounded-xl border bg-white px-3 py-2.5 text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500',
        miss.length ? 'border-dashed border-amber-400' : bottleneck ? 'border-amber-400 bg-amber-50/40' : 'border-slate-200',
        selected && 'ring-2 ring-green-500 border-green-500 shadow-md',
      )}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
    >
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-green-700 shrink-0" />
        <span className="text-[10px] font-mono text-slate-400 truncate">{index + 1} · {s.key || '—'}</span>
        <span className={cn('ml-auto rounded px-1 text-[10px] font-medium', s.productivitySource === 'VALIDATED_STANDARD' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500')}>
          {s.productivitySource === 'VALIDATED_STANDARD' ? 'Validated' : 'Estimate'}
        </span>
      </div>
      <p className="text-sm font-semibold text-slate-900 truncate mt-1">{s.name || 'Unnamed stage'}</p>
      <p className={cn('text-[11px] truncate', empty(time) ? 'text-amber-700' : 'text-slate-600')}>
        {empty(time) ? (perShift ? 'Units / person / shift missing' : 'Minutes per unit missing') : perShift ? `${fmt(time)} units / person / shift` : `${fmt(time)} min / unit`}
      </p>
      <p className={cn('text-[11px] truncate', empty(s.workstations) ? 'text-amber-700' : 'text-slate-600')}>
        {empty(s.workstations) ? 'Workstations missing' : `${s.workstations} station${s.workstations === 1 ? '' : 's'} × ${s.operatorsPerStation ?? 1} op`}
      </p>
      <div className="flex items-center gap-1.5 mt-1 text-[10px]">
        {result && <span className="text-slate-500 truncate">≈ {fmt(result.capacityFinalUnitsPerDay, 1)} units/day</span>}
        {bottleneck && <span className="rounded bg-amber-100 px-1 font-medium text-amber-800">Bottleneck</span>}
        {s.isQualityGate && <ShieldCheck className="h-3.5 w-3.5 text-green-700 ml-auto shrink-0" aria-label="Quality gate" />}
      </div>
    </button>
  );
}

// ── Table view (same stages array) ───────────────────────────────────────────

function StageTable({ stages, selected, onSelect, readOnly, ops, onMove, onRemove, results }: {
  stages: any[]; selected: number | null; onSelect: (i: number) => void; readOnly: boolean; ops: ReturnType<typeof useStageOps>;
  onMove: (i: number, d: -1 | 1) => void; onRemove: (i: number) => void; results: Map<string, any>;
}) {
  const cell = 'h-8 text-xs px-2';
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[1000px] text-xs">
        <thead className="bg-slate-50 text-slate-500">
          <tr className="text-left">
            <th className="px-2 py-2 font-medium w-8">#</th>
            <th className="px-2 py-2 font-medium min-w-[150px]">Stage</th>
            <th className="px-2 py-2 font-medium">After</th>
            <th className="px-2 py-2 font-medium w-28">Time / unit <span className="text-red-500">*</span></th>
            <th className="px-2 py-2 font-medium w-24">Stations <span className="text-red-500">*</span></th>
            <th className="px-2 py-2 font-medium w-24">Ops / station</th>
            <th className="px-2 py-2 font-medium w-28">Source</th>
            <th className="px-2 py-2 font-medium w-20">Yield %</th>
            <th className="px-2 py-2 font-medium w-20">Rework %</th>
            <th className="px-2 py-2 font-medium w-24">Result</th>
            <th className="px-2 py-2 font-medium w-28" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {stages.map((s, i) => {
            const perShift = s.timeBasis === 'UNITS_PER_PERSON_SHIFT';
            const r = results.get(s.key);
            return (
              <tr key={i} className={cn(selected === i ? 'bg-green-50/60' : 'hover:bg-slate-50/60')}>
                <td className="px-2 py-1.5 text-slate-400 font-mono">{i + 1}</td>
                <td className="px-2 py-1.5">
                  <TextInput aria-label={`Stage ${i + 1} name`} className={cell} value={s.name} disabled={readOnly} onChange={(e) => ops.update(i, { name: e.target.value })} />
                  <span className="text-[10px] font-mono text-slate-400">{s.key}</span>
                </td>
                <td className="px-2 py-1.5 text-slate-500 font-mono">{s.dependsOn?.length ? s.dependsOn.join(', ') : 'Start'}</td>
                <td className="px-2 py-1.5">
                  <NumInput placeholder="required" ariaLabel={`${s.name} ${perShift ? 'units per person per shift' : 'minutes per unit'}`} className={cell} value={perShift ? s.unitsPerPersonShift : s.stdMinutesPerUnit} disabled={readOnly}
                    onChange={(v) => ops.update(i, perShift ? { unitsPerPersonShift: v } : { stdMinutesPerUnit: v })} />
                  <span className="text-[10px] text-slate-400">{perShift ? 'units / person / shift' : 'min / unit'}</span>
                </td>
                <td className="px-2 py-1.5"><NumInput placeholder="required" ariaLabel={`${s.name} workstations`} className={cell} step="1" value={s.workstations} disabled={readOnly} onChange={(v) => ops.update(i, { workstations: v })} /></td>
                <td className="px-2 py-1.5"><NumInput ariaLabel={`${s.name} operators per station`} className={cell} step="1" value={s.operatorsPerStation} disabled={readOnly} onChange={(v) => ops.update(i, { operatorsPerStation: v })} /></td>
                <td className="px-2 py-1.5">
                  <SelectInput aria-label={`${s.name} source`} className={cell} value={s.productivitySource} disabled={readOnly} onChange={(e) => ops.update(i, { productivitySource: e.target.value })}>
                    <option value="ESTIMATE">Estimate</option>
                    <option value="VALIDATED_STANDARD">Validated</option>
                  </SelectInput>
                </td>
                <td className="px-2 py-1.5"><NumInput ariaLabel={`${s.name} yield`} className={cell} value={s.yieldPct} disabled={readOnly} onChange={(v) => ops.update(i, { yieldPct: v })} /></td>
                <td className="px-2 py-1.5"><NumInput ariaLabel={`${s.name} rework`} className={cell} value={s.reworkPct} disabled={readOnly} onChange={(v) => ops.update(i, { reworkPct: v ?? 0 })} /></td>
                <td className="px-2 py-1.5 text-[11px] text-slate-500">
                  {r ? <>{fmt(r.capacityFinalUnitsPerDay, 1)}/day{r.isBottleneck && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">Bottleneck</span>}</> : '—'}
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex justify-end gap-0.5">
                    <Button size="icon-xs" variant="ghost" aria-label={`Edit all settings of ${s.name}`} onClick={() => onSelect(i)}><SlidersHorizontal /></Button>
                    {!readOnly && (
                      <>
                        <Button size="icon-xs" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => onMove(i, -1)}><ArrowUp /></Button>
                        <Button size="icon-xs" variant="ghost" aria-label="Move down" disabled={i === stages.length - 1} onClick={() => onMove(i, 1)}><ArrowDown /></Button>
                        <Button size="icon-xs" variant="ghost" aria-label={`Remove ${s.name}`} onClick={() => onRemove(i)}><Trash2 className="text-slate-400" /></Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-slate-400 border-t border-slate-100">* Required. Setup, buffer, bench area, skill, order and completion criteria are under each stage&apos;s settings.</p>
    </div>
  );
}

// ── Stage side panel ─────────────────────────────────────────────────────────

function StagePanel({ idx, stages, readOnly, ops, result, onClose, onMove, onRemove, onAddAfter }: {
  idx: number; stages: any[]; readOnly: boolean; ops: ReturnType<typeof useStageOps>; result?: any;
  onClose: () => void; onMove: (i: number, d: -1 | 1) => void; onRemove: (i: number) => void; onAddAfter: (key: string) => void;
}) {
  const s = stages[idx];
  // Snapshot when the panel opens, so Cancel can undo this panel's edits only.
  const [snapshot] = useState(() => structuredClone(s));
  const [advanced, setAdvanced] = useState(false);
  const changed = JSON.stringify(snapshot) !== JSON.stringify(s);
  const perShift = s.timeBasis === 'UNITS_PER_PERSON_SHIFT';
  const up = (patch: Record<string, unknown>) => ops.update(idx, patch);

  const cancel = () => {
    if (snapshot.key !== s.key) ops.renameKey(idx, snapshot.key);
    ops.update(idx, snapshot);
    onClose();
  };
  const reset = () => {
    if (!confirm('Reset the time, workstations, yield, rework, buffer and setup values of this stage to their defaults? Name, order and completion criteria are kept.')) return;
    up({ ...STAGE_DEFAULTS });
  };

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm" aria-label={`Stage ${idx + 1} settings`}>
      <header className="flex items-start justify-between gap-2 px-4 pt-4">
        <div className="min-w-0">
          <p className="text-[11px] font-mono text-slate-400">Stage {idx + 1} · {s.key || '—'}</p>
          <p className="text-sm font-semibold text-slate-900 truncate">{s.name || 'Unnamed stage'}</p>
          <div className="flex flex-wrap gap-1 mt-1">
            <Pill className={s.productivitySource === 'VALIDATED_STANDARD' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-600 border-slate-200'}>
              {s.productivitySource === 'VALIDATED_STANDARD' ? 'Validated standard' : 'Estimate'}
            </Pill>
            {result?.isBottleneck && <Pill className="bg-amber-50 text-amber-800 border-amber-200">Bottleneck</Pill>}
            {s.isQualityGate && <Pill className="bg-white text-slate-600 border-slate-200">Quality gate</Pill>}
          </div>
        </div>
        <Button size="icon-sm" variant="ghost" aria-label="Close stage settings" onClick={onClose}><X /></Button>
      </header>

      <div className="p-4 space-y-3">
        <Field label="Stage name"><TextInput value={s.name} disabled={readOnly} onChange={(e) => up({ name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          {perShift
            ? <Field label="Units / person / shift *"><NumInput value={s.unitsPerPersonShift} disabled={readOnly} onChange={(v) => up({ unitsPerPersonShift: v })} /></Field>
            : <Field label="Std minutes / unit *"><NumInput value={s.stdMinutesPerUnit} disabled={readOnly} onChange={(v) => up({ stdMinutesPerUnit: v })} /></Field>}
          <Field label="Workstations *"><NumInput value={s.workstations} step="1" disabled={readOnly} onChange={(v) => up({ workstations: v })} /></Field>
        </div>
        <Field label="Operators per station" hint="Default 1 — change only if a station needs more people">
          <NumInput value={s.operatorsPerStation} step="1" disabled={readOnly} onChange={(v) => up({ operatorsPerStation: v })} />
        </Field>

        <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          {result
            ? <>Calculated: ≈ {fmt(result.capacityFinalUnitsPerDay, 1)} finished units/day · {fmt(result.durationWorkingDays, 1)} working day(s) · {result.startDate} → {result.finishDate}</>
            : 'Capacity and dates are calculated when you run the calculation with these values.'}
        </div>

        <button type="button" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}
          className="flex w-full items-center gap-1 border-t border-slate-100 pt-3 text-xs font-medium text-slate-600 hover:text-slate-900">
          {advanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}Advanced settings
          <span className="ml-auto font-normal text-slate-400">defaults already filled</span>
        </button>
        {advanced && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Key" hint="Short ID used in links"><TextInput value={s.key} disabled={readOnly} onChange={(e) => ops.renameKey(idx, e.target.value)} /></Field>
            <Field label="Skill"><TextInput value={s.skill} disabled={readOnly} onChange={(e) => up({ skill: e.target.value })} /></Field>
            <Field label="Comes after" className="col-span-2">
              <div className="flex flex-wrap gap-1 min-h-9 items-center">
                {stages.filter((o) => o.key !== s.key).map((o) => {
                  const on = s.dependsOn.includes(o.key);
                  return (
                    <button key={o.key} type="button" disabled={readOnly} aria-pressed={on}
                      onClick={() => up({ dependsOn: on ? s.dependsOn.filter((d: string) => d !== o.key) : [...s.dependsOn, o.key] })}
                      className={cn('px-2 h-7 rounded-md border text-xs', on ? 'bg-green-50 border-green-300 text-green-800' : 'border-slate-200 text-slate-400')}>{o.key}</button>
                  );
                })}
                {!s.dependsOn.length && <span className="text-[11px] text-slate-400">Starts at project start</span>}
              </div>
            </Field>
            <Field label="Time basis" className="col-span-2">
              <SelectInput value={s.timeBasis} disabled={readOnly} onChange={(e) => up({ timeBasis: e.target.value })}>
                <option value="MINUTES_PER_UNIT">Minutes per unit</option>
                <option value="UNITS_PER_PERSON_SHIFT">Units per person per shift</option>
              </SelectInput>
            </Field>
            <Field label="Data source" className="col-span-2">
              <SelectInput value={s.productivitySource} disabled={readOnly} onChange={(e) => up({ productivitySource: e.target.value })}>
                <option value="ESTIMATE">Estimate</option>
                <option value="VALIDATED_STANDARD">Validated standard (time study)</option>
              </SelectInput>
            </Field>
            <Field label="Yield %"><NumInput value={s.yieldPct} disabled={readOnly} onChange={(v) => up({ yieldPct: v })} /></Field>
            <Field label="Rework %"><NumInput value={s.reworkPct} disabled={readOnly} onChange={(v) => up({ reworkPct: v ?? 0 })} /></Field>
            <Field label="Capacity buffer %"><NumInput value={s.bufferPct} disabled={readOnly} onChange={(v) => up({ bufferPct: v ?? 0 })} /></Field>
            <Field label="Bench m² / station"><NumInput value={s.benchAreaM2} disabled={readOnly} onChange={(v) => up({ benchAreaM2: v })} /></Field>
            <Field label="Setup min"><NumInput value={s.setupMinutes} disabled={readOnly} onChange={(v) => up({ setupMinutes: v ?? 0 })} /></Field>
            <Field label="Changeovers"><NumInput value={s.changeovers} step="1" disabled={readOnly} onChange={(v) => up({ changeovers: v ?? 0 })} /></Field>
            <Field label="Completion criteria" className="col-span-2"><TextInput value={s.completionCriteria} disabled={readOnly} onChange={(e) => up({ completionCriteria: e.target.value })} /></Field>
            <div className="col-span-2"><Check label="Quality gate (QA / test)" checked={s.isQualityGate} disabled={readOnly} onChange={(v) => up({ isQualityGate: v })} /></div>
          </div>
        )}

        {!readOnly && (
          <>
            <div className="flex flex-wrap items-center gap-1 border-t border-slate-100 pt-3">
              <Button size="xs" variant="ghost" onClick={() => onAddAfter(s.key)}><Plus />Next stage</Button>
              <Button size="icon-xs" variant="ghost" aria-label="Move earlier" disabled={idx === 0} onClick={() => onMove(idx, -1)}><ArrowUp /></Button>
              <Button size="icon-xs" variant="ghost" aria-label="Move later" disabled={idx === stages.length - 1} onClick={() => onMove(idx, 1)}><ArrowDown /></Button>
              <Button size="xs" variant="ghost" className="ml-auto text-slate-500" onClick={() => onRemove(idx)}><Trash2 />Remove</Button>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={reset}><Undo2 />Reset to defaults</Button>
              <div className="flex-1" />
              <Button size="sm" variant="outline" disabled={!changed} onClick={cancel}>Cancel</Button>
              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={onClose}>Done</Button>
            </div>
            <p className="text-[11px] text-slate-400">Changes go into this scenario&apos;s draft. Use Save draft or Run calculation to store them.</p>
          </>
        )}
      </div>
    </section>
  );
}
