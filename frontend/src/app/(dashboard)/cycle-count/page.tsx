'use client';

import { useEffect, useState, useCallback } from 'react';
import { Calculator } from 'lucide-react';
import { toast } from 'sonner';
import { cycleCountApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { RetiredNotice } from '@/components/layout/retired-notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/utils';

const ACTIVE = ['OPEN', 'IN_PROGRESS', 'REVIEW'];

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-slate-100 text-slate-700', IN_PROGRESS: 'bg-yellow-100 text-yellow-800',
  REVIEW: 'bg-orange-100 text-orange-800', APPROVED: 'bg-green-100 text-green-700',
  CLOSED: 'bg-slate-200 text-slate-600', CANCELLED: 'bg-red-100 text-red-700',
};

export default function CycleCountPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setSessions(await cycleCountApi.list()); } catch { setSessions([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Phase 2: Cycle Count is retired. New sessions, counting, submit and approve
  // answer 410. Cancel is kept: it is the audited way to end an old count and
  // release the stock rows it locks (no variance is applied).
  async function loadSession(id: string) {
    try { setSelected(await cycleCountApi.get(id)); } catch (e: any) { toast.error(e.message); }
  }

  async function cancelSession() {
    if (!window.confirm('Cancel this count? Counted stock is unlocked and no variance is applied.')) return;
    try { await cycleCountApi.cancel(selected.id); toast.success('Count cancelled — stock unlocked'); setSelected(await cycleCountApi.get(selected.id)); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Cycle Count (history)" subtitle="Past count sessions and their variances" icon={Calculator} />
      <RetiredNotice feature="Cycle Count"
        extra={sessions.some((x) => ACTIVE.includes(x.status))
          ? <p className="text-amber-700">An unfinished count still locks its stock rows. Open it and use <b>Cancel</b> to release them. No variance is applied.</p>
          : undefined} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Session list */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <h3 className="font-semibold text-slate-700 text-sm">Sessions ({sessions.length})</h3>
          </div>
          <div className="divide-y divide-slate-50 max-h-[60vh] overflow-y-auto">
            {loading ? [...Array(3)].map((_, i) => <div key={i} className="p-3"><Skeleton className="h-10" /></div>)
              : sessions.length === 0 ? <p className="p-8 text-center text-slate-400 text-sm">No sessions</p>
              : sessions.map((s) => (
                <div key={s.id} onClick={() => loadSession(s.id)}
                  className={`p-3 cursor-pointer hover:bg-slate-50 transition-colors ${selected?.id === s.id ? 'bg-green-50 border-l-4 border-green-500' : ''}`}>
                  <p className="font-mono text-xs font-semibold text-green-700">{s.refNumber}</p>
                  <div className="flex items-center justify-between mt-1">
                    <Badge variant="outline" className={STATUS_COLORS[s.status]}>{s.status}</Badge>
                    <span className="text-xs text-slate-400">{s._count?.lines ?? 0} lines</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{formatDate(s.createdAt)}</p>
                </div>
              ))}
          </div>
        </div>

        {/* Count execution */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {!selected ? (
            <div className="flex items-center justify-center h-64 text-slate-400">
              <div className="text-center"><Calculator className="h-10 w-10 mx-auto mb-3 opacity-20" /><p className="text-sm">Select a session to begin counting</p></div>
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-slate-800">{selected.refNumber}</h3>
                  <p className="text-xs text-slate-400">
                    {selected.summary?.counted}/{selected.summary?.total} counted · {selected.summary?.varianceCount} variances
                    {selected.summary?.excluded ? ` · ${selected.summary.excluded} excluded` : ''}
                    {['OPEN', 'IN_PROGRESS', 'REVIEW'].includes(selected.status) && ' · counted stock is locked'}
                  </p>
                </div>
                <div className="flex gap-2">
                  {ACTIVE.includes(selected.status) && <Button size="sm" variant="outline" onClick={cancelSession}>Cancel count &amp; release stock</Button>}
                </div>
              </div>
              <div className="overflow-x-auto max-h-[55vh] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="border-b border-slate-100">
                      <th className="text-left px-3 py-2 font-medium text-slate-600">Product</th>
                      <th className="text-left px-3 py-2 font-medium text-slate-600">Location</th>
                      <th className="text-center px-3 py-2 font-medium text-slate-600">Expected</th>
                      <th className="text-center px-3 py-2 font-medium text-slate-600">Counted</th>
                      <th className="text-center px-3 py-2 font-medium text-slate-600">Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {selected.lines?.map((l: any) => (
                      <tr key={l.id} className={l.excludedAt ? 'opacity-50' : l.conflictReason ? 'bg-amber-50/60' : l.variance !== 0 && l.countedQty !== null ? 'bg-red-50/50' : ''}>
                        <td className="px-3 py-2 text-sm text-slate-700">
                          {l.productName ?? l.productCode ?? l.productId.slice(-8)}
                          {l.productCode && l.productName && <span className="block text-xs text-slate-400 font-mono">{l.productCode}</span>}
                          {l.conflictReason && <span className="block text-xs text-amber-700">{l.conflictReason}</span>}
                          {l.excludedAt && <span className="block text-xs text-slate-500">{l.notes ?? 'Excluded from count'}</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-500">{l.locationKey || '—'}</td>
                        <td className="px-3 py-2 text-center font-medium">{l.expectedQty}</td>
                        <td className="px-3 py-2 text-center">
                          {l.excludedAt || l.countedQty === null ? <span className="text-slate-400">—</span> : <span className="font-medium">{l.countedQty}</span>}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {l.countedQty !== null && (
                            <span className={l.variance === 0 ? 'text-green-600' : 'text-red-600 font-semibold'}>
                              {l.variance > 0 ? '+' : ''}{l.variance ?? '—'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
