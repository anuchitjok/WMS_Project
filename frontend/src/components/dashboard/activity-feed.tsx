'use client';

// Operational Activity — light enterprise timeline. Operational events only
// (receiving/putaway/approval/picking/packing/shipment/delivery/RMA) — filtered server-side.
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/utils';
import { classifyActivity } from '@/lib/activity-timeline';
import type { ActivityEvent } from '@/lib/api';

const DOMAIN_DOT: Record<string, string> = {
  RECEIVING: 'bg-blue-500', PUTAWAY: 'bg-emerald-500', APPROVAL: 'bg-amber-500',
  FULFILLMENT: 'bg-violet-500', SHIPMENT: 'bg-orange-500', RMA: 'bg-red-500',
  INVENTORY: 'bg-slate-400', OTHER: 'bg-slate-400',
};
const DOMAIN_LABEL: Record<string, string> = {
  RECEIVING: 'Receiving', PUTAWAY: 'Putaway', APPROVAL: 'Approval',
  FULFILLMENT: 'Fulfillment', SHIPMENT: 'Shipment', RMA: 'RMA', INVENTORY: 'Inventory', OTHER: 'Activity',
};

export function ActivityFeed({ events, loading }: { events?: ActivityEvent[]; loading?: boolean }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-4">Operational Activity</h2>
      {loading ? (
        <div className="space-y-1">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : !events?.length ? (
        <p className="text-sm text-slate-400 py-8 text-center">No recent operational activity</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {events.map((e) => {
            const meta = classifyActivity(e.action);
            return (
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
            );
          })}
        </ul>
      )}
    </div>
  );
}
