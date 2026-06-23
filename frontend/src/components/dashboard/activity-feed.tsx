'use client';

// Row 4 — Warehouse Activity Timeline (the operational heartbeat).
// Operational events only (receiving/putaway/approval/picking/packing/shipment/RMA) —
// filtered server-side; domain chips filter client-side over already-fetched data.
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/utils';
import { classifyActivity } from '@/lib/activity-timeline';
import type { ActivityEvent } from '@/lib/api';

const DOMAIN_DOT: Record<string, string> = {
  RECEIVING: 'bg-teal-500', PUTAWAY: 'bg-emerald-500', APPROVAL: 'bg-amber-500',
  FULFILLMENT: 'bg-violet-500', SHIPMENT: 'bg-orange-500', RMA: 'bg-red-500',
  INVENTORY: 'bg-slate-400', OTHER: 'bg-slate-400',
};
const DOMAIN_LABEL: Record<string, string> = {
  RECEIVING: 'Receiving', PUTAWAY: 'Putaway', APPROVAL: 'Approval',
  FULFILLMENT: 'Fulfillment', SHIPMENT: 'Shipment', RMA: 'RMA', INVENTORY: 'Inventory', OTHER: 'Activity',
};

// Priority order matching the warehouse flow.
const DOMAIN_ORDER = ['RECEIVING', 'PUTAWAY', 'FULFILLMENT', 'SHIPMENT', 'RMA', 'APPROVAL', 'INVENTORY', 'OTHER'];

export function ActivityFeed({
  events,
  loading,
  title = 'Warehouse Activity Timeline',
  maxBodyClass = 'max-h-[420px]',
  showFilters = true,
}: {
  events?: ActivityEvent[];
  loading?: boolean;
  title?: string;
  maxBodyClass?: string;
  showFilters?: boolean;
}) {
  const [filter, setFilter] = useState<string>('ALL');

  // Pre-classify once.
  const classified = useMemo(
    () => (events ?? []).map((e) => ({ e, meta: classifyActivity(e.action) })),
    [events],
  );

  // Domains present in the data, in flow order.
  const domains = useMemo(() => {
    const present = new Set<string>(classified.map((c) => c.meta.domain));
    return DOMAIN_ORDER.filter((d) => present.has(d));
  }, [classified]);

  const visible = filter === 'ALL' ? classified : classified.filter((c) => c.meta.domain === filter);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">{title}</h2>
        {showFilters && !loading && domains.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <Chip active={filter === 'ALL'} onClick={() => setFilter('ALL')}>All</Chip>
            {domains.map((d) => (
              <Chip key={d} active={filter === d} onClick={() => setFilter(d)}>
                {DOMAIN_LABEL[d]}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-1">{[...Array(7)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : !visible.length ? (
        <p className="text-sm text-slate-400 py-8 text-center">No recent operational activity</p>
      ) : (
        <ul className={cn('divide-y divide-slate-100 overflow-y-auto', maxBodyClass)}>
          {visible.map(({ e, meta }) => (
            <li key={e.id} className="flex items-center gap-3 py-2.5">
              <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', DOMAIN_DOT[meta.domain])} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-800 capitalize truncate">{meta.label}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 flex-shrink-0">{DOMAIN_LABEL[meta.domain]}</span>
                </div>
                <p className="text-xs text-slate-400 truncate">
                  {e.user?.fullName ?? 'System'}{e.entityType ? ` · ${e.entityType}` : ''}
                </p>
              </div>
              <time className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0 tabular-nums">{formatDate(e.createdAt)}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1 text-xs font-medium transition-colors',
        active ? 'bg-green-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
      )}
    >
      {children}
    </button>
  );
}
