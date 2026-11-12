'use client';

// PR8 Phase 4 — task panel under the 3D view: Now | Pending | Flow.
//
// Read-only, existing APIs only (see use-tower-data.ts): open tasks from
// /fulfillment/board, stock rows by status from /inventory (totals), putaway
// waiting from /dashboard/kpis. Decided with the user (10 Nov 2026):
//   • Pending = this warehouse only (pick not started, waiting to ship, exceptions, putaway)
//   • Flow counts stock rows for stock steps and tasks for order steps
//   • Receive = stock rows waiting to be received in this warehouse
// Clicking a task lists its lines; lines still to pick are highlighted in the
// 3D view (cyan, numbered) by the page.

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { ArrowRight, ChevronDown, ChevronUp, ClipboardList, MapPin, PackageCheck } from 'lucide-react';
import { labelOf, useT } from '@/i18n';
import { cn, formatDate } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { FlowFigures, OpenTask, Source, StockFigures, TaskLine } from './use-tower-data';

export type TaskTab = 'now' | 'pending' | 'flow';

const NOW = ['PICKING', 'PICKED', 'PACKING'];
const PENDING = ['ALLOCATED', 'PACKED', 'READY_TO_SHIP'];
const EXCEPTION = ['SHORT_PICK', 'DAMAGED', 'HOLD'];
/** Tasks whose remaining lines are still on the shelf. */
export const PICK_STAGE = new Set(['ALLOCATED', 'PICKING']);

const TONE: Record<string, string> = {
  ALLOCATED: 'bg-slate-100 text-slate-700',
  PICKING: 'bg-blue-50 text-blue-700',
  PICKED: 'bg-blue-50 text-blue-700',
  PACKING: 'bg-emerald-50 text-emerald-700',
  PACKED: 'bg-emerald-50 text-emerald-700',
  READY_TO_SHIP: 'bg-emerald-50 text-emerald-700',
};

export const lineLeft = (l: TaskLine) => Math.max(0, (Number(l.qtyRequested) || 0) - (Number(l.qtyPicked) || 0));

