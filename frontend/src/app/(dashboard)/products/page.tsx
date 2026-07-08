'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Tag, Search, Plus, Download, Upload, X, ChevronDown, ChevronRight,
  Package, Layers, BarChart3, AlertTriangle, RefreshCw,
  FileText, Printer, Pencil, Clock, Shield, TrendingDown,
  Building2, Box, CheckCircle2, Filter, Eye, History,
  ArrowUpDown, MoreHorizontal, Info, PauseCircle, PlayCircle, Ban,
  CircleDot, Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { productsApi, warehouseApi, labelsApi } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { DiscardChangesDialog } from '@/components/ui/discard-changes-dialog';
import { useDiscardGuard } from '@/hooks/use-discard-guard';
import { cn, hasUnsavedChanges } from '@/lib/utils';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRODUCT_TYPES = ['SPARE_PART', 'FINISHED_GOODS'];
const STOCK_STATUSES = ['AVAILABLE','RESERVED','PICKING','QUARANTINE','DAMAGED','DOA','RTV_PENDING','SHIPPED'];
const PRODUCT_STATUSES = ['ACTIVE','INACTIVE','DISCONTINUED'];

const TYPE_BADGE: Record<string, string> = {
  SPARE_PART:     'bg-teal-100 text-teal-700 border-teal-200',
  FINISHED_GOODS: 'bg-emerald-100 text-emerald-700 border-emerald-200',
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
const PRODUCT_STATUS_CFG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  ACTIVE:       { label: 'Active',       bg: 'bg-green-100',  text: 'text-green-800',  dot: 'bg-green-500'  },
  INACTIVE:     { label: 'Inactive',     bg: 'bg-slate-100',  text: 'text-slate-600',  dot: 'bg-slate-400'  },
  DISCONTINUED: { label: 'Discontinued', bg: 'bg-red-100',    text: 'text-red-700',    dot: 'bg-red-400'    },
};

const BLANK = {
  code:'', name:'', description:'', manufacturer:'', model:'',
  partNumber:'', vendorPartNumber:'', productType:'SPARE_PART',
  category:'', unit:'unit', unitCost:0, minStock:0,
  serialControlled:false, batchControlled:false,
  productStatus:'ACTIVE', brandId:'',
};

function ProductStatusBadge({ status }: { status?: string }) {
  const cfg = PRODUCT_STATUS_CFG[status ?? ''] ?? { label: status || '—', bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' };
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap', cfg.bg, cfg.text)}>
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', cfg.dot)} />
      {cfg.label}
    </span>
  );
}

// ─── KPI Bar ──────────────────────────────────────────────────────────────────

