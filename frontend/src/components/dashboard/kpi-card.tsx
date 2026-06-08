'use client';

// Executive KPI card — light enterprise theme (white + accent). Reused across the dashboard.
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { LucideIcon } from 'lucide-react';

export type KpiTone = 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'slate';

const TONE: Record<KpiTone, string> = {
  blue:   'bg-blue-50 text-blue-600',
  green:  'bg-emerald-50 text-emerald-600',
  amber:  'bg-amber-50 text-amber-600',
  red:    'bg-red-50 text-red-600',
  violet: 'bg-violet-50 text-violet-600',
  slate:  'bg-slate-100 text-slate-600',
};

export interface KpiCardProps {
  label: string;
  value: number | string | null;
  icon: LucideIcon;
  tone?: KpiTone;
  delta?: number | null;
  href?: string;
  loading?: boolean;
  emptyText?: string;
}

export function KpiCard({ label, value, icon: Icon, tone = 'blue', delta, href, loading, emptyText = 'N/A' }: KpiCardProps) {
  const body = (
    <div
      className={cn(
        'h-full bg-white border border-slate-200 rounded-xl p-4 shadow-sm transition-all',
        href && 'hover:shadow-md hover:border-slate-300',
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn('h-10 w-10 rounded-lg grid place-items-center flex-shrink-0', TONE[tone])}>
          <Icon className="h-5 w-5" />
        </span>
        {typeof delta === 'number' && delta !== 0 && !loading && (
          <span className={cn('text-xs font-semibold tabular-nums', delta > 0 ? 'text-emerald-600' : 'text-red-600')}>
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-8 w-16 mt-3" />
      ) : (
        <p className="mt-3 text-3xl font-bold text-slate-900 tabular-nums leading-none">
          {value === null ? emptyText : typeof value === 'number' ? value.toLocaleString() : value}
        </p>
      )}
      <p className="mt-1.5 text-[13px] font-medium text-slate-500 leading-tight">{label}</p>
    </div>
  );

  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}
