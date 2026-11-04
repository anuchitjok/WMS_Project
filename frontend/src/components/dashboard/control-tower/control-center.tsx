'use client';

// Section D — Operations Control Center. Every item is a live count with a
// severity, a short explanation and a link to the existing module where the
// work is done. Severity is threshold-based on the real count only.
import Link from 'next/link';
import {
  AlarmClock, ChevronRight, MapPin, PackageX, RotateCcw, ShieldCheck, Siren, Truck, TriangleAlert, type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { interpolate, useT } from '@/i18n';
import type { DashboardOverview } from '@/lib/api';
import { Panel } from './panel';

type Level = 'normal' | 'attention' | 'critical';
const cls = (v: number, warn: number, crit: number): Level => (v > crit ? 'critical' : v > warn ? 'attention' : 'normal');

const LEVEL: Record<Level, { badge: string; icon: string; row: string }> = {
  critical: { badge: 'bg-red-100 text-red-700', icon: 'bg-red-100 text-red-600', row: 'border-red-200 bg-red-50/60' },
  attention: { badge: 'bg-amber-100 text-amber-700', icon: 'bg-amber-50 text-amber-600', row: 'border-amber-200/80 bg-amber-50/40' },
  normal: { badge: 'bg-slate-100 text-slate-500', icon: 'bg-slate-100 text-slate-500', row: 'border-slate-100 bg-white' },
};

interface Item { key: string; label: string; hint: string; count: number; level: Level; icon: LucideIcon; href: string }

export function ControlCenter({ data, loading }: { data: DashboardOverview | null; loading: boolean }) {
  const { m, fmt } = useT();
  const C = m.dashboard.ct.control;
  const I = C.items;
  const k = data?.kpis;
  const c = data?.control;

  const overdue = (c?.overdueApprovals ?? 0) + (c?.overduePicking ?? 0) + (c?.overdueRtv ?? 0);
  const exceptions = (c?.fulfillmentExceptions ?? 0) + (c?.doaAwaitingRtv ?? 0);

  const items: Item[] = [
    { key: 'low', label: I.lowStock, hint: I.lowStockHint, count: k?.lowStockAlerts ?? 0, level: cls(k?.lowStockAlerts ?? 0, 0, 10), icon: TriangleAlert, href: '#low-stock' },
    {
      key: 'overdue', label: I.overdue,
      hint: c?.overdueRtv ? `${I.overdueHint} · ${interpolate(I.overdueRtvHint, { count: c.overdueRtv })}` : I.overdueHint,
      count: overdue, level: overdue > 0 ? 'critical' : 'normal', icon: AlarmClock, href: '/work-queue',
    },
    { key: 'putaway', label: I.pendingPutaway, hint: I.pendingPutawayHint, count: k?.pendingPutaway ?? 0, level: cls(k?.pendingPutaway ?? 0, 0, 25), icon: MapPin, href: '/putaway' },
    { key: 'exceptions', label: I.exceptions, hint: I.exceptionsHint, count: exceptions, level: cls(exceptions, 0, 5), icon: PackageX, href: '/work-queue' },
    { key: 'approval', label: I.pendingApproval, hint: I.pendingApprovalHint, count: k?.pendingApproval ?? 0, level: cls(k?.pendingApproval ?? 0, 0, 15), icon: ShieldCheck, href: '/approvals' },
    { key: 'returns', label: I.returns, hint: I.returnsHint, count: k?.openReturns ?? 0, level: cls(k?.openReturns ?? 0, 0, 10), icon: RotateCcw, href: '/rtv' },
    { key: 'fulfillment', label: I.activeFulfillment, hint: I.activeFulfillmentHint, count: k?.activeFulfillment ?? 0, level: 'normal', icon: Truck, href: '/outbound/fulfillment' },
  ];

  const worst: Level = items.some((i) => i.level === 'critical') ? 'critical' : items.some((i) => i.level === 'attention') ? 'attention' : 'normal';
  const badgeText = worst === 'critical' ? C.critical : worst === 'attention' ? C.needAttention : C.allClear;

  return (
    <Panel
      title={C.title}
      subtitle={C.subtitle}
      icon={Siren}
      tone={data && worst === 'critical' ? 'alert' : 'default'}
      className="h-full"
      actions={data && (
        <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', worst === 'normal' ? 'bg-emerald-50 text-emerald-700' : LEVEL[worst].badge)}>
          {badgeText}
        </span>
      )}
    >
      {loading && !data ? (
        <div className="grid gap-2 sm:grid-cols-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map((it) => {
            const L = LEVEL[it.level];
            return (
              <li key={it.key}>
                <Link
                  href={it.href}
                  className={cn('group flex h-full items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:border-slate-300 hover:shadow-sm', L.row)}
                >
                  <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', L.icon)}>
                    <it.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-800">{it.label}</span>
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-slate-500 line-clamp-2">{it.hint}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className={cn('text-xl font-bold leading-none tabular-nums', it.level === 'critical' ? 'text-red-600' : it.level === 'attention' ? 'text-amber-600' : 'text-slate-900')}>
                      {fmt.number(it.count)}
                    </span>
                    <span className={cn('rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide', L.badge)}>
                      {m.dashboard.kpiStatus[it.level]}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-slate-500" aria-label={C.open} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
