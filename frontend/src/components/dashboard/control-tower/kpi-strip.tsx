'use client';

// Section A — Executive Overview. Six compact KPI cards.
// Period figures (receiving, shipment) show a previous-period comparison and a
// sparkline from the trend; snapshot figures say so instead of inventing a trend.
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Boxes, MapPin, PackagePlus, Send, Truck, TriangleAlert, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import type { DashboardOverview } from '@/lib/api';
import { FLOW_COLORS, Sparkline } from './charts';
import { balanceHref, delta, FLOW_HREF, type Delta } from './format';

type Status = 'normal' | 'attention' | 'critical';
const STATUS_DOT: Record<Status, string> = { normal: 'bg-emerald-500', attention: 'bg-amber-500', critical: 'bg-red-500' };

interface Card {
  key: string;
  label: string;
  hint: string;
  value: number | null;
  icon: LucideIcon;
  href: string;
  status: Status;
  spark?: { values: number[]; color: string };
  change?: Delta;
  suffix?: string;
  danger?: boolean;
}

// Backlog thresholds — the same ones the previous dashboard used for its status dots.
const cls = (v: number, warn: number, crit: number): Status => (v > crit ? 'critical' : v > warn ? 'attention' : 'normal');

export function KpiStrip({ data, loading, warehouseId }: { data: DashboardOverview | null; loading: boolean; warehouseId?: string }) {
  const { m, fmt } = useT();
  const K = m.dashboard.ct.kpi;
  const k = data?.kpis;
  const flows = data?.flows;
  const series = (f: 'receiving' | 'shipment') => data?.trend.map((b) => b[f]) ?? [];

  const cards: Card[] = [
    {
      key: 'receiving', label: K.receiving, hint: K.receivingHint, value: flows?.current.receiving ?? null, icon: PackagePlus,
      href: FLOW_HREF.receiving, status: 'normal',
      spark: { values: series('receiving'), color: FLOW_COLORS.receiving },
      change: flows ? delta(flows.current.receiving, flows.previous.receiving) : undefined,
    },
    {
      key: 'putaway', label: K.putaway, hint: K.putawayHint, value: k?.pendingPutaway ?? null, icon: MapPin,
      href: FLOW_HREF.putaway, status: cls(k?.pendingPutaway ?? 0, 0, 25),
    },
    {
      key: 'fulfillment', label: K.fulfillment, hint: K.fulfillmentHint, value: k?.activeFulfillment ?? null, icon: Truck,
      href: FLOW_HREF.fulfillment, status: 'normal',
    },
    {
      key: 'shipment', label: K.shipment, hint: K.shipmentHint, value: flows?.current.shipment ?? null, icon: Send,
      href: FLOW_HREF.shipment, status: 'normal',
      spark: { values: series('shipment'), color: FLOW_COLORS.shipment },
      change: flows ? delta(flows.current.shipment, flows.previous.shipment) : undefined,
    },
    {
      key: 'available', label: K.available, hint: K.availableHint, value: data?.inventory.available ?? null, icon: Boxes,
      href: balanceHref({ warehouseId }), status: 'normal', suffix: K.unitsSuffix,
    },
    {
      key: 'low', label: K.lowStock, hint: K.lowStockHint, value: k?.lowStockAlerts ?? null, icon: TriangleAlert,
      href: '#low-stock', status: cls(k?.lowStockAlerts ?? 0, 0, 10), danger: (k?.lowStockAlerts ?? 0) > 0,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
      {cards.map((c) => (
        <Link
          key={c.key}
          href={c.href}
          title={c.hint}
          className={cn(
            'group relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-white p-3.5 shadow-sm transition-all hover:-translate-y-px hover:shadow-md sm:p-4',
            c.danger ? 'border-red-200 bg-gradient-to-br from-red-50 to-white' : 'border-slate-200 hover:border-slate-300',
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', c.danger ? 'bg-red-100 text-red-600' : 'bg-green-50 text-green-600')}>
                <c.icon className="h-[18px] w-[18px]" />
              </span>
              <span className="text-[13px] font-medium leading-tight text-slate-600 line-clamp-2">{c.label}</span>
            </div>
            {!loading && <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', STATUS_DOT[c.status])} aria-label={m.dashboard.kpiStatus[c.status]} title={m.dashboard.kpiStatus[c.status]} />}
          </div>

          {loading ? (
            <Skeleton className="mt-3 h-8 w-20" />
          ) : (
            <p className="mt-2.5 flex items-baseline gap-1.5 text-[1.75rem] font-bold leading-none tabular-nums text-slate-900">
              {c.value === null ? m.common.states.notAvailable : fmt.number(c.value)}
              {c.suffix && c.value !== null && <span className="text-xs font-medium text-slate-400">{c.suffix}</span>}
            </p>
          )}

          <div className="mt-2 min-h-[16px] text-[11px] leading-tight">
            {loading ? null : c.change ? <ChangeText d={c.change} /> : <span className="text-slate-400">{K.liveSnapshot}</span>}
          </div>

          <div className="mt-auto pt-2">
            {c.spark && !loading && c.spark.values.some((v) => v > 0) ? (
              <Sparkline values={c.spark.values} color={c.spark.color} />
            ) : (
              <div className="h-8" />
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

function ChangeText({ d }: { d: Delta }) {
  const { m, fmt } = useT();
  const K = m.dashboard.ct.kpi;
  if (d.kind === 'pct') {
    const up = d.pct > 0;
    const Icon = up ? ArrowUpRight : ArrowDownRight;
    return (
      <span className="flex flex-wrap items-center gap-1">
        <span className={cn('inline-flex items-center font-semibold tabular-nums', up ? 'text-emerald-600' : 'text-red-600')}>
          <Icon className="h-3.5 w-3.5" />
          {fmt.percent(Math.abs(d.pct), Math.abs(d.pct) < 0.1 ? 1 : 0)}
        </span>
        <span className="text-slate-400">{K.vsPrevious}</span>
      </span>
    );
  }
  const text = d.kind === 'new' ? K.newActivity : d.kind === 'flat' ? K.noChange : K.noHistory;
  return <span className="text-slate-400">{text}</span>;
}
