'use client';

// Executive WMS Operations Center.
// Live (no feature flag). Reuses existing production APIs only:
//   /dashboard/kpis · /dashboard/inventory-health · /dashboard/activity · /dashboard/stats
// No schema, business-logic, endpoint, or workflow changes. All status text is
// DERIVED from these existing metrics (threshold classification only).

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  PackagePlus, MapPin, ShieldCheck, Truck, Send, AlertTriangle, RefreshCw,
  Activity, Boxes, ShieldAlert,
} from 'lucide-react';
import {
  dashboardApi,
  type DashboardKpis, type InventoryHealth, type ActivityEvent,
} from '@/lib/api';
import type { DashboardStats } from '@/types';
import { KpiCard, type KpiTone, type KpiStatus } from '@/components/dashboard/kpi-card';
import { ExecutiveCard, type ExecLevel } from '@/components/dashboard/executive-card';
import { InventoryHealthChart } from '@/components/dashboard/inventory-health-chart';
import { AlertsPanel } from '@/components/dashboard/alerts-panel';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { OpenTasksSummary } from '@/components/dashboard/open-tasks-summary';
import { RecentTransactions } from '@/components/dashboard/recent-transactions';
import { LowStockTable, type LowStockItem } from '@/components/dashboard/low-stock-table';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth.store';
import { useT } from '@/i18n';

