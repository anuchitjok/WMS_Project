'use client';

// Dashboard V2 — role-aware KPI grid. Renders only cards permitted for the
// current user's role. Responsive: 1 / 2 / 4 columns.
import { KpiCard, type KpiCardProps } from './kpi-card';
import { useAuthStore } from '@/store/auth.store';
import type { UserRole } from '@/types';

export interface KpiGridItem extends KpiCardProps {
  /** if set, only these roles see the card; omit = visible to all */
  roles?: UserRole[];
}

export function KpiGrid({ items, loading }: { items: KpiGridItem[]; loading?: boolean }) {
  const user = useAuthStore((s) => s.user);
  const visible = items.filter((it) => !it.roles || (user && it.roles.includes(user.role)));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {visible.map((it) => (
        <KpiCard key={it.label} {...it} loading={loading ?? it.loading} />
      ))}
    </div>
  );
}
