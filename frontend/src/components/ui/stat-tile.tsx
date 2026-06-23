import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

export type StatTileTone = 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'cyan';

interface StatTileProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: StatTileTone;
  className?: string;
}

const TONES: Record<StatTileTone, { bg: string; border: string; label: string; value: string; icon: string }> = {
  slate: { bg: 'bg-white', border: 'border-slate-200', label: 'text-slate-500', value: 'text-slate-900', icon: 'text-slate-400' },
  green: { bg: 'bg-green-50', border: 'border-green-200', label: 'text-green-700', value: 'text-green-800', icon: 'text-green-500' },
  amber: { bg: 'bg-amber-50', border: 'border-amber-200', label: 'text-amber-700', value: 'text-amber-800', icon: 'text-amber-500' },
  red: { bg: 'bg-red-50', border: 'border-red-200', label: 'text-red-700', value: 'text-red-800', icon: 'text-red-500' },
  blue: { bg: 'bg-blue-50', border: 'border-blue-200', label: 'text-blue-700', value: 'text-blue-800', icon: 'text-blue-500' },
  cyan: { bg: 'bg-cyan-50', border: 'border-cyan-200', label: 'text-cyan-700', value: 'text-cyan-800', icon: 'text-cyan-500' },
};

/**
 * Reusable KPI / workload tile — tinted card with icon, label and value.
 * Generic across pages; `tone` carries the semantic meaning.
 */
export function StatTile({ label, value, icon: Icon, tone = 'slate', className }: StatTileProps) {
  const t = TONES[tone];
  return (
    <div className={cn('rounded-xl border p-4 flex items-center gap-3 shadow-sm', t.bg, t.border, className)}>
      <div className={cn('rounded-lg border bg-white/70 p-2 flex-shrink-0', t.border)}>
        <Icon className={cn('h-5 w-5', t.icon)} />
      </div>
      <div className="min-w-0">
        <p className={cn('text-xs font-medium truncate', t.label)}>{label}</p>
        <p className={cn('text-2xl font-bold leading-tight', t.value)}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
      </div>
    </div>
  );
}
