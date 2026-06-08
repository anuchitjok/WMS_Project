'use client';

// Executive Operations Dashboard.
// Live (no feature flag). Uses existing production APIs: /dashboard/kpis,
// /dashboard/inventory-health, /dashboard/activity. No schema/business changes.

import { useEffect, useState, useCallback } from 'react';
import {
  PackagePlus, MapPin, ShieldCheck, Truck, Send, AlertTriangle, RefreshCw,
} from 'lucide-react';
import { dashboardApi, type DashboardKpis, type InventoryHealth, type ActivityEvent } from '@/lib/api';
import { KpiCard, type KpiTone } from '@/components/dashboard/kpi-card';
import { InventoryHealthChart } from '@/components/dashboard/inventory-health-chart';
import { AlertsPanel } from '@/components/dashboard/alerts-panel';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth.store';

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [health, setHealth] = useState<InventoryHealth | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [k, h, a] = await Promise.all([
        dashboardApi.kpis(),
        dashboardApi.inventoryHealth(),
        dashboardApi.activity(15),
      ]);
      setKpis(k); setHealth(h); setActivity(a);
    } catch {
      // handled by api client
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const cards: { label: string; value: number | null; icon: any; tone: KpiTone; href: string }[] = [
    { label: 'Receiving Today',   value: kpis?.todayReceiving   ?? null, icon: PackagePlus,   tone: 'blue',   href: '/receiving' },
    { label: 'Pending Putaway',   value: kpis?.pendingPutaway   ?? null, icon: MapPin,        tone: 'violet', href: '/putaway' },
    { label: 'Pending Approval',  value: kpis?.pendingApproval  ?? null, icon: ShieldCheck,   tone: 'amber',  href: '/approvals' },
    { label: 'Active Fulfillment',value: kpis?.activeFulfillment?? null, icon: Truck,         tone: 'blue',   href: '/outbound/fulfillment' },
    { label: 'Shipment Today',    value: kpis?.shipmentToday    ?? null, icon: Send,          tone: 'green',  href: '/outbound/fulfillment' },
    { label: 'Low Stock Alerts',  value: kpis?.lowStockAlerts   ?? null, icon: AlertTriangle, tone: 'red',    href: '/inventory' },
  ];

  return (
    <div className="p-5 sm:p-6 space-y-5 bg-slate-50 min-h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600">Hightpoint Service Network</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-0.5">Operations Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">
            Welcome back, {user?.fullName} · {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 bg-white" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} /> Refresh
        </Button>
      </div>

      {/* Executive KPI row — desktop 6 / tablet 3 / mobile 2 */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
        {cards.map((c) => (
          <KpiCard key={c.label} label={c.label} value={c.value} icon={c.icon} tone={c.tone} href={c.href} loading={loading} />
        ))}
      </div>

      {/* Inventory Health + Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5 items-stretch">
        <div className="lg:col-span-2">
          <InventoryHealthChart data={health ?? undefined} loading={loading} />
        </div>
        <AlertsPanel
          data={kpis ? { lowStock: kpis.lowStockAlerts, pendingApproval: kpis.pendingApproval, pendingPutaway: kpis.pendingPutaway } : undefined}
          loading={loading}
        />
      </div>

      {/* Operational Activity */}
      <ActivityFeed events={activity} loading={loading} />
    </div>
  );
}
