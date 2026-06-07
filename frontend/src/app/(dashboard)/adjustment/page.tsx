'use client';

import { useEffect, useState, useCallback } from 'react';
import { Calculator } from 'lucide-react';
import { toast } from 'sonner';
import { adjustmentApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';

export default function AdjustmentPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ productLabel: '', reason: 'Cycle count variance', quantityBefore: 0, quantityAfter: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await adjustmentApi.list()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function submit() {
    try { await adjustmentApi.create({ ...form, quantityBefore: Number(form.quantityBefore), quantityAfter: Number(form.quantityAfter) }); toast.success('Adjustment requested'); setOpen(false); load(); }
    catch (e: any) { toast.error(e.message); }
  }
  async function approve(id: string) {
    try { await adjustmentApi.approve(id); toast.success('Adjustment approved & posted'); load(); }
    catch (e: any) { toast.error(e.message); }
  }
  async function reject(id: string) {
    try { await adjustmentApi.reject(id); toast.success('Adjustment rejected'); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Stock Adjustment" subtitle="Controlled quantity adjustment with approval" icon={Calculator}
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button className="bg-blue-600 hover:bg-blue-700 text-white" />}>+ Adjustment Request</DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Stock Adjustment</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1"><Label>Product Label</Label><Input value={form.productLabel} onChange={(e) => setForm((f) => ({ ...f, productLabel: e.target.value }))} placeholder="e.g. CAB-CAT5E — Cat5e Cable" /></div>
                <div className="space-y-1"><Label>Reason</Label><Input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label>Qty Before</Label><Input type="number" value={form.quantityBefore} onChange={(e) => setForm((f) => ({ ...f, quantityBefore: Number(e.target.value) }))} /></div>
                  <div className="space-y-1"><Label>Qty After</Label><Input type="number" value={form.quantityAfter} onChange={(e) => setForm((f) => ({ ...f, quantityAfter: Number(e.target.value) }))} /></div>
                </div>
              </div>
              <DialogFooter><Button onClick={submit} className="bg-blue-600 hover:bg-blue-700 text-white">Create</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">Adjustment No.</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Item</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Reason</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Before → After</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Action</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No adjustments</td></tr>
              : rows.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-blue-700">{a.refNumber}</td>
                  <td className="px-4 py-3 text-slate-700">{a.productLabel}</td>
                  <td className="px-4 py-3 text-slate-600">{a.reason}</td>
                  <td className="px-4 py-3 font-medium">{a.quantityBefore} → {a.quantityAfter}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className={a.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : a.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}>{a.status.replace(/_/g, ' ')}</Badge></td>
                  <td className="px-4 py-3 space-x-1">{a.status === 'PENDING_APPROVAL' && (<>
                    <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white" onClick={() => approve(a.id)}>Approve</Button>
                    <Button size="sm" variant="outline" className="h-7 text-red-600 border-red-200" onClick={() => reject(a.id)}>Reject</Button>
                  </>)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
