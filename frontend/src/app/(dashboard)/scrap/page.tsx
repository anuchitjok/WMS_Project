'use client';

import { useEffect, useState, useCallback } from 'react';
import { Trash2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { scrapApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { ReasonCodeField, reasonFilled, type ReasonValue } from '@/components/reason-code-field';
import { StockPicker, type PickedStock } from '@/components/inventory/stock-picker';

// Same list the server accepts (stock-state ON_HAND_UNCOMMITTED).
const SCRAPPABLE = ['AVAILABLE', 'QUARANTINE', 'DAMAGED', 'DOA', 'RTV_PENDING', 'RETURNED_UNUSED'];

const SCRAP_FLOW: Record<string, string[]> = {
  PENDING_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['DISPOSED', 'CANCELLED'],
};

const STATUS_COLOR: Record<string, string> = {
  PENDING_REVIEW: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-green-100 text-green-700',
  DISPOSED: 'bg-slate-100 text-slate-600',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-400',
};

const DISPOSAL_OPTIONS = ['Destroy', 'Shred', 'Recycle', 'Donate', 'Other'];

// U05: Approved and Disposed are different steps — only disposal removes stock.
const STOCK_NOTE: Record<string, string> = {
  PENDING_REVIEW: 'Stock unchanged',
  APPROVED: 'Stock not yet deducted',
  DISPOSED: 'Stock removed',
  REJECTED: 'Stock unchanged',
  CANCELLED: 'Stock unchanged',
};

export default function ScrapPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ reason: '', description: '', disposalMethod: '', quantity: 1 });
  const [unit, setUnit] = useState<PickedStock | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState<ReasonValue>({});
  const [disposeTarget, setDisposeTarget] = useState<any | null>(null);
  const [dispose, setDispose] = useState({ method: '', notes: '' });
  const [disposing, setDisposing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await scrapApi.list(filterStatus || undefined)); }
    finally { setLoading(false); }
  }, [filterStatus]);

  useEffect(() => { load(); }, [load]);

  async function advance(c: any, nextStatus: string) {
    if (nextStatus === 'DISPOSED') {
      setDispose({ method: c.disposalMethod ?? '', notes: '' });
      setDisposeTarget(c);
      return;
    }
    try {
      await scrapApi.updateStatus(c.id, nextStatus);
      toast.success(`Scrap case moved to ${nextStatus.replace(/_/g, ' ')}`);
      load();
    } catch (e: any) { toast.error(e.message); }
  }

  async function confirmDispose() {
    if (!disposeTarget || !dispose.method.trim()) return;
    setDisposing(true);
    try {
      await scrapApi.updateStatus(disposeTarget.id, 'DISPOSED', { disposalMethod: dispose.method.trim(), notes: dispose.notes.trim() || undefined });
      toast.success(`${disposeTarget.refNumber} disposed — stock removed`);
      setDisposeTarget(null);
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setDisposing(false); }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!unit || !reasonFilled(reason)) { toast.error('Pick a stock unit and give a reason'); return; }
    const qty = Number(form.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > unit.quantity) { toast.error(`Quantity must be a whole number from 1 to ${unit.quantity}`); return; }
    setSubmitting(true);
    try {
      await scrapApi.create({ ...form, ...reason, stockItemId: unit.id, reason: reason.reason?.trim(), quantity: qty });
      setReason({});
      toast.success('Scrap case created');
      setShowCreate(false);
      setForm({ reason: '', description: '', disposalMethod: '', quantity: 1 });
      setUnit(null);
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Scrap Management"
        subtitle="Track and dispose scrapped stock items"
        icon={Trash2}
      />

      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">All Status</option>
          {['PENDING_REVIEW', 'APPROVED', 'DISPOSED', 'REJECTED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <Button className="bg-red-600 hover:bg-red-700 text-white ml-auto" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 mr-1" /> New Scrap Case
        </Button>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-bold text-lg">New Scrap Case</h2>
              <button onClick={() => setShowCreate(false)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <StockPicker value={unit} onChange={(u) => { setUnit(u); setForm((f) => ({ ...f, quantity: 1 })); }} allowedStatuses={SCRAPPABLE} label="Stock unit *" />
              <ReasonCodeField category="SCRAP" label="Reason *" value={reason} onChange={setReason} placeholder="e.g. Physical damage, End of life" />
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Description</label>
                <Input placeholder="Additional details" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Disposal Method</label>
                  <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={form.disposalMethod} onChange={(e) => setForm({ ...form, disposalMethod: e.target.value })}>
                    <option value="">Select...</option>
                    {DISPOSAL_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Quantity</label>
                  <Input type="number" min={1} max={unit?.quantity} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: +e.target.value })} />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button type="submit" className="flex-1 bg-red-600 hover:bg-red-700 text-white" disabled={submitting}>
                  {submitting ? 'Creating...' : 'Create'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dispose modal — disposal is the step that removes the goods from stock */}
      {disposeTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setDisposeTarget(null)}>
          <div role="dialog" aria-label="Dispose scrap" className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-bold text-lg">Dispose · {disposeTarget.refNumber}</h2>
              <button aria-label="Close" onClick={() => setDisposeTarget(null)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                Disposing removes {disposeTarget.quantity} from stock. This cannot be undone.
              </p>
              <div>
                <label htmlFor="dispose-method" className="text-xs font-medium text-slate-600 block mb-1">Disposal method *</label>
                <select id="dispose-method" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={dispose.method} onChange={(e) => setDispose({ ...dispose, method: e.target.value })}>
                  <option value="">Select…</option>
                  {[...new Set([...DISPOSAL_OPTIONS, ...(dispose.method ? [dispose.method] : [])])].map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="dispose-notes" className="text-xs font-medium text-slate-600 block mb-1">Evidence / certificate reference</label>
                <Input id="dispose-notes" placeholder="e.g. Recycler certificate no." value={dispose.notes} onChange={(e) => setDispose({ ...dispose, notes: e.target.value })} />
              </div>
              {!dispose.method && <p className="text-xs text-amber-700">Still needed: disposal method</p>}
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setDisposeTarget(null)}>Cancel</Button>
                <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white" disabled={disposing || !dispose.method} onClick={confirmDispose}>
                  {disposing ? 'Disposing…' : 'Dispose'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="text-left px-4 py-3 font-medium text-slate-600">Ref</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Product</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Reason</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Disposal</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Qty</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Requested By</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading
              ? [...Array(4)].map((_, i) => (
                  <tr key={i}>{[...Array(8)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>
                ))
              : rows.length === 0
              ? <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400">No scrap cases</td></tr>
              : rows.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-red-700">{c.refNumber}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{c.stockItem?.product?.name ?? '—'}</p>
                      <p className="text-xs text-slate-400">{c.stockItem?.serialNumber ?? c.stockItem?.product?.code ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-700 max-w-[140px] truncate">{c.reason}</td>
                    <td className="px-4 py-3 text-slate-600">{c.disposalMethod ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-700">{c.quantity}</td>
                    <td className="px-4 py-3 text-slate-600">{c.requestedBy?.fullName ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={STATUS_COLOR[c.status] ?? 'bg-slate-100 text-slate-600'}>
                        {c.status.replace(/_/g, ' ')}
                      </Badge>
                      {STOCK_NOTE[c.status] && <p className="mt-1 text-xs text-slate-500">{STOCK_NOTE[c.status]}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {(SCRAP_FLOW[c.status] ?? []).map((next) => (
                          <Button
                            key={next}
                            size="sm"
                            className={`h-7 text-xs ${next === 'REJECTED' || next === 'CANCELLED' ? 'bg-slate-200 text-slate-700 hover:bg-slate-300' : 'bg-red-600 hover:bg-red-700 text-white'}`}
                            onClick={() => advance(c, next)}
                          >
                            {next === 'DISPOSED' ? 'Dispose…' : next.replace(/_/g, ' ')}
                          </Button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
