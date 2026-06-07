'use client';

import { useEffect, useState, useCallback } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { toast } from 'sonner';
import { transferApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';

export default function TransferPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ productLabel: '', quantity: 1, fromLocation: '', toLocation: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await transferApi.list()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function submit() {
    try { await transferApi.create({ ...form, quantity: Number(form.quantity) }); toast.success('Transfer request created'); setOpen(false); load(); }
    catch (e: any) { toast.error(e.message); }
  }
  async function complete(id: string) {
    try { await transferApi.complete(id); toast.success('Transfer completed'); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Stock Transfer" subtitle="Move stock between warehouses and locations" icon={ArrowLeftRight}
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button className="bg-blue-600 hover:bg-blue-700 text-white" />}>+ Transfer Request</DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Stock Transfer</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1"><Label>Product Label</Label><Input value={form.productLabel} onChange={(e) => setForm((f) => ({ ...f, productLabel: e.target.value }))} placeholder="e.g. SW-C2960X — Cisco Switch" /></div>
                <div className="space-y-1"><Label>Quantity</Label><Input type="number" min={1} value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))} /></div>
                <div className="space-y-1"><Label>From Location</Label><Input value={form.fromLocation} onChange={(e) => setForm((f) => ({ ...f, fromLocation: e.target.value }))} placeholder="WH-MAIN / R-01 / S-A1" /></div>
                <div className="space-y-1"><Label>To Location</Label><Input value={form.toLocation} onChange={(e) => setForm((f) => ({ ...f, toLocation: e.target.value }))} placeholder="WH-MAIN / R-02 / S-B1" /></div>
              </div>
              <DialogFooter><Button onClick={submit} className="bg-blue-600 hover:bg-blue-700 text-white">Create</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">Transfer No.</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Item</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">From → To</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Qty</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Action</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No transfers</td></tr>
              : rows.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-blue-700">{t.refNumber}</td>
                  <td className="px-4 py-3 text-slate-700">{t.productLabel}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{t.fromLocation} → {t.toLocation}</td>
                  <td className="px-4 py-3 font-medium">{t.quantity}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className={t.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}>{t.status}</Badge></td>
                  <td className="px-4 py-3">{t.status !== 'COMPLETED' && <Button size="sm" className="h-7 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => complete(t.id)}>Confirm</Button>}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
