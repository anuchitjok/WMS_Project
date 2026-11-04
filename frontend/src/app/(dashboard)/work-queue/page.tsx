'use client';

// Phase 4: one list of open work — what to do next, who is responsible, how long it has waited.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ListTodo, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { dashboardApi, type WorkItem } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const STAGES = ['Receive', 'Putaway', 'Approve', 'Allocate', 'Fulfil', 'Return', 'Scrap'] as const;

function waited(since: string, now: number) {
  const mins = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60000));
  if (mins < 60) return { text: `${mins} min`, hours: mins / 60 };
  const h = Math.floor(mins / 60);
  if (h < 48) return { text: `${h} h`, hours: h };
  return { text: `${Math.floor(h / 24)} days`, hours: h };
}

export default function WorkQueuePage() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<string>('');
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await dashboardApi.workQueue();
      setItems(res.items); setCounts(res.counts); setNow(Date.now());
    } catch (e: any) { toast.error(e.message ?? 'Failed to load work queue'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => (stage ? items.filter((i) => i.stage === stage) : items), [items, stage]);

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Work Queue" subtitle="Open work, oldest first — next action, who is responsible, and how long it has waited" icon={ListTodo}
        action={<Button variant="outline" onClick={load} disabled={loading} className="gap-1.5"><RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Refresh</Button>} />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Stage">
        <button role="tab" aria-selected={!stage} onClick={() => setStage('')}
          className={cn('rounded-full border px-3 py-1 text-sm', !stage ? 'border-green-600 bg-green-50 text-green-700' : 'border-slate-200 bg-white text-slate-600')}>
          All <span className="tabular-nums">{items.length}</span>
        </button>
        {STAGES.map((s) => (
          <button key={s} role="tab" aria-selected={stage === s} onClick={() => setStage(s)}
            className={cn('rounded-full border px-3 py-1 text-sm', stage === s ? 'border-green-600 bg-green-50 text-green-700' : 'border-slate-200 bg-white text-slate-600')}>
            {s} <span className="tabular-nums">{counts[s] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">Stage</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Reference</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">What</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Next action</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Responsible</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Waiting</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(5)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : shown.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">Nothing waiting{stage ? ` in ${stage}` : ''}.</td></tr>
              : shown.map((i, idx) => {
                const w = waited(i.waitingSince, now);
                return (
                  <tr key={`${i.stage}-${i.ref}-${idx}`} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-600">{i.stage}</td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-green-700">{i.ref}</td>
                    <td className="px-4 py-3 text-slate-600">{i.summary}</td>
                    <td className="px-4 py-3"><Link href={i.href} className="text-green-700 underline underline-offset-2">{i.nextAction}</Link></td>
                    <td className="px-4 py-3 text-slate-700">{i.owner}</td>
                    <td className={cn('px-4 py-3 whitespace-nowrap tabular-nums', w.hours >= 48 ? 'text-red-600 font-medium' : w.hours >= 24 ? 'text-amber-700' : 'text-slate-600')}>{w.text}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
