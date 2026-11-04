'use client';

// Read-only Stock Detail (Phase 2). Stock changes only through receiving, requests
// and returns, so this drawer has no edit, status, transfer or adjust actions.
// The one action kept is "Release Reservation" for a reservation whose request
// already finished — the server refuses anything still in use.
import { useEffect, useState } from 'react';
import { X, Info, MapPin, FileText, History, RefreshCw, Clock, Building2, Layers, Box, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { inventoryApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { typeLabel } from '@/lib/product-terms';
import { getT, labelOf, useT } from '@/i18n';

const SECTIONS = [
  { id: 'info', icon: Info },
  { id: 'location', icon: MapPin },
  { id: 'recv', icon: FileText },
  { id: 'movement', icon: History },
  { id: 'rtv', icon: RefreshCw },
  { id: 'audit', icon: Clock },
] as const;

export function StockDetailDrawer({ itemId, onClose, onChanged }: { itemId: string; onClose: () => void; onChanged?: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState('info');
  const [releasing, setReleasing] = useState(false);
  const { m, t, fmt: f } = useT();
  const D = m.reports.drawer;
  const F = D.f;
  const fmt = (d: any) => f.date(d);
  const statusLabel = (s: string) => labelOf(m.status.stock, s);

  useEffect(() => {
    setLoading(true);
    setSection('info');
    inventoryApi.detailFull(itemId)
      .then(setData)
      .catch(() => { setData(null); toast.error(getT().m.reports.drawer.loadFailed); })
      .finally(() => setLoading(false));
  }, [itemId]);

  return (
    <div role="dialog" aria-label={D.dialog} className="fixed inset-y-0 right-0 z-50 w-full sm:w-[460px] bg-white shadow-2xl border-l border-slate-200 flex flex-col">
      <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between bg-slate-50 flex-shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <p className="font-mono font-bold text-slate-900">{loading ? '…' : (data?.serialNumber ?? data?.batchNumber ?? data?.id?.slice(-8) ?? '—')}</p>
            {data && !loading && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{statusLabel(data.status)}</span>
            )}
          </div>
          <p className="text-slate-500 text-xs">{loading ? '' : data?.product?.name}</p>
          <p className="text-[11px] text-slate-400 mt-1">{D.readOnly}</p>
        </div>
        <button onClick={onClose} aria-label={m.common.actions.close} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
      </div>

      <div className="flex overflow-x-auto border-b border-slate-100 flex-shrink-0 bg-slate-50">
        {SECTIONS.map(({ id, icon: Icon }) => (
          <button key={id} onClick={() => setSection(id)}
            className={cn('flex items-center gap-1 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors',
              section === id ? 'border-green-600 text-green-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            <Icon className="w-3.5 h-3.5" />{D.sections[id]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? <div className="space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
        : !data ? <p className="text-slate-400 text-center py-10">{D.failed}</p>
        : (
          <>
            {section === 'info' && (
              <div className="grid grid-cols-2 gap-2">
                {[
                  { l: F.status, v: statusLabel(data.status) },
                  { l: F.ownership, v: labelOf(D.ownership, data.ownershipType) },
                  { l: F.quantity, v: `${f.number(data.quantity)} ${data.product?.unit ?? ''}` },
                  { l: F.serial, v: data.serialNumber ?? '—', mono: true },
                  { l: F.batch, v: data.batchNumber ?? '—', mono: true },
                  { l: F.sku, v: data.product?.code ?? '—', mono: true },
                  { l: F.partNo, v: data.product?.partNumber ?? '—', mono: true },
                  { l: F.brand, v: data.product?.brand?.name ?? '—' },
                  { l: F.model, v: data.product?.model ?? '—' },
                  { l: F.productType, v: typeLabel(data.product?.productType) },
                  { l: F.received, v: fmt(data.receivedDate) },
                  { l: F.expiry, v: fmt(data.expiryDate) },
                  { l: F.createdBy, v: data.createdBy?.fullName ?? '—' },
                  { l: F.notes, v: data.notes ?? '—' },
                ].map(({ l, v, mono }) => (
                  <div key={l} className="bg-slate-50 rounded-lg p-2">
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{l}</p>
                    <p className={cn('text-sm mt-0.5 break-all font-medium text-slate-800', mono && 'font-mono text-xs text-green-700')}>{v}</p>
                  </div>
                ))}
              </div>
            )}
            {section === 'location' && (
              <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                {[
                  { l: F.warehouse, v: data.warehouse ? `${data.warehouse.code} — ${data.warehouse.name}` : '—', icon: Building2 },
                  { l: F.zone, v: data.rack?.zone ?? '—', icon: MapPin },
                  { l: F.rack, v: data.rack?.code ?? '—', icon: Layers },
                  { l: F.slot, v: data.slot?.code ?? '—', icon: Box },
                ].map(({ l, v, icon: Icon }) => (
                  <div key={l} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-slate-500"><Icon className="w-3.5 h-3.5" />{l}</div>
                    <span className="text-xs font-semibold font-mono text-slate-800">{v}</span>
                  </div>
                ))}
              </div>
            )}
            {section === 'recv' && (
              <div className="space-y-2">
                {!data.goodsReceivingItems?.length && <p className="text-slate-400 text-center py-6 text-sm">{D.noReceiving}</p>}
                {data.goodsReceivingItems?.map((gri: any) => {
                  const rcv = gri.receiving;
                  return (
                    <div key={gri.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-green-700">{rcv?.refNumber}</span>
                        <span className="text-[10px] text-slate-400">{fmt(rcv?.receivedDate)}</span>
                      </div>
                      {[{ l: F.awb, v: rcv?.awbNumber || '—' }, { l: F.invoice, v: rcv?.invoiceNumber || '—' }, { l: F.customerCase, v: rcv?.gswNumber || '—' }, { l: F.source, v: rcv?.sourceType ? labelOf(m.receiving.sourceType, rcv.sourceType) : '—' }, { l: F.receivedBy, v: rcv?.receivedBy?.fullName || '—' }, { l: F.qty, v: f.number(gri.quantity) }, { l: F.condition, v: gri.condition ? labelOf(m.receiving.condition, String(gri.condition).toLowerCase()) : '—' }].map(({ l, v }) => (
                        <div key={l} className="flex justify-between text-xs"><span className="text-slate-400">{l}</span><span className="font-mono text-slate-700">{v}</span></div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
            {section === 'movement' && (
              <div className="space-y-1.5">
                <div className="border-l-2 border-green-500 pl-3 py-1.5">
                  <p className="text-xs font-medium text-slate-700">{D.stockReceived}</p>
                  <p className="text-[10px] text-slate-400">{t(D.qtyOn, { qty: f.number(data.quantity), date: fmt(data.receivedDate) })}</p>
                </div>
                {data.withdrawalRequestItems?.map((wri: any) => (
                  <div key={wri.id} className="flex items-start gap-2 border-l-2 border-green-400 pl-3 py-1.5">
                    <div className="flex-1">
                      <p className="text-xs font-medium text-slate-700">{D.withdrawal}</p>
                      <p className="text-[10px] font-mono text-slate-400">{wri.request?.refNumber}</p>
                      <p className="text-[10px] text-slate-400">{wri.request?.department} · {wri.request?.status ? labelOf(m.status.request, wri.request.status) : ''}</p>
                    </div>
                    <p className="text-[10px] text-slate-400">{fmt(wri.request?.createdAt)}</p>
                  </div>
                ))}
                {data.rtvCases?.map((rtv: any) => (
                  <div key={rtv.id} className="border-l-2 border-orange-400 pl-3 py-1.5">
                    <p className="text-xs font-medium text-orange-700">{D.rtvCase}</p>
                    <p className="text-[10px] font-mono text-slate-400">{rtv.refNumber}</p>
                    <p className="text-[10px] text-slate-400">{rtv.vendor?.name} · {rtv.status ? labelOf(m.status.rtv, rtv.status) : ''}</p>
                  </div>
                ))}
              </div>
            )}
            {section === 'rtv' && (
              <div className="space-y-2">
                {data.withdrawalRequestItems?.filter((w: any) => w.request?.rmaCaseNumber).map((wri: any) => (
                  <div key={wri.id} className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <div className="flex justify-between mb-1"><span className="font-mono text-xs font-bold text-amber-700">{wri.request?.refNumber}</span><span className="text-[10px] text-amber-800">{wri.request?.status ? labelOf(m.status.request, wri.request.status) : ''}</span></div>
                    <p className="text-xs text-amber-700">{t(D.rma, { ref: wri.request?.rmaCaseNumber })}</p>
                  </div>
                ))}
                {data.rtvCases?.map((rtv: any) => (
                  <div key={rtv.id} className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                    <div className="flex justify-between mb-1"><span className="font-mono text-xs font-bold text-orange-700">{rtv.refNumber}</span><span className="text-[10px] text-orange-800">{rtv.status ? labelOf(m.status.rtv, rtv.status) : ''}</span></div>
                    <p className="text-xs text-orange-700">{t(D.vendor, { name: rtv.vendor?.name ?? '—' })} · {rtv.reason}</p>
                  </div>
                ))}
                {!data.withdrawalRequestItems?.some((w: any) => w.request?.rmaCaseNumber) && !data.rtvCases?.length && <p className="text-slate-400 text-center py-6 text-sm">{D.noRtv}</p>}
              </div>
            )}
            {section === 'audit' && (
              <div className="space-y-1.5">
                {!data.auditLogs?.length && <p className="text-slate-400 text-center py-6 text-sm">{D.noAudit}</p>}
                {data.auditLogs?.map((log: any) => (
                  <div key={log.id} className="flex items-start gap-2 text-xs border-b border-slate-50 pb-1.5">
                    <span className="text-[10px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 font-mono flex-shrink-0 mt-0.5 whitespace-nowrap">{labelOf(m.status.action, log.action)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-600 break-words">{log.detail}</p>
                      <p className="text-slate-400 text-[10px]">{log.user?.fullName ?? D.system} · {f.dateTime(log.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {data?.status === 'RESERVED' && (
        <div className="border-t border-slate-100 p-3 flex-shrink-0 bg-slate-50">
          <Button size="sm" variant="outline" className="w-full text-xs gap-1.5" disabled={releasing}
            onClick={() => {
              setReleasing(true);
              inventoryApi.releaseReservation(data.id)
                .then(() => { toast.success(D.released); onChanged?.(); onClose(); })
                .catch((e: any) => toast.error(e.message || D.releaseFailed))
                .finally(() => setReleasing(false));
            }}>
            <CheckCircle2 className="w-3.5 h-3.5" /> {releasing ? D.releasing : D.release}
          </Button>
        </div>
      )}
    </div>
  );
}
