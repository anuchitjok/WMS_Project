'use client';

// Row 1 — Executive Overview card. Answers an executive question at a glance:
// operations health, inventory health, or business risk.
// All status text is DERIVED from existing metrics (see dashboard page) — never hardcoded.

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { LucideIcon } from 'lucide-react';

export type ExecLevel = 'ok' | 'warn' | 'critical';

interface LevelStyle {
  iconTile: string;
  headline: string;
  ring: string;
  dominantBg: string;
  dominantHeadline: string;
}
const LEVEL: Record<ExecLevel, LevelStyle> = {
  ok: {
    iconTile: 'bg-emerald-50 text-emerald-600',
    headline: 'text-emerald-700',
    ring: 'border-slate-200',
    dominantBg: 'bg-emerald-50 border-emerald-200',
    dominantHeadline: 'text-emerald-700',
  },
  warn: {
    iconTile: 'bg-amber-50 text-amber-600',
    headline: 'text-amber-700',
    ring: 'border-slate-200',
    dominantBg: 'bg-amber-50 border-amber-200',
    dominantHeadline: 'text-amber-700',
  },
  critical: {
    iconTile: 'bg-red-50 text-red-600',
    headline: 'text-red-700',
    ring: 'border-red-200',
    dominantBg: 'bg-red-50 border-red-300',
    dominantHeadline: 'text-red-700',
  },
};

export interface ExecMetric {
  label: string;
  value: number | string;
}

export interface ExecutiveCardProps {
  title: string;
  icon: LucideIcon;
  level: ExecLevel;
  headline: string;          // derived status, e.g. "Operating Normally" / "Inventory Health 72%"
  subline?: string;          // supporting sentence
  metrics: ExecMetric[];
  dominant?: boolean;        // Business Risk card — visually dominant
  loading?: boolean;
}

export function ExecutiveCard({ title, icon: Icon, level, headline, subline, metrics, dominant, loading }: ExecutiveCardProps) {
  const s = LEVEL[level];

  return (
    <div
      className={cn(
        'h-full rounded-2xl border p-5 shadow-sm transition-all',
        dominant ? cn('shadow-md', s.dominantBg) : cn('bg-white', s.ring),
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className={cn('grid place-items-center flex-shrink-0 rounded-xl', dominant ? 'h-12 w-12' : 'h-10 w-10', s.iconTile)}>
          <Icon className={dominant ? 'h-6 w-6' : 'h-5 w-5'} />
        </span>
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{title}</p>
      </div>

      {/* Headline status (derived) */}
      {loading ? (
        <Skeleton className="mt-4 h-8 w-3/4" />
      ) : (
        <p className={cn('mt-4 font-bold leading-tight', dominant ? 'text-2xl' : 'text-xl', dominant ? s.dominantHeadline : s.headline)}>
          {headline}
        </p>
      )}
      {subline && !loading && <p className="mt-1 text-sm text-slate-500 leading-snug">{subline}</p>}

      {/* Sub-metrics */}
      <div className={cn('mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4', dominant ? 'border-red-200/60' : 'border-slate-100')}>
        {metrics.map((m) => (
          <div key={m.label} className="min-w-0">
            {loading ? (
              <Skeleton className="h-6 w-12" />
            ) : (
              <p className="text-xl font-bold text-slate-900 tabular-nums leading-none">
                {typeof m.value === 'number' ? m.value.toLocaleString() : m.value}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-500 truncate">{m.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
