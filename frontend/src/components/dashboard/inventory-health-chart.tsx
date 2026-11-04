'use client';

// Inventory Health — light enterprise styling: clean stacked bar + aligned legend.
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { InventoryHealth } from '@/lib/api';
import { useT } from '@/i18n';

const SEGMENTS: { key: keyof InventoryHealth; bar: string; dot: string }[] = [
  { key: 'available',  bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
  { key: 'reserved',   bar: 'bg-teal-500',    dot: 'bg-teal-500' },
  { key: 'picked',     bar: 'bg-violet-500',  dot: 'bg-violet-500' },
  { key: 'qcHold',     bar: 'bg-amber-500',   dot: 'bg-amber-500' },
  { key: 'rtvPending', bar: 'bg-red-500',     dot: 'bg-red-500' },
];

export function InventoryHealthChart({ data, loading }: { data?: InventoryHealth; loading?: boolean }) {
  const { m, t, fmt } = useT();
  const d = m.dashboard;
  const total = data ? SEGMENTS.reduce((s, seg) => s + (data[seg.key] || 0), 0) : 0;

  return (
    <div className="h-full bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">{d.health.title}</h2>
        {!loading && <span className="text-xs font-medium text-slate-400">{t(d.health.units, { count: fmt.number(total) })}</span>}
      </div>

      {loading ? (
        <Skeleton className="h-2.5 w-full rounded-full" />
      ) : total === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center">{d.health.noData}</p>
      ) : (
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 gap-px">
          {SEGMENTS.map((seg) => {
            const v = data![seg.key] || 0;
            const pct = (v / total) * 100;
            return pct > 0 ? <div key={seg.key} className={cn('h-full first:rounded-l-full last:rounded-r-full', seg.bar)} style={{ width: `${pct}%` }} title={`${d.metrics[seg.key]}: ${fmt.number(v)}`} /> : null;
          })}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-4 mt-6">
        {SEGMENTS.map((seg) => (
          <div key={seg.key} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', seg.dot)} />
              <span className="text-xs font-medium text-slate-500 truncate">{d.metrics[seg.key]}</span>
            </div>
            {loading ? <Skeleton className="h-7 w-10" /> : <span className="text-2xl font-bold text-slate-900 tabular-nums leading-none">{fmt.number(data?.[seg.key] ?? 0)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
