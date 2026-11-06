'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Tag, Search, Plus, Download, Upload, X, ChevronDown, ChevronRight,
  Package, Layers, BarChart3, AlertTriangle, RefreshCw,
  FileText, Printer, Pencil, Clock, Shield, TrendingDown,
  Building2, Box, CheckCircle2, Filter, Eye, History,
  Info, PauseCircle, PlayCircle, Ban, CircleDot, Zap, GripVertical,
} from 'lucide-react';
import { toast } from 'sonner';
import { productsApi, warehouseApi, labelsApi } from '@/lib/api';
import { canWriteProducts } from '@/lib/api-products';
import { useAuthStore } from '@/store/auth.store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { getT, humanize, labelOf, useT, type Messages } from '@/i18n';
import { ProductFormDialog, PRODUCT_STATUSES, PRODUCT_TYPES } from '@/components/products/product-form-dialog';
import { ProductImportDialog } from '@/components/products/product-import-dialog';
import { ColumnsMenu } from '@/components/products/columns-menu';
import { COLUMN_GROUPS, useColumnPrefs, type ColumnGroup, type ColumnMeta } from '@/components/products/use-column-prefs';

// ─── Constants ────────────────────────────────────────────────────────────────

const STOCK_STATUSES = ['AVAILABLE', 'RESERVED', 'PICKING', 'QUARANTINE', 'DAMAGED', 'DOA', 'RTV_PENDING', 'SHIPPED'];

const TYPE_BADGE: Record<string, string> = {
  SPARE_PART:     'bg-slate-50 text-slate-700 border-slate-200',
  FINISHED_GOODS: 'bg-green-50 text-green-700 border-green-200',
};
const STATUS_BADGE: Record<string, string> = {
  AVAILABLE:   'bg-green-100 text-green-700',
  RESERVED:    'bg-yellow-100 text-yellow-700',
  QUARANTINE:  'bg-red-100 text-red-700',
  DOA:         'bg-red-200 text-red-900',
  RTV_PENDING: 'bg-orange-100 text-orange-700',
  DAMAGED:     'bg-rose-100 text-rose-700',
  PICKING:     'bg-cyan-100 text-cyan-700',
};
const PRODUCT_STATUS_STYLE: Record<string, { bg: string; text: string; dot: string }> = {
  ACTIVE:       { bg: 'bg-green-100', text: 'text-green-800', dot: 'bg-green-500' },
  INACTIVE:     { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' },
  DISCONTINUED: { bg: 'bg-red-100',   text: 'text-red-700',   dot: 'bg-red-400'   },
};

/** Stored receiving source type → display label ("RTV Replacement" shows as "RTV Return"). */
function sourceTypeLabel(m: Messages, v?: string | null): string {
  if (!v) return '—';
  return (m.products.sourceType as Record<string, string>)[v] ?? v.replace(/_/g, ' ');
}

function downloadAuthed(url: string, name: string) {
  let token: string | null = null;
  try { token = localStorage.getItem('wms_token'); } catch { token = null; }
  fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then((r) => r.blob())
    .then((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); })
    .catch((e) => toast.error(e.message));
}

function ProductStatusBadge({ status }: { status?: string }) {
  const { m } = useT();
  const s = PRODUCT_STATUS_STYLE[status ?? ''] ?? { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' };
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap', s.bg, s.text)}>
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', s.dot)} />
      {status ? labelOf(m.products.status, status) : '—'}
    </span>
  );
}

// ─── KPI Bar ──────────────────────────────────────────────────────────────────

