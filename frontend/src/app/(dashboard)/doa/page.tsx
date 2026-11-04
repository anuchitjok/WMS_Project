'use client';

import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { doaApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { StockPicker, type PickedStock } from '@/components/inventory/stock-picker';
import { ReasonCodeField, reasonFilled, type ReasonValue } from '@/components/reason-code-field';
import { STOCK_STATUS_COLORS } from '@/lib/utils';
import type { StockStatus } from '@/types';
import { getT, labelOf, useT } from '@/i18n';

// Same list the server accepts (doa.service DECLARABLE): stock on hand, not committed to outbound work.
const DECLARABLE = ['AVAILABLE', 'QUARANTINE', 'DAMAGED', 'PENDING_INSPECTION', 'RETURNED_UNUSED'];

export default function DoaPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [unit, setUnit] = useState<PickedStock | null>(null);
  const [reason, setReason] = useState<ReasonValue>({});
  const [saving, setSaving] = useState(false);
  const { m, t } = useT();
  const D = m.rtv.doa;

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await doaApi.list()); } catch (e: any) { toast.error(e.message || getT().m.rtv.doa.toast.loadFailed); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function createRtv(id: string) {
    try { const c = await doaApi.createRtv(id); toast.success(t(D.toast.rtvCreated, { ref: c?.refNumber ?? '' })); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  async function declare() {
    if (!unit || !reasonFilled(reason)) { toast.error(D.toast.pickUnit); return; }
    setSaving(true);
    try {
      await doaApi.declare(unit.id, reason.reason?.trim(), reason.reasonCode);
      toast.success(t(D.toast.declared, { unit: unit.serialNumber ?? D.toast.unit }));
      setOpen(false); setUnit(null); setReason({});
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title={D.title} subtitle={D.subtitle} icon={AlertTriangle}
        action={<Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />{D.declare}</Button>} />

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setUnit(null); setReason({}); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{D.dialogTitle}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <StockPicker value={unit} onChange={setUnit} allowedStatuses={DECLARABLE} label={D.stockUnit} />
            <ReasonCodeField category="DOA" label={D.reason} value={reason} onChange={setReason} placeholder={D.reasonPlaceholder} />
            <p className="text-xs text-slate-500">{D.hint}</p>
          </div>
          <DialogFooter>
            <Button onClick={declare} disabled={saving || !unit || !reasonFilled(reason)} className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50">
              {saving ? D.saving : D.declare}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">{D.col.stockItem}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{D.col.productSerial}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{D.col.reason}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{D.col.status}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{D.col.location}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{D.col.action}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">{D.empty}</td></tr>
              : rows.map((i) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{i.id.slice(-8)}</td>
                  <td className="px-4 py-3"><span className="font-medium text-slate-800">{i.product?.name}</span><br /><span className="text-xs text-slate-400">{i.serialNumber ?? i.product?.code}</span></td>
                  <td className="px-4 py-3 text-sm text-slate-600 max-w-xs truncate" title={i.notes ?? ''}>{i.notes ?? '—'}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className={STOCK_STATUS_COLORS[i.status as StockStatus]}>{labelOf(m.status.stock, i.status)}</Badge></td>
                  <td className="px-4 py-3 text-xs text-slate-600">{i.warehouse?.name ?? '—'}</td>
                  <td className="px-4 py-3">{i.status !== 'RTV_PENDING' && <Button size="sm" className="h-7 bg-red-600 hover:bg-red-700 text-white" onClick={() => createRtv(i.id)}>{D.createRtv}</Button>}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
