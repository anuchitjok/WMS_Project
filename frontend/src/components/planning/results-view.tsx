'use client';

import { Fragment, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleHelp, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Explain, FLAG, FlagPills, Pill, RunStatusPill, Section, Stat, fmt, money } from './shared';

const VIEWS = [
  ['overview', 'Overview'], ['workflow', 'Workflow & timeline'], ['manpower', 'Manpower'], ['materials', 'Materials & stock'],
  ['space', 'Warehouse space'], ['cost', 'Cost'], ['assumptions', 'Assumptions & data'],
] as const;

export function ResultsView({ run }: { run: any }) {
  const [view, setView] = useState<string>('overview');
  const r = run.result;
  const cur = r.summary.currency;

  if (r.overallStatus === 'INSUFFICIENT_DATA' && !r.stages.length) {
    return (
      <Section title="The plan could not be calculated" hint="Complete these inputs and calculate again. Nothing was estimated in their place.">
        <ul className="space-y-1.5">
          {r.errors.map((e: any, i: number) => (
            <li key={i} className="flex gap-2 text-sm text-slate-700"><XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />{e.message}</li>
          ))}
        </ul>
      </Section>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <RunStatusPill status={r.overallStatus} />
            <span className="text-xs text-slate-500">Run #{run.runNumber} · {run.scenarioName} · data as of {r.asOf} · {r.engineVersion}</span>
            {run.stale && <Pill className="bg-amber-50 text-amber-700 border-amber-200">Inputs changed since this run</Pill>}
          </div>
          <FlagPills flags={r.flags} />
          {r.overallStatus === 'READY_FOR_PLANNING_REVIEW' && <p className="text-xs text-slate-500">Ready for planning review — this is not an approval or a release for execution.</p>}
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {VIEWS.map(([k, label]) => (
          <button key={k} onClick={() => setView(k)} className={cn('px-3 py-2 text-sm -mb-px border-b-2 whitespace-nowrap', view === k ? 'border-green-600 text-green-700 font-medium' : 'border-transparent text-slate-500 hover:text-slate-800')}>{label}</button>
        ))}
      </div>

      {view === 'overview' && <Overview r={r} cur={cur} />}
      {view === 'workflow' && <WorkflowView r={r} />}
      {view === 'manpower' && <ManpowerView r={r} cur={cur} />}
      {view === 'materials' && <MaterialsView r={r} cur={cur} />}
      {view === 'space' && <SpaceView r={r} />}
      {view === 'cost' && <CostView r={r} />}
      {view === 'assumptions' && <AssumptionsView run={run} />}
    </div>
  );
}

function Overview({ r, cur }: { r: any; cur: string }) {
  const s = r.summary;
  const late = (s.scheduleVarianceWorkingDays ?? 0) > 0;
  const mp = r.manpower;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Planned units" value={fmt(s.quantity, 0)} sub={`Line pace ${fmt(s.lineThroughputPerDay)} units/day (bottleneck: ${s.bottleneckStage})`} />
        <Stat label="Estimated completion" value={s.estimatedFinish ?? '—'} tone={late ? 'bad' : 'good'}
          sub={`Target ${s.targetEnd} · ${late ? `${s.scheduleVarianceWorkingDays} working day(s) late` : `${Math.abs(s.scheduleVarianceWorkingDays ?? 0)} working day(s) to spare`}`} />
        <Stat label="People required / available" value={`${fmt(s.requiredHeadcount, 0)} / ${s.availableHeadcount ?? '—'}`}
          tone={mp?.additionalWorkersNeeded ? 'bad' : mp?.additionalWorkersNeeded === 0 ? 'good' : 'warn'}
          sub={`${fmt(s.totalLaborHours)} labour hours · ${fmt(mp?.requiredFte?.value)} FTE`} />
        <Stat label="Estimated cost" value={s.estimatedCost === null ? 'Hidden' : money(s.estimatedCost, cur)} tone={s.costComplete ? 'neutral' : 'warn'}
          sub={s.estimatedCost === null ? 'Requires cost permission' : s.costComplete ? `${money(r.cost?.costPerUnit, cur)} per unit` : 'Incomplete — see Cost'} />
        <Stat label="Materials" value={`${s.materialLines - s.materialShortageLines} of ${s.materialLines} ready`} tone={s.materialShortageLines ? 'bad' : 'good'} sub={s.materialShortageLines ? `${s.materialShortageLines} short or late` : 'Covered in time'} />
        <Stat label="Warehouse space" value={s.spaceStatus === 'OK' ? 'Sufficient' : s.spaceStatus.charAt(0) + s.spaceStatus.slice(1).toLowerCase()}
          tone={s.spaceStatus === 'OK' ? 'good' : s.spaceStatus === 'INCOMPLETE' ? 'warn' : 'bad'}
          sub={r.space.map((x: any) => `${x.label.split(' ')[0]} ${x.utilizationPct === null ? '—' : `${x.utilizationPct}%`}`).join(' · ')} />
        <Stat label="Critical path" value={<span className="text-sm">{r.criticalPath.map((k: string) => r.stages.find((x: any) => x.key === k)?.name).join(' → ')}</span>} />
        <Stat label="Planning window" value={`${r.calendar.windowWorkingDays} working days`} sub={`${r.calendar.clockHoursPerDay} working hours/day · batch ${r.calendar.transferBatchSize}`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Risks and recommended actions">
          {!r.risks.length ? <p className="text-sm text-slate-500">No risks found with the current inputs.</p> : (
            <ul className="space-y-3">
              {r.risks.map((x: any, i: number) => (
                <li key={i} className="flex gap-2.5">
                  <span className={cn('mt-1.5 h-2 w-2 rounded-full shrink-0', x.level === 'HIGH' ? 'bg-red-500' : x.level === 'MEDIUM' ? 'bg-amber-500' : 'bg-slate-300')} />
                  <div className="text-sm">
                    <p className="text-slate-800"><span className="text-xs text-slate-500 mr-1.5">{x.area}</span>{x.message}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{x.action}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <div className="space-y-4">
          <Section title="Readiness checklist" hint="Planning readiness only. Execution needs the normal operational approvals.">
            <ul className="space-y-2">
              {r.readiness.map((x: any) => (
                <li key={x.key} className="flex gap-2 text-sm">
                  {x.status === 'MET' ? <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" /> : x.status === 'UNKNOWN' ? <CircleHelp className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" /> : <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />}
                  <div><p className="text-slate-800">{x.label}</p><p className="text-xs text-slate-500">{x.detail}</p></div>
                </li>
              ))}
            </ul>
          </Section>
          {!!r.whatIfs?.length && (
            <Section title="Alternatives to consider" hint="Each re-runs the calculation with one change. Nothing is applied — create a scenario to adopt one.">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-slate-500"><th className="pb-2 font-medium">Change</th><th className="pb-2 font-medium">Finish</th><th className="pb-2 font-medium">People</th></tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {r.whatIfs.map((w: any) => (
                    <tr key={w.key}>
                      <td className="py-2 pr-2"><p className="text-slate-800">{w.label}</p><p className="text-xs text-slate-500">{w.tradeOff}</p></td>
                      <td className="py-2 whitespace-nowrap"><span className={w.meetsTarget ? 'text-green-700' : 'text-slate-700'}>{w.finishDate ?? '—'}</span></td>
                      <td className="py-2">{fmt(w.requiredHeadcount, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function FlowDiagram({ stages, critical }: { stages: any[]; critical: string[] }) {
  const levels = Math.max(...stages.map((s) => s.level)) + 1;
  const cols = Array.from({ length: levels }, (_, l) => stages.filter((s) => s.level === l));
  return (
    <div className="overflow-x-auto">
      <div className="flex items-stretch gap-0 min-w-max py-2">
        {cols.map((col, l) => (
          <div key={l} className="flex items-center">
            {l > 0 && <div className="w-8 h-px bg-slate-300 relative"><span className="absolute -right-1 -top-[4px] text-slate-300 text-[10px]">▶</span></div>}
            <div className="flex flex-col gap-2 justify-center">
              {col.map((s) => (
                <div key={s.key} className={cn('w-48 rounded-lg border bg-white p-2.5', s.isBottleneck ? 'border-amber-400 ring-2 ring-amber-100' : critical.includes(s.key) ? 'border-green-400' : 'border-slate-200')}>
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-sm font-medium text-slate-900 truncate">{s.name}</p>
                    {s.isBottleneck && <span className="text-[11px] text-amber-700">bottleneck</span>}
                  </div>
                  <p className="text-[11px] text-slate-500">after {s.dependsOn.length ? s.dependsOn.join(', ') : 'start'}</p>
                  <div className="grid grid-cols-2 gap-x-2 mt-1.5 text-[11px] text-slate-600">
                    <span>In {s.inputQty}</span><span>Out {s.requiredOutput}</span>
                    <span>{fmt(s.capacityPerDay)}/day</span><span>{fmt(s.durationWorkingDays)} days</span>
                    <span>Crew {s.crewPerShift}</span><span>{s.reworkQty ? `Rework ${s.reworkQty}` : s.scrapQty ? `Scrap ${s.scrapQty}` : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">Green border = critical path. Stages in the same column can run at the same time.</p>
    </div>
  );
}

function Gantt({ r }: { r: any }) {
  const start = new Date(`${r.summary.plannedStart}T00:00:00Z`).getTime();
  const end = Math.max(new Date(`${r.summary.estimatedFinish}T00:00:00Z`).getTime(), new Date(`${r.summary.targetEnd}T00:00:00Z`).getTime()) + 86_400_000;
  const pct = (d: string, endOfDay = false) => ((new Date(`${d}T00:00:00Z`).getTime() + (endOfDay ? 86_400_000 : 0) - start) / (end - start)) * 100;
  const target = pct(r.summary.targetEnd, true);
  return (
    <div className="space-y-1.5">
      {r.stages.map((s: any) => (
        <div key={s.key} className="flex items-center gap-3">
          <div className="w-36 shrink-0 text-xs text-slate-700 truncate">{s.name}</div>
          <div className="relative flex-1 h-6 bg-slate-50 rounded">
            <div className="absolute top-0 bottom-0 border-l border-dashed border-red-300" style={{ left: `${target}%` }} />
            <div className={cn('absolute top-1 bottom-1 rounded', s.isCritical ? 'bg-green-500' : 'bg-slate-300')}
              style={{ left: `${pct(s.startDate)}%`, width: `${Math.max(1, pct(s.finishDate, true) - pct(s.startDate))}%` }}
              title={`${s.startDate} → ${s.finishDate}`} />
          </div>
          <div className="w-44 shrink-0 text-[11px] text-slate-500">{s.startDate} → {s.finishDate}</div>
        </div>
      ))}
      <p className="text-[11px] text-slate-400 pl-40">Dashed line = target date. Green = critical stages.</p>
    </div>
  );
}

const BOUND: Record<string, string> = { START: 'Project start', MATERIAL: 'Waiting for materials', OWN_CAPACITY: 'Own capacity' };
const bound = (b: string) => BOUND[b] ?? (b.startsWith('PREDECESSOR:') ? `After ${b.split(':')[1]}` : b.startsWith('LAST_BATCH_FROM:') ? `Last batch from ${b.split(':')[1]}` : b);

function WorkflowView({ r }: { r: any }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <Section title="Process flow"><FlowDiagram stages={r.stages} critical={r.criticalPath} /></Section>
      <Section title="Timeline"><Gantt r={r} /></Section>
      <Section title="Milestones">
        <div className="flex flex-wrap gap-2">
          {r.milestones.map((m: any, i: number) => <Pill key={i} className="bg-white border-slate-200 text-slate-700">{m.label} · {m.date}</Pill>)}
        </div>
      </Section>
      <Section title="Stage throughput" hint="Click a row to see the formulas.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-slate-50"><tr className="text-left text-xs uppercase text-slate-500">
              {['Stage', 'Input', 'Rework', 'Scrap', 'Min/unit', 'Capacity/day', 'Duration (h)', 'Start', 'Finish', 'Start bound by', 'Queue est.'].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {r.stages.map((s: any) => (
                <Fragment key={s.key}>
                  <tr className="cursor-pointer hover:bg-slate-50/60" onClick={() => setOpen(open === s.key ? null : s.key)}>
                    <td className="px-3 py-2.5 font-medium text-slate-800">{s.name}{s.isBottleneck && <span className="ml-1.5 text-[11px] text-amber-700">bottleneck</span>}</td>
                    <td className="px-3 py-2.5">{s.inputQty}</td><td className="px-3 py-2.5">{s.reworkQty}</td><td className="px-3 py-2.5">{s.scrapQty}</td>
                    <td className="px-3 py-2.5">{fmt(s.laborMinutesPerUnit)}</td><td className="px-3 py-2.5">{fmt(s.capacityPerDay)}</td>
                    <td className="px-3 py-2.5">{fmt(s.durationClockHours)}</td><td className="px-3 py-2.5 text-xs">{s.startDate}</td><td className="px-3 py-2.5 text-xs">{s.finishDate}</td>
                    <td className="px-3 py-2.5 text-xs">{bound(s.startBoundBy)}</td><td className="px-3 py-2.5">{s.queueEstimate}</td>
                  </tr>
                  {open === s.key && (
                    <tr><td colSpan={11} className="px-3 py-3 bg-slate-50/60 space-y-2">
                      {s.explain.map((e: any, i: number) => <Explain key={i} formula={e.formula} detail={e.detail} />)}
                      <p className="text-[11px] text-slate-500">Finish bound by: {bound(s.finishBoundBy)}{s.materialReadyDate ? ` · materials ready ${s.materialReadyDate}` : ''}</p>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function ManpowerView({ r, cur }: { r: any; cur: string }) {
  const m = r.manpower;
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Total labour hours" value={fmt(m.totalLaborHours)} />
        <Stat label="Required FTE" value={fmt(m.requiredFte.value)} sub={`over ${m.windowWorkingDays} working days`} />
        <Stat label="Headcount required" value={m.requiredHeadcount} sub={`If each stage had its own crew: ${m.dedicatedCrewHeadcount}`} />
        <Stat label="Additional workers needed" value={m.additionalWorkersNeeded ?? 'Unknown'} tone={m.additionalWorkersNeeded ? 'bad' : m.additionalWorkersNeeded === 0 ? 'good' : 'warn'}
          sub={m.availableHeadcount === null ? 'Available headcount not entered' : `${m.availableHeadcount} available (${fmt(m.effectiveAvailable)} after absence)`} />
      </div>
      <Section title="How the headcount is calculated" hint="People move between stages over time, so sequential stages share people. Stages running at the same time add up — nobody does two tasks at once.">
        <div className="space-y-3">
          {[m.requiredFte, m.headcountByHours, m.peakCrewPerShift, m.headcountBySchedule].map((e: any, i: number) => <Explain key={i} formula={e.formula} detail={e.detail} />)}
          <p className="text-xs text-slate-600">Required headcount = the larger of the hours-based and schedule-based figures = <b>{m.requiredHeadcount}</b>.</p>
          {m.capacityGapHours !== null && <p className="text-xs text-slate-600">Hour gap to the target with available people: <b>{fmt(m.capacityGapHours)} h</b> · workforce utilization {fmt(m.workforceUtilizationPct)}%.</p>}
          {m.staffingLimitedNote && <p className="text-xs text-amber-800 bg-amber-50 rounded-md px-3 py-2">{m.staffingLimitedNote}</p>}
          {m.overtime && <p className="text-xs text-slate-600">Overtime: {fmt(m.overtime.hoursNeeded)} h needed, {fmt(m.overtime.hoursAvailable)} h available ({m.overtime.coversHourGap ? 'covers' : 'does not cover'} the hour gap). {m.overtime.note}</p>}
        </div>
      </Section>
      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Workload by stage">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="pb-2 font-medium">Stage</th><th className="pb-2 font-medium">Skill</th><th className="pb-2 font-medium">Hours</th><th className="pb-2 font-medium">Share</th><th className="pb-2 font-medium">Crew/shift</th>{r.cost && <th className="pb-2 font-medium">Labour</th>}</tr></thead>
            <tbody className="divide-y divide-slate-50">
              {m.byStage.map((s: any) => (
                <tr key={s.key}>
                  <td className="py-2">{s.name}</td><td className="py-2 text-slate-500">{s.skill}</td><td className="py-2">{fmt(s.laborHours)}</td>
                  <td className="py-2"><div className="flex items-center gap-2"><div className="h-1.5 w-16 bg-slate-100 rounded"><div className="h-1.5 bg-green-500 rounded" style={{ width: `${s.sharePct}%` }} /></div><span className="text-xs text-slate-500">{fmt(s.sharePct, 0)}%</span></div></td>
                  <td className="py-2">{s.crewPerShift}</td>
                  {r.cost && <td className="py-2 text-xs">{money(r.cost.byStage.find((c: any) => c.key === s.key)?.labor, cur)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="By skill and shift">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="pb-2 font-medium">Skill</th><th className="pb-2 font-medium">Hours</th><th className="pb-2 font-medium">Peak crew/shift</th><th className="pb-2 font-medium">Headcount</th></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {m.bySkill.map((s: any) => <tr key={s.skill}><td className="py-2">{s.skill}</td><td className="py-2">{fmt(s.laborHours)}</td><td className="py-2">{s.peakCrewPerShift}</td><td className="py-2">{s.headcount}</td></tr>)}
            </tbody>
          </table>
          <p className="text-xs text-slate-500 mt-3">{m.byShift.map((s: any) => `Shift ${s.shift}: ${s.peakCrew} people at peak`).join(' · ')}</p>
        </Section>
      </div>
    </div>
  );
}

function MaterialsView({ r, cur }: { r: any; cur: string }) {
  if (!r.materials.length) return <Section title="Materials"><p className="text-sm text-slate-500">No materials defined for this scenario.</p></Section>;
  return (
    <Section title="Material requirements and availability" hint="Source: manually defined project list. Stock figures are for the planning warehouse at the time of the run.">
      <div className="space-y-3">
        {r.materials.map((m: any) => (
          <div key={m.productId} className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-slate-900">{m.code} <span className="text-slate-500 font-normal">{m.name}</span></p>
                <p className="text-[11px] text-slate-400">{m.source === 'MANUAL' ? 'Manually defined' : m.source} · {m.demandType === 'PLAN_APPROVED' ? 'Confirmed planning demand' : 'Planned (forecast) demand'} · used at {m.stages.join(', ')}</p>
              </div>
              {m.shortage > 0 || !m.arrivesInTime
                ? <Pill className="bg-red-50 text-red-700 border-red-200">Short {m.shortage} {m.unit}{!m.arrivesInTime ? ' · late' : ''}</Pill>
                : <Pill className="bg-green-50 text-green-700 border-green-200">Covered</Pill>}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-12 gap-2 mt-3 text-xs">
              {[
                ['Total need', m.totalRequirement], ['On hand', m.onHand], ['Reserved', m.reserved], ['Safety stock', m.safetyStock],
                ['Pending requests', m.pendingRequestDemand], ['Other plans', m.otherPlanDemand], ['Net available', m.netAvailable], ['Net requirement', m.netRequirement],
                ['Inbound in time', m.eligibleInbound], ['Required by', m.requiredByDate], ['Covered on', m.coverageDate ?? 'unknown'], ['Suggest', m.suggestedReplenishment],
              ].map(([k, v]) => <div key={k as string}><p className="text-slate-400">{k}</p><p className="text-slate-800 font-medium">{typeof v === 'number' ? fmt(v) : v}</p></div>)}
            </div>
            {!!m.inbound.length && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.inbound.map((i: any, idx: number) => (
                  <Pill key={idx} className={i.arrivesInTime ? 'bg-white border-slate-200 text-slate-600' : 'bg-amber-50 border-amber-200 text-amber-800'}>
                    {i.source === 'MANUAL' ? 'Expected' : 'In inspection'} {i.quantity} on {i.expectedDate} · {i.reference}{i.arrivesInTime ? '' : ' (late)'}
                  </Pill>
                ))}
              </div>
            )}
            <p className="text-xs text-slate-600 mt-2">{m.explanation}</p>
            {m.totalCost !== null && <p className="text-[11px] text-slate-400 mt-1">{money(m.unitCost, cur)} × {m.totalRequirement} = {money(m.totalCost, cur)} ({m.unitCostSource === 'MANUAL_ESTIMATE' ? 'manual estimate' : 'Product Master standard cost'})</p>}
          </div>
        ))}
      </div>
    </Section>
  );
}

function SpaceView({ r }: { r: any }) {
  return (
    <Section title="Warehouse capacity" hint="Storage, staging and work areas are separate spaces and are checked separately.">
      <div className="grid md:grid-cols-2 gap-3">
        {r.space.map((s: any) => {
          const pct = s.utilizationPct;
          return (
            <div key={s.key} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-900">{s.label}</p>
                <Pill className={s.status === 'OK' ? 'bg-green-50 text-green-700 border-green-200' : s.status === 'INCOMPLETE' ? 'bg-slate-50 text-slate-500 border-slate-200' : s.status === 'RISK' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-200'}>
                  {s.status === 'OK' ? 'Sufficient' : s.status === 'INCOMPLETE' ? 'Incomplete data' : s.status === 'RISK' ? 'At risk' : `Short ${fmt(s.shortfall)} ${s.unit}`}
                </Pill>
              </div>
              <p className="text-xs text-slate-600 mt-2">Required <b>{fmt(s.required)}</b> · available <b>{fmt(s.available)}</b> {s.unit} <span className="text-slate-400">({s.availableSource === 'WMS' ? 'from WMS' : s.availableSource === 'MANUAL_OVERRIDE' ? 'entered manually' : 'no data'})</span></p>
              {pct !== null && <div className="h-1.5 bg-slate-100 rounded mt-2"><div className={cn('h-1.5 rounded', pct > 100 ? 'bg-red-500' : s.status === 'RISK' ? 'bg-amber-500' : 'bg-green-500')} style={{ width: `${Math.min(100, pct)}%` }} /></div>}
              <div className="mt-2"><Explain formula={s.formula} detail={s.detail} /></div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function CostView({ r }: { r: any }) {
  const c = r.cost;
  if (!c) return <Section title="Cost"><p className="text-sm text-slate-500">You do not have permission to see costs for this project.</p></Section>;
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Section title={`Estimated cost (${c.currency})`} hint={c.note}>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-50">
            {c.lines.map((l: any, i: number) => (
              <tr key={i}><td className="py-2"><p className="text-slate-800">{l.label}</p><p className="text-[11px] text-slate-500">{l.basis}</p></td>
                <td className="py-2 text-right whitespace-nowrap">{l.amount === null ? <span className="text-slate-400">missing</span> : money(l.amount, c.currency)}{l.status === 'MISSING' && l.amount !== null && <span className="text-[11px] text-amber-700 block">partial</span>}</td></tr>
            ))}
            <tr className="font-semibold"><td className="py-2">Total{!c.complete && <span className="text-xs font-normal text-amber-700 ml-2">incomplete</span>}</td><td className="py-2 text-right">{money(c.total, c.currency)}</td></tr>
            <tr><td className="py-1 text-slate-500 text-xs">Per delivered unit</td><td className="py-1 text-right text-xs">{money(c.costPerUnit, c.currency)}</td></tr>
          </tbody>
        </table>
        {!!c.missing.length && <p className="text-xs text-amber-800 bg-amber-50 rounded-md px-3 py-2 mt-3">Missing: {c.missing.join('; ')}</p>}
      </Section>
      <Section title="Cost by stage">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="pb-2 font-medium">Stage</th><th className="pb-2 font-medium text-right">Labour</th><th className="pb-2 font-medium text-right">Material</th></tr></thead>
          <tbody className="divide-y divide-slate-50">
            {c.byStage.map((s: any) => <tr key={s.key}><td className="py-2">{s.name}</td><td className="py-2 text-right">{money(s.labor, c.currency)}</td><td className="py-2 text-right">{money(s.material, c.currency)}</td></tr>)}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

function AssumptionsView({ run }: { run: any }) {
  const r = run.result;
  const lay = run.data?.layout;
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Section title="Assumptions applied">
        {!r.assumptions.length ? <p className="text-sm text-slate-500">No defaults were applied — every value was entered.</p>
          : <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">{r.assumptions.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul>}
      </Section>
      <Section title="Warnings and missing data">
        <ul className="space-y-1.5 text-sm">
          {[...r.warnings.map((w: any) => ({ ...w, k: 'w' })), ...r.missingData.map((w: any) => ({ ...w, k: 'm' }))].map((w: any, i: number) => (
            <li key={i} className="flex gap-2 text-slate-700"><span className={cn('mt-1.5 h-2 w-2 rounded-full shrink-0', w.k === 'm' ? 'bg-slate-400' : 'bg-amber-500')} /><span><span className="text-xs text-slate-500 mr-1">{w.area}</span>{w.message}</span></li>
          ))}
          {!r.warnings.length && !r.missingData.length && <li className="text-slate-500">None.</li>}
        </ul>
      </Section>
      <Section title="WMS data used (snapshot)" hint={`Read in one consistent transaction on ${r.asOf}. Stored with the run so it can be re-verified.`} className="lg:col-span-2">
        {lay && (
          <p className="text-xs text-slate-600 mb-3">
            Warehouse {lay.warehouseCode}: {lay.palletSlotCount} pallet/bulk slots ({lay.palletSlotFreeCapacity} free positions), {lay.otherSlotCount} other slots.
            Floor Plan: {lay.hasLayout ? `drawn in ${lay.layoutUnit}` : 'none'}; receiving {fmt(lay.receivingAreaM2)} m², dispatch {fmt(lay.dispatchAreaM2)} m², staging {fmt(lay.stagingAreaM2)} m², work {fmt(lay.workAreaM2)} m².
          </p>
        )}
        <p className="text-[11px] font-mono text-slate-400 break-all">Input hash {run.inputHash}</p>
        <p className="text-[11px] text-slate-400 mt-1">Flags: {r.flags.map((f: string) => FLAG[f] ?? f).join(', ') || 'none'}</p>
      </Section>
    </div>
  );
}
