'use client';

// Global Approval Workspace.
// Canonical home for request approvals (moved from /approval, which now redirects here).
// Governance surface — decisions are recorded by the backend approval flow.
// P4: View details drawer (4.3), row checkboxes + bulk approve/reject (4.4),
// delivery method on each row (4.7).

import { useEffect, useState, useCallback } from 'react';
import { ShieldCheck, X, AlertTriangle, CheckCircle2, Eye, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { requestsApi, localizeError } from '@/lib/api';
import { requestsApiP4, BULK_APPROVE_MAX, type BulkApproveResponse } from '@/lib/api-requests';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RequestDetailDrawer } from '@/components/requests/request-detail-drawer';
import { DeliveryMethodBadge } from '@/components/requests/delivery-method-badge';
import { REQUEST_STATUS_COLORS } from '@/lib/utils';
import type { RequestStatus } from '@/types';
import { labelOf, useT } from '@/i18n';

const PENDING: string[] = ['SUBMITTED', 'PENDING_APPROVAL'];
const TH = 'text-left px-4 py-3 text-xs uppercase tracking-wide font-medium text-slate-500';

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  const { m } = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button className="text-slate-400 hover:text-slate-700" onClick={onClose} aria-label={m.common.actions.close}><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 px-5 py-4">{children}</div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}

