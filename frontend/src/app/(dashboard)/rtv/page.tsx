'use client';

import { useEffect, useState, useCallback } from 'react';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { rtvApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { labelOf, useT } from '@/i18n';

// Straight-line steps up to the vendor receiving the unit; after that the case
// ends either with a replacement (received against the case) or a credit note.
const RTV_FLOW = ['RTV_REQUIRED', 'PENDING_REVIEW', 'APPROVED', 'PENDING_SHIPMENT', 'SHIPPED_TO_VENDOR', 'VENDOR_RECEIVED'];
const CLOSED = ['COMPLETED', 'REJECTED_BY_VENDOR', 'CANCELLED'];

type Modal = { kind: 'replacement' | 'credit'; c: any } | null;

export default function RTVPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [form, setForm] = useState({ serialNumber: '', notes: '', creditNoteRef: '' });
  const { m, t } = useT();
  const V = m.rtv;
  const label = (s: string) => labelOf(m.status.rtv, s);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await rtvApi.list()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function move(c: any, next: string, extra: { creditNoteRef?: string } = {}) {
    setBusy(c.id);
    try { await rtvApi.updateStatus(c.id, next, extra); toast.success(t(V.toast.moved, { ref: c.refNumber, status: label(next) })); setModal(null); load(); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  }

  async function receiveReplacement() {
    if (!modal) return;
    const c = modal.c;
    setBusy(c.id);
    try {
      const res = await rtvApi.receiveReplacement(c.id, { serialNumber: form.serialNumber.trim() || undefined, notes: form.notes.trim() || undefined });
      toast.success(t(V.toast.replacementReceived, { ref: res.receiving?.refNumber ?? '' }));
      setModal(null); load();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  }

  function open(kind: 'replacement' | 'credit', c: any) {
    setForm({ serialNumber: '', notes: '', creditNoteRef: '' });
    setModal({ kind, c });
  }

  function actions(c: any) {
    if (CLOSED.includes(c.status)) {
      return c.replacementStock
        ? <span className="text-xs text-slate-500">{t(V.replacedBy, { serial: c.replacementStock.serialNumber ?? V.newUnit })}</span>
        : c.creditNoteRef ? <span className="text-xs text-slate-500">{t(V.creditNote, { ref: c.creditNoteRef })}</span> : null;
    }
    const b = 'h-7 text-xs';
    if (c.status === 'VENDOR_RECEIVED') {
      return (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" className={`${b} bg-purple-600 hover:bg-purple-700 text-white`} disabled={busy === c.id} onClick={() => move(c, 'REPLACEMENT_PENDING')}>{V.vendorReplace}</Button>
          <Button size="sm" variant="outline" className={b} disabled={busy === c.id} onClick={() => move(c, 'CREDIT_NOTE_PENDING')}>{V.vendorCredit}</Button>
          <Button size="sm" variant="outline" className={b} disabled={busy === c.id} onClick={() => move(c, 'REJECTED_BY_VENDOR')}>{V.rejected}</Button>
        </div>
      );
    }
    if (c.status === 'REPLACEMENT_PENDING') {
      return <Button size="sm" className={`${b} bg-purple-600 hover:bg-purple-700 text-white`} disabled={busy === c.id} onClick={() => open('replacement', c)}>{V.receiveReplacementDots}</Button>;
    }
    if (c.status === 'CREDIT_NOTE_PENDING') {
      return <Button size="sm" className={`${b} bg-purple-600 hover:bg-purple-700 text-white`} disabled={busy === c.id} onClick={() => open('credit', c)}>{V.recordCreditDots}</Button>;
    }
    const idx = RTV_FLOW.indexOf(c.status);
    const next = idx >= 0 ? RTV_FLOW[idx + 1] : undefined;
    return next ? (
      <div className="flex flex-wrap gap-1">
        <Button size="sm" className={`${b} bg-purple-600 hover:bg-purple-700 text-white`} disabled={busy === c.id} onClick={() => move(c, next)}>
          {next === 'SHIPPED_TO_VENDOR' ? V.markShipped : label(next)}
        </Button>
        {['RTV_REQUIRED', 'PENDING_REVIEW', 'APPROVED', 'PENDING_SHIPMENT'].includes(c.status) && (
          <Button size="sm" variant="outline" className={b} disabled={busy === c.id} onClick={() => move(c, 'CANCELLED')}>{m.common.actions.cancel}</Button>
        )}
      </div>
    ) : null;
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title={V.title} subtitle={V.subtitle} icon={RotateCcw} />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">{V.col.case}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{V.col.reason}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{V.col.item}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{V.col.vendor}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{V.col.status}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{V.col.action}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">{V.empty}</td></tr>
              : rows.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-purple-700">{c.refNumber}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className="bg-red-100 text-red-700">{c.reason}</Badge></td>
                  <td className="px-4 py-3 text-slate-700">{c.stockItem?.product?.name ?? '—'}<br /><span className="text-xs text-slate-400">{c.stockItem?.serialNumber ?? c.stockItem?.product?.code}</span></td>
                  <td className="px-4 py-3 text-slate-600">{c.vendor?.name ?? '—'}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className="bg-purple-100 text-purple-700">{label(c.status)}</Badge></td>
                  <td className="px-4 py-3">{actions(c)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!modal} onOpenChange={(o) => { if (!o) setModal(null); }}>
        <DialogContent>
          {modal?.kind === 'replacement' && (
            <>
              <DialogHeader><DialogTitle>{t(V.replacement.title, { ref: modal.c.refNumber })}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  {modal.c.stockItem?.serialNumber ? <>{V.replacement.replacesSerial} <span className="font-mono">{modal.c.stockItem.serialNumber}</span></> : V.replacement.replacesUnit} ({modal.c.stockItem?.product?.code}).{' '}
                  {V.replacement.body}
                </p>
                <div>
                  <label htmlFor="repl-serial" className="text-xs font-medium text-slate-600 block mb-1">{V.replacement.newSerial}{modal.c.stockItem?.serialNumber ? ' *' : ''}</label>
                  <Input id="repl-serial" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} placeholder={V.replacement.serialPlaceholder} />
                </div>
                <div>
                  <label htmlFor="repl-notes" className="text-xs font-medium text-slate-600 block mb-1">{V.replacement.notes}</label>
                  <Input id="repl-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={V.replacement.notesPlaceholder} />
                </div>
                {modal.c.stockItem?.serialNumber && !form.serialNumber.trim() && <p className="text-xs text-amber-700">{V.replacement.stillNeeded}</p>}
              </div>
              <DialogFooter>
                <Button className="bg-purple-600 hover:bg-purple-700 text-white"
                  disabled={busy === modal.c.id || (!!modal.c.stockItem?.serialNumber && !form.serialNumber.trim())}
                  onClick={receiveReplacement}>{V.replacement.submit}</Button>
              </DialogFooter>
            </>
          )}
          {modal?.kind === 'credit' && (
            <>
              <DialogHeader><DialogTitle>{t(V.credit.title, { ref: modal.c.refNumber })}</DialogTitle></DialogHeader>
              <div>
                <label htmlFor="credit-ref" className="text-xs font-medium text-slate-600 block mb-1">{V.credit.ref}</label>
                <Input id="credit-ref" value={form.creditNoteRef} onChange={(e) => setForm({ ...form, creditNoteRef: e.target.value })} placeholder="CN-2026-0042" />
              </div>
              <DialogFooter>
                <Button className="bg-purple-600 hover:bg-purple-700 text-white" disabled={busy === modal.c.id || !form.creditNoteRef.trim()}
                  onClick={() => move(modal.c, 'COMPLETED', { creditNoteRef: form.creditNoteRef.trim() })}>{V.credit.complete}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
