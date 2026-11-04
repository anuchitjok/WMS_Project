'use client';

// Section F — Top Low Stock Items. Shared low-stock metric (AVAILABLE units vs
// Product.minStock, else the system default), sorted by shortage. Rows open the
// stock balance report filtered to the SKU.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, PackageSearch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import type { DashboardOverview } from '@/lib/api';
import { balanceHref } from './format';
import { EmptyNote, Panel } from './panel';

export function LowStockItems({ data, loading, warehouseId }: { data: DashboardOverview | null; loading: boolean; warehouseId?: string }) {
  const { m, fmt } = useT();
  const L = m.dashboard.ct.lowStock;
  const router = useRouter();
  const rows = data?.lowStock.top ?? [];

  return (
    <Panel
      title={L.title}
      subtitle={data && data.lowStock.count > 0 ? `${fmt.number(Math.min(rows.length, data.lowStock.count))} / ${fmt.number(data.lowStock.count)}` : undefined}
      icon={PackageSearch}
      className="h-full scroll-mt-20"
      actions={
        <Link href={balanceHref({ warehouseId })} className="flex items-center gap-0.5 text-xs font-medium text-green-700 hover:text-green-800">
          {m.common.actions.viewAll} <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      }
    >
      {loading && !data ? (
        <div className="space-y-1.5">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyNote>{L.empty}</EmptyNote>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="rounded-l-md px-2 py-2 text-left font-semibold">{L.product}</th>
                <th className="px-2 py-2 text-left font-semibold">{L.warehouse}</th>
                <th className="px-2 py-2 text-right font-semibold">{L.current}</th>
                <th className="px-2 py-2 text-right font-semibold">{L.min}</th>
                <th className="px-2 py-2 text-right font-semibold">{L.shortage}</th>
                <th className="rounded-r-md px-2 py-2 text-center font-semibold">{L.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => {
                const where = p.warehouses.length
                  ? p.warehouses.map((w) => w.code ?? m.dashboard.ct.unassigned).join(', ')
                  : L.noStock;
                return (
                  <tr
                    key={p.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => router.push(balanceHref({ warehouseId, q: p.code }))}
                  >
                    <td className="max-w-[200px] px-2 py-2.5">
                      <span className="block truncate font-medium text-slate-800">{p.code}</span>
                      <span className="block truncate text-[11px] text-slate-400" title={p.name}>{p.name}</span>
                    </td>
                    <td className={cn('max-w-[120px] truncate px-2 py-2.5 text-xs', p.warehouses.length ? 'text-slate-600' : 'text-slate-400')} title={where}>{where}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-900">{fmt.number(p.available)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-600" title={p.thresholdSource === 'system' ? L.systemMin : undefined}>
                      {fmt.number(p.minStock)}{p.thresholdSource === 'system' && <span className="text-slate-400">*</span>}
                    </td>
                    <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-red-600">−{fmt.number(p.shortage)}</td>
                    <td className="px-2 py-2.5 text-center">
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', p.severity === 'critical' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700')}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', p.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500')} />
                        {p.severity === 'critical' ? L.critical : L.warning}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.some((p) => p.thresholdSource === 'system') && (
            <p className="mt-2 px-2 text-[11px] text-slate-400">* {L.systemMin}</p>
          )}
        </div>
      )}
    </Panel>
  );
}
