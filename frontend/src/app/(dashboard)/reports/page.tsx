'use client';

import { useEffect, useState, useCallback } from 'react';
import { BarChart3, Clock, AlertTriangle, RotateCcw, TrendingDown } from 'lucide-react';
import { reportsApi } from '@/lib/api';
import { StatCard } from '@/components/dashboard/stat-card';
import { PageHeader } from '@/components/layout/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

export default function ReportsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await reportsApi.summary()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Reports & Dashboard" subtitle="Inventory, RMA, RTV, SLA and audit reports" icon={BarChart3} />

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard title="Request SLA" value={`${data?.kpis.slaRate ?? 0}%`} icon={Clock} color="green" subtitle="Completed within target" />
          <StatCard title="DOA Rate" value={`${data?.kpis.doaRate ?? 0}%`} icon={AlertTriangle} color="red" subtitle="DOA / damaged ratio" />
          <StatCard title="Open RTV" value={data?.kpis.openRtv ?? 0} icon={RotateCcw} color="yellow" subtitle="Vendor return cases" />
          <StatCard title="Low Stock" value={data?.kpis.lowStockCount ?? 0} icon={TrendingDown} color="blue" subtitle="Below safety stock" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Stock by Ownership</h2>
          {loading ? <Skeleton className="h-32" /> : (
            <div className="space-y-2">
              {data?.stockByOwnership?.map((o: any) => (
                <div key={o.ownershipType} className="flex items-center justify-between text-sm">
                  <Badge variant="outline">{o.ownershipType}</Badge>
                  <span className="font-semibold text-slate-700">{o._sum.quantity ?? 0} units · {o._count._all} items</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Low Stock Alerts</h2>
          {loading ? <Skeleton className="h-32" /> : data?.lowStockItems?.length === 0 ? (
            <p className="text-sm text-slate-400">No low stock items 🎉</p>
          ) : (
            <div className="space-y-2">
              {data?.lowStockItems?.map((p: any) => (
                <div key={p.code} className="flex items-center justify-between text-sm">
                  <div><span className="font-medium text-slate-800">{p.name}</span> <span className="text-xs text-slate-400">{p.code}</span></div>
                  <Badge className="bg-red-100 text-red-700" variant="outline">{p.onHand} / min {p.minStock}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
