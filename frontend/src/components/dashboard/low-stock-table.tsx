'use client';

// Row 7 (Left) — Top Low Stock SKU. Reuses existing /dashboard/stats.lowStockAlerts
// (per-product available vs minStock). Read-only.
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronRight } from 'lucide-react';
import { useT } from '@/i18n';

export interface LowStockItem {
  id: string;
  code: string;
  name: string;
  available: number;
  minStock: number;
}

export function LowStockTable({ items, loading, limit = 6 }: { items?: LowStockItem[]; loading?: boolean; limit?: number }) {
  const { m } = useT();
  const L = m.dashboard.lowStock;
  const rows = [...(items ?? [])]
    .sort((a, b) => (b.minStock - b.available) - (a.minStock - a.available))
    .slice(0, limit);

  return (
    <div className="h-full bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">{L.title}</h2>
        <Link href="/reports?tab=balance" className="text-xs font-medium text-green-600 hover:text-green-700 flex items-center gap-0.5">
          {m.common.actions.viewAll} <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      {loading ? (
        <div className="space-y-1">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : !rows.length ? (
        <p className="text-sm text-slate-400 py-8 text-center">{L.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <th className="pb-2 pr-2 font-semibold">{L.skuProduct}</th>
                <th className="pb-2 px-2 text-right font-semibold">{L.avail}</th>
                <th className="pb-2 px-2 text-right font-semibold" title={L.minHint}>{L.min}</th>
                <th className="pb-2 pl-2 text-right font-semibold">{L.gap}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => {
                const gap = p.minStock - p.available;
                return (
                  <tr key={p.id} className="hover:bg-red-50/40">
                    <td className="py-2 pr-2 min-w-0">
                      <p className="font-mono text-xs font-bold text-slate-800">{p.code}</p>
                      <p className="text-xs text-slate-400 truncate max-w-[16rem]">{p.name}</p>
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums font-semibold text-red-600">{p.available}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-slate-500">{p.minStock}</td>
                    <td className="py-2 pl-2 text-right">
                      <span className={cn('inline-block rounded-md px-2 py-0.5 text-xs font-bold tabular-nums',
                        gap > 0 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500')}>
                        −{gap}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