// Threshold classifier for backlog/risk metrics (real, value-derived).
const cls = (v: number, warn: number, crit: number): KpiStatus =>
  v > crit ? 'critical' : v > warn ? 'attention' : 'normal';

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { m, t, fmt } = useT();
  const d = m.dashboard;
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [health, setHealth] = useState<InventoryHealth | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [k, h, a, s] = await Promise.all([
        dashboardApi.kpis(),
        dashboardApi.inventoryHealth(),
        dashboardApi.activity(30),
        dashboardApi.stats(),
      ]);
      setKpis(k); setHealth(h); setActivity(a); setStats(s);
    } catch {
      // handled by api client
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Derived executive figures (existing metrics only) ──────────────────────
  const derived = useMemo(() => {
    const k = kpis;
    const h = health;
    const invTotal = h ? h.available + h.reserved + h.picked + h.qcHold + h.rtvPending : 0;
    const healthPct = invTotal > 0 ? Math.round((h!.available / invTotal) * 100) : null;
    const atRisk = h ? h.qcHold + h.rtvPending : 0;
    const riskShare = invTotal > 0 ? atRisk / invTotal : 0;
    const openTasks = k ? k.pendingPutaway + k.pendingApproval + k.activeFulfillment : 0;
    const riskCount = k ? k.lowStockAlerts + k.openReturns : 0;

    // Operations level
    let opsLevel: ExecLevel = 'ok';
    if (k && (k.pendingApproval > 15 || k.pendingPutaway > 25)) opsLevel = 'critical';
    else if (k && (k.pendingApproval + k.pendingPutaway) > 0) opsLevel = 'warn';
    const opsHeadline = opsLevel === 'ok' ? d.exec.opsOk
      : opsLevel === 'warn' ? d.exec.opsWarn
      : d.exec.opsCritical;

    // Inventory level
    let invLevel: ExecLevel = 'ok';
    if (invTotal > 0 && (healthPct! < 50 || riskShare > 0.2)) invLevel = 'critical';
    else if (invTotal > 0 && (healthPct! < 75 || riskShare > 0.1)) invLevel = 'warn';
    const invHeadline = invTotal === 0 ? d.exec.invNoData
      : invLevel === 'critical' ? d.exec.invRisk
      : t(d.exec.invHealth, { pct: healthPct });
    const invSub = invTotal === 0 ? undefined
      : invLevel === 'critical' ? t(d.exec.invSubCritical, { pct: healthPct, count: fmt.number(atRisk) })
      : invLevel === 'warn' ? t(d.exec.invSubWarn, { count: fmt.number(atRisk) })
      : t(d.exec.invSubOk, { available: fmt.number(h!.available), total: fmt.number(invTotal) });

    // Business risk level (dominant)
    let riskLevel: ExecLevel = 'ok';
    if (k && (k.lowStockAlerts > 10 || riskCount > 10)) riskLevel = 'critical';
    else if (riskCount > 0) riskLevel = 'warn';
    const riskHeadline = riskLevel === 'ok' ? d.exec.riskOk
      : riskLevel === 'warn' ? t(d.exec.riskWarn, { count: riskCount })
      : d.exec.riskCritical;
    const riskSub = k ? t(d.exec.riskSub, { low: k.lowStockAlerts, exceptions: k.openReturns }) : undefined;

    return { invTotal, healthPct, openTasks, riskCount, opsLevel, opsHeadline,
      invLevel, invHeadline, invSub, riskLevel, riskHeadline, riskSub };
  }, [kpis, health, d, t, fmt]);

  const lowStockItems = (stats?.lowStockAlerts ?? []) as unknown as LowStockItem[];

  // Row 2 KPI cards with threshold status indicators.
  const cards: { label: string; value: number | null; icon: typeof PackagePlus; tone: KpiTone; href: string; status: KpiStatus }[] = [
    { label: d.metrics.receivingToday, value: kpis?.todayReceiving    ?? null, icon: PackagePlus,   tone: 'blue',   href: '/receiving',            status: 'normal' },
    { label: d.metrics.pendingPutaway, value: kpis?.pendingPutaway    ?? null, icon: MapPin,        tone: 'blue',   href: '/putaway',              status: cls(kpis?.pendingPutaway ?? 0, 0, 25) },
    { label: d.metrics.pendingApproval, value: kpis?.pendingApproval   ?? null, icon: ShieldCheck,   tone: 'blue',   href: '/approvals',            status: cls(kpis?.pendingApproval ?? 0, 0, 15) },
    { label: d.metrics.activeFulfillment, value: kpis?.activeFulfillment ?? null, icon: Truck,         tone: 'blue',   href: '/outbound/fulfillment', status: 'normal' },
    { label: d.metrics.shipmentToday, value: kpis?.shipmentToday     ?? null, icon: Send,          tone: 'blue',   href: '/outbound/fulfillment', status: 'normal' },
    { label: d.metrics.criticalAlerts, value: kpis?.lowStockAlerts    ?? null, icon: AlertTriangle, tone: 'red',    href: '/reports?tab=balance',          status: cls(kpis?.lowStockAlerts ?? 0, 0, 10) },
  ];

  return (
    <div className="p-4 sm:p-5 space-y-4 bg-slate-50 min-h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600">{d.company}</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-0.5">{d.title}</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {t(d.welcome, { name: user?.fullName ?? '' })} · {fmt.dateLong(new Date())}
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 bg-white" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} /> {m.common.actions.refresh}
        </Button>
      </div>

      {/* ROW 1 — Executive Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ExecutiveCard
          title={d.exec.operations} icon={Activity} level={derived.opsLevel}
          headline={derived.opsHeadline}
          subline={t(d.exec.openTasksAcross, { count: fmt.number(derived.openTasks) })}
          loading={loading}
          metrics={[
            { label: d.metrics.openTasks, value: derived.openTasks },
            { label: d.metrics.activeFulfillment, value: kpis?.activeFulfillment ?? 0 },
            { label: d.metrics.pendingPutaway, value: kpis?.pendingPutaway ?? 0 },
            { label: d.metrics.pendingApproval, value: kpis?.pendingApproval ?? 0 },
          ]}
        />
        <ExecutiveCard
          title={d.exec.inventory} icon={Boxes} level={derived.invLevel}
          headline={derived.invHeadline} subline={derived.invSub}
          loading={loading}
          metrics={[
            { label: d.metrics.available, value: health?.available ?? 0 },
            { label: d.metrics.reserved, value: health?.reserved ?? 0 },
            { label: d.metrics.qcHold, value: health?.qcHold ?? 0 },
            { label: d.metrics.rtvPending, value: health?.rtvPending ?? 0 },
          ]}
        />
        <ExecutiveCard
          title={d.exec.risk} icon={ShieldAlert} level={derived.riskLevel} dominant
          headline={derived.riskHeadline} subline={derived.riskSub}
          loading={loading}
          metrics={[
            { label: d.metrics.lowStockAlerts, value: kpis?.lowStockAlerts ?? 0 },
            { label: d.metrics.inventoryExceptions, value: kpis?.openReturns ?? 0 },
          ]}
        />
      </div>

      {/* ROW 2 — KPI Operations Bar */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
        {cards.map((c) => (
          <KpiCard key={c.label} label={c.label} value={c.value} icon={c.icon} tone={c.tone} status={c.status} href={c.href} loading={loading} />
        ))}
      </div>

      {/* ROW 3 — Critical Alert Center + Inventory Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
        <AlertsPanel
          data={kpis ? { lowStock: kpis.lowStockAlerts, pendingApproval: kpis.pendingApproval, pendingPutaway: kpis.pendingPutaway, inventoryExceptions: kpis.openReturns } : undefined}
          loading={loading}
        />
        <div className="lg:col-span-2">
          <InventoryHealthChart data={health ?? undefined} loading={loading} />
        </div>
      </div>

      {/* ROW 4 — Warehouse Activity Timeline (operational heartbeat) */}
      <ActivityFeed events={activity} loading={loading} />

      {/* ROW 5 — Workload & Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        <OpenTasksSummary
          data={kpis ? { pendingPutaway: kpis.pendingPutaway, pendingApproval: kpis.pendingApproval, activeFulfillment: kpis.activeFulfillment, shipmentQueue: kpis.shipmentToday } : undefined}
          loading={loading}
        />
        <RecentTransactions logs={stats?.recentAuditLogs} loading={loading} />
      </div>

      {/* ROW 7 — Inventory Risk Monitoring (rendered only when low-stock data exists) */}
      {(loading || lowStockItems.length > 0) && (
        <div className="grid grid-cols-1 gap-4">
          <LowStockTable items={lowStockItems} loading={loading} />
        </div>
      )}
    </div>
  );
}
