'use client';

import { useEffect, useState, useCallback } from 'react';
import { Calculator, Plus, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cycleCountApi, warehouseApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate } from '@/lib/utils';

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-slate-100 text-slate-700', IN_PROGRESS: 'bg-yellow-100 text-yellow-800',
  REVIEW: 'bg-blue-100 text-blue-800', APPROVED: 'bg-green-100 text-green-700',
  CLOSED: 'bg-slate-200 text-slate-600', CANCELLED: 'bg-red-100 text-red-700',
};

export default function CycleCountPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [form, setForm] = useState({ warehouseId: '', type: 'BLIND', notes: '' });
  const [countValues, setCountValues] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, w] = await Promise.all([cycleCountApi.list(), warehouseApi.list()]);
      setSessions(s); setWarehouses(w);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    try { await cycleCountApi.create(form); toast.success('Session created'); setOpen(false); load(); } catch (e: any) { toast.error(e.message); }
  }

  async function loadSession(id: string) {
    try { setSelected(await cycleCountApi.get(id)); } catch (e: any) { toast.error(e.message); }
  }

  async function submitCount(lineId: string) {
    if (!selected) return;
    const qty = Number(countValues[lineId]);
    if (isNaN(qty) || qty < 0) { toast.error('Enter a valid quantity'); return; }
    try {
      await cycleCountApi.countLine(selected.id, lineId, qty);
      toast.success('Count recorded');
      setSelected(await cycleCountApi.get(selected.id));
    } catch (e: any) { toast.error(e.message); }
  }

  async function submit() {
    try { setSelected(await cycleCountApi.submit(selected.id)); toast.success('Submitted for review'); } catch (e: any) { toast.error(e.message); }
  }
  async function approve() {
    try { setSelected(await cycleCountApi.approve(selected.id)); toast.success('Approved — variances applied'); load(); } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Cycle Count" subtitle="Inventory accuracy verification and variance management" icon={Calculator}
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button className="bg-blue-600 hover:bg-blue-700 text-white" />}><Plus className="h-4 w-4 mr-1" />New Count Session</DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Count Session</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Warehouse</Label>
                  <Select value={form.warehouseId} onValueChange={(v) => setForm((f) => ({ ...f, warehouseId: v ?? '' }))}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                    <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Count Type</Label>
                  <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v ?? 'BLIND' }))}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="BLIND">Blind Count (recommended)</SelectItem><SelectItem value="DIRECTED">Directed Count</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
              </div>
              <DialogFooter><Button onClick={create} className="bg-blue-600 hover:bg-blue-700 text-white">Create Session</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

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
                  className={`p-3 cursor-pointer hover:bg-slate-50 transition-colors ${selected?.id === s.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''}`}>
                  <p className="font-mono text-xs font-semibold text-blue-700">{s.refNumber}</p>
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
                  <p className="text-xs text-slate-400">{selected.summary?.counted}/{selected.summary?.total} counted · {selected.summary?.varianceCount} variances</p>
                </div>
                <div className="flex gap-2">
                  {selected.status === 'IN_PROGRESS' && <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={submit}>Submit for Review</Button>}
                  {selected.status === 'REVIEW' && <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={approve}>Approve & Apply</Button>}
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
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {selected.lines?.map((l: any) => (
                      <tr key={l.id} className={l.variance !== 0 && l.countedQty !== null ? 'bg-red-50/50' : ''}>
                        <td className="px-3 py-2 text-xs text-slate-700">{l.productId.slice(-8)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-500">{l.locationKey || '—'}</td>
                        <td className="px-3 py-2 text-center font-medium">{l.expectedQty}</td>
                        <td className="px-3 py-2 text-center">
                          {l.countedQty !== null ? <span className="font-medium">{l.countedQty}</span>
                            : <Input type="number" min={0} className="h-7 w-20 text-center text-xs" value={countValues[l.id] ?? ''} onChange={(e) => setCountValues((v) => ({ ...v, [l.id]: e.target.value }))} />}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {l.countedQty !== null && (
                            <span className={l.variance === 0 ? 'text-green-600' : 'text-red-600 font-semibold'}>
                              {l.variance > 0 ? '+' : ''}{l.variance ?? '—'}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {l.countedQty === null && ['OPEN', 'IN_PROGRESS'].includes(selected.status) && (
                            <Button size="sm" className="h-6 text-xs bg-blue-600 hover:bg-blue-700 text-white" onClick={() => submitCount(l.id)}>
                              <CheckCircle2 className="h-3 w-3" />
                            </Button>
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
