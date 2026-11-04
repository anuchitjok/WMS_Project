'use client';

import { useEffect, useState, useCallback } from 'react';
import { MapPin, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { putawayApi, warehouseApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DiscardChangesDialog } from '@/components/ui/discard-changes-dialog';
import { useDiscardGuard } from '@/hooks/use-discard-guard';
import { hasUnsavedChanges } from '@/lib/utils';
import { useT } from '@/i18n';

type FitResult = Awaited<ReturnType<typeof putawayApi.fitCheck>> | null;

const BLANK_BOX_FORM = { length: '', width: '', height: '' };
const BLANK_LOC = { warehouseId: '', rackId: '', slotId: '' };
type Loc = typeof BLANK_LOC;
const SELECT_CLS = 'h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm disabled:bg-slate-50 disabled:text-slate-400';

export default function PutawayPage() {
  const { m, t } = useT();
  const P = m.putaway;
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<any>(null); // item awaiting confirm in the dialog
  const [box, setBox] = useState(BLANK_BOX_FORM);
  const [fit, setFit] = useState<FitResult>(null);
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Destination: a slot is required (Warehouse → Rack → Slot). Pre-filled from
  // the location recorded at receiving, and changeable here.
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loc, setLoc] = useState<Loc>(BLANK_LOC);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await putawayApi.pending()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { warehouseApi.list().then(setWarehouses).catch(() => setWarehouses([])); }, []);

  const racks: any[] = warehouses.find((w) => w.id === loc.warehouseId)?.racks ?? [];
  const slots: any[] = racks.find((r) => r.id === loc.rackId)?.slots ?? [];

  function openConfirm(item: any) {
    setTarget(item);
    setBox(BLANK_BOX_FORM);
    setFit(null);
    setLoc({ warehouseId: item.warehouseId ?? '', rackId: item.rackId ?? '', slotId: item.slotId ?? '' });
  }

  function changeLoc(next: Partial<Loc>) {
    setLoc((l) => ({ ...l, ...next }));
    setFit(null); // fit was checked against the previous slot
  }

  async function runFitCheck() {
    if (!loc.slotId || !box.length || !box.width || !box.height) return;
    setChecking(true);
    try {
      const res = await putawayApi.fitCheck(loc.slotId, { length: +box.length, width: +box.width, height: +box.height });
      setFit(res);
    } catch (e: any) { toast.error(e.message); } finally { setChecking(false); }
  }

  async function doConfirm() {
    if (!target || !loc.slotId) return;
    setConfirming(true);
    try {
      await putawayApi.confirm(target.id, { warehouseId: loc.warehouseId, rackId: loc.rackId, slotId: loc.slotId });
      toast.success(P.done);
      setTarget(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setConfirming(false); }
  }

  const hasBoxInput = box.length !== '' && box.width !== '' && box.height !== '';
  const boxGuard = useDiscardGuard(hasUnsavedChanges(box, BLANK_BOX_FORM), () => { setTarget(null); setBox(BLANK_BOX_FORM); setFit(null); setLoc(BLANK_LOC); });

  return (
    <div className="p-6 space-y-5">
      <PageHeader title={P.title} subtitle={P.subtitle} icon={MapPin} />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">{P.table.stockItem}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{P.table.product}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{P.table.qty}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{P.table.suggested}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{P.table.status}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{P.table.action}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">{P.empty}</td></tr>
              : rows.map((i) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{i.serialNumber ?? i.batchNumber ?? i.id.slice(-8)}</td>
                  <td className="px-4 py-3"><span className="font-medium text-slate-800">{i.product?.name}</span><br /><span className="text-xs text-slate-400">{i.product?.code}</span></td>
                  <td className="px-4 py-3 font-medium">{i.quantity}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{[i.warehouse?.code, i.rack?.code, i.slot?.code].filter(Boolean).join(' › ') || '—'}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className="bg-amber-100 text-amber-700 whitespace-nowrap">{P.pending}</Badge></td>
                  <td className="px-4 py-3"><Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white" onClick={() => openConfirm(i)}>{P.confirmBtn}</Button></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!target} onOpenChange={(o) => { if (!o) boxGuard.requestClose(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(P.dialogTitle, { code: target?.product?.code ?? '' })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs mb-1 block">{P.destination}</Label>
              <div className="grid grid-cols-3 gap-2">
                <select aria-label={P.warehouse} className={SELECT_CLS} value={loc.warehouseId}
                  onChange={(e) => changeLoc({ warehouseId: e.target.value, rackId: '', slotId: '' })}>
                  <option value="">{P.warehousePh}</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
                </select>
                <select aria-label={P.rack} className={SELECT_CLS} value={loc.rackId} disabled={!loc.warehouseId}
                  onChange={(e) => changeLoc({ rackId: e.target.value, slotId: '' })}>
                  <option value="">{P.rackPh}</option>
                  {racks.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
                </select>
                <select aria-label={P.slot} className={SELECT_CLS} value={loc.slotId} disabled={!loc.rackId}
                  onChange={(e) => changeLoc({ slotId: e.target.value })}>
                  <option value="">{P.slotPh}</option>
                  {slots.map((sl) => (
                    <option key={sl.id} value={sl.id}>
                      {sl.code}{sl.capacity ? ` (${sl._count?.stockItems ?? 0}/${sl.capacity})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              {!loc.slotId && (
                <p className="text-xs text-amber-700 mt-1">{P.chooseSlot}</p>
              )}
            </div>

            <div>
              <Label className="text-xs mb-1 block">{P.boxSize}</Label>
              <div className="grid grid-cols-3 gap-2">
                <Input type="number" min={0} placeholder={P.length} value={box.length} onChange={(e) => { setBox((f) => ({ ...f, length: e.target.value })); setFit(null); }} />
                <Input type="number" min={0} placeholder={P.width} value={box.width} onChange={(e) => { setBox((f) => ({ ...f, width: e.target.value })); setFit(null); }} />
                <Input type="number" min={0} placeholder={P.height} value={box.height} onChange={(e) => { setBox((f) => ({ ...f, height: e.target.value })); setFit(null); }} />
              </div>
            </div>

            {hasBoxInput && !fit && (
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={runFitCheck} disabled={checking}>
                {checking ? P.checking : P.checkFit}
              </Button>
            )}

            {fit && !fit.hasSlotDimensions && (
              <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                {t(P.noSize, { occupied: fit.occupied, capacity: fit.capacity })}
              </p>
            )}
            {fit && fit.hasSlotDimensions && fit.fits && (
              <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-2.5 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                {t(P.fits, { l: fit.slot.lengthCm, w: fit.slot.widthCm, h: fit.slot.heightCm, occupied: fit.occupied, capacity: fit.capacity })}
              </p>
            )}
            {fit && fit.hasSlotDimensions && !fit.fits && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {t(P.noFit, { l: fit.slot.lengthCm, w: fit.slot.widthCm, h: fit.slot.heightCm })}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={boxGuard.requestClose}>{m.common.actions.cancel}</Button>
            <Button
              onClick={doConfirm}
              disabled={confirming || !loc.slotId}
              className={fit && fit.hasSlotDimensions && !fit.fits ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'}
            >
              {confirming ? P.confirming : fit && fit.hasSlotDimensions && !fit.fits ? P.confirmAnyway : P.confirmPutaway}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DiscardChangesDialog open={boxGuard.confirming} onKeepEditing={boxGuard.keepEditing} onDiscard={boxGuard.confirmDiscard} />
    </div>
  );
}