export function TaskPanel({ open, flow, stock, tab, onTab, selectedTaskId, onSelectTask, locate, onGoSlot, stopOf }: {
  open: Source<OpenTask[]>;
  flow: Source<FlowFigures>;
  stock: Source<StockFigures>;
  tab: TaskTab; onTab: (t: TaskTab) => void;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  /** Where a line's stock sits now (null = not known). */
  locate: (l: TaskLine) => { slotId: string; code: string } | null;
  onGoSlot: (slotId: string) => void;
  /** PR8 Phase 5: walking order per slot of the task on show (null = no route). */
  stopOf?: Map<string, { order: number; reachable: boolean }> | null;
}) {
  const { m, t } = useT();
  const T = m.layout3d.w3d.tasks;
  const [collapsed, setCollapsed] = useState(false);
  const tasks = open.data ?? [];
  const nowList = tasks.filter((t) => NOW.includes(t.status));
  const pendingList = tasks.filter((t) => PENDING.includes(t.status) || EXCEPTION.includes(t.status));
  const putaway = stock.data?.pendingPutaway ?? 0;

  const tabs: { id: TaskTab; label: string; n?: number }[] = [
    { id: 'now', label: T.tabNow, n: open.data ? nowList.length : undefined },
    { id: 'pending', label: T.tabPending, n: open.data ? pendingList.length + (putaway ? 1 : 0) : undefined },
    { id: 'flow', label: T.tabFlow },
  ];

  let body: ReactNode;
  if (tab === 'flow') {
    body = <FlowStrip flow={flow} stock={stock} tasks={open} />;
  } else if (open.state === 'loading') {
    body = <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>;
  } else if (open.state !== 'ok') {
    body = <p className="text-sm text-slate-500">{open.state === 'denied' ? T.noAccess : T.loadError}</p>;
  } else {
    const list = tab === 'now' ? nowList : pendingList;
    body = (
      <ul className="space-y-1.5">
        {list.map((t) => (
          <TaskRow key={t.id} t={t} open={t.id === selectedTaskId} onToggle={() => onSelectTask(t.id === selectedTaskId ? null : t.id)}
            locate={locate} onGoSlot={onGoSlot} stopOf={t.id === selectedTaskId ? stopOf : null} />
        ))}
        {tab === 'pending' && putaway > 0 && (
          <li className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm">
            <span className="flex items-center gap-2 text-slate-700"><PackageCheck className="h-4 w-4 text-amber-600" />{m.layout3d.w3d.tower.kpi.putaway}</span>
            <Link href="/putaway" className="text-xs font-medium text-emerald-700 underline-offset-2 hover:underline">
              {t(T.rowsN, { n: putaway.toLocaleString() })}
            </Link>
          </li>
        )}
        {list.length === 0 && !(tab === 'pending' && putaway > 0) && <li className="py-3 text-center text-sm text-slate-400">{tab === 'now' ? T.emptyNow : T.emptyPending}</li>}
      </ul>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label={T.title}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ClipboardList className="h-4 w-4 text-slate-500" />{T.title}</h2>
        {!collapsed && (
          <div className="flex rounded-lg bg-slate-100 p-0.5" role="tablist">
            {tabs.map((x) => (
              <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => onTab(x.id)}
                className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors',
                  tab === x.id ? 'bg-white font-semibold text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                {x.label}{x.n != null && <span className="tabular-nums text-slate-400">{x.n}</span>}
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={() => setCollapsed((v) => !v)} aria-expanded={!collapsed} aria-label={collapsed ? T.expand : T.collapse}
          className="ml-auto grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
      </div>
      {!collapsed && <div className="max-h-72 overflow-y-auto border-t border-slate-100 px-4 py-3" role="tabpanel">{body}</div>}
    </section>
  );
}

function TaskRow({ t, open, onToggle, locate, onGoSlot, stopOf }: {
  t: OpenTask; open: boolean; onToggle: () => void;
  locate: (l: TaskLine) => { slotId: string; code: string } | null;
  onGoSlot: (slotId: string) => void;
  stopOf?: Map<string, { order: number; reachable: boolean }> | null;
}) {
  const { m, t: tr } = useT();
  const T = m.layout3d.w3d.tasks;
  const lines = t.items ?? [];
  const req = lines.reduce((a, l) => a + (Number(l.qtyRequested) || 0), 0);
  const got = lines.reduce((a, l) => a + (Number(l.qtyPicked) || 0), 0);
  const exception = EXCEPTION.includes(t.status);
  const pick = PICK_STAGE.has(t.status);

  return (
    <li className={cn('rounded-lg border', open ? 'border-cyan-300 bg-cyan-50/40' : 'border-slate-100')}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-slate-50">
        <span className="font-mono text-sm font-semibold text-slate-800">{t.refNumber}</span>
        <span className="text-xs text-slate-500">{t.requestRef}</span>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', exception ? 'bg-red-50 text-red-700' : TONE[t.status] ?? 'bg-slate-100 text-slate-700')}>
          {labelOf(m.status.fulfillment, t.status)}
        </span>
        <span className="text-xs text-slate-500">{tr(T.linesQty, { lines: lines.length, got: got.toLocaleString(), req: req.toLocaleString() })}</span>
        {t.deliveryMethod && <span className="text-xs text-slate-400">{t.deliveryMethod === 'SHIP' ? T.ship : T.collect}</span>}
        <span className="ml-auto text-xs text-slate-400" title={T.since}>{formatDate(t.updatedAt)}</span>
        {pick && <span className="text-xs font-medium text-cyan-700">{open ? T.hidePick : T.showPick}</span>}
      </button>
      {open && (
        <ol className="space-y-1 border-t border-slate-100 px-3 py-2">
          {lines.map((l, i) => {
            const left = lineLeft(l);
            const at = left > 0 ? locate(l) : null;
            const stop = at ? stopOf?.get(at.slotId) : undefined;
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                <span className={cn('grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold tabular-nums',
                  left > 0 && at ? 'bg-cyan-500 text-white' : 'bg-slate-200 text-slate-600')}>{i + 1}</span>
                <span className="font-mono text-xs text-slate-800">{l.product?.code ?? '—'}</span>
                <span className="text-xs tabular-nums text-slate-600">{tr(T.qty, { got: Number(l.qtyPicked) || 0, req: Number(l.qtyRequested) || 0, unit: l.product?.unit ?? '' }).trim()}</span>
                {left === 0 ? (
                  <span className="text-xs text-emerald-700">{T.picked}</span>
                ) : at ? (
                  <button type="button" onClick={() => onGoSlot(at.slotId)} className="flex items-center gap-1 font-mono text-xs font-medium text-blue-700 hover:underline">
                    <MapPin className="h-3.5 w-3.5" />{at.code}
                  </button>
                ) : (
                  <span className="text-xs text-amber-700">{l.stockItemId ? T.noLocation : T.notAllocated}</span>
                )}
                {stop && (stop.reachable ? (
                  <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[11px] font-semibold text-cyan-800">{tr(T.stop, { n: stop.order })}</span>
                ) : (
                  <span className="text-xs text-amber-700">{T.noAisle}</span>
                ))}
              </li>
            );
          })}
          <li className="pt-1">
            <Link href="/outbound/fulfillment" className="text-xs font-medium text-emerald-700 underline-offset-2 hover:underline">{T.openFulfillment}</Link>
          </li>
        </ol>
      )}
    </li>
  );
}

function FlowStrip({ flow, stock, tasks }: { flow: Source<FlowFigures>; stock: Source<StockFigures>; tasks: Source<OpenTask[]> }) {
  const { m } = useT();
  const T = m.layout3d.w3d.tasks, F = T.flow;
  const count = (...st: string[]) => (tasks.data ?? []).filter((x) => st.includes(x.status)).length;
  const steps: { key: keyof typeof F.step; src: Source<unknown>['state']; n: number; unit: 'rows' | 'tasks'; href?: string }[] = [
    { key: 'receive', src: flow.state, n: flow.data?.receive ?? 0, unit: 'rows', href: '/receiving' },
    { key: 'putaway', src: stock.state, n: stock.data?.pendingPutaway ?? 0, unit: 'rows', href: '/putaway' },
    { key: 'available', src: flow.state, n: flow.data?.available ?? 0, unit: 'rows' },
    { key: 'pick', src: tasks.state, n: count('ALLOCATED', 'PICKING'), unit: 'tasks', href: '/outbound/fulfillment' },
    { key: 'pack', src: tasks.state, n: count('PICKED', 'PACKING'), unit: 'tasks', href: '/outbound/fulfillment' },
    { key: 'ship', src: tasks.state, n: count('PACKED', 'READY_TO_SHIP'), unit: 'tasks', href: '/outbound/fulfillment' },
  ];
  return (
    <ol className="flex flex-wrap items-stretch gap-1.5">
      {steps.map((s, i) => {
        const inner = (
          <>
            <p className="truncate text-xs text-slate-500">{F.step[s.key]}</p>
            {s.src === 'loading' ? <Skeleton className="my-1 h-6 w-12" /> : s.src === 'ok'
              ? <p className="text-xl font-semibold tabular-nums text-slate-900">{s.n.toLocaleString()}</p>
              : <p className="text-xl font-semibold text-slate-300" title={s.src === 'denied' ? T.noAccess : T.loadError}>—</p>}
            <p className="truncate text-[11px] text-slate-400">{s.unit === 'rows' ? F.unitRows : F.unitTasks}</p>
          </>
        );
        return (
          <li key={s.key} className="flex min-w-[7.5rem] flex-1 items-center gap-1.5">
            {s.href
              ? <Link href={s.href} title={F.hint[s.key]} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 hover:border-emerald-300 hover:bg-emerald-50/40">{inner}</Link>
              : <div title={F.hint[s.key]} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2">{inner}</div>}
            {i < steps.length - 1 && <ArrowRight className="h-4 w-4 flex-shrink-0 text-slate-300" aria-hidden />}
          </li>
        );
      })}
      <li className="w-full pt-1 text-xs text-slate-400">{F.note}</li>
    </ol>
  );
}
