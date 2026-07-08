'use client';

import { useEffect, useState, useCallback } from 'react';
import { MapPin, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { putawayApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

type FitResult = Awaited<ReturnType<typeof putawayApi.fitCheck>> | null;

export default function PutawayPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<any>(null); // item awaiting confirm in the dialog
  const [box, setBox] = useState({ length: '', width: '', height: '' });
  const [fit, setFit] = useState<FitResult>(null);
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await putawayApi.pending()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function openConfirm(item: any) {
    setTarget(item);
    setBox({ length: '', width: '', height: '' });
    setFit(null);
  }

  async function runFitCheck() {
    if (!target?.slotId || !box.length || !box.width || !box.height) return;
    setChecking(true);
    try {
      const res = await putawayApi.fitCheck(target.slotId, { length: +box.length, width: +box.width, height: +box.height });
      setFit(res);
    } catch (e: any) { toast.error(e.message); } finally { setChecking(false); }
  }

  async function doConfirm() {
    if (!target) return;
    setConfirming(true);
    try {
      await putawayApi.confirm(target.id, { warehouseId: target.warehouseId, rackId: target.rackId, slotId: target.slotId });
      toast.success('Putaway confirmed — stock is now Available');
      setTarget(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setConfirming(false); }
  }

  const hasBoxInput = box.length !== '' && box.width !== '' && box.height !== '';

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Putaway Management" subtitle="Assign location and confirm storage" icon={MapPin} />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">Stock Item</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Product</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Qty</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Suggested Location</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Action</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No items awaiting putaway</td></tr>
              : rows.map((i) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{i.id.slice(-8)}</td>
                  <td className="px-4 py-3"><span className="font-medium text-slate-800">{i.product?.name}</span><br /><span className="text-xs text-slate-400">{i.product?.code}</span></td>
                  <td className="px-4 py-3 font-medium">{i.quantity}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{[i.warehouse?.code, i.rack?.code, i.slot?.code].filter(Boolean).join(' › ') || '—'}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className="bg-amber-100 text-amber-700">Pending Putaway</Badge></td>
                  <td className="px-4 py-3"><Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white" onClick={() => openConfirm(i)}>Confirm</Button></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Putaway — {target?.product?.code}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              Location: <span className="font-medium text-slate-700">{[target?.warehouse?.code, target?.rack?.code, target?.slot?.code].filter(Boolean).join(' › ') || '—'}</span>
            </p>

            <div>
              <Label className="text-xs mb-1 block">Box size (cm) — optional, checks fit against the slot</Label>
              <div className="grid grid-cols-3 gap-2">
                <Input type="number" min={0} placeholder="Length" value={box.length} onChange={(e) => { setBox((f) => ({ ...f, length: e.target.value })); setFit(null); }} />
                <Input type="number" min={0} placeholder="Width" value={box.width} onChange={(e) => { setBox((f) => ({ ...f, width: e.target.value })); setFit(null); }} />
                <Input type="number" min={0} placeholder="Height" value={box.height} onChange={(e) => { setBox((f) => ({ ...f, height: e.target.value })); setFit(null); }} />
              </div>
            </div>

            {hasBoxInput && !fit && (
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={runFitCheck} disabled={checking}>
                {checking ? 'Checking…' : 'Check Fit'}
              </Button>
            )}

            {fit && !fit.hasSlotDimensions && (
              <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                This slot has no size on record — capacity check only ({fit.occupied}/{fit.capacity} used).
              </p>
            )}
            {fit && fit.hasSlotDimensions && fit.fits && (
              <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-2.5 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                Fits — slot is {fit.slot.lengthCm}×{fit.slot.widthCm}×{fit.slot.heightCm} cm ({fit.occupied}/{fit.capacity} used)
              </p>
            )}
            {fit && fit.hasSlotDimensions && !fit.fits && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                Doesn&apos;t fit — box is larger than the slot ({fit.slot.lengthCm}×{fit.slot.widthCm}×{fit.slot.heightCm} cm). You can still confirm if you&apos;re certain it fits.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
            <Button
              onClick={doConfirm}
              disabled={confirming}
              className={fit && fit.hasSlotDimensions && !fit.fits ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'}
            >
              {confirming ? 'Confirming…' : fit && fit.hasSlotDimensions && !fit.fits ? 'Confirm Anyway' : 'Confirm Putaway'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
