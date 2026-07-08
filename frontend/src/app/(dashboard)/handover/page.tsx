'use client';

import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { toast } from 'sonner';
import { fulfillmentApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { REQUEST_STATUS_COLORS } from '@/lib/utils';
import type { RequestStatus } from '@/types';

export default function HandoverPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Task currently being handed over (drives the confirmation modal).
  const [confirmTarget, setConfirmTarget] = useState<any | null>(null);
  const [receiver, setReceiver] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await fulfillmentApi.handoverQueue()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function openConfirm(r: any) {
    setConfirmTarget(r);
    setReceiver(r.requester?.fullName ?? '');
  }

  async function confirmHandover() {
    if (!confirmTarget) return;
    const name = receiver.trim();
    if (!name) { toast.error('Please enter the receiver name'); return; }
    setBusy(true);
    try {
      await fulfillmentApi.issueToRma(confirmTarget.id, { receiver: name });
      toast.success('Handover confirmed — issued to RMA');
      setConfirmTarget(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Handover Confirmation" subtitle="Receiver confirmation and issue to RMA" icon={CheckCircle2} />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">Request</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Receiver</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Items</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Action</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(5)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">No items awaiting handover</td></tr>
              : rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-green-700">{r.refNumber}</td>
                  <td className="px-4 py-3 text-slate-700">{r.requester?.fullName}</td>
                  <td className="px-4 py-3 text-slate-600">{r.items?.length ?? 0}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className={REQUEST_STATUS_COLORS[r.status as RequestStatus]}>{r.status.replace(/_/g, ' ')}</Badge></td>
                  <td className="px-4 py-3"><Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white" onClick={() => openConfirm(r)}>Confirm Handover</Button></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Confirmation modal — handover issues stock to RMA and cannot be undone */}
      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setConfirmTarget(null)}>
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="font-semibold text-slate-900">Confirm handover · {confirmTarget.refNumber}</h3>
              <button className="text-slate-400 hover:text-slate-700" onClick={() => setConfirmTarget(null)}><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <p className="text-sm text-slate-600">
                Issuing <span className="font-medium text-slate-800">{confirmTarget.items?.length ?? 0} item(s)</span> to RMA.
                This records physical handover and cannot be undone.
              </p>
              <div className="space-y-1">
                <label className="block text-sm text-slate-600">Receiver name <span className="text-red-500">*</span></label>
                <Input value={receiver} onChange={(e) => setReceiver(e.target.value)} placeholder="Person receiving the goods" />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <Button variant="outline" size="sm" onClick={() => setConfirmTarget(null)}>Cancel</Button>
              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" disabled={busy} onClick={confirmHandover}>Confirm handover</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
