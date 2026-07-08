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

export default function ScrapPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ stockItemId: '', reason: '', description: '', disposalMethod: '', quantity: 1 });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await scrapApi.list(filterStatus || undefined)); }
    finally { setLoading(false); }
  }, [filterStatus]);

  useEffect(() => { load(); }, [load]);

  async function advance(c: any, nextStatus: string) {
    try {
      await scrapApi.updateStatus(c.id, nextStatus);
      toast.success(`Scrap case moved to ${nextStatus.replace(/_/g, ' ')}`);
      load();
    } catch (e: any) { toast.error(e.message); }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.stockItemId || !form.reason) { toast.error('Stock Item ID and Reason are required'); return; }
    setSubmitting(true);
    try {
      await scrapApi.create({ ...form, quantity: Number(form.quantity) });
      toast.success('Scrap case created');
      setShowCreate(false);
      setForm({ stockItemId: '', reason: '', description: '', disposalMethod: '', quantity: 1 });
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
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Stock Item ID / Serial *</label>
                <Input placeholder="Enter Stock Item ID" value={form.stockItemId} onChange={(e) => setForm({ ...form, stockItemId: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Reason *</label>
                <Input placeholder="e.g. Physical damage, End of life" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </div>
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
                  <Input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: +e.target.value })} />
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
                            {next.replace(/_/g, ' ')}
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