export default function ApprovalsWorkspacePage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Request currently being rejected (drives the reason modal).
  const [rejectTarget, setRejectTarget] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  // P4 4.3 / 4.4
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<'approve' | 'reject' | null>(null);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkApproveResponse | null>(null);
  const { m, t, fmt } = useT();
  const A = m.approvals;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [submitted, pending] = await Promise.all([
        requestsApi.list({ status: 'SUBMITTED', limit: 50 }),
        requestsApi.list({ status: 'PENDING_APPROVAL', limit: 50 }),
      ]);
      const next = [...submitted.data, ...pending.data];
      setRows(next);
      // Keep only selections that are still pending after a refresh.
      setSelected((prev) => new Set([...prev].filter((id) => next.some((r) => r.id === id))));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const selectable = rows.filter((r) => PENDING.includes(r.status)).slice(0, BULK_APPROVE_MAX);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else if (next.size < BULK_APPROVE_MAX) next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.id)));
  }

  async function approve(id: string) {
    setBusyId(id);
    try {
      await requestsApi.approve(id, true);
      toast.success(A.toast.approved);
      setDetailId(null);
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
      setDetailId(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setBusyId(null); }
  }

  async function confirmBulk() {
    if (!bulkMode || selected.size === 0) return;
    const approveAll = bulkMode === 'approve';
    const reason = bulkReason.trim();
    if (!approveAll && !reason) { toast.error(A.toast.reasonRequired); return; }
    setBulkBusy(true);
    try {
      const res = await requestsApiP4.bulkApprove([...selected], approveAll, approveAll ? undefined : reason);
      setBulkMode(null);
      setBulkReason('');
      setSelected(new Set());
      setBulkResult(res);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setBulkBusy(false); }
  }

  // Requests approved at a step that still waits on a later approval step.
  const nextStepCount = bulkResult?.results.filter((r) => r.ok && r.status === 'PENDING_APPROVAL').length ?? 0;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <PageHeader title={A.title} subtitle={A.subtitle} icon={ShieldCheck} />

      {/* Bulk action bar — appears once something is selected */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5">
          <span className="text-sm font-medium text-green-800">{t(A.selected, { count: selected.size })}</span>
          <button className="text-sm text-slate-500 underline-offset-2 hover:underline" onClick={() => setSelected(new Set())}>{A.clearSelection}</button>
          <div className="ml-auto flex gap-2">
            <Button size="sm" className="h-8 bg-green-600 hover:bg-green-700 text-white" onClick={() => setBulkMode('approve')}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />{A.bulkApprove}
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-red-600 border-red-200 bg-white" onClick={() => { setBulkMode('reject'); setBulkReason(''); }}>
              <XCircle className="h-3.5 w-3.5 mr-1" />{A.bulkReject}
            </Button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 bg-slate-50">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-green-600 align-middle"
                  checked={allSelected}
                  disabled={selectable.length === 0}
                  onChange={toggleAll}
                  aria-label={A.selectAll}
                  title={A.selectAll}
                />
              </th>
              <th className={TH}>{A.col.request}</th>
              <th className={TH}>{A.col.requester}</th>
              <th className={TH}>{A.col.rma}</th>
              <th className={TH}>{m.requests.deliveryCol}</th>
              <th className={TH}>{A.col.stockCheck}</th>
              <th className={TH}>{A.col.status}</th>
              <th className={TH}>{A.col.action}</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading && rows.length === 0 ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
                : rows.length === 0 ? <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400">{A.empty}</td></tr>
                : rows.map((r) => (
                  <tr key={r.id} className={selected.has(r.id) ? 'bg-green-50/40' : 'hover:bg-slate-50'}>
                    <td className="px-4 py-3">
                      {PENDING.includes(r.status) && (
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-green-600 align-middle"
                          checked={selected.has(r.id)}
                          onChange={() => toggle(r.id)}
                          aria-label={t(A.selectRow, { ref: r.refNumber })}
                        />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-semibold text-green-700">{r.refNumber}</span>
                      <span className="block text-xs text-slate-400 whitespace-nowrap">{fmt.dateTime(r.createdAt)}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{r.requester?.fullName}<br /><span className="text-xs text-slate-400">{r.department}</span></td>
                    <td className="px-4 py-3 text-slate-600">{r.rmaCaseNumber ?? '—'}</td>
                    <td className="px-4 py-3"><DeliveryMethodBadge value={r.deliveryMethod} /></td>
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
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-slate-600" onClick={() => setDetailId(r.id)}>
                        <Eye className="h-3.5 w-3.5 mr-1" />{A.viewDetails}
                      </Button>
                      <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white" disabled={busyId === r.id} onClick={() => approve(r.id)}>{A.approve}</Button>
                      <Button size="sm" variant="outline" className="h-7 text-red-600 border-red-200" disabled={busyId === r.id} onClick={() => { setRejectTarget(r); setRejectReason(''); }}>{A.reject}</Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* P4 4.3 — request detail drawer (Approve / Reject available from inside) */}
      <RequestDetailDrawer
        requestId={detailId}
        onClose={() => setDetailId(null)}
        footer={(req) => PENDING.includes(req.status) ? (
          <>
            <Button size="sm" variant="outline" className="text-red-600 border-red-200" disabled={busyId === req.id}
              onClick={() => { setRejectTarget(req); setRejectReason(''); }}>{A.reject}</Button>
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" disabled={busyId === req.id}
              onClick={() => approve(req.id)}>{A.approve}</Button>
          </>
        ) : null}
      />

      {/* Reject-reason modal — the reason is recorded and shown to the requester */}
      {rejectTarget && (
        <Modal
          title={t(A.rejectTitle, { ref: rejectTarget.refNumber })}
          onClose={() => setRejectTarget(null)}
          footer={<>
            <Button variant="outline" size="sm" onClick={() => setRejectTarget(null)}>{m.common.actions.cancel}</Button>
            <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" disabled={busyId === rejectTarget.id} onClick={confirmReject}>{A.confirmReject}</Button>
          </>}
        >
          <label className="block text-sm text-slate-600">{A.reasonLabel} <span className="text-red-500">*</span></label>
          <textarea
            autoFocus
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder={A.reasonPlaceholder}
            className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
          />
          <p className="text-xs text-slate-400">{A.reasonHint}</p>
        </Modal>
      )}

      {/* P4 4.4 — bulk confirm (one reason for every selected request when rejecting) */}
      {bulkMode && (
        <Modal
          title={t(bulkMode === 'approve' ? A.bulkApproveTitle : A.bulkRejectTitle, { count: selected.size })}
          onClose={() => { if (!bulkBusy) setBulkMode(null); }}
          footer={<>
            <Button variant="outline" size="sm" disabled={bulkBusy} onClick={() => setBulkMode(null)}>{m.common.actions.cancel}</Button>
            {bulkMode === 'approve' ? (
              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" disabled={bulkBusy} onClick={confirmBulk}>
                {bulkBusy ? A.processing : A.bulkApprove}
              </Button>
            ) : (
              <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" disabled={bulkBusy || !bulkReason.trim()} onClick={confirmBulk}>
                {bulkBusy ? A.processing : A.confirmReject}
              </Button>
            )}
          </>}
        >
          {bulkMode === 'approve' ? (
            <p className="text-sm text-slate-600">{A.bulkApproveHint}</p>
          ) : (
            <>
              <label className="block text-sm text-slate-600">{A.reasonLabel} <span className="text-red-500">*</span></label>
              <textarea
                autoFocus
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder={A.reasonPlaceholder}
                className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
              />
              <p className="text-xs text-slate-400">{A.bulkReasonHint}</p>
            </>
          )}
          <p className="text-xs text-slate-500 font-mono break-words">
            {rows.filter((r) => selected.has(r.id)).map((r) => r.refNumber).join(', ')}
          </p>
        </Modal>
      )}

      {/* P4 4.4 — per-request result summary */}
      {bulkResult && (
        <Modal
          title={A.result.title}
          onClose={() => setBulkResult(null)}
          footer={<Button size="sm" variant="outline" onClick={() => setBulkResult(null)}>{m.common.actions.close}</Button>}
        >
          <ul className="space-y-1 text-sm">
            {bulkResult.approved - nextStepCount > 0 && (
              <li className="flex items-center gap-2 text-green-700"><CheckCircle2 className="h-4 w-4" />{t(A.result.approved, { count: bulkResult.approved - nextStepCount })}</li>
            )}
            {nextStepCount > 0 && (
              <li className="flex items-center gap-2 text-slate-700"><ShieldCheck className="h-4 w-4" />{t(A.result.nextStep, { count: nextStepCount })}</li>
            )}
            {bulkResult.rejected > 0 && (
              <li className="flex items-center gap-2 text-slate-700"><XCircle className="h-4 w-4" />{t(A.result.rejected, { count: bulkResult.rejected })}</li>
            )}
            {bulkResult.failed > 0 && (
              <li className="flex items-center gap-2 text-red-700"><AlertTriangle className="h-4 w-4" />{t(A.result.failed, { count: bulkResult.failed })}</li>
            )}
          </ul>
          {bulkResult.failed > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-700 mb-1">{A.result.failedList}</p>
              <ul className="space-y-1 text-sm text-red-800 max-h-48 overflow-y-auto">
                {bulkResult.results.filter((r) => !r.ok).map((r) => (
                  <li key={r.id}><span className="font-mono font-semibold">{r.refNumber ?? r.id}</span> — {localizeError(r.error ?? '')}</li>
                ))}
              </ul>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
