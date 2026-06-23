'use client';

import { useEffect, useState, useCallback } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { notifApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatDate } from '@/lib/utils';

const TYPE_ICONS: Record<string, string> = {
  REQUEST_SUBMITTED: '📋', REQUEST_APPROVED: '✅', REQUEST_REJECTED: '❌',
  PICKING_TASK: '📦', READY_FOR_PICKUP: '🚚', USAGE_REQUIRED: '🔔',
  DOA_DECLARED: '⚠️', RTV_OVERDUE: '⏱', UNUSED_RETURN: '🔁',
  LOW_STOCK: '↓', SLA_OVERDUE: '⏰', GENERAL: '💬',
};

export default function NotificationsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await notifApi.list(page, 20)); } finally { setLoading(false); }
  }, [page]);
  useEffect(() => { load(); }, [load]);

  async function readAll() { try { await notifApi.markAllRead(); toast.success('All marked as read'); load(); } catch (e: any) { toast.error(e.message); } }
  async function read(id: string) { await notifApi.markRead(id).catch(() => {}); load(); }

  return (
    <div className="p-6 space-y-5 max-w-3xl mx-auto">
      <PageHeader title="Notifications" subtitle="All system alerts and workflow updates" icon={Bell}
        action={data?.unread > 0 ? <Button variant="outline" onClick={readAll}><CheckCheck className="h-4 w-4 mr-2" />Mark all read</Button> : undefined}
      />

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
        {loading ? [...Array(6)].map((_, i) => <div key={i} className="p-4"><Skeleton className="h-12" /></div>)
          : !data?.data?.length ? <div className="p-12 text-center text-slate-400"><Bell className="h-10 w-10 mx-auto mb-3 opacity-20" /><p>No notifications</p></div>
          : data.data.map((n: any) => (
            <div key={n.id} onClick={() => read(n.id)}
              className={cn('flex gap-4 p-4 hover:bg-slate-50 cursor-pointer transition-colors', !n.isRead && 'bg-green-50/30 border-l-4 border-green-500')}>
              <span className="text-xl flex-shrink-0 mt-0.5">{TYPE_ICONS[n.type] ?? '💬'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className={cn('text-sm', !n.isRead ? 'font-semibold text-slate-800' : 'text-slate-600')}>{n.title}</p>
                  <p className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0">{formatDate(n.createdAt)}</p>
                </div>
                <p className="text-sm text-slate-500 mt-0.5">{n.message}</p>
                {n.entityType && <Badge variant="outline" className="text-[10px] mt-1">{n.entityType}</Badge>}
              </div>
              {!n.isRead && <div className="h-2.5 w-2.5 rounded-full bg-green-500 flex-shrink-0 mt-1.5" />}
            </div>
          ))}
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">Page {data.page} of {data.totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
