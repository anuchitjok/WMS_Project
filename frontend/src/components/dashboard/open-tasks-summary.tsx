'use client';

// Row 5 (Left) — Open Tasks Summary. Reuses existing /dashboard/kpis queue counts.
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { MapPin, ShieldCheck, Truck, Send } from 'lucide-react';
import { useT } from '@/i18n';

export interface OpenTasksData {
  pendingPutaway: number;
  pendingApproval: number;
  activeFulfillment: number;
  shipmentQueue: number;
}

const TILES = [
  { key: 'pendingPutaway',   icon: MapPin,      href: '/putaway',             tile: 'bg-teal-50 text-teal-600' },
  { key: 'pendingApproval',  icon: ShieldCheck, href: '/approvals',           tile: 'bg-amber-50 text-amber-600' },
  { key: 'activeFulfillment',icon: Truck,      href: '/outbound/fulfillment', tile: 'bg-violet-50 text-violet-600' },
  { key: 'shipmentQueue',    icon: Send,        href: '/outbound/fulfillment', tile: 'bg-emerald-50 text-emerald-600' },
] as const;

export function OpenTasksSummary({ data, loading }: { data?: OpenTasksData; loading?: boolean }) {
  const { m, fmt } = useT();
  return (
    <div className="h-full bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-4">{m.dashboard.openTasks.title}</h2>
      <div className="grid grid-cols-2 gap-3">
        {TILES.map((t) => {
          const Icon = t.icon;
          const v = data?.[t.key] ?? 0;
          return (
            <Link key={t.key} href={t.href}
              className="rounded-lg border border-slate-200 p-3 transition-colors hover:bg-slate-50">
              <span className={cn('h-9 w-9 rounded-lg grid place-items-center', t.tile)}>
                <Icon className="h-4 w-4" />
              </span>
              {loading ? <Skeleton className="h-7 w-12 mt-3" /> : (
                <p className="mt-3 text-2xl font-bold text-slate-900 tabular-nums leading-none">{fmt.number(v)}</p>
              )}
              <p className="mt-1 text-xs text-slate-500 leading-tight">{m.dashboard.metrics[t.key]}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
