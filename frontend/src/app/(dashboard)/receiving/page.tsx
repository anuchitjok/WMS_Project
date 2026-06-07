'use client';

import { useEffect, useState, useCallback } from 'react';
import { PackagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { receivingApi, warehouseApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate } from '@/lib/utils';

export default function ReceivingPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ sourceType: 'Brand Owner', productId: '', quantity: 1, condition: 'good', warehouseId: '', serialNumber: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [gr, prods, whs] = await Promise.all([receivingApi.list(), warehouseApi.products(), warehouseApi.list()]);
      setRows(gr); setProducts(prods); setWarehouses(whs);
      if (prods[0]) setForm((f) => ({ ...f, productId: f.productId || prods[0].id }));
      if (whs[0]) setForm((f) => ({ ...f, warehouseId: f.warehouseId || whs[0].id }));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function submit() {
    try {
      await receivingApi.create({
        sourceType: form.sourceType,
        items: [{ productId: form.productId, quantity: Number(form.quantity), condition: form.condition, warehouseId: form.warehouseId, serialNumber: form.serialNumber || undefined }],
      });
      toast.success('Goods received — stock created');
      setOpen(false); load();
    } catch (e: any) { toast.error(e.message); }
  }

  async function verify(id: string) {
    try { await receivingApi.verify(id); toast.success('Receiving verified'); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Goods Receiving & Verification" subtitle="Receive, inspect and verify inbound goods" icon={PackagePlus}
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button className="bg-blue-600 hover:bg-blue-700 text-white" />}>+ Goods Receiving</DialogTrigger>
            <DialogContent className="w-full max-w-2xl sm:max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
              <DialogHeader><DialogTitle>Goods Receiving</DialogTitle></DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1 min-w-0">
                  <Label>Source Type</Label>
                  <Select value={form.sourceType} onValueChange={(v) => setForm((f) => ({ ...f, sourceType: v ?? 'Brand Owner' }))}>
                    <SelectTrigger className="w-full min-w-0 [&>span]:truncate"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-64">{['Brand Owner', 'Vendor', 'Customer Return', 'RTV Replacement'].map((s) => <SelectItem key={s} value={s} className="truncate">{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 min-w-0">
                  <Label>Product</Label>
                  <Select value={form.productId} onValueChange={(v) => setForm((f) => ({ ...f, productId: v ?? '' }))}>
                    <SelectTrigger className="w-full min-w-0 [&>span]:truncate"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-64">{products.map((p) => <SelectItem key={p.id} value={p.id} className="truncate">{p.code} — {p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 min-w-0"><Label>Quantity</Label><Input type="number" min={1} value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))} className="w-full min-w-0" /></div>
                <div className="space-y-1 min-w-0">
                  <Label>Condition</Label>
                  <Select value={form.condition} onValueChange={(v) => setForm((f) => ({ ...f, condition: v ?? 'good' }))}>
                    <SelectTrigger className="w-full min-w-0 [&>span]:truncate"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-64">{['good', 'damaged', 'doa'].map((s) => <SelectItem key={s} value={s} className="truncate">{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 min-w-0">
                  <Label>Warehouse</Label>
                  <Select value={form.warehouseId} onValueChange={(v) => setForm((f) => ({ ...f, warehouseId: v ?? '' }))}>
                    <SelectTrigger className="w-full min-w-0 [&>span]:truncate"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-64">{warehouses.map((w) => <SelectItem key={w.id} value={w.id} className="truncate">{w.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 min-w-0"><Label>Serial (optional)</Label><Input value={form.serialNumber} onChange={(e) => setForm((f) => ({ ...f, serialNumber: e.target.value }))} className="w-full min-w-0" /></div>
              </div>
              <DialogFooter><Button onClick={submit} className="bg-blue-600 hover:bg-blue-700 text-white">Receive & Update Stock</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">GR No.</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Source</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Items</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Received</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Action</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(5)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No receiving records</td></tr>
              : rows.map((gr) => (
                <tr key={gr.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-blue-700">{gr.refNumber}</td>
                  <td className="px-4 py-3 text-slate-600">{gr.sourceType}</td>
                  <td className="px-4 py-3 text-slate-600">{gr.items?.length ?? 0} item(s)</td>
                  <td className="px-4 py-3"><Badge variant="outline" className={gr.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}>{gr.status}</Badge></td>
                  <td className="px-4 py-3 text-xs text-slate-400">{formatDate(gr.receivedDate)}</td>
                  <td className="px-4 py-3">{gr.status !== 'completed' && <Button size="sm" className="h-7 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => verify(gr.id)}>Verify</Button>}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
