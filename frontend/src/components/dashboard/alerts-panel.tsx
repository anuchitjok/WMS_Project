'use client';

// Row 3 (Left) — Critical Alert Center.
// Combines operational exceptions and orders them by operational priority
// (severity, then volume). All counts come from existing /dashboard/kpis data.
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, ShieldCheck, MapPin, RotateCcw, ChevronRight, CheckCircle2 } from 'lucide-react';

export interface AlertsData {
  lowStock: number;
  pendingApproval: number;
  pendingPutaway: number;
  inventoryExceptions?: number; // openReturns (returns + RTV) from /kpis
}

interface AlertRow {
  key: keyof AlertsData;
  label: string;
  hint: string;
  icon: typeof AlertTriangle;
  href: string;
  severity: number; // higher = more urgent
  iconCls: string;
  active: string;
  badge: string;
}

const ROWS: AlertRow[] = [
  { key: 'lowStock',            label: 'Low Stock',            hint: 'Below minimum level',   icon: AlertTriangle, href: '/inventory', severity: 4, iconCls: 'bg-red-50 text-red-600',       active: 'border-red-200 bg-red-50/50',       badge: 'bg-red-100 text-red-700' },
  { key: 'inventoryExceptions', label: 'Inventory Exceptions', hint: 'Returns / RTV pending', icon: RotateCcw,     href: '/rtv',       severity: 3, iconCls: 'bg-orange-50 text-orange-600', active: 'border-orange-200 bg-orange-50/50', badge: 'bg-orange-100 text-orange-700' },
  { key: 'pendingApproval',     label: 'Pending Approval',     hint: 'Awaiting decision',     icon: ShieldCheck,   href: '/approvals', severity: 2, iconCls: 'bg-amber-50 text-amber-600',   active: 'border-amber-200 bg-amber-50/50',   badge: 'bg-amber-100 text-amber-700' },
  { key: 'pendingPutaway',      label: 'Pending Putaway',      hint: 'Awaiting storage',      icon: MapPin,        href: '/putaway',   severity: 1, iconCls: 'bg-teal-50 text-teal-600',     active: 'border-teal-200 bg-teal-50/50',     badge: 'bg-teal-100 text-teal-700' },
];

export function AlertsPanel({ data, loading, title = 'Critical Alert Center' }: { data?: AlertsData; loading?: boolean; title?: string }) {
  const rows = [...ROWS].sort((a, b) => {
    const av = data?.[a.key] ?? 0;
    const bv = data?.[b.key] ?? 0;
    const aActive = av > 0 ? 1 : 0;
    const bActive = bv > 0 ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;             // active first
    if (b.severity !== a.severity) return b.severity - a.severity; // then severity
    return bv - av;                                                // then volume
  });

  const totalActive = ROWS.reduce((n, r) => n + ((data?.[r.key] ?? 0) > 0 ? 1 : 0), 0);

  return (
    <div className="h-full bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">{title}</h2>
        {!loading && (
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold tabular-nums',
            totalActive > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700')}>
            {totalActive > 0 ? `${totalActive} active` : 'All clear'}
          </span>
        )}
      </div>

      {!loading && totalActive === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-500" />
          <p className="mt-2 text-sm font-medium text-slate-600">No active alerts</p>
          <p className="text-xs text-slate-400">All operational queues are within normal range</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((row) => {
            const v = data?.[row.key] ?? 0;
            const Icon = row.icon;
            const urgent = v > 0;
            return (
              <Link key={row.key} href={row.href}
                className={cn('flex items-center gap-3 rounded-lg border p-3 transition-colors',
                  urgent ? row.active : 'border-slate-200 hover:bg-slate-50')}>
                <span className={cn('h-9 w-9 rounded-lg grid place-items-center flex-shrink-0', row.iconCls)}>
                  <Icon className="w-4 h-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 leading-tight">{row.label}</p>
                  <p className="text-xs text-slate-400 leading-tight">{row.hint}</p>
                </div>
                {loading ? <Skeleton className="h-6 w-9" /> : (
                  <span className={cn('min-w-[2rem] text-center rounded-md px-2 py-0.5 text-sm font-bold tabular-nums',
                    urgent ? row.badge : 'text-slate-400')}>{v}</span>
                )}
                <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
