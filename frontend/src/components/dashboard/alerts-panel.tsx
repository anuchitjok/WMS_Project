'use client';

// Warehouse Alerts — light enterprise styling with clear urgency hierarchy.
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, ShieldCheck, MapPin, ChevronRight } from 'lucide-react';

export interface AlertsData {
  lowStock: number;
  pendingApproval: number;
  pendingPutaway: number;
}

const ROWS = [
  { key: 'lowStock',        label: 'Low Stock',        icon: AlertTriangle, href: '/inventory', iconCls: 'bg-red-50 text-red-600',       active: 'border-red-200 bg-red-50/40',       badge: 'bg-red-100 text-red-700' },
  { key: 'pendingApproval', label: 'Pending Approval', icon: ShieldCheck,   href: '/approvals', iconCls: 'bg-amber-50 text-amber-600',   active: 'border-amber-200 bg-amber-50/40',   badge: 'bg-amber-100 text-amber-700' },
  { key: 'pendingPutaway',  label: 'Pending Putaway',  icon: MapPin,        href: '/putaway',   iconCls: 'bg-orange-50 text-orange-600', active: 'border-orange-200 bg-orange-50/40', badge: 'bg-orange-100 text-orange-700' },
] as const;

export function AlertsPanel({ data, loading }: { data?: AlertsData; loading?: boolean }) {
  return (
    <div className="h-full bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-5">Warehouse Alerts</h2>
      <div className="space-y-2.5">
        {ROWS.map((row) => {
          const v = data?.[row.key] ?? 0;
          const Icon = row.icon;
          const urgent = v > 0;
          return (
            <Link key={row.key} href={row.href}
              className={cn(
                'flex items-center gap-3 rounded-lg border p-3 transition-colors',
                urgent ? row.active : 'border-slate-200 hover:bg-slate-50',
              )}>
              <span className={cn('h-9 w-9 rounded-lg grid place-items-center flex-shrink-0', row.iconCls)}>
                <Icon className="w-4 h-4" />
              </span>
              <span className="text-sm font-medium text-slate-700 flex-1">{row.label}</span>
              {loading ? <Skeleton className="h-6 w-9" /> : (
                <span className={cn('min-w-[2rem] text-center rounded-md px-2 py-0.5 text-sm font-bold tabular-nums',
                  urgent ? row.badge : 'text-slate-400')}>{v}</span>
              )}
              <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