function KpiBar({ kpi, loading }: { kpi: any; loading: boolean }) {
  const cards = [
    { label: 'Total SKU',       value: kpi?.totalSku,              icon: Tag,          color: 'text-slate-700',   bg: 'bg-slate-50',    border: 'border-slate-200' },
    { label: 'Active',          value: kpi?.activeCount,           icon: CircleDot,    color: 'text-green-700',   bg: 'bg-green-50',    border: 'border-green-200' },
    { label: 'Inactive',        value: kpi?.inactiveCount,         icon: PauseCircle,  color: kpi?.inactiveCount > 0 ? 'text-slate-600' : 'text-slate-400', bg: 'bg-slate-50', border: 'border-slate-200' },
    { label: 'Discontinued',    value: kpi?.discontinuedCount,     icon: Ban,          color: kpi?.discontinuedCount > 0 ? 'text-red-700' : 'text-slate-400', bg: kpi?.discontinuedCount > 0 ? 'bg-red-50' : 'bg-slate-50', border: kpi?.discontinuedCount > 0 ? 'border-red-200' : 'border-slate-200' },
    { label: 'Serial Ctrl',     value: kpi?.serializedItems,       icon: Shield,       color: 'text-slate-700',   bg: 'bg-slate-50',    border: 'border-slate-200' },
    { label: 'Batch Ctrl',      value: kpi?.batchControlledCount,  icon: Zap,          color: 'text-slate-700',   bg: 'bg-slate-50',    border: 'border-slate-200' },
    { label: 'Low Stock',       value: kpi?.lowStock,              icon: TrendingDown, color: kpi?.lowStock > 0 ? 'text-amber-700' : 'text-slate-400', bg: kpi?.lowStock > 0 ? 'bg-amber-50' : 'bg-slate-50', border: kpi?.lowStock > 0 ? 'border-amber-200' : 'border-slate-200' },
    { label: 'On Hold',         value: kpi?.quarantineCount,       icon: AlertTriangle,color: kpi?.quarantineCount > 0 ? 'text-red-700' : 'text-slate-400', bg: kpi?.quarantineCount > 0 ? 'bg-red-50' : 'bg-slate-50', border: kpi?.quarantineCount > 0 ? 'border-red-200' : 'border-slate-200' },
    { label: 'RTV Pending',     value: kpi?.rtvPendingCount,       icon: RefreshCw,    color: kpi?.rtvPendingCount > 0 ? 'text-orange-700' : 'text-slate-400', bg: kpi?.rtvPendingCount > 0 ? 'bg-orange-50' : 'bg-slate-50', border: kpi?.rtvPendingCount > 0 ? 'border-orange-200' : 'border-slate-200' },
    { label: 'DOA Items',       value: kpi?.doaCount,              icon: X,            color: kpi?.doaCount > 0 ? 'text-red-900' : 'text-slate-400', bg: kpi?.doaCount > 0 ? 'bg-red-100' : 'bg-slate-50', border: kpi?.doaCount > 0 ? 'border-red-300' : 'border-slate-200' },
    { label: 'Warehouses',      value: kpi?.totalWarehouses,       icon: Building2,    color: 'text-slate-700',   bg: 'bg-slate-50',    border: 'border-slate-200' },
    { label: 'Total Qty',       value: kpi?.totalQty?.toLocaleString(), icon: Box,     color: 'text-slate-700',   bg: 'bg-slate-50',    border: 'border-slate-200' },
  ];
  return (
    <div className="grid grid-cols-4 lg:grid-cols-6 xl:grid-cols-12 gap-2">
      {cards.map(({ label, value, icon: Icon, color, bg, border }) => (
        <div key={label} className={cn('flex items-center gap-2 px-3 py-2.5 rounded-xl border shadow-sm', bg, border)}>
          <Icon className={cn('w-4 h-4 flex-shrink-0', color)} />
          <div className="min-w-0">
            {loading ? <Skeleton className="h-5 w-10" /> : <p className={cn('text-lg font-bold tabular-nums leading-none', color)}>{value ?? 0}</p>}
            <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Status Dot ───────────────────────────────────────────────────────────────

function StatusDots({ statusCounts }: { statusCounts: Record<string, number> }) {
  const order = ['AVAILABLE','RESERVED','QUARANTINE','DOA','RTV_PENDING','DAMAGED'];
  const dotColor: Record<string, string> = {
    AVAILABLE: 'bg-green-500', RESERVED: 'bg-yellow-400',
    QUARANTINE: 'bg-red-500', DOA: 'bg-red-800',
    RTV_PENDING: 'bg-orange-500', DAMAGED: 'bg-rose-400',
  };
  return (
    <div className="flex flex-wrap gap-1">
      {order.filter((s) => statusCounts[s]).map((s) => (
        <span key={s} title={`${s}: ${statusCounts[s]}`}
          className={cn('inline-flex items-center gap-0.5 text-[10px] rounded px-1 py-0.5 font-medium', STATUS_BADGE[s] ?? 'bg-slate-100 text-slate-600')}>
          {statusCounts[s]}
        </span>
      ))}
      {Object.keys(statusCounts).length === 0 && <span className="text-slate-300 text-xs">—</span>}
    </div>
  );
}

// ─── Inventory Drilldown Modal ────────────────────────────────────────────────

function DrilldownModal({ product, onClose }: { product: any; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-green-600" /> Inventory Drilldown — {product.code}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{product.name}</p>
          {/* Status breakdown */}
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(product.statusCounts ?? {}).map(([status, count]: [string, any]) => (
              <div key={status} className={cn('rounded-lg border px-3 py-2', STATUS_BADGE[status] ?? 'bg-slate-50')}>
                <p className="text-xs font-medium">{status.replace(/_/g,' ')}</p>
                <p className="text-xl font-bold tabular-nums">{count}</p>
              </div>
            ))}
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><p className="text-slate-400 text-xs">Total Qty</p><p className="font-bold">{product.totalQty}</p></div>
              <div><p className="text-slate-400 text-xs">Primary WH</p><p className="font-bold">{product.primaryWarehouse || '—'}</p></div>
              <div><p className="text-slate-400 text-xs">Inventory Value</p><p className="font-bold">฿{(product.inventoryValue ?? 0).toLocaleString()}</p></div>
            </div>
          </div>
          {product.ownershipTypes?.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-1">Ownership Types</p>
              <div className="flex gap-1 flex-wrap">
                {product.ownershipTypes.map((o: string) => (
                  <span key={o} className="text-xs bg-green-100 text-green-700 rounded px-2 py-0.5 font-medium">{o}</span>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Product Detail Drawer ────────────────────────────────────────────────────

function ProductDetailDrawer({ productId, onClose, onEdit }: { productId: string; onClose: () => void; onEdit: (data: any) => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('info');

  useEffect(() => {
    setLoading(true);
    productsApi.detailFull(productId)
      .then(setData)
      .catch(() => toast.error('Failed to load product detail'))
      .finally(() => setLoading(false));
  }, [productId]);

  const sections = [
    { id: 'info',      label: 'Product Info',       icon: Info },
    { id: 'inventory', label: 'Inventory',           icon: Box },
    { id: 'serials',   label: 'Serials',             icon: Shield },
    { id: 'movement',  label: 'Movement',            icon: History },
    { id: 'rtv',       label: 'RTV / RMA',           icon: RefreshCw },
    { id: 'audit',     label: 'Audit',               icon: Clock },
  ];

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-[480px] bg-white shadow-2xl border-l border-slate-200 flex flex-col">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between bg-slate-50">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <p className="font-bold text-slate-900">{loading ? '…' : data?.name}</p>
            {data?.productStatus && <ProductStatusBadge status={data.productStatus} />}
          </div>
          <p className="text-slate-500 text-xs font-mono">{loading ? '' : data?.code}</p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 mt-0.5"><X className="w-5 h-5" /></button>
      </div>

      {/* Section tabs */}
      <div className="flex overflow-x-auto border-b border-slate-100 flex-shrink-0 bg-slate-50">
        {sections.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveSection(id)}
            className={cn('flex items-center gap-1 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors',
              activeSection === id ? 'border-green-600 text-green-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : !data ? (
          <p className="text-slate-400 text-center py-10">Failed to load</p>
        ) : (
          <>
            {/* Product Info */}
            {activeSection === 'info' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'SKU / Code', value: data.code, mono: true },
                    { label: 'Part Number', value: data.partNumber || '—', mono: true },
                    { label: 'Vendor P/N', value: data.vendorPartNumber || '—', mono: true },
                    { label: 'Brand', value: data.brand?.name || '—' },
                    { label: 'Manufacturer', value: data.manufacturer || '—' },
                    { label: 'Model', value: data.model || '—' },
                    { label: 'Type', value: data.productType?.replace('_',' ') || '—' },
                    { label: 'Category', value: data.category || '—' },
                    { label: 'Unit', value: data.unit || '—' },
                    { label: 'Unit Cost', value: data.unitCost ? `฿${data.unitCost.toLocaleString()}` : '—' },
                    { label: 'Min Stock', value: String(data.minStock) },
                    { label: 'Serial Controlled', value: data.serialControlled ? 'Yes' : 'No' },
                    { label: 'Batch Controlled', value: data.batchControlled ? 'Yes' : 'No' },
                    { label: 'Product Status', value: PRODUCT_STATUS_CFG[data.productStatus]?.label ?? data.productStatus ?? '—' },
                  ].map(({ label, value, mono }) => (
                    <div key={label} className="bg-slate-50 rounded-lg p-2">
                      <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{label}</p>
                      <p className={cn('text-sm text-slate-800 font-medium mt-0.5 break-all', mono && 'font-mono text-xs')}>{value}</p>
                    </div>
                  ))}
                </div>
                {data.description && (
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide mb-1">Description</p>
                    <p className="text-sm text-slate-700 leading-relaxed">{data.description}</p>
                  </div>
                )}
              </div>
            )}

            {/* Inventory */}
            {activeSection === 'inventory' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-green-700">{data._count?.stockItems ?? 0}</p>
                    <p className="text-xs text-green-500">Total Stock Items</p>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-green-700">{data.stockItems?.filter((i: any) => i.status === 'AVAILABLE').length ?? 0}</p>
                    <p className="text-xs text-green-500">Available</p>
                  </div>
                </div>
                {/* By warehouse */}
                {(() => {
                  const byWh: Record<string, { name: string; count: number; qty: number }> = {};
                  data.stockItems?.forEach((si: any) => {
                    const k = si.warehouse?.code ?? 'Unknown';
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
                          <p className="text-[10px] text-slate-400">{info.name}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-slate-800">{info.qty}</p>
                        <p className="text-[10px] text-slate-400">{info.count} items</p>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}

            {/* Serials */}
            {activeSection === 'serials' && (
              <div className="space-y-2">
                {data.stockItems?.filter((i: any) => i.serialNumber).length === 0
                  ? <p className="text-slate-400 text-center py-6 text-sm">No serialized items</p>
                  : data.stockItems?.filter((i: any) => i.serialNumber).map((si: any) => (
                    <div key={si.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                      <div>
                        <p className="font-mono text-xs font-bold text-green-700">{si.serialNumber}</p>
                        <p className="text-[10px] text-slate-400">{[si.warehouse?.code, si.rack?.code, si.slot?.code].filter(Boolean).join(' › ')}</p>
                      </div>
                      <span className={cn('text-[10px] rounded px-1.5 py-0.5 font-medium', STATUS_BADGE[si.status] ?? 'bg-slate-100 text-slate-600')}>{si.status}</span>
                    </div>
                  ))}
              </div>
            )}

            {/* Movement */}
            {activeSection === 'movement' && (
              <div className="space-y-2">
                {data.stockItems?.slice(0, 15).map((si: any) => (
                  <div key={si.id} className="flex items-start gap-2 border-l-2 border-green-400 pl-3 py-1">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-700">Received {si.serialNumber ? `· ${si.serialNumber}` : ''}</p>
                      <p className="text-[10px] text-slate-400">{[si.warehouse?.code, si.rack?.code].filter(Boolean).join(' › ')} · Qty: {si.quantity}</p>
                      {si.goodsReceivingItems?.[0]?.receiving && (
                        <p className="text-[10px] text-slate-400 font-mono">{si.goodsReceivingItems[0].receiving.refNumber}</p>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 flex-shrink-0">{si.receivedDate ? new Date(si.receivedDate).toLocaleDateString('th-TH') : '—'}</p>
                  </div>
                ))}
              </div>
            )}

            {/* RTV / RMA */}
            {activeSection === 'rtv' && (
              <div className="space-y-2">
                {data.withdrawalRequestItems?.length === 0
                  ? <p className="text-slate-400 text-center py-6 text-sm">No RTV/RMA references</p>
                  : data.withdrawalRequestItems?.map((wri: any) => (
                    <div key={wri.id} className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-orange-700">{wri.request?.refNumber}</span>
                        <span className="text-[10px] bg-orange-200 text-orange-800 rounded px-1.5 py-0.5">{wri.request?.status?.replace(/_/g,' ')}</span>
                      </div>
                      {wri.request?.rmaCaseNumber && <p className="text-xs text-orange-600 mt-0.5">RMA: {wri.request.rmaCaseNumber}</p>}
                      <p className="text-[10px] text-orange-500 mt-0.5">{wri.request?.department} · {wri.request?.createdAt ? new Date(wri.request.createdAt).toLocaleDateString('th-TH') : ''}</p>
                    </div>
                  ))}
              </div>
            )}

            {/* Audit */}
            {activeSection === 'audit' && (
              <div className="space-y-1.5">
                {data.auditLogs?.map((log: any) => (
                  <div key={log.id} className="flex items-start gap-2 text-xs">
                    <span className="text-[10px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 font-mono flex-shrink-0 mt-0.5">{log.action.replace(/_/g,' ')}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-600 truncate">{log.detail}</p>
                      <p className="text-slate-400 text-[10px]">{log.user?.fullName ?? 'System'} · {new Date(log.createdAt).toLocaleString('th-TH')}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer actions */}
      {data && (
        <div className="border-t border-slate-100 p-3 flex gap-2 flex-shrink-0 bg-slate-50">
          <Button size="sm" variant="outline" className="flex-1 gap-1.5 text-xs" onClick={() => data && onEdit(data)}>
            <Pencil className="w-3.5 h-3.5" /> Edit
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs"
            onClick={async () => { try { await labelsApi.product([productId]); toast.success('Label PDF'); } catch (e: any) { toast.error(e.message); } }}>
            <Printer className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="outline" className="flex-1 gap-1.5 text-xs"
            onClick={() => {
              const token = localStorage.getItem('wms_token');
              const url = productsApi.exportUrl('xlsx', { search: data.code });
              fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
                .then((r) => r.blob())
                .then((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${data.code}-stock.xlsx`; a.click(); });
            }}>
            <Download className="w-3.5 h-3.5" /> Export
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Enterprise Table Row ─────────────────────────────────────────────────────

function EnterpriseRow({ row, isSelected, onSelect, onDrilldown, onEdit, onStatusChange }: {
  row: any; isSelected: boolean;
  onSelect: () => void;
  onDrilldown: () => void;
  onEdit: () => void;
  onStatusChange: (newStatus: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const fmt = (d: any) => d ? new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';

  return (
    <>
      <tr
        className={cn('border-b border-slate-100 hover:bg-slate-50/80 transition-colors cursor-pointer text-xs',
          isSelected ? 'bg-green-50/60 ring-1 ring-inset ring-green-300' : '',
          row.hasDoa ? 'border-l-2 border-l-red-500' :
          row.hasRtv ? 'border-l-2 border-l-orange-400' :
          row.hasQuarantine ? 'border-l-2 border-l-amber-400' :
          row.isLowStock ? 'border-l-2 border-l-yellow-400' : 'border-l-2 border-l-transparent',
        )}
        onClick={onSelect}
      >
        {/* Expand */}
        <td className="px-2 py-2.5 w-8">
          <button onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            className="text-slate-300 hover:text-slate-600">
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </td>

        {/* IDENTITY */}
        <td className="px-3 py-2.5 min-w-[140px]">
          <p className="font-mono font-bold text-green-700 text-xs leading-none">{row.code}</p>
          {row.partNumber && <p className="text-[10px] text-slate-400 font-mono mt-0.5">{row.partNumber}</p>}
          {row.vendorPartNumber && <p className="text-[10px] text-slate-300 font-mono">{row.vendorPartNumber}</p>}
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap">{row.brandName || '—'}</td>
        <td className="px-3 py-2.5 whitespace-nowrap">
          <p className={cn('font-medium text-slate-700', row.productStatus === 'DISCONTINUED' && 'line-through text-slate-400')}>{row.name}</p>
          {row.model && <p className="text-[10px] text-slate-400">{row.manufacturer ? `${row.manufacturer} · ` : ''}{row.model}</p>}
        </td>
        <td className="px-3 py-2.5">
          <Badge variant="outline" className={cn('text-[11px] whitespace-nowrap', TYPE_BADGE[row.productType])}>{row.productType?.replace('_',' ')}</Badge>
        </td>
        <td className="px-3 py-2.5 max-w-[160px]"><p className="truncate text-slate-500">{row.description || '—'}</p></td>

        {/* STATUS */}
        <td className="px-3 py-2.5 whitespace-nowrap"><ProductStatusBadge status={row.productStatus} /></td>

        {/* UOM */}
        <td className="px-3 py-2.5 whitespace-nowrap text-xs font-medium text-slate-600">{row.unit || '—'}</td>

        {/* CATEGORY */}
        <td className="px-3 py-2.5 max-w-[100px]"><p className="truncate text-xs text-slate-500">{row.category || '—'}</p></td>

        {/* CONTROLS (S/B badges) */}
        <td className="px-3 py-2.5">
          <div className="flex gap-1">
            <span className={cn('text-[10px] px-1 py-0.5 rounded font-bold border', row.serialControlled ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-slate-50 text-slate-300 border-slate-200')}>S</span>
            <span className={cn('text-[10px] px-1 py-0.5 rounded font-bold border', row.batchControlled ? 'bg-violet-100 text-violet-700 border-violet-200' : 'bg-slate-50 text-slate-300 border-slate-200')}>B</span>
          </div>
        </td>

        {/* INVENTORY */}
        <td className="px-3 py-2.5 whitespace-nowrap font-medium">{row.primaryWarehouse || '—'}</td>
        <td className="px-3 py-2.5 whitespace-nowrap font-mono text-[11px] text-slate-500">
          {[row.primaryRack, row.primarySlot].filter(Boolean).join(' › ') || '—'}
        </td>
        <td className="px-3 py-2.5 text-center">
          <button onClick={(e) => { e.stopPropagation(); onDrilldown(); }}
            className="font-bold text-slate-800 hover:text-green-700 hover:underline tabular-nums">{row.totalQty}</button>
          {row.isLowStock && <p className="text-[10px] text-amber-600 font-medium mt-0.5">LOW</p>}
        </td>
        <td className="px-3 py-2.5"><StatusDots statusCounts={row.statusCounts} /></td>
        <td className="px-3 py-2.5 whitespace-nowrap text-[11px] text-slate-500">{row.sourceType?.replace(/_/g,' ') || '—'}</td>

        {/* TRACEABILITY */}
        <td className="px-3 py-2.5 text-center">
          {row.serialCount > 0
            ? <span className="bg-indigo-100 text-indigo-700 text-[11px] rounded px-1.5 py-0.5 font-bold">{row.serialCount}</span>
            : <span className="text-slate-300 text-[11px]">—</span>}
        </td>
        <td className="px-3 py-2.5 font-mono text-[11px] whitespace-nowrap text-slate-500">{row.awbNumber || '—'}</td>
        <td className="px-3 py-2.5 font-mono text-[11px] whitespace-nowrap text-slate-500">{row.invoiceNumber || '—'}</td>
        <td className="px-3 py-2.5 font-mono text-[11px] whitespace-nowrap text-slate-500">{row.rmaRef || '—'}</td>

        {/* AUDIT */}
        <td className="px-3 py-2.5 whitespace-nowrap text-slate-400">{fmt(row.createdAt)}</td>
        <td className="px-3 py-2.5 whitespace-nowrap text-slate-400">{fmt(row.latestReceiveDate)}</td>

        {/* Actions */}
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1">
            <button onClick={(e) => { e.stopPropagation(); onSelect(); }}
              className="p-1 rounded hover:bg-green-100 text-slate-400 hover:text-green-600" title="View detail">
              <Eye className="w-3.5 h-3.5" />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600" title="Edit product">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            {row.productStatus === 'ACTIVE' && (
              <button onClick={(e) => { e.stopPropagation(); onStatusChange('INACTIVE'); }}
                className="p-1 rounded hover:bg-amber-100 text-slate-300 hover:text-amber-600" title="Deactivate">
                <PauseCircle className="w-3.5 h-3.5" />
              </button>
            )}
            {row.productStatus === 'INACTIVE' && (
              <button onClick={(e) => { e.stopPropagation(); onStatusChange('ACTIVE'); }}
                className="p-1 rounded hover:bg-green-100 text-slate-300 hover:text-green-600" title="Reactivate">
                <PlayCircle className="w-3.5 h-3.5" />
              </button>
            )}
            {row.productStatus === 'DISCONTINUED' && (
              <button onClick={(e) => { e.stopPropagation(); onStatusChange('ACTIVE'); }}
                className="p-1 rounded hover:bg-green-100 text-slate-300 hover:text-green-600" title="Restore to Active">
                <PlayCircle className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* Expanded row */}
      {expanded && (
        <tr className="bg-slate-50 border-b border-slate-200">
          <td colSpan={22} className="px-6 py-3">
            <div className="grid grid-cols-3 gap-4 text-xs">
              <div>
                <p className="font-semibold text-slate-600 mb-1.5 flex items-center gap-1"><Box className="w-3 h-3" /> Inventory by Status</p>
                {Object.entries(row.statusCounts ?? {}).map(([s, n]) => (
                  <div key={s} className="flex justify-between py-0.5 border-b border-slate-100">
                    <span className="text-slate-500">{s.replace(/_/g,' ')}</span>
                    <span className="font-bold tabular-nums">{n as number}</span>
                  </div>
                ))}
                {Object.keys(row.statusCounts ?? {}).length === 0 && <p className="text-slate-400">No stock</p>}
              </div>
              <div>
                <p className="font-semibold text-slate-600 mb-1.5 flex items-center gap-1"><Building2 className="w-3 h-3" /> Location</p>
                <div className="space-y-1">
                  <div className="flex justify-between"><span className="text-slate-400">Warehouse</span><span className="font-medium">{row.primaryWarehouse || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Rack</span><span className="font-medium font-mono">{row.primaryRack || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Slot</span><span className="font-medium font-mono">{row.primarySlot || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Total Qty</span><span className="font-bold">{row.totalQty}</span></div>
                </div>
              </div>
              <div>
                <p className="font-semibold text-slate-600 mb-1.5 flex items-center gap-1"><FileText className="w-3 h-3" /> References</p>
                <div className="space-y-1">
                  <div className="flex justify-between"><span className="text-slate-400">AWB</span><span className="font-mono">{row.awbNumber || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Invoice</span><span className="font-mono">{row.invoiceNumber || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Customer Case</span><span className="font-mono">{row.gswNumber || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">RMA Ref</span><span className="font-mono">{row.rmaRef || '—'}</span></div>
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

function EnterpriseMasterTab({ brands, warehouses }: { brands: any[]; warehouses: any[] }) {
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

  // Create/Edit dialog
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(BLANK);
  const [formBaseline, setFormBaseline] = useState<any>(BLANK); // snapshot at open-time, for the unsaved-changes guard
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const [importing, setImporting] = useState(false);

  const loadKpi = useCallback(async () => {
    setKpiLoading(true);
    try { setKpi(await productsApi.kpi()); } finally { setKpiLoading(false); }
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
    } finally { setLoading(false); }
  }, [search, whFilter, brandFilter, typeFilter, statusFilter, productStatusFilter, categoryFilter, serialOnly, page]);

  useEffect(() => { loadKpi(); }, [loadKpi]);
  useEffect(() => { setPage(1); }, [search, whFilter, brandFilter, typeFilter, statusFilter, productStatusFilter, categoryFilter, serialOnly]);
  useEffect(() => { load(); }, [load]);

  async function handleStatusChange(productId: string, newStatus: string) {
    try {
      await productsApi.changeStatus(productId, newStatus);
      toast.success(`Product ${newStatus === 'ACTIVE' ? 'activated' : newStatus === 'INACTIVE' ? 'deactivated' : 'discontinued'}`);
      load(); loadKpi();
    } catch (e: any) { toast.error(e.message); }
  }

  function openEdit(product: any) {
    setEditId(product.id);
    const loaded = {
      code: product.code ?? '',
      name: product.name ?? '',
      description: product.description ?? '',
      manufacturer: product.manufacturer ?? '',
      model: product.model ?? '',
      partNumber: product.partNumber ?? '',
      vendorPartNumber: product.vendorPartNumber ?? '',
      productType: product.productType ?? 'SPARE_PART',
      category: product.category ?? '',
      unit: product.unit ?? 'unit',
      unitCost: product.unitCost ?? 0,
      minStock: product.minStock ?? 0,
      serialControlled: product.serialControlled ?? false,
      batchControlled: product.batchControlled ?? false,
      productStatus: product.productStatus ?? 'ACTIVE',
      brandId: product.brandId ?? product.brand?.id ?? '',
    };
    setForm(loaded);
    setFormBaseline(loaded);
    setSelectedId(null); // close drawer first
    setOpen(true);
  }

  async function submit() {
    setBusy(true);
    try {
      if (editId) { const { code, ...updatePayload } = form; await productsApi.update(editId, updatePayload); toast.success('Updated'); }
      else { await productsApi.create({ ...form, unitCost: Number(form.unitCost), minStock: Number(form.minStock), brandId: form.brandId || undefined }); toast.success('Created'); }
      setOpen(false); setForm(BLANK); setFormBaseline(BLANK); setEditId(null); load(); loadKpi();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  const formIsDirty = hasUnsavedChanges(form, formBaseline);
  const formGuard = useDiscardGuard(formIsDirty, () => {
    setOpen(false); setForm(BLANK); setFormBaseline(BLANK); setEditId(null);
  });

  async function handleImport(file: File) {
    setImporting(true);
    try { const r = await productsApi.import(file); setImportResult(r); toast.success(`Import: ${r.created} created, ${r.updated} updated`); load(); loadKpi(); }
    catch (e: any) { toast.error(e.message); } finally { setImporting(false); }
  }

  const F = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f: any) => ({ ...f, [k]: e.target.value }));

  const COL_GROUPS = [
    { label: 'Product Identity', cols: 9, accent: 'text-slate-500' },
    { label: 'Inventory Context', cols: 5, accent: 'text-green-700' },
    { label: 'Traceability', cols: 4, accent: 'text-teal-700' },
    { label: 'Operational Audit', cols: 2, accent: 'text-indigo-600' },
    { label: '', cols: 1, accent: 'text-slate-500' },
  ];

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* KPI */}
      <KpiBar kpi={kpi} loading={kpiLoading} />

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input placeholder="Search SKU, Part#, Serial, AWB, Invoice, Model, Description…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-8 text-sm" />
        </div>
        <Button variant="outline" size="sm" className={cn('h-8 gap-1.5 text-xs', showFilters && 'bg-green-50 border-green-300 text-green-700')} onClick={() => setShowFilters((v) => !v)}>
          <Filter className="w-3.5 h-3.5" /> Filters {showFilters ? '▲' : '▼'}
        </Button>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input type="checkbox" checked={serialOnly} onChange={(e) => setSerialOnly(e.target.checked)} className="accent-green-600" />
          Serialized Only
        </label>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => fileRef.current?.click()}>
            <Upload className="w-3.5 h-3.5" /> Import
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); }} />
          <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => { const token = localStorage.getItem('wms_token'); fetch(productsApi.exportUrl('xlsx'), { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then((r) => r.blob()).then((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'products.xlsx'; a.click(); }); }}>
            <Download className="w-3.5 h-3.5" /> Export
          </Button>
          <Button size="sm" className="h-8 bg-green-600 hover:bg-green-700 text-white gap-1.5 text-xs" onClick={() => { setEditId(null); setForm(BLANK); setFormBaseline(BLANK); setOpen(true); }}>
            <Plus className="w-3.5 h-3.5" /> New Product
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div className="flex flex-wrap gap-2 bg-green-50 border border-green-200 rounded-xl p-3">
          {/* Row 1: Product-level filters */}
          <div className="flex flex-wrap gap-2 w-full">
            <select className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white font-medium" value={productStatusFilter} onChange={(e) => setProductStatusFilter(e.target.value)}>
              <option value="">All Product Status</option>
              {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white min-w-[140px]"
              placeholder="Filter by Category…"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            />
            <select className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All Types</option>
              {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{t.replace('_',' ')}</option>)}
            </select>
            <select className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white" value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
              <option value="">All Brands</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white" value={whFilter} onChange={(e) => setWhFilter(e.target.value)}>
              <option value="">All Warehouses</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
            <select className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Stock Status</option>
              {STOCK_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
            </select>
          </div>
          <button onClick={() => { setWhFilter(''); setBrandFilter(''); setTypeFilter(''); setStatusFilter(''); setProductStatusFilter('ACTIVE'); setCategoryFilter(''); setSerialOnly(false); }}
            className="text-xs text-slate-400 hover:text-slate-600 px-2">Clear all</button>
        </div>
      )}

      {/* Import result */}
      {importing && <div className="text-center text-sm text-green-600 animate-pulse py-2">Importing…</div>}
      {importResult && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 flex items-center gap-3 text-sm">
          <CheckCircle2 className="w-4 h-4 text-green-600" />
          <span>Import complete: <strong>{importResult.created}</strong> created · <strong>{importResult.updated}</strong> updated</span>
          {importResult.errors?.length > 0 && <span className="text-red-600">{importResult.errors.length} errors</span>}
          <button onClick={() => setImportResult(null)} className="ml-auto text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Enterprise Table */}
      <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs min-w-[1800px]">
            <thead className="sticky top-0 z-10">
              {/* Group headers */}
              <tr>
                <th className="bg-slate-100 border-b border-slate-200 w-8" />
                {COL_GROUPS.map((g, i) => (
                  <th key={i} colSpan={g.cols} className={cn('text-center text-[10px] font-bold py-2 uppercase tracking-widest bg-slate-100 border-b border-r border-slate-200', g.accent)}>
                    {g.label}
                  </th>
                ))}
              </tr>
              {/* Column headers */}
              <tr className="bg-slate-50">
                <th className="w-8 bg-slate-50 border-b border-slate-200" />
                {/* Identity */}
                {['SKU / Part #','Brand','Product / Model','Type','Description','Status','UOM','Category','Ctrl'].map((h) => (
                  <th key={h} className="text-left px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wide whitespace-nowrap text-slate-500 border-b border-r border-slate-200">{h}</th>
                ))}
                {/* Inventory */}
                {['Warehouse','Bin / Rack','Qty','Condition','Source'].map((h) => (
                  <th key={h} className="text-left px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wide whitespace-nowrap text-slate-500 border-b border-r border-slate-200">{h}</th>
                ))}
                {/* Traceability */}
                {['Serial','AWB','Invoice No.','RMA Ref'].map((h) => (
                  <th key={h} className="text-left px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wide whitespace-nowrap text-slate-500 border-b border-r border-slate-200">{h}</th>
                ))}
                {/* Audit */}
                {['Created','Received'].map((h) => (
                  <th key={h} className="text-left px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wide whitespace-nowrap text-slate-500 border-b border-r border-slate-200">{h}</th>
                ))}
                <th className="px-3 py-2.5 bg-slate-50 border-b border-slate-200 w-16 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">Act</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? [...Array(8)].map((_, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      {[...Array(22)].map((_, j) => <td key={j} className="px-3 py-2.5"><Skeleton className="h-3.5" /></td>)}
                    </tr>
                  ))
                : rows.length === 0
                ? <tr><td colSpan={22} className="px-4 py-12 text-center text-slate-400">No products found</td></tr>
                : rows.map((row) => (
                    <EnterpriseRow
                      key={row.id}
                      row={row}
                      isSelected={selectedId === row.id}
                      onSelect={() => setSelectedId(selectedId === row.id ? null : row.id)}
                      onDrilldown={() => setDrilldownRow(row)}
                      onEdit={() => openEdit(row)}
                      onStatusChange={(s) => handleStatusChange(row.id, s)}
                    />
                  ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > LIMIT && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 bg-slate-50 flex-shrink-0">
            <p className="text-xs text-slate-500">{total.toLocaleString()} products · Page {page} of {Math.ceil(total / LIMIT)}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page >= Math.ceil(total / LIMIT)} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {drilldownRow && <DrilldownModal product={drilldownRow} onClose={() => setDrilldownRow(null)} />}

      {/* Create/Edit Dialog */}
      <Dialog open={open} onOpenChange={(o) => { if (o) setOpen(true); else formGuard.requestClose(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? 'Edit Product' : 'New Product'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1"><Label>Code *</Label><Input value={form.code} onChange={F('code')} disabled={!!editId} /></div>
            <div className="space-y-1"><Label>Name *</Label><Input value={form.name} onChange={F('name')} /></div>
            <div className="space-y-1"><Label>Manufacturer</Label><Input value={form.manufacturer} onChange={F('manufacturer')} /></div>
            <div className="space-y-1"><Label>Model</Label><Input value={form.model} onChange={F('model')} /></div>
            <div className="space-y-1"><Label>Part Number</Label><Input value={form.partNumber} onChange={F('partNumber')} /></div>
            <div className="space-y-1"><Label>Vendor P/N</Label><Input value={form.vendorPartNumber} onChange={F('vendorPartNumber')} /></div>
            <div className="space-y-1"><Label>Product Type</Label>
              <Select value={form.productType} onValueChange={(v) => setForm((f: any) => ({ ...f, productType: v ?? 'SPARE_PART' }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRODUCT_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace('_',' ')}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Brand</Label>
              <Select
                items={brands.map((b) => ({ value: b.id, label: b.name }))}
                value={form.brandId}
                onValueChange={(v) => setForm((f: any) => ({ ...f, brandId: v ?? '' }))}
              >
                <SelectTrigger><SelectValue placeholder="Select brand" /></SelectTrigger>
                <SelectContent className="max-h-48">{brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Unit Cost (฿)</Label><Input type="number" value={form.unitCost} onChange={F('unitCost')} /></div>
            <div className="space-y-1"><Label>Min Stock</Label><Input type="number" value={form.minStock} onChange={F('minStock')} /></div>
            <div className="space-y-1"><Label>Serial Controlled</Label>
              <div className="flex items-center gap-2 pt-1">
                <button type="button" onClick={() => setForm((f: any) => ({ ...f, serialControlled: !f.serialControlled }))}
                  className={cn('relative inline-flex h-6 w-11 items-center rounded-full transition-colors', form.serialControlled ? 'bg-indigo-600' : 'bg-slate-300')}>
                  <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform', form.serialControlled ? 'translate-x-6' : 'translate-x-1')} />
                </button>
                <span className="text-sm text-slate-600">{form.serialControlled ? 'Required' : 'Not required'}</span>
              </div>
            </div>
            <div className="space-y-1"><Label>Batch Controlled</Label>
              <div className="flex items-center gap-2 pt-1">
                <button type="button" onClick={() => setForm((f: any) => ({ ...f, batchControlled: !f.batchControlled }))}
                  className={cn('relative inline-flex h-6 w-11 items-center rounded-full transition-colors', form.batchControlled ? 'bg-violet-600' : 'bg-slate-300')}>
                  <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform', form.batchControlled ? 'translate-x-6' : 'translate-x-1')} />
                </button>
                <span className="text-sm text-slate-600">{form.batchControlled ? 'Required' : 'Not required'}</span>
              </div>
            </div>
            <div className="space-y-1"><Label>Product Status</Label>
              <Select value={form.productStatus} onValueChange={(v) => setForm((f: any) => ({ ...f, productStatus: v ?? 'ACTIVE' }))}>
                <SelectTrigger>
                  <span className={cn('flex flex-1 text-left text-sm', !form.productStatus && 'text-muted-foreground')}>
                    {form.productStatus ? PRODUCT_STATUS_CFG[form.productStatus]?.label ?? form.productStatus : 'Select status'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active — orderable &amp; receivable</SelectItem>
                  <SelectItem value="INACTIVE">Inactive — hidden from receiving</SelectItem>
                  {editId && <SelectItem value="DISCONTINUED">Discontinued — end of life</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1"><Label>Description</Label>
              <Textarea value={form.description} onChange={F('description')} rows={3} className="resize-y" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={formGuard.requestClose}>Cancel</Button>
            <Button onClick={submit} className="bg-green-600 hover:bg-green-700 text-white" disabled={busy}>{busy ? 'Saving…' : editId ? 'Save' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DiscardChangesDialog open={formGuard.confirming} onKeepEditing={formGuard.keepEditing} onDiscard={formGuard.confirmDiscard} />

      {/* Detail Drawer */}
      {selectedId && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSelectedId(null)} />
          <ProductDetailDrawer productId={selectedId} onClose={() => setSelectedId(null)} onEdit={openEdit} />
        </>
      )}
    </div>
  );
}

// ─── Stock Register Tab (3-panel) ─────────────────────────────────────────────

function StockRegisterTab({ warehouses, brands }: { warehouses: any[]; brands: any[] }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [whFilter, setWhFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await productsApi.stockRegister({ search: search||undefined, warehouseId: whFilter||undefined, brandId: brandFilter||undefined, productType: typeFilter||undefined })); }
    finally { setLoading(false); }
  }, [search, whFilter, brandFilter, typeFilter]);
  useEffect(() => { load(); }, [load]);

  const stats = { total: rows.length, available: rows.filter((r) => r.status === 'AVAILABLE').length, warehouses: new Set(rows.map((r) => r.warehouseId).filter(Boolean)).size, products: new Set(rows.map((r) => r.productId)).size };

  function handleExport(fmt: 'xlsx' | 'csv') {
    const token = typeof window !== 'undefined' ? localStorage.getItem('wms_token') : '';
    const filter: Record<string, string> = {};
    if (search) filter.search = search;
    if (whFilter) filter.warehouseId = whFilter;
    if (brandFilter) filter.brandId = brandFilter;
    if (typeFilter) filter.productType = typeFilter;
    const url = productsApi.exportUrl(fmt, filter);
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then((r) => r.blob()).then((blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `stock-register.${fmt}`; a.click(); });
  }

  async function handleImport(file: File) {
    setImporting(true);
    try { const r = await productsApi.import(file); setImportResult(r); toast.success(`Import: ${r.created} created, ${r.updated} updated`); load(); }
    catch (e: any) { toast.error(e.message); } finally { setImporting(false); }
  }

  const COLS = [
    { key: 'receiveDate',      label: 'Date',        render: (r: any) => r.receiveDate ? new Date(r.receiveDate).toLocaleDateString('th-TH') : '—' },
    { key: 'brand',            label: 'Brand',       render: (r: any) => r.brand || '—' },
    { key: 'awbNumber',        label: 'AWB',         render: (r: any) => <span className="font-mono text-xs">{r.awbNumber || '—'}</span> },
    { key: 'invoiceNumber',    label: 'Invoice No.', render: (r: any) => <span className="font-mono text-xs">{r.invoiceNumber || '—'}</span> },
    { key: 'gswNumber',        label: 'Customer Case',     render: (r: any) => <span className="font-mono text-xs">{r.gswNumber || '—'}</span> },
    { key: 'productType',      label: 'Type',        render: (r: any) => <Badge variant="outline" className={cn('text-[11px]', TYPE_BADGE[r.productType])}>{r.productType?.replace('_',' ')}</Badge> },
    { key: 'productName',      label: 'Product',     render: (r: any) => <span className="font-medium">{r.productName}</span> },
    { key: 'model',            label: 'Model',       render: (r: any) => r.model || '—' },
    { key: 'vendorPartNumber', label: 'Vendor P/N',  render: (r: any) => <span className="font-mono text-xs">{r.vendorPartNumber || '—'}</span> },
    { key: 'partNumber',       label: 'Part',        render: (r: any) => <span className="font-mono text-xs">{r.partNumber || '—'}</span> },
    { key: 'serialNumber',     label: 'Serial No.',  render: (r: any) => <span className="font-mono text-xs">{r.serialNumber || '—'}</span> },
    { key: 'description',      label: 'Description', render: (r: any) => <span className="max-w-[120px] truncate block text-xs text-slate-500">{r.description || '—'}</span> },
    { key: 'warehouse',        label: 'WH',          render: (r: any) => r.warehouse || '—' },
    { key: 'qty',              label: 'Qty',         render: (r: any) => <span className="font-bold">{r.qty}</span> },
  ];

  return (
    <div className="flex gap-4 h-[calc(100vh-220px)] min-h-0">
      {/* Left */}
      <div className="w-56 flex-shrink-0 flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <Input placeholder="Serial, product, part…" className="pl-8 h-8 text-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-3 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5"><Filter className="w-3 h-3" /> Filters</p>
          {[
            { label: 'Warehouse', value: whFilter, onChange: setWhFilter, options: warehouses.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` })) },
            { label: 'Brand', value: brandFilter, onChange: setBrandFilter, options: brands.map((b) => ({ value: b.id, label: b.name })) },
            { label: 'Type', value: typeFilter, onChange: setTypeFilter, options: PRODUCT_TYPES.map((t) => ({ value: t, label: t.replace('_',' ') })) },
          ].map(({ label, value, onChange, options }) => (
            <div key={label} className="space-y-1">
              <label className="text-xs text-slate-500">{label}</label>
              <select className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
                <option value="">All {label}s</option>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5"><BarChart3 className="w-3 h-3" /> Summary</p>
          {[{ label: 'Total Items', value: stats.total, icon: Box, color: 'text-green-600' }, { label: 'Available', value: stats.available, icon: CheckCircle2, color: 'text-green-600' }, { label: 'Warehouses', value: stats.warehouses, icon: Building2, color: 'text-purple-600' }, { label: 'Products', value: stats.products, icon: Package, color: 'text-amber-600' }].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-slate-500"><Icon className={cn('w-3.5 h-3.5', color)} />{label}</div>
              <span className="text-xs font-bold">{loading ? '…' : value}</span>
            </div>
          ))}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Import / Export</p>
          {[
            { label: 'Download Template', icon: FileText, color: 'text-green-600', action: () => { const token = localStorage.getItem('wms_token'); fetch(productsApi.templateUrl(), { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then((r) => r.blob()).then((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'template.xlsx'; a.click(); }); } },
            { label: 'Import xlsx / csv', icon: Upload, color: 'text-green-600', action: () => fileRef.current?.click() },
            { label: 'Export .xlsx', icon: Download, color: 'text-indigo-600', action: () => handleExport('xlsx') },
            { label: 'Export .csv', icon: Download, color: 'text-slate-500', action: () => handleExport('csv') },
          ].map(({ label, icon: Icon, color, action }) => (
            <Button key={label} variant="outline" size="sm" className="w-full h-7 text-xs gap-1 justify-start" onClick={action}>
              <Icon className={cn('w-3 h-3', color)} />{label}
            </Button>
          ))}
          <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); }} />
        </div>
      </div>

      {/* Center Table */}
      <div className="flex-1 min-w-0 flex flex-col bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex-shrink-0">
          <span className="text-xs font-semibold text-slate-600">{loading ? 'Loading…' : `${rows.length} items`}</span>
          <span className="text-xs text-slate-400">Click a row to view detail</span>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs min-w-[1200px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50">
                {COLS.map((c) => <th key={c.key} className="text-left px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wide whitespace-nowrap text-slate-500 border-b border-slate-200">{c.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? [...Array(8)].map((_, i) => <tr key={i}>{COLS.map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3.5" /></td>)}</tr>)
                : rows.length === 0 ? <tr><td colSpan={COLS.length} className="px-4 py-12 text-center text-slate-400">No stock items found</td></tr>
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

      {/* Right Detail */}
      <div className={cn('w-72 flex-shrink-0 flex flex-col gap-3 transition-all', !selected && 'opacity-40 pointer-events-none')}>
        {selected ? (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 flex items-start justify-between">
              <div>
                <p className="font-bold text-slate-900 text-sm">{selected.productName}</p>
                <p className="text-slate-500 text-xs mt-0.5 font-mono">{selected.productCode}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={cn('text-xs', TYPE_BADGE[selected.productType])}>{selected.productType?.replace('_',' ')}</Badge>
                <Badge variant="outline" className={cn('text-xs', STATUS_BADGE[selected.status] ?? 'bg-slate-100 text-slate-600')}>{selected.status}</Badge>
              </div>
              {[{ label: 'Receiving', rows: [{ l: 'Date', v: selected.receiveDate ? new Date(selected.receiveDate).toLocaleDateString('th-TH') : '—' }, { l: 'AWB', v: selected.awbNumber || '—', m: true }, { l: 'Invoice', v: selected.invoiceNumber || '—', m: true }, { l: 'Customer Case', v: selected.gswNumber || '—', m: true }] },
                { label: 'Product', rows: [{ l: 'Brand', v: selected.brand || '—' }, { l: 'Model', v: selected.model || '—' }, { l: 'Vendor P/N', v: selected.vendorPartNumber || '—', m: true }, { l: 'Part #', v: selected.partNumber || '—', m: true }, { l: 'Serial', v: selected.serialNumber || '—', m: true }] },
                { label: 'Location', rows: [{ l: 'WH', v: selected.warehouse || '—' }, { l: 'Rack', v: selected.rack || '—' }, { l: 'Slot', v: selected.slot || '—' }, { l: 'Qty', v: String(selected.qty) }] },
              ].map(({ label, rows: rs }) => (
                <div key={label}>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">{label}</p>
                  <div className="space-y-1">
                    {rs.map(({ l, v, m }) => (
                      <div key={l} className="flex items-start justify-between gap-2 text-xs">
                        <span className="text-slate-400 flex-shrink-0">{l}</span>
                        <span className={cn('text-slate-800 text-right break-all', m && 'font-mono')}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-slate-400">
            <ChevronRight className="w-6 h-6 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Select a row to view details</p>
          </div>
        )}
      </div>

      {importing && <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"><div className="bg-white rounded-xl p-6 text-sm font-medium text-green-700 animate-pulse">Importing…</div></div>}
    </div>
  );
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

function TabBar({ active, onChange }: { active: string; onChange: (t: string) => void }) {
  const tabs = [{ id: 'master', label: 'Product Master', icon: Tag }, { id: 'register', label: 'Stock Register', icon: Layers }];
  return (
    <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button key={id} onClick={() => onChange(id)}
          className={cn('flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all',
            active === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
          <Icon className="w-4 h-4" />{label}
        </button>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const [tab, setTab] = useState<'master' | 'register'>('master');
  const [brands, setBrands] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([warehouseApi.brands(), warehouseApi.list()])
      .then(([b, w]) => { setBrands(b); setWarehouses(w); })
      .catch(() => {});
  }, []);

  return (
    <div className="p-5 flex flex-col gap-4 h-full overflow-hidden">
      <div className="flex items-center justify-between flex-wrap gap-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-green-600 rounded-xl flex items-center justify-center">
            <Tag className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-slate-900">Master Data / Product Master</h1>
            <p className="text-xs text-slate-500 mt-0.5">Inventory traceability · Serial tracking · Warehouse governance</p>
          </div>
        </div>
        <TabBar active={tab} onChange={(t) => setTab(t as any)} />
      </div>

      {tab === 'master'
        ? <EnterpriseMasterTab brands={brands} warehouses={warehouses} />
        : <StockRegisterTab warehouses={warehouses} brands={brands} />
      }
    </div>
  );
}