function KpiBar({ kpi, loading }: { kpi: any; loading: boolean }) {
  const { m, fmt } = useT();
  const K = m.products.kpi;
  const warn = (n: number | undefined, on: string) => ((n ?? 0) > 0 ? on : 'text-slate-400');
  const cards = [
    { label: K.totalSku,      value: kpi?.totalSku,             icon: Tag,           color: 'text-slate-700', hint: K.totalSkuHint },
    { label: K.active,        value: kpi?.activeCount,          icon: CircleDot,     color: 'text-green-700' },
    { label: K.inactive,      value: kpi?.inactiveCount,        icon: PauseCircle,   color: warn(kpi?.inactiveCount, 'text-slate-600') },
    { label: K.discontinued,  value: kpi?.discontinuedCount,    icon: Ban,           color: warn(kpi?.discontinuedCount, 'text-red-700') },
    { label: K.serialTracked, value: kpi?.serializedItems,      icon: Shield,        color: 'text-slate-700', hint: K.serialTrackedHint },
    { label: K.batchTracked,  value: kpi?.batchControlledCount, icon: Zap,           color: 'text-slate-700', hint: K.batchTrackedHint },
    { label: K.lowStock,      value: kpi?.lowStock,             icon: TrendingDown,  color: warn(kpi?.lowStock, 'text-amber-700') },
    { label: K.onHold,        value: kpi?.quarantineCount,      icon: AlertTriangle, color: warn(kpi?.quarantineCount, 'text-red-700') },
    { label: K.rtvPending,    value: kpi?.rtvPendingCount,      icon: RefreshCw,     color: warn(kpi?.rtvPendingCount, 'text-amber-700') },
    { label: K.doa,           value: kpi?.doaCount,             icon: X,             color: warn(kpi?.doaCount, 'text-red-800') },
    { label: K.warehouses,    value: kpi?.totalWarehouses,      icon: Building2,     color: 'text-slate-700' },
    { label: K.totalQty,      value: kpi?.totalQty,             icon: Box,           color: 'text-slate-700' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
      {cards.map(({ label, value, icon: Icon, color, hint }) => (
        <div key={label} title={hint} className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-white shadow-sm min-w-0">
          <Icon className={cn('w-4 h-4 flex-shrink-0', color)} />
          <div className="min-w-0">
            {loading ? <Skeleton className="h-5 w-10" /> : <p className={cn('text-lg font-bold tabular-nums leading-none', color)}>{fmt.number(value ?? 0)}</p>}
            <p className="text-xs text-slate-500 mt-0.5 leading-tight truncate">{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Status Dots ──────────────────────────────────────────────────────────────

function StatusDots({ statusCounts }: { statusCounts: Record<string, number> }) {
  const { m } = useT();
  const order = ['AVAILABLE', 'RESERVED', 'QUARANTINE', 'DOA', 'RTV_PENDING', 'DAMAGED'];
  return (
    <div className="flex flex-wrap gap-1">
      {order.filter((s) => statusCounts[s]).map((s) => (
        <span key={s} title={`${labelOf(m.status.stock, s)}: ${statusCounts[s]}`}
          className={cn('inline-flex items-center gap-0.5 text-xs rounded px-1 py-0.5 font-medium', STATUS_BADGE[s] ?? 'bg-slate-100 text-slate-600')}>
          {statusCounts[s]}
        </span>
      ))}
      {Object.keys(statusCounts).length === 0 && <span className="text-slate-300 text-xs">—</span>}
    </div>
  );
}

// ─── Inventory Drilldown Modal ────────────────────────────────────────────────

function DrilldownModal({ product, onClose }: { product: any; onClose: () => void }) {
  const { m, t, fmt } = useT();
  const D = m.products.drilldown;
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-green-600" /> {t(D.title, { code: product.partNumber || product.code })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{product.description || product.name}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.entries(product.statusCounts ?? {}).map(([status, count]: [string, any]) => (
              <div key={status} className={cn('rounded-lg border px-3 py-2', STATUS_BADGE[status] ?? 'bg-slate-50')}>
                <p className="text-xs font-medium">{labelOf(m.status.stock, status)}</p>
                <p className="text-xl font-bold tabular-nums">{count}</p>
              </div>
            ))}
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><p className="text-slate-500 text-xs">{D.totalQty}</p><p className="font-bold">{fmt.number(product.totalQty)}</p></div>
              <div><p className="text-slate-500 text-xs">{D.primaryWh}</p><p className="font-bold">{product.primaryWarehouse || '—'}</p></div>
              <div><p className="text-slate-500 text-xs">{D.value}</p><p className="font-bold">{fmt.currency(product.inventoryValue ?? 0)}</p></div>
            </div>
          </div>
          {product.ownershipTypes?.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-1">{D.ownership}</p>
              <div className="flex gap-1 flex-wrap">
                {product.ownershipTypes.map((o: string) => (
                  <span key={o} className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-medium">{o}</span>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{m.common.actions.close}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Product Detail Drawer ────────────────────────────────────────────────────

function ProductDetailDrawer({ productId, canWrite, onClose, onEdit }: { productId: string; canWrite: boolean; onClose: () => void; onEdit: (data: any) => void }) {
  const { m, t, fmt } = useT();
  const P = m.products;
  const Dr = P.drawer;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('info');

  useEffect(() => {
    setLoading(true);
    productsApi.detailFull(productId)
      .then(setData)
      .catch(() => toast.error(getT().m.products.toast.loadDetailFailed))
      .finally(() => setLoading(false));
  }, [productId]);

  const sections = [
    { id: 'info',      label: Dr.sections.info,      icon: Info },
    { id: 'inventory', label: Dr.sections.inventory, icon: Box },
    { id: 'serials',   label: Dr.sections.serials,   icon: Shield },
    { id: 'movement',  label: Dr.sections.movement,  icon: History },
    { id: 'rtv',       label: Dr.sections.rtv,       icon: RefreshCw },
    { id: 'audit',     label: Dr.sections.audit,     icon: Clock },
  ];
  const yesNo = (v: boolean) => (v ? Dr.yes : Dr.no);
  const box = data && (data.lengthCm || data.widthCm || data.heightCm)
    ? [data.lengthCm, data.widthCm, data.heightCm].map((v: number | null) => (v == null ? '—' : fmt.number(v))).join(' × ')
    : '—';

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] bg-white shadow-2xl border-l border-slate-200 flex flex-col">
      <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between bg-slate-50">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="font-bold text-slate-900 truncate">{loading ? '…' : data?.description || data?.name}</p>
            {data?.productStatus && <ProductStatusBadge status={data.productStatus} />}
          </div>
          <p className="text-slate-500 text-xs font-mono">{loading ? '' : data?.partNumber || data?.code}</p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 mt-0.5" aria-label={m.common.actions.close}><X className="w-5 h-5" /></button>
      </div>

      <div className="flex overflow-x-auto border-b border-slate-100 flex-shrink-0 bg-slate-50">
        {sections.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveSection(id)}
            className={cn('flex items-center gap-1 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors',
              activeSection === id ? 'border-green-600 text-green-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : !data ? (
          <p className="text-slate-400 text-center py-10">{Dr.failed}</p>
        ) : (
          <>
            {activeSection === 'info' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: P.form.sku, value: data.partNumber || '—', mono: true },
                    { label: Dr.internalCode, value: data.code, mono: true },
                    { label: P.form.brand, value: data.brand?.name || '—' },
                    { label: P.form.model, value: data.model || '—' },
                    { label: P.form.status, value: labelOf(P.status, data.productStatus) || '—' },
                    { label: P.form.type, value: labelOf(P.type, data.productType) || '—' },
                    { label: P.form.partType, value: data.partType || '—' },
                    { label: P.form.cost, value: data.unitCost ? fmt.currency(data.unitCost) : '—' },
                    { label: P.form.price, value: data.defaultPrice != null ? fmt.currency(data.defaultPrice) : '—' },
                    { label: P.form.vendorPart, value: data.vendorPartNumber || '—', mono: true },
                    { label: P.form.manufacturer, value: data.manufacturer || '—' },
                    { label: P.form.category, value: data.category || '—' },
                    { label: P.form.uom, value: data.unit || '—' },
                    { label: P.form.minStock, value: String(data.minStock) },
                    { label: P.form.serial, value: yesNo(data.serialControlled) },
                    { label: P.form.batch, value: yesNo(data.batchControlled) },
                    { label: P.form.boxSize, value: box },
                    { label: P.form.createdBy, value: data.createdByName || '—' },
                    { label: P.form.createdOn, value: fmt.dateTime(data.createdAt) },
                    { label: P.form.modifiedBy, value: data.updatedByName || '—' },
                    { label: P.form.modifiedOn, value: fmt.dateTime(data.updatedAt) },
                  ].map(({ label, value, mono }) => (
                    <div key={label} className="bg-slate-50 rounded-lg p-2">
                      <p className="text-xs text-slate-500 font-medium">{label}</p>
                      <p className={cn('text-sm text-slate-800 font-medium mt-0.5 break-all', mono && 'font-mono text-xs')}>{value}</p>
                    </div>
                  ))}
                </div>
                {data.description && (
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs text-slate-500 font-medium mb-1">{P.form.description}</p>
                    <p className="text-sm text-slate-700 leading-relaxed">{data.description}</p>
                  </div>
                )}
              </div>
            )}

            {activeSection === 'inventory' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-green-700">{data._count?.stockItems ?? 0}</p>
                    <p className="text-xs text-green-600">{Dr.totalItems}</p>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-green-700">{data.stockItems?.filter((i: any) => i.status === 'AVAILABLE').length ?? 0}</p>
                    <p className="text-xs text-green-600">{Dr.available}</p>
                  </div>
                </div>
                {(() => {
                  const byWh: Record<string, { name: string; count: number; qty: number }> = {};
                  data.stockItems?.forEach((si: any) => {
                    const k = si.warehouse?.code ?? Dr.unknownWh;
                    if (!byWh[k]) byWh[k] = { name: si.warehouse?.name ?? k, count: 0, qty: 0 };
                    byWh[k].count++;
                    byWh[k].qty += si.quantity;
                  });
                  return Object.entries(byWh).map(([code, info]) => (
                    <div key={code} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-3.5 h-3.5 text-slate-400" />
                        <div>
                          <p className="text-xs font-semibold text-slate-700">{code}</p>
                          <p className="text-xs text-slate-500">{info.name}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-slate-800">{fmt.number(info.qty)}</p>
                        <p className="text-xs text-slate-500">{t(Dr.items, { count: info.count })}</p>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}

            {activeSection === 'serials' && (
              <div className="space-y-2">
                {data.stockItems?.filter((i: any) => i.serialNumber).length === 0
                  ? <p className="text-slate-400 text-center py-6 text-sm">{Dr.noSerials}</p>
                  : data.stockItems?.filter((i: any) => i.serialNumber).map((si: any) => (
                    <div key={si.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                      <div>
                        <p className="font-mono text-xs font-bold text-green-700">{si.serialNumber}</p>
                        <p className="text-xs text-slate-500">{[si.warehouse?.code, si.rack?.code, si.slot?.code].filter(Boolean).join(' › ')}</p>
                      </div>
                      <span className={cn('text-xs rounded-full px-2 py-0.5 font-medium', STATUS_BADGE[si.status] ?? 'bg-slate-100 text-slate-600')}>{labelOf(m.status.stock, si.status)}</span>
                    </div>
                  ))}
              </div>
            )}

            {activeSection === 'movement' && (
              <div className="space-y-2">
                {data.stockItems?.slice(0, 15).map((si: any) => (
                  <div key={si.id} className="flex items-start gap-2 border-l-2 border-green-400 pl-3 py-1">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-700">{Dr.received} {si.serialNumber ? `· ${si.serialNumber}` : ''}</p>
                      <p className="text-xs text-slate-500">{[si.warehouse?.code, si.rack?.code].filter(Boolean).join(' › ')} · {t(Dr.qtyLine, { qty: si.quantity })}</p>
                      {si.goodsReceivingItems?.[0]?.receiving && (
                        <p className="text-xs text-slate-500 font-mono">{si.goodsReceivingItems[0].receiving.refNumber}</p>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 flex-shrink-0">{fmt.date(si.receivedDate)}</p>
                  </div>
                ))}
              </div>
            )}

            {activeSection === 'rtv' && (
              <div className="space-y-2">
                {data.withdrawalRequestItems?.length === 0
                  ? <p className="text-slate-400 text-center py-6 text-sm">{Dr.noRtv}</p>
                  : data.withdrawalRequestItems?.map((wri: any) => (
                    <div key={wri.id} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-slate-700">{wri.request?.refNumber}</span>
                        <span className="text-xs bg-slate-200 text-slate-700 rounded-full px-2 py-0.5">{labelOf(m.status.request, wri.request?.status)}</span>
                      </div>
                      {wri.request?.rmaCaseNumber && <p className="text-xs text-slate-600 mt-0.5">{t(Dr.rma, { ref: wri.request.rmaCaseNumber })}</p>}
                      <p className="text-xs text-slate-500 mt-0.5">{wri.request?.department} · {fmt.date(wri.request?.createdAt)}</p>
                    </div>
                  ))}
              </div>
            )}

            {activeSection === 'audit' && (
              <div className="space-y-1.5">
                {data.auditLogs?.map((log: any) => (
                  <div key={log.id} className="flex items-start gap-2 text-xs">
                    <span className="text-xs bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 font-mono flex-shrink-0 mt-0.5">{humanize(log.action)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-600 truncate">{log.detail}</p>
                      <p className="text-slate-500 text-xs">{log.user?.fullName ?? Dr.system} · {fmt.dateTime(log.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {data && (
        <div className="border-t border-slate-100 p-3 flex gap-2 flex-shrink-0 bg-slate-50">
          {canWrite && (
            <Button size="sm" variant="outline" className="flex-1 gap-1.5 text-xs" onClick={() => onEdit(data)}>
              <Pencil className="w-3.5 h-3.5" /> {m.common.actions.edit}
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" aria-label={m.common.actions.print}
            onClick={async () => { try { await labelsApi.product([productId]); toast.success(getT().m.products.toast.labelPdf); } catch (e: any) { toast.error(e.message); } }}>
            <Printer className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="outline" className="flex-1 gap-1.5 text-xs"
            onClick={() => downloadAuthed(productsApi.exportUrl('xlsx', { search: data.code }), `${data.code}-stock.xlsx`)}>
            <Download className="w-3.5 h-3.5" /> {Dr.exportStock}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Column definitions ───────────────────────────────────────────────────────

interface ColumnDef extends ColumnMeta {
  label: string;
  hint?: string;
  td?: string;
  render: (row: any) => React.ReactNode;
}

const COLUMN_META: ColumnMeta[] = [
  ...['sku', 'brand', 'description', 'model', 'status', 'type', 'partType', 'cost', 'price', 'uom', 'category', 'ctrl'].map((id) => ({ id, group: 'identity' as ColumnGroup })),
  ...['warehouse', 'bin', 'qty', 'stockStatus', 'condition', 'source'].map((id) => ({ id, group: 'inventory' as ColumnGroup })),
  ...['serial', 'awb', 'invoice', 'poRef', 'rmaRef'].map((id) => ({ id, group: 'traceability' as ColumnGroup })),
  ...['createdOn', 'createdBy', 'receivedOn', 'receivedBy', 'modifiedOn', 'modifiedBy'].map((id) => ({ id, group: 'audit' as ColumnGroup })),
];

function buildColumns(m: Messages, fmt: ReturnType<typeof getT>['fmt'], t: ReturnType<typeof getT>['t'], onDrilldown: (row: any) => void): Record<string, ColumnDef> {
  const P = m.products;
  const C = P.cols;
  const H = P.colHints as Record<string, string>;
  const mono = 'font-mono text-xs whitespace-nowrap text-slate-600';
  const defs: Omit<ColumnDef, 'group'>[] = [
    { id: 'sku', label: C.sku, td: 'min-w-[150px]', render: (r) => (
      <>
        <p className="font-mono font-bold text-green-700 text-xs leading-none">{r.partNumber || r.code}</p>
        {r.partNumber && r.partNumber !== r.code && <p className="text-xs text-slate-400 font-mono mt-0.5">{r.code}</p>}
        {r.vendorPartNumber && <p className="text-xs text-slate-400 font-mono">{r.vendorPartNumber}</p>}
      </>
    ) },
    { id: 'brand', label: C.brand, td: 'whitespace-nowrap', render: (r) => r.brandName || '—' },
    { id: 'description', label: C.description, td: 'min-w-[200px] max-w-[280px]', render: (r) => (
      <>
        <p className={cn('font-medium text-slate-700 truncate', r.productStatus === 'DISCONTINUED' && 'line-through text-slate-400')}>{r.description || r.name}</p>
        {r.description && r.name && r.name !== r.description && <p className="text-xs text-slate-400 truncate">{r.name}</p>}
      </>
    ) },
    { id: 'model', label: C.model, td: 'whitespace-nowrap text-slate-600', render: (r) => r.model || '—' },
    { id: 'status', label: C.status, td: 'whitespace-nowrap', render: (r) => <ProductStatusBadge status={r.productStatus} /> },
    { id: 'type', label: C.type, render: (r) => <Badge variant="outline" className={cn('text-xs whitespace-nowrap rounded-full', TYPE_BADGE[r.productType])}>{labelOf(P.type, r.productType)}</Badge> },
    { id: 'partType', label: C.partType, td: 'whitespace-nowrap text-slate-600', render: (r) => r.partType || '—' },
    { id: 'cost', label: C.cost, td: 'whitespace-nowrap text-right tabular-nums', render: (r) => fmt.number(r.unitCost ?? 0) },
    { id: 'price', label: C.price, td: 'whitespace-nowrap text-right tabular-nums', render: (r) => (r.defaultPrice == null ? '—' : fmt.number(r.defaultPrice)) },
    { id: 'uom', label: C.uom, td: 'whitespace-nowrap font-medium text-slate-600', render: (r) => r.unit || '—' },
    { id: 'category', label: C.category, td: 'max-w-[120px]', render: (r) => <p className="truncate text-slate-500">{r.category || '—'}</p> },
    { id: 'ctrl', label: C.ctrl, render: (r) => (
      <div className="flex gap-1">
        <span title={r.serialControlled ? P.row.serialReq : P.row.serialNotReq}
          className={cn('text-xs px-1 py-0.5 rounded font-bold border', r.serialControlled ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-300 border-slate-200')}>S</span>
        <span title={r.batchControlled ? P.row.batchReq : P.row.batchNotReq}
          className={cn('text-xs px-1 py-0.5 rounded font-bold border', r.batchControlled ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-300 border-slate-200')}>B</span>
      </div>
    ) },
    { id: 'warehouse', label: C.warehouse, td: 'whitespace-nowrap font-medium', render: (r) => r.primaryWarehouse || '—' },
    { id: 'bin', label: C.bin, td: mono, render: (r) => [r.primaryRack, r.primarySlot].filter(Boolean).join(' › ') || '—' },
    { id: 'qty', label: C.qty, td: 'text-center', render: (r) => (
      <>
        <button onClick={(e) => { e.stopPropagation(); onDrilldown(r); }} className="font-bold text-slate-800 hover:text-green-700 hover:underline tabular-nums">{fmt.number(r.totalQty)}</button>
        {r.isLowStock && <p className="text-xs text-amber-600 font-medium mt-0.5">{P.row.low}</p>}
      </>
    ) },
    { id: 'stockStatus', label: C.stockStatus, render: (r) => <StatusDots statusCounts={r.statusCounts} /> },
    { id: 'condition', label: C.condition, td: 'whitespace-nowrap', render: (r) => (
      r.itemCondition
        ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{labelOf(P.condition, r.itemCondition)}</span>
        : r.qcCondition ? <span className="text-xs text-slate-500">{t(P.qcCondition, { value: humanize(r.qcCondition) })}</span> : '—'
    ) },
    { id: 'source', label: C.source, td: 'whitespace-nowrap text-slate-600', render: (r) => sourceTypeLabel(m, r.sourceType) },
    { id: 'serial', label: C.serial, td: 'text-center', render: (r) => (r.serialCount > 0
      ? <span className="bg-green-50 text-green-700 text-xs rounded-full px-2 py-0.5 font-bold">{r.serialCount}</span>
      : <span className="text-slate-300 text-xs">—</span>) },
    { id: 'awb', label: C.awb, td: mono, render: (r) => r.awbNumber || '—' },
    { id: 'invoice', label: C.invoice, td: mono, render: (r) => r.invoiceNumber || '—' },
    { id: 'poRef', label: C.poRef, td: mono, render: (r) => r.poNumber || '—' },
    { id: 'rmaRef', label: C.rmaRef, td: mono, render: (r) => r.rmaRef || r.receivingRmaRef || '—' },
    { id: 'createdOn', label: C.createdOn, td: 'whitespace-nowrap text-slate-500', render: (r) => fmt.date(r.createdAt) },
    { id: 'createdBy', label: C.createdBy, td: 'whitespace-nowrap text-slate-600', render: (r) => r.createdByName || '—' },
    { id: 'receivedOn', label: C.receivedOn, td: 'whitespace-nowrap text-slate-500', render: (r) => fmt.date(r.latestReceiveDate) },
    { id: 'receivedBy', label: C.receivedBy, td: 'whitespace-nowrap text-slate-600', render: (r) => r.receivedBy || '—' },
    { id: 'modifiedOn', label: C.modifiedOn, td: 'whitespace-nowrap text-slate-500', render: (r) => fmt.date(r.updatedAt) },
    { id: 'modifiedBy', label: C.modifiedBy, td: 'whitespace-nowrap text-slate-600', render: (r) => r.updatedByName || '—' },
  ];
  const groupOf = new Map(COLUMN_META.map((c) => [c.id, c.group]));
  return Object.fromEntries(defs.map((d) => [d.id, { ...d, group: groupOf.get(d.id)!, hint: H[d.id] }]));
}

// ─── Enterprise Table Row ─────────────────────────────────────────────────────

function EnterpriseRow({ row, cols, isSelected, canWrite, onSelect, onEdit, onStatusChange }: {
  row: any; cols: ColumnDef[]; isSelected: boolean; canWrite: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onStatusChange: (newStatus: string) => void;
}) {
  const { m } = useT();
  const R = m.products.row;
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className={cn('border-b border-slate-100 hover:bg-slate-50/80 transition-colors cursor-pointer text-sm',
          isSelected ? 'bg-green-50/60 ring-1 ring-inset ring-green-300' : '',
          row.hasDoa ? 'border-l-2 border-l-red-500' :
          row.hasRtv ? 'border-l-2 border-l-orange-400' :
          row.hasQuarantine ? 'border-l-2 border-l-amber-400' :
          row.isLowStock ? 'border-l-2 border-l-yellow-400' : 'border-l-2 border-l-transparent',
        )}
        onClick={onSelect}
      >
        <td className="px-2 py-2.5 w-8">
          <button onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }} className="text-slate-300 hover:text-slate-600" aria-label={R.expand} aria-expanded={expanded}>
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </td>
        {cols.map((c) => <td key={c.id} className={cn('px-3 py-2.5 text-xs', c.td)}>{c.render(row)}</td>)}
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1">
            <button onClick={(e) => { e.stopPropagation(); onSelect(); }}
              className="p-1 rounded hover:bg-green-100 text-slate-400 hover:text-green-600" title={R.viewDetail} aria-label={R.viewDetail}>
              <Eye className="w-3.5 h-3.5" />
            </button>
            {canWrite && (
              <>
                <button onClick={(e) => { e.stopPropagation(); onEdit(); }}
                  className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600" title={R.edit} aria-label={R.edit}>
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                {row.productStatus === 'ACTIVE' && (
                  <button onClick={(e) => { e.stopPropagation(); onStatusChange('INACTIVE'); }}
                    className="p-1 rounded hover:bg-amber-100 text-slate-300 hover:text-amber-600" title={R.deactivate} aria-label={R.deactivate}>
                    <PauseCircle className="w-3.5 h-3.5" />
                  </button>
                )}
                {row.productStatus !== 'ACTIVE' && (
                  <button onClick={(e) => { e.stopPropagation(); onStatusChange('ACTIVE'); }}
                    className="p-1 rounded hover:bg-green-100 text-slate-300 hover:text-green-600"
                    title={row.productStatus === 'DISCONTINUED' ? R.restore : R.reactivate} aria-label={row.productStatus === 'DISCONTINUED' ? R.restore : R.reactivate}>
                    <PlayCircle className="w-3.5 h-3.5" />
                  </button>
                )}
              </>
            )}
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-slate-50 border-b border-slate-200">
          <td colSpan={cols.length + 2} className="px-6 py-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <p className="font-semibold text-slate-600 mb-1.5 flex items-center gap-1"><Box className="w-3 h-3" /> {R.invByStatus}</p>
                {Object.entries(row.statusCounts ?? {}).map(([s, n]) => (
                  <div key={s} className="flex justify-between py-0.5 border-b border-slate-100">
                    <span className="text-slate-500">{labelOf(m.status.stock, s)}</span>
                    <span className="font-bold tabular-nums">{n as number}</span>
                  </div>
                ))}
                {Object.keys(row.statusCounts ?? {}).length === 0 && <p className="text-slate-400">{R.noStock}</p>}
              </div>
              <div>
                <p className="font-semibold text-slate-600 mb-1.5 flex items-center gap-1"><Building2 className="w-3 h-3" /> {R.location}</p>
                <div className="space-y-1">
                  <div className="flex justify-between"><span className="text-slate-500">{m.products.cols.warehouse}</span><span className="font-medium">{row.primaryWarehouse || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">{R.rack}</span><span className="font-medium font-mono">{row.primaryRack || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">{R.slot}</span><span className="font-medium font-mono">{row.primarySlot || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">{R.totalQty}</span><span className="font-bold">{row.totalQty}</span></div>
                </div>
              </div>
              <div>
                <p className="font-semibold text-slate-600 mb-1.5 flex items-center gap-1"><FileText className="w-3 h-3" /> {R.references}</p>
                <div className="space-y-1">
                  <div className="flex justify-between"><span className="text-slate-500">{m.products.cols.awb}</span><span className="font-mono">{row.awbNumber || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">{R.invoice}</span><span className="font-mono">{row.invoiceNumber || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">{R.customerCase}</span><span className="font-mono">{row.gswNumber || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">{R.rmaRef}</span><span className="font-mono">{row.rmaRef || row.receivingRmaRef || '—'}</span></div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Enterprise Product Master Tab ────────────────────────────────────────────

function EnterpriseMasterTab({ brands, warehouses, canWrite, userId, onBrandCreated }: {
  brands: any[]; warehouses: any[]; canWrite: boolean; userId?: string; onBrandCreated: (b: any) => void;
}) {
  const { m, t, fmt } = useT();
  const P = m.products;
  const [kpi, setKpi] = useState<any>(null);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  // Filters
  const [search, setSearch] = useState('');
  const [whFilter, setWhFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [productStatusFilter, setProductStatusFilter] = useState('ACTIVE');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [serialOnly, setSerialOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Selection / modals
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drilldownRow, setDrilldownRow] = useState<any>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<any>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Columns: order within group + hidden, remembered per user (plan 2.2).
  const prefs = useColumnPrefs(COLUMN_META, userId);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const columns = useMemo(() => buildColumns(m, fmt, t, setDrilldownRow), [m, fmt, t]);
  const visible = prefs.order.filter((id) => columns[id] && !prefs.hidden.includes(id)).map((id) => columns[id]);
  const groupSpans = COLUMN_GROUPS.map((g) => ({ g, span: visible.filter((c) => c.group === g).length })).filter((x) => x.span > 0);

  const loadKpi = useCallback(async () => {
    setKpiLoading(true);
    try { setKpi(await productsApi.kpi()); } catch { /* KPI is informational */ } finally { setKpiLoading(false); }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await productsApi.enterpriseList({
        search, warehouseId: whFilter, brandId: brandFilter,
        productType: typeFilter, stockStatus: statusFilter,
        productStatus: productStatusFilter || undefined,
        category: categoryFilter || undefined,
        serialOnly, page, limit: LIMIT,
      });
      setRows(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  }, [search, whFilter, brandFilter, typeFilter, statusFilter, productStatusFilter, categoryFilter, serialOnly, page]);

  useEffect(() => { loadKpi(); }, [loadKpi]);
  useEffect(() => { setPage(1); }, [search, whFilter, brandFilter, typeFilter, statusFilter, productStatusFilter, categoryFilter, serialOnly]);
  useEffect(() => { load(); }, [load]);

  async function handleStatusChange(productId: string, newStatus: string) {
    try {
      await productsApi.changeStatus(productId, newStatus);
      const T = getT().m.products.toast;
      toast.success(newStatus === 'ACTIVE' ? T.activated : newStatus === 'INACTIVE' ? T.deactivated : T.discontinued);
      load(); loadKpi();
    } catch (e: any) { toast.error(e.message); }
  }

  function openEdit(product: any) {
    setSelectedId(null); // close drawer first
    setEditProduct(product);
    setFormOpen(true);
  }

  const thBase = 'text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wide whitespace-nowrap text-slate-500 border-b border-r border-slate-200 bg-slate-50';
  const colCount = visible.length + 2;

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <KpiBar kpi={kpi} loading={kpiLoading} />

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[min(16rem,100%)]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input placeholder={P.toolbar.search} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-8 text-sm" />
        </div>
        <Button variant="outline" size="sm" className={cn('h-8 gap-1.5 text-xs', showFilters && 'bg-green-50 border-green-300 text-green-700')} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
          <Filter className="w-3.5 h-3.5" /> {P.toolbar.filters} {showFilters ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </Button>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer" title={P.toolbar.serialOnlyHint}>
          <input type="checkbox" checked={serialOnly} onChange={(e) => setSerialOnly(e.target.checked)} className="accent-green-600" />
          {P.toolbar.serialOnly}
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ColumnsMenu
            columns={COLUMN_META.map((c) => ({ ...c, label: columns[c.id]?.label ?? c.id }))}
            order={prefs.order} hidden={prefs.hidden}
            onToggle={prefs.toggle} onShift={prefs.shift} onReset={prefs.reset}
          />
          {canWrite && (
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => setImportOpen(true)}>
              <Upload className="w-3.5 h-3.5" /> {P.toolbar.import}
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => downloadAuthed(productsApi.exportUrl('xlsx'), 'products.xlsx')}>
            <Download className="w-3.5 h-3.5" /> {P.toolbar.export}
          </Button>
          {canWrite && (
            <Button size="sm" className="h-8 bg-green-600 hover:bg-green-700 text-white gap-1.5 text-xs" onClick={() => { setEditProduct(null); setFormOpen(true); }}>
              <Plus className="w-3.5 h-3.5" /> {P.toolbar.newProduct}
            </Button>
          )}
        </div>
      </div>
      {!canWrite && <p className="text-xs text-slate-500">{P.readOnly}</p>}

      {/* Filter bar */}
      {showFilters && (
        <div className="flex flex-wrap gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
          <div className="flex flex-wrap gap-2 w-full">
            <select className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white font-medium" value={productStatusFilter} onChange={(e) => setProductStatusFilter(e.target.value)}>
              <option value="">{P.filters.allProductStatus}</option>
              {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{labelOf(P.status, s)}</option>)}
            </select>
            <input className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white min-w-[140px]" placeholder={P.filters.category}
              value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} />
            <select className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">{P.filters.allTypes}</option>
              {PRODUCT_TYPES.map((x) => <option key={x} value={x}>{labelOf(P.type, x)}</option>)}
            </select>
            <select className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white" value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
              <option value="">{P.filters.allBrands}</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white" value={whFilter} onChange={(e) => setWhFilter(e.target.value)}>
              <option value="">{P.filters.allWarehouses}</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
            <select className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{P.filters.allStockStatus}</option>
              {STOCK_STATUSES.map((s) => <option key={s} value={s}>{labelOf(m.status.stock, s)}</option>)}
            </select>
          </div>
          <button onClick={() => { setWhFilter(''); setBrandFilter(''); setTypeFilter(''); setStatusFilter(''); setProductStatusFilter('ACTIVE'); setCategoryFilter(''); setSerialOnly(false); }}
            className="text-xs text-slate-500 hover:text-slate-700 px-2">{P.filters.clearAll}</button>
        </div>
      )}

      {/* Enterprise Table */}
      <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs min-w-[1200px]">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="bg-slate-50 border-b border-slate-200 w-8" />
                {groupSpans.map(({ g, span }) => (
                  <th key={g} colSpan={span} className="text-center text-xs font-semibold py-2 uppercase tracking-wide bg-slate-50 border-b border-r border-slate-200 text-slate-500">
                    {P.groups[g]}
                  </th>
                ))}
                <th className="bg-slate-50 border-b border-slate-200" />
              </tr>
              <tr>
                <th className="w-8 bg-slate-50 border-b border-slate-200" />
                {visible.map((c) => (
                  <th key={c.id} title={c.hint}
                    draggable
                    onDragStart={(e) => { setDragId(c.id); try { e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'move'; } catch { /* ignore */ } }}
                    onDragOver={(e) => { if (dragId && prefs.sameGroup(dragId, c.id)) { e.preventDefault(); setDragOver(c.id); } }}
                    onDragLeave={() => setDragOver((d) => (d === c.id ? null : d))}
                    onDrop={(e) => { e.preventDefault(); if (dragId) prefs.move(dragId, c.id); setDragId(null); setDragOver(null); }}
                    onDragEnd={() => { setDragId(null); setDragOver(null); }}
                    className={cn(thBase, 'cursor-grab select-none', dragId === c.id && 'opacity-50', dragOver === c.id && dragId !== c.id && 'bg-green-50 text-green-700')}>
                    <span className="inline-flex items-center gap-1">
                      <GripVertical className="w-3 h-3 text-slate-300" aria-hidden />
                      {c.label}
                    </span>
                  </th>
                ))}
                <th className="px-3 py-2.5 bg-slate-50 border-b border-slate-200 w-20 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">{P.cols.actions}</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? [...Array(8)].map((_, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      {[...Array(colCount)].map((_, j) => <td key={j} className="px-3 py-2.5"><Skeleton className="h-3.5" /></td>)}
                    </tr>
                  ))
                : rows.length === 0
                ? <tr><td colSpan={colCount} className="px-4 py-12 text-center text-slate-400">{P.empty}</td></tr>
                : rows.map((row) => (
                    <EnterpriseRow
                      key={row.id}
                      row={row}
                      cols={visible}
                      canWrite={canWrite}
                      isSelected={selectedId === row.id}
                      onSelect={() => setSelectedId(selectedId === row.id ? null : row.id)}
                      onEdit={() => openEdit(row)}
                      onStatusChange={(s) => handleStatusChange(row.id, s)}
                    />
                  ))}
            </tbody>
          </table>
        </div>

        {total > LIMIT && (
          <div className="flex flex-wrap gap-2 items-center justify-between px-4 py-2.5 border-t border-slate-100 bg-slate-50 flex-shrink-0">
            <p className="text-xs text-slate-500">{t(P.pagination, { total: fmt.number(total), page, pages: Math.ceil(total / LIMIT) })}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>{m.common.actions.previous}</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page >= Math.ceil(total / LIMIT)} onClick={() => setPage((p) => p + 1)}>{m.common.actions.next}</Button>
            </div>
          </div>
        )}
      </div>

      {drilldownRow && <DrilldownModal product={drilldownRow} onClose={() => setDrilldownRow(null)} />}

      {canWrite && (
        <>
          <ProductFormDialog
            open={formOpen}
            product={editProduct}
            brands={brands}
            onBrandCreated={onBrandCreated}
            onClose={() => { setFormOpen(false); setEditProduct(null); }}
            onSaved={() => { setFormOpen(false); setEditProduct(null); load(); loadKpi(); }}
          />
          <ProductImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={() => { load(); loadKpi(); }} />
        </>
      )}

      {selectedId && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSelectedId(null)} />
          <ProductDetailDrawer productId={selectedId} canWrite={canWrite} onClose={() => setSelectedId(null)} onEdit={openEdit} />
        </>
      )}
    </div>
  );
}

// ─── Stock Register Tab (3-panel) ─────────────────────────────────────────────

function StockRegisterTab({ warehouses, brands, canWrite }: { warehouses: any[]; brands: any[]; canWrite: boolean }) {
  const { m, t, fmt } = useT();
  const R = m.products.register;
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [whFilter, setWhFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await productsApi.stockRegister({ search: search || undefined, warehouseId: whFilter || undefined, brandId: brandFilter || undefined, productType: typeFilter || undefined })); }
    catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [search, whFilter, brandFilter, typeFilter]);
  useEffect(() => { load(); }, [load]);

  const stats = { total: rows.length, available: rows.filter((r) => r.status === 'AVAILABLE').length, warehouses: new Set(rows.map((r) => r.warehouseId).filter(Boolean)).size, products: new Set(rows.map((r) => r.productId)).size };

  function handleExport(format: 'xlsx' | 'csv') {
    const filter: Record<string, string> = {};
    if (search) filter.search = search;
    if (whFilter) filter.warehouseId = whFilter;
    if (brandFilter) filter.brandId = brandFilter;
    if (typeFilter) filter.productType = typeFilter;
    downloadAuthed(productsApi.exportUrl(format, filter), `stock-register.${format}`);
  }

  async function handleImport(file: File) {
    setImporting(true);
    try {
      const r = await productsApi.import(file);
      const { m: mm, t: tt } = getT();
      toast.success(tt(mm.products.register.imported, { created: r.created, updated: r.updated }));
      load();
    } catch (e: any) { toast.error(e.message); } finally { setImporting(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  const C = R.cols;
  const COLS = [
    { key: 'receiveDate',      label: C.date,         render: (r: any) => fmt.date(r.receiveDate) },
    { key: 'brand',            label: C.brand,        render: (r: any) => r.brand || '—' },
    { key: 'awbNumber',        label: C.awb,          render: (r: any) => <span className="font-mono text-xs">{r.awbNumber || '—'}</span> },
    { key: 'invoiceNumber',    label: C.invoice,      render: (r: any) => <span className="font-mono text-xs">{r.invoiceNumber || '—'}</span> },
    { key: 'gswNumber',        label: C.customerCase, render: (r: any) => <span className="font-mono text-xs">{r.gswNumber || '—'}</span> },
    { key: 'productType',      label: C.type,         render: (r: any) => <Badge variant="outline" className={cn('text-xs rounded-full', TYPE_BADGE[r.productType])}>{labelOf(m.products.type, r.productType)}</Badge> },
    { key: 'productName',      label: C.product,      render: (r: any) => <span className="font-medium">{r.productName}</span> },
    { key: 'model',            label: C.model,        render: (r: any) => r.model || '—' },
    { key: 'vendorPartNumber', label: C.vendorPart,   render: (r: any) => <span className="font-mono text-xs">{r.vendorPartNumber || '—'}</span> },
    { key: 'partNumber',       label: C.partNumber,   render: (r: any) => <span className="font-mono text-xs">{r.partNumber || '—'}</span> },
    { key: 'serialNumber',     label: C.serial,       render: (r: any) => <span className="font-mono text-xs">{r.serialNumber || '—'}</span> },
    { key: 'description',      label: C.description,  render: (r: any) => <span className="max-w-[120px] truncate block text-xs text-slate-500">{r.description || '—'}</span> },
    { key: 'warehouse',        label: C.wh,           render: (r: any) => r.warehouse || '—' },
    { key: 'qty',              label: C.qty,          render: (r: any) => <span className="font-bold">{r.qty}</span> },
  ];

  const filterDefs = [
    { label: R.warehouse, value: whFilter, onChange: setWhFilter, options: warehouses.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` })) },
    { label: R.brand, value: brandFilter, onChange: setBrandFilter, options: brands.map((b) => ({ value: b.id, label: b.name })) },
    { label: R.type, value: typeFilter, onChange: setTypeFilter, options: PRODUCT_TYPES.map((x) => ({ value: x, label: labelOf(m.products.type, x) })) },
  ];
  const actions = [
    { label: R.template, icon: FileText, action: () => downloadAuthed(productsApi.templateUrl(), 'template.xlsx'), show: true },
    { label: R.import, icon: Upload, action: () => fileRef.current?.click(), show: canWrite },
    { label: R.exportXlsx, icon: Download, action: () => handleExport('xlsx'), show: true },
    { label: R.exportCsv, icon: Download, action: () => handleExport('csv'), show: true },
  ].filter((a) => a.show);

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:h-[calc(100vh-220px)] min-h-0">
      <div className="lg:w-56 flex-shrink-0 flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <Input placeholder={R.search} className="pl-8 h-8 text-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-3 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5"><Filter className="w-3 h-3" /> {R.filters}</p>
          {filterDefs.map(({ label, value, onChange, options }) => (
            <div key={label} className="space-y-1">
              <label className="text-xs text-slate-500">{label}</label>
              <select className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
                <option value="">{R.all}</option>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5"><BarChart3 className="w-3 h-3" /> {R.summary}</p>
          {[{ label: R.totalItems, value: stats.total, icon: Box }, { label: R.available, value: stats.available, icon: CheckCircle2 }, { label: R.warehouses, value: stats.warehouses, icon: Building2 }, { label: R.products, value: stats.products, icon: Package }].map(({ label, value, icon: Icon }) => (
            <div key={label} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-slate-500"><Icon className="w-3.5 h-3.5 text-green-600" />{label}</div>
              <span className="text-xs font-bold">{loading ? '…' : fmt.number(value)}</span>
            </div>
          ))}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{R.importExport}</p>
          {actions.map(({ label, icon: Icon, action }) => (
            <Button key={label} variant="outline" size="sm" className="w-full h-7 text-xs gap-1 justify-start" onClick={action}>
              <Icon className="w-3 h-3 text-slate-500" />{label}
            </Button>
          ))}
          <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); }} />
        </div>
      </div>

      <div className="flex-1 min-w-0 min-h-[320px] flex flex-col bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex-shrink-0">
          <span className="text-xs font-semibold text-slate-600">{loading ? R.loading : t(R.items, { count: fmt.number(rows.length) })}</span>
          <span className="text-xs text-slate-400 hidden sm:inline">{R.clickRow}</span>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs min-w-[1200px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50">
                {COLS.map((c) => <th key={c.key} className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wide whitespace-nowrap text-slate-500 border-b border-slate-200">{c.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? [...Array(8)].map((_, i) => <tr key={i}>{COLS.map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3.5" /></td>)}</tr>)
                : rows.length === 0 ? <tr><td colSpan={COLS.length} className="px-4 py-12 text-center text-slate-400">{R.empty}</td></tr>
                : rows.map((r, i) => (
                  <tr key={r.id} onClick={() => setSelected(r)}
                    className={cn('cursor-pointer transition-colors', i % 2 === 1 ? 'bg-slate-50/60' : 'bg-white', selected?.id === r.id ? 'bg-green-50 ring-1 ring-inset ring-green-400' : 'hover:bg-green-50/40')}>
                    {COLS.map((c) => <td key={c.key} className="px-3 py-2 whitespace-nowrap">{c.render(r)}</td>)}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={cn('lg:w-72 flex-shrink-0 flex flex-col gap-3 transition-all', !selected && 'opacity-40 pointer-events-none')}>
        {selected ? (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 flex items-start justify-between">
              <div>
                <p className="font-bold text-slate-900 text-sm">{selected.productName}</p>
                <p className="text-slate-500 text-xs mt-0.5 font-mono">{selected.partNumber || selected.productCode}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-700" aria-label={m.common.actions.close}><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={cn('text-xs rounded-full', TYPE_BADGE[selected.productType])}>{labelOf(m.products.type, selected.productType)}</Badge>
                <Badge variant="outline" className={cn('text-xs rounded-full', STATUS_BADGE[selected.status] ?? 'bg-slate-100 text-slate-600')}>{labelOf(m.status.stock, selected.status)}</Badge>
              </div>
              {[{ label: R.sections.receiving, rows: [{ l: C.date, v: fmt.date(selected.receiveDate) }, { l: C.awb, v: selected.awbNumber || '—', mo: true }, { l: C.invoice, v: selected.invoiceNumber || '—', mo: true }, { l: C.customerCase, v: selected.gswNumber || '—', mo: true }] },
                { label: R.sections.product, rows: [{ l: C.brand, v: selected.brand || '—' }, { l: C.model, v: selected.model || '—' }, { l: C.vendorPart, v: selected.vendorPartNumber || '—', mo: true }, { l: C.partNumber, v: selected.partNumber || '—', mo: true }, { l: C.serial, v: selected.serialNumber || '—', mo: true }] },
                { label: R.sections.location, rows: [{ l: C.wh, v: selected.warehouse || '—' }, { l: C.rack, v: selected.rack || '—' }, { l: C.slot, v: selected.slot || '—' }, { l: C.qty, v: String(selected.qty) }] },
              ].map(({ label, rows: rs }) => (
                <div key={label}>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">{label}</p>
                  <div className="space-y-1">
                    {rs.map(({ l, v, mo }: { l: string; v: string; mo?: boolean }) => (
                      <div key={l} className="flex items-start justify-between gap-2 text-xs">
                        <span className="text-slate-500 flex-shrink-0">{l}</span>
                        <span className={cn('text-slate-800 text-right break-all', mo && 'font-mono')}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-slate-400 hidden lg:block">
            <ChevronRight className="w-6 h-6 mx-auto mb-2 opacity-40" />
            <p className="text-sm">{R.selectRow}</p>
          </div>
        )}
      </div>

      {importing && <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"><div className="bg-white rounded-xl p-6 text-sm font-medium text-green-700 animate-pulse">{R.importing}</div></div>}
    </div>
  );
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

function TabBar({ active, onChange }: { active: string; onChange: (t: string) => void }) {
  const { m } = useT();
  const tabs = [{ id: 'master', label: m.products.tabs.master, icon: Tag }, { id: 'register', label: m.products.tabs.register, icon: Layers }];
  return (
    <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button key={id} onClick={() => onChange(id)}
          className={cn('flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-md text-sm font-medium transition-all',
            active === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
          <Icon className="w-4 h-4" />{label}
        </button>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const { m } = useT();
  const user = useAuthStore((s) => s.user);
  const canWrite = canWriteProducts(user?.role);
  const [tab, setTab] = useState<'master' | 'register'>('master');
  const [brands, setBrands] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([warehouseApi.brands(), warehouseApi.list()])
      .then(([b, w]) => { setBrands(b); setWarehouses(w); })
      .catch(() => {});
  }, []);

  // Brand quick-add: show the new brand in every brand list right away.
  const onBrandCreated = useCallback((b: any) => {
    setBrands((list) => (list.some((x) => x.id === b.id) ? list : [...list, b].sort((a, z) => String(a.name).localeCompare(String(z.name)))));
  }, []);

  return (
    <div className="p-4 sm:p-5 flex flex-col gap-4 h-full overflow-hidden">
      <div className="flex items-center justify-between flex-wrap gap-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-green-600 rounded-xl flex items-center justify-center">
            <Tag className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-slate-900">{m.products.title}</h1>
            <p className="text-xs text-slate-500 mt-0.5">{m.products.subtitle}</p>
          </div>
        </div>
        <TabBar active={tab} onChange={(t) => setTab(t as 'master' | 'register')} />
      </div>

      {tab === 'master'
        ? <EnterpriseMasterTab brands={brands} warehouses={warehouses} canWrite={canWrite} userId={user?.id} onBrandCreated={onBrandCreated} />
        : <StockRegisterTab warehouses={warehouses} brands={brands} canWrite={canWrite} />
      }
    </div>
  );
}
