'use client';

// Row 5 (Right) — Recent Transactions. Reuses existing /dashboard/stats recentAuditLogs
// (the raw latest warehouse audit entries). Read-only.
import { cn } from '@/lib/utils';
import { Skeleton, } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/utils';
import { classifyActivity } from '@/lib/activity-timeline';
import type { AuditLog } from '@/types';

const DOMAIN_DOT: Record<string, string> = {
  RECEIVING: 'bg-teal-500', PUTAWAY: 'bg-emerald-500', APPROVAL: 'bg-amber-500',
  FULFILLMENT: 'bg-violet-500', SHIPMENT: 'bg-orange-500', RMA: 'bg-red-500',
  INVENTORY: 'bg-slate-400', OTHER: 'bg-slate-300',
};

export function RecentTransactions({ logs, loading }: { logs?: AuditLog[]; loading?: boolean }) {
  return (
    <div className="h-full bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-4">Recent Transactions</h2>
      {loading ? (
        <div className="space-y-1">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-11" />)}</div>
      ) : !logs?.length ? (
        <p className="text-sm text-slate-400 py-8 text-center">No recent transactions</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {logs.map((l) => {
            const meta = classifyActivity(l.action);
            return (
              <li key={l.id} className="flex items-center gap-3 py-2.5">
                <span className={cn('w-2 h-2 rounded-full flex-shrink-0', DOMAIN_DOT[meta.domain] ?? 'bg-slate-300')} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 capitalize truncate">{meta.label}</p>
                  <p className="text-xs text-slate-400 truncate">
                    {l.user?.fullName ?? 'System'}{l.entityType ? ` · ${l.entityType}` : ''}
                  </p>
                </div>
                <time className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0 tabular-nums">{formatDate(l.createdAt)}</time>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
