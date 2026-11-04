'use client';

// Section G — Recent Warehouse Activity. The latest operational audit events
// (/dashboard/activity, references resolved by the backend), filterable by
// activity type. Status is read from the event itself (approved vs rejected…).
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { classifyActivity, type ActivityDomain } from '@/lib/activity-timeline';
import { useT } from '@/i18n';
import type { ActivityEvent } from '@/lib/api';
import { EmptyNote, Panel } from './panel';

const FILTERS = ['ALL', 'RECEIVING', 'PUTAWAY', 'FULFILLMENT', 'SHIPMENT', 'APPROVAL', 'RMA'] as const;
type Filter = (typeof FILTERS)[number];

const DOMAIN_HREF: Partial<Record<ActivityDomain, string>> = {
  RECEIVING: '/receiving', PUTAWAY: '/putaway', FULFILLMENT: '/outbound/fulfillment',
  SHIPMENT: '/outbound/fulfillment', APPROVAL: '/approvals', RMA: '/rtv',
};
const DOMAIN_DOT: Record<ActivityDomain, string> = {
  RECEIVING: 'bg-[#2a78d6]', PUTAWAY: 'bg-[#eb6834]', FULFILLMENT: 'bg-[#1baf7a]', SHIPMENT: 'bg-[#eda100]',
  APPROVAL: 'bg-slate-500', RMA: 'bg-[#e87ba4]', INVENTORY: 'bg-slate-300', OTHER: 'bg-slate-300',
};

type Result = 'success' | 'rejected' | 'exception' | 'cancelled';
function resultOf(action: string): Result {
  if (/REJECTED/.test(action)) return 'rejected';
  if (/EXCEPTION|DOA/.test(action)) return 'exception';
  if (/CANCELLED/.test(action)) return 'cancelled';
  return 'success';
}
const RESULT_CLS: Record<Result, string> = {
  success: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-red-50 text-red-700',
  exception: 'bg-amber-50 text-amber-700',
  cancelled: 'bg-slate-100 text-slate-600',
};

export function ActivityTable({ events, loading }: { events: ActivityEvent[] | null; loading: boolean }) {
  const { m, fmt } = useT();
  const A = m.dashboard.ct.activity;
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('ALL');

  const rows = useMemo(() => (events ?? []).map((e) => ({ e, meta: classifyActivity(e.action) })), [events]);
  const counts = useMemo(() => {
    const c: Partial<Record<Filter, number>> = { ALL: rows.length };
    rows.forEach((r) => { c[r.meta.domain as Filter] = (c[r.meta.domain as Filter] ?? 0) + 1; });
    return c;
  }, [rows]);
  const visible = filter === 'ALL' ? rows : rows.filter((r) => r.meta.domain === filter);

  return (
    <Panel
      title={A.title}
      subtitle={A.allScope}
      icon={History}
      actions={
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                filter === f ? 'bg-green-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              )}
            >
              {A.filter[f]}
              {counts[f] ? <span className={cn('ml-1 tabular-nums', filter === f ? 'text-green-100' : 'text-slate-400')}>{counts[f]}</span> : null}
            </button>
          ))}
        </div>
      }
    >
      {loading && !events ? (
        <div className="space-y-1.5">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
      ) : visible.length === 0 ? (
        <EmptyNote>{A.empty}</EmptyNote>
      ) : (
        <div className="-mx-1 max-h-[380px] overflow-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="sticky top-0 z-[1] bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="rounded-l-md px-2 py-2 text-left font-semibold">{A.time}</th>
                <th className="px-2 py-2 text-left font-semibold">{A.reference}</th>
                <th className="px-2 py-2 text-left font-semibold">{A.activity}</th>
                <th className="px-2 py-2 text-left font-semibold">{A.user}</th>
                <th className="rounded-r-md px-2 py-2 text-center font-semibold">{A.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map(({ e, meta }) => {
                const res = resultOf(e.action);
                const href = DOMAIN_HREF[meta.domain];
                return (
                  <tr key={e.id} className={cn(href && 'cursor-pointer hover:bg-slate-50')} onClick={href ? () => router.push(href) : undefined}>
                    <td className="whitespace-nowrap px-2 py-2.5 tabular-nums text-slate-500" title={fmt.dateTime(e.createdAt)}>
                      <span className="block text-slate-700">{fmt.time(e.createdAt)}</span>
                      <span className="block text-[11px] text-slate-400">{fmt.date(e.createdAt)}</span>
                    </td>
                    <td className="max-w-[160px] truncate px-2 py-2.5 font-mono text-xs text-slate-700" title={e.ref ?? undefined}>{e.ref ?? '—'}</td>
                    <td className="px-2 py-2.5">
                      <span className="flex items-center gap-2">
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', DOMAIN_DOT[meta.domain])} />
                        <span className="truncate text-slate-800">{(m.status.action as Record<string, string>)[e.action] ?? meta.label}</span>
                      </span>
                    </td>
                    <td className="max-w-[160px] truncate px-2 py-2.5 text-slate-600">{e.user?.fullName ?? m.common.states.system}</td>
                    <td className="px-2 py-2.5 text-center">
                      <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold', RESULT_CLS[res])}>{A.result[res]}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
