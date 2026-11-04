'use client';

// Global Approval Workspace.
// Canonical home for request approvals (moved from /approval, which now redirects here).
// Governance surface — decisions are recorded by the backend approval flow.

import { useEffect, useState, useCallback } from 'react';
import { ShieldCheck, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { requestsApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { REQUEST_STATUS_COLORS } from '@/lib/utils';
import type { RequestStatus } from '@/types';
import { labelOf, useT } from '@/i18n';

export default function ApprovalsWorkspacePage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Request currently being rejected (drives the reason modal).
  const [rejectTarget, setRejectTarget] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const { m, t } = useT();
  const A = m.approvals;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [submitted, pending] = await Promise.all([
        requestsApi.list({ status: 'SUBMITTED', limit: 50 }),
        requestsApi.list({ status: 'PENDING_APPROVAL', limit: 50 }),
      ]);
      setRows([...submitted.data, ...pending.data]);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function approve(id: string) {
    setBusyId(id);
    try {
      await requestsApi.approve(id, true);
      toast.success(A.toast.approved);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setBusyId(null); }
  }

  async function confirmReject() {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (!reason) { toast.error(A.toast.reasonRequired); return; }
    setBusyId(rejectTarget.id);
    try {
      await requestsApi.approve(rejectTarget.id, false, reason);
      toast.success(A.toast.rejected);
      setRejectTarget(null);
      setRejectReason('');
      load();
    } catch (e: any) { toast.error(e.message); } finally { setBusyId(null); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title={A.title} subtitle={A.subtitle} icon={ShieldCheck} />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 bg-slate-50">
            <th className="text-left px-4 py-3 text-xs uppercase tracking-wide font-medium text-slate-500">{A.col.request}</th>
            <th className="text-left px-4 py-3 text-xs uppercase tracking-wide font-medium text-slate-500">{A.col.requester}</th>
            <th className="text-left px-4 py-3 text-xs uppercase tracking-wide font-medium text-slate-500">{A.col.rma}</th>
            <th className="text-left px-4 py-3 text-xs uppercase tracking-wide font-medium text-slate-500">{A.col.stockCheck}</th>
            <th className="text-left px-4 py-3 text-xs uppercase tracking-wide font-medium text-slate-500">{A.col.status}</th>
            <th className="text-left px-4 py-3 text-xs uppercase tracking-wide font-medium text-slate-500">{A.col.action}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">{A.empty}</td></tr>
              : rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-green-700">{r.refNumber}</td>
                  <td className="px-4 py-3 text-slate-700">{r.requester?.fullName}<br /><span className="text-xs text-slate-400">{r.department}</span></td>
                  <td className="px-4 py-3 text-slate-600">{r.rmaCaseNumber ?? '—'}</td>
                  <td className="px-4 py-3">
                    {r.stockOk ? (
                      <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 gap-1">
                        <CheckCircle2 className="h-3 w-3" /> {A.stockAvailable}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-amber-200 bg-amber-50 text-amber-700 gap-1"
                        title={(r.stockShortages ?? []).map((s: any) => t(A.shortLine, { name: s.productName, need: s.requested, have: s.available })).join('\n')}
                      >
                        <AlertTriangle className="h-3 w-3" /> {t(A.short, { count: r.stockShortages?.length ?? 0 })}
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3"><Badge variant="outline" className={REQUEST_STATUS_COLORS[r.status as RequestStatus]}>{labelOf(m.status.request, r.status)}</Badge></td>
                  <td className="px-4 py-3 space-x-1 whitespace-nowrap">
                    <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white" disabled={busyId === r.id} onClick={() => approve(r.id)}>{A.approve}</Button>
                    <Button size="sm" variant="outline" className="h-7 text-red-600 border-red-200" disabled={busyId === r.id} onClick={() => { setRejectTarget(r); setRejectReason(''); }}>{A.reject}</Button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Reject-reason modal — the reason is recorded and shown to the requester */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setRejectTarget(null)}>
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="font-semibold text-slate-900">{t(A.rejectTitle, { ref: rejectTarget.refNumber })}</h3>
              <button className="text-slate-400 hover:text-slate-700" onClick={() => setRejectTarget(null)} aria-label={m.common.actions.close}><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <label className="block text-sm text-slate-600">{A.reasonLabel} <span className="text-red-500">*</span></label>
              <textarea
                autoFocus
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder={A.reasonPlaceholder}
                className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
              />
              <p className="text-xs text-slate-400">{A.reasonHint}</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <Button variant="outline" size="sm" onClick={() => setRejectTarget(null)}>{m.common.actions.cancel}</Button>
              <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" disabled={busyId === rejectTarget.id} onClick={confirmReject}>{A.confirmReject}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
