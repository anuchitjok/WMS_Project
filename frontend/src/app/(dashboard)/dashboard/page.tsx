'use client';

import { useEffect, useState, useCallback } from 'react';
import { Package, ClipboardList, BarChart3, Boxes } from 'lucide-react';
import { dashboardApi } from '@/lib/api';
import type { DashboardStats } from '@/types';
import { StatCard } from '@/components/dashboard/stat-card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/utils';
import { STOCK_STATUS_COLORS } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await dashboardApi.stats();
      setStats(data);
    } catch {
      // handled by api client
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">
          Welcome back, {user?.fullName} · {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* KPI Cards */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard title="Total Stock Items" value={stats?.totals.totalStock ?? 0} icon={Boxes} color="blue" />
          <StatCard title="Available Stock" value={stats?.totals.availableStock ?? 0} icon={Package} color="green" />
          <StatCard title="Pending Requests" value={stats?.totals.pendingRequests ?? 0} icon={ClipboardList} color="yellow" />
          <StatCard title="Active Products" value={stats?.totals.totalProducts ?? 0} icon={BarChart3} color="blue" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Stock by Status */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Stock by Status</h2>
          {loading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-6" />)}</div>
          ) : (
            <div className="space-y-2">
              {stats?.stockByStatus.map((s) => (
                <div key={s.status} className="flex items-center justify-between">
                  <Badge className={STOCK_STATUS_COLORS[s.status]} variant="outline">
                    {s.status.replace(/_/g, ' ')}
                  </Badge>
                  <span className="text-sm font-semibold text-slate-700">{s._count._all}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Recent Activity</h2>
          {loading ? (
            <div className="space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <div className="space-y-3 divide-y divide-slate-100">
              {stats?.recentAuditLogs.slice(0, 8).map((log) => (
                <div key={log.id} className="pt-3 first:pt-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {log.action.replace(/_/g, ' ')}
                      </p>
                      <p className="text-xs text-slate-400">
                        {log.user?.fullName ?? 'System'} · {log.entityType}
                      </p>
                    </div>
                    <p className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
                      {formatDate(log.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
