'use client';

// Executive KPI card — light enterprise theme (white + accent). Reused across the dashboard.
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { LucideIcon } from 'lucide-react';

export type KpiTone = 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'slate';

const TONE: Record<KpiTone, string> = {
  blue:   'bg-teal-50 text-teal-600',
  green:  'bg-emerald-50 text-emerald-600',
  amber:  'bg-amber-50 text-amber-600',
  red:    'bg-red-50 text-red-600',
  violet: 'bg-violet-50 text-violet-600',
  slate:  'bg-slate-100 text-slate-600',
};

// Threshold-based operational status (real, value-derived — NOT a fabricated trend).
export type KpiStatus = 'normal' | 'attention' | 'critical';

const STATUS_DOT: Record<KpiStatus, string> = {
  normal: 'bg-emerald-500',
  attention: 'bg-amber-500',
  critical: 'bg-red-500',
};
const STATUS_LABEL: Record<KpiStatus, string> = {
  normal: 'Normal',
  attention: 'Attention',
  critical: 'Critical',
};
const STATUS_ACCENT: Record<KpiStatus, string> = {
  normal: 'before:bg-emerald-400',
  attention: 'before:bg-amber-400',
  critical: 'before:bg-red-500',
};

export interface KpiCardProps {
  label: string;
  value: number | string | null;
  icon: LucideIcon;
  tone?: KpiTone;
  status?: KpiStatus;
  delta?: number | null;
  href?: string;
  loading?: boolean;
  emptyText?: string;
}

export function KpiCard({ label, value, icon: Icon, tone = 'blue', status, delta, href, loading, emptyText = 'N/A' }: KpiCardProps) {
  const body = (
    <div
      className={cn(
        'relative h-full overflow-hidden bg-white border border-slate-200 rounded-xl p-4 shadow-sm transition-all',
        // left status accent bar
        status && 'before:absolute before:left-0 before:top-0 before:h-full before:w-1',
        status && STATUS_ACCENT[status],
        href && 'hover:shadow-md hover:border-slate-300',
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn('h-11 w-11 rounded-xl grid place-items-center flex-shrink-0', TONE[tone])}>
          <Icon className="h-5 w-5" />
        </span>
        {!loading && status && (
          <span className="flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[status])} />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{STATUS_LABEL[status]}</span>
          </span>
        )}
        {!loading && !status && typeof delta === 'number' && delta !== 0 && (
          <span className={cn('text-xs font-semibold tabular-nums', delta > 0 ? 'text-emerald-600' : 'text-red-600')}>
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-9 w-16 mt-3" />
      ) : (
        <p className="mt-3 text-[2rem] font-bold text-slate-900 tabular-nums leading-none">
          {value === null ? emptyText : typeof value === 'number' ? value.toLocaleString() : value}
        </p>
      )}
      <p className="mt-2 text-[13px] font-medium text-slate-500 leading-tight">{label}</p>
    </div>
  );

  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}
