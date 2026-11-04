'use client';

// Phase 3: one timeline for a GR, WR, FT, shipment or serial number.
import { useState } from 'react';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { auditApi, type TimelineResponse } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/utils';
import { ChangesList } from './changes-list';

const ENTITY_LABEL: Record<string, string> = {
  GoodsReceiving: 'Receiving', WithdrawalRequest: 'Request', FulfillmentTask: 'Fulfillment',
  Shipment: 'Shipment', StockItem: 'Stock unit',
};

export function TransactionTimeline({ humanAction }: { humanAction: (a: string) => string }) {
  const [ref, setRef] = useState('');
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (ref.trim().length < 3) { toast.error('Enter at least 3 characters'); return; }
    setLoading(true);
    try { setData(await auditApi.timeline(ref.trim())); }
    catch (err: any) { toast.error(err.message ?? 'Search failed'); setData(null); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={search} className="flex flex-wrap items-end gap-3 bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="space-y-1 flex-1 min-w-[240px]">
          <label htmlFor="timeline-ref" className="text-xs text-slate-500">GR, WR, FT, shipment or serial number (exact)</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input id="timeline-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. WR-2026-TIWNMX or SN12345" className="pl-8" />
          </div>
        </div>
        <Button type="submit" disabled={loading} className="bg-green-600 hover:bg-green-700 text-white">Show timeline</Button>
      </form>

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
      ) : data && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-sm text-slate-600">
            {data.matches.length === 0
              ? <>No GR, WR, FT, shipment or serial matches <b>{data.query}</b>.</>
              : <>Found {data.matches.map((m) => `${m.type} ${m.ref}`).join(', ')} · {data.events.length} event{data.events.length === 1 ? '' : 's'}{data.truncated ? ' (first 500 shown)' : ''}</>}
          </div>
          {data.events.length > 0 && (
            <ol className="divide-y divide-slate-100">
              {data.events.map((ev) => (
                <li key={ev.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4">
                  <span className="text-xs text-slate-500 whitespace-nowrap sm:w-40 shrink-0">{formatDate(ev.at)}</span>
                  <span className="text-xs rounded bg-slate-100 text-slate-600 px-1.5 py-0.5 whitespace-nowrap self-start">
                    {ENTITY_LABEL[ev.entityType ?? ''] ?? ev.entityType ?? '—'}{ev.ref ? ` · ${ev.ref}` : ''}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">{humanAction(ev.action)}</p>
                    {ev.detail && <p className="text-xs text-slate-600 break-words">{ev.detail}</p>}
                    <ChangesList changes={ev.changes} />
                  </div>
                  <span className="text-xs text-slate-500 whitespace-nowrap">{ev.user}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
