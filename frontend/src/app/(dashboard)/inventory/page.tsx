'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Package, Search, Download, ChevronDown, ChevronRight, X,
  BarChart3, AlertTriangle, RefreshCw, Shield, Clock,
  Building2, Box, CheckCircle2, Eye, History, Layers,
  MoreHorizontal, MapPin, ArrowRightLeft, FileText, SlidersHorizontal,
  Zap, Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { inventoryApi, warehouseApi } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ColumnManagerButton, useColumnPrefs, type ColumnDef } from '@/components/inventory/column-manager';

// ─── Column configuration (user-configurable: show/hide + drag reorder) ───────
// Locked columns (sku, qty, status) cannot be hidden — they carry the row's identity/state.

// Light header bands (mockup-clean): uniform light fill, group identity carried by
// a muted accent text color instead of heavy dark fills.
const GROUP_CFG: Record<string, { label: string; accent: string }> = {
  product:      { label: 'Product Information',  accent: 'text-slate-500' },
  inventory:    { label: 'Inventory Status',      accent: 'text-green-700' },
  location:     { label: 'Warehouse Location',     accent: 'text-teal-700' },
  traceability: { label: 'Traceability & Audit',  accent: 'text-indigo-600' },
};

const COLUMN_DEFS: ColumnDef[] = [
  { key: 'sku',         label: 'SKU / Part #',    group: 'product',      locked: true },
  { key: 'type',        label: 'Type',             group: 'product' },
  { key: 'productModel',label: 'Product / Model',  group: 'product' },
  { key: 'brand',        label: 'Brand',            group: 'product' },
  { key: 'serialBatch', label: 'Serial / Batch',   group: 'inventory' },
  { key: 'qty',          label: 'Qty',              group: 'inventory',   locked: true },
  { key: 'status',      label: 'Status',           group: 'inventory',   locked: true },
  { key: 'ownership',   label: 'Ownership',        group: 'inventory' },
  { key: 'warehouse',   label: 'Warehouse',        group: 'location' },
  { key: 'zone',         label: 'Zone',             group: 'location' },
  { key: 'rack',         label: 'Rack',             group: 'location' },
  { key: 'slot',         label: 'Bin / Slot',       group: 'location' },
  { key: 'receiveDate', label: 'Receive Date',     group: 'traceability' },
  { key: 'agingDays',   label: 'Aging Days',       group: 'traceability' },
  { key: 'recvBy',      label: 'Recv By',          group: 'traceability' },
  { key: 'awb',           label: 'AWB',              group: 'traceability' },
  { key: 'invoiceNo',   label: 'Invoice No.',      group: 'traceability' },
  { key: 'rmaRef',      label: 'RMA Ref',          group: 'traceability' },
];

interface RowCtx {
  rcv: any; rmaRef: string | undefined; agingDays: number; isAging: boolean; isAgingCritical: boolean;
  fmt: (d: any) => string;
}

const CELL_RENDERERS: Record<string, (item: any, ctx: RowCtx) => React.ReactNode> = {
  sku: (item) => (
    <>
      <p className="font-mono font-bold text-green-700 text-[11px]">{item.product?.code}</p>
      {item.product?.partNumber && <p className="text-[10px] text-slate-400 font-mono">{item.product.partNumber}</p>}
    </>
  ),
  type: (item) => (
    <Badge variant="outline" className={cn('text-[11px]', item.product?.productType === 'SPARE_PART' ? 'bg-teal-100 text-teal-700' : 'bg-emerald-100 text-emerald-700')}>
      {item.product?.productType?.replace('_', ' ')}
    </Badge>
  ),
  productModel: (item) => (
    <>
      <p className="font-medium text-slate-700 truncate">{item.product?.name}</p>
      {item.product?.model && <p className="text-[10px] text-slate-400">{item.product.model}</p>}
    </>
  ),
  brand: (item) => item.product?.brand?.name ?? '—',
  serialBatch: (item) => item.serialNumber ?? item.batchNumber ?? '—',
  qty: (item) => item.quantity,
  status: (item) => <StatusBadge status={item.status} />,
  ownership: (item) => (
    <span className="text-[11px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 font-medium">{OWNERSHIP_LABEL[item.ownershipType] ?? item.ownershipType}</span>
  ),
  warehouse: (item) => item.warehouse?.code ?? '—',
  zone: (item) => item.rack?.zone ?? '—',
  rack: (item) => item.rack?.code ?? '—',
  slot: (item) => item.slot?.code ?? '—',
  receiveDate: (item, ctx) => ctx.fmt(item.receivedDate),
  agingDays: (_item, ctx) => (
    <span className={cn('px-1.5 py-0.5 rounded text-[11px] font-bold tabular-nums',
      ctx.isAgingCritical ? 'bg-red-100 text-red-700' : ctx.isAging ? 'bg-yellow-100 text-yellow-700' : 'text-slate-400')}>
      {ctx.agingDays}d
    </span>
  ),
  recvBy: (item) => item.createdBy?.fullName ?? '—',
  awb: (_item, ctx) => ctx.rcv?.awbNumber ?? '—',
  invoiceNo: (_item, ctx) => ctx.rcv?.invoiceNumber ?? '—',
  rmaRef: (_item, ctx) => ctx.rmaRef ?? '—',
};

const CELL_CLASS: Record<string, string> = {
  sku: 'px-3 py-2.5 min-w-[130px]',
  type: 'px-3 py-2.5',
  productModel: 'px-3 py-2.5 max-w-[150px]',
  brand: 'px-3 py-2.5 whitespace-nowrap text-slate-500',
  serialBatch: 'px-3 py-2.5 font-mono text-[11px] text-indigo-700 font-medium whitespace-nowrap',
  qty: 'px-3 py-2.5 text-center font-bold tabular-nums',
  status: 'px-3 py-2.5',
  ownership: 'px-3 py-2.5 whitespace-nowrap',
  warehouse: 'px-3 py-2.5 whitespace-nowrap font-medium',
  zone: 'px-3 py-2.5 whitespace-nowrap text-slate-400 text-[11px]',
  rack: 'px-3 py-2.5 whitespace-nowrap font-mono text-[11px] text-slate-600',
  slot: 'px-3 py-2.5 whitespace-nowrap font-mono text-[11px] text-slate-600',
  receiveDate: 'px-3 py-2.5 whitespace-nowrap text-slate-400',
  agingDays: 'px-3 py-2.5 whitespace-nowrap',
  recvBy: 'px-3 py-2.5 whitespace-nowrap text-slate-400',
  awb: 'px-3 py-2.5 font-mono text-[11px] whitespace-nowrap text-slate-500',
  invoiceNo: 'px-3 py-2.5 font-mono text-[11px] whitespace-nowrap text-slate-500',
  rmaRef: 'px-3 py-2.5 font-mono text-[11px] whitespace-nowrap text-slate-500',
};

// Groups columns into contiguous bands by `group`, in the user's current order —
// so the colored header band stays correct even after a custom drag reorder.
function computeBands(cols: ColumnDef[]) {
  const bands: { group: string; count: number }[] = [];
  for (const c of cols) {
    const last = bands[bands.length - 1];
    if (last && last.group === c.group) last.count += 1;
    else bands.push({ group: c.group, count: 1 });
  }
  return bands;
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  AVAILABLE:          { label: 'Available',    bg: 'bg-green-100',   text: 'text-green-800',  dot: 'bg-green-500' },
  RESERVED:           { label: 'Reserved',     bg: 'bg-teal-100',    text: 'text-teal-800',   dot: 'bg-teal-500' },
  PICKING:            { label: 'Picking',      bg: 'bg-cyan-100',    text: 'text-cyan-800',   dot: 'bg-cyan-500' },
  PICKED:             { label: 'Picked',       bg: 'bg-cyan-200',    text: 'text-cyan-900',   dot: 'bg-cyan-600' },
  QUARANTINE:         { label: 'On Hold',      bg: 'bg-red-100',     text: 'text-red-800',    dot: 'bg-red-500' },
  RTV_PENDING:        { label: 'RTV Pending',  bg: 'bg-orange-100',  text: 'text-orange-800', dot: 'bg-orange-500' },
  DOA:                { label: 'DOA',          bg: 'bg-red-200',     text: 'text-red-900',    dot: 'bg-red-700' },
  DAMAGED:            { label: 'Damaged',      bg: 'bg-rose-100',    text: 'text-rose-800',   dot: 'bg-rose-500' },
  SHIPPED:            { label: 'Shipped',      bg: 'bg-slate-100',   text: 'text-slate-600',  dot: 'bg-slate-400' },
  PENDING_RECEIVING:  { label: 'Pending',      bg: 'bg-yellow-100',  text: 'text-yellow-800', dot: 'bg-yellow-500' },
  PENDING_INSPECTION: { label: 'Inspection',   bg: 'bg-yellow-200',  text: 'text-yellow-900', dot: 'bg-yellow-600' },
  CLOSED:             { label: 'Closed',       bg: 'bg-slate-200',   text: 'text-slate-500',  dot: 'bg-slate-300' },
};

const OWNERSHIP_LABEL: Record<string, string> = {
  CONSIGNMENT: 'Consignment', OWN: 'Own Stock', RMA: 'RMA', CUSTOMER: 'Customer',
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { label: status, bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' };
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap', cfg.bg, cfg.text)}>
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', cfg.dot)} />
      {cfg.label}
    </span>
  );
}

// ─── KPI Bar ──────────────────────────────────────────────────────────────────
// CR-INV-001: Total SKU / Total Qty / Available Qty / Reserved Qty / RTV Qty / Aging KPIs.
// Cards act as quick filters — clicking applies the matching status/aging filter.

function InventoryKpiBar({
  kpi, loading, activeStatus, activeAging90, activeAging365, onQuickFilter,
}: {
  kpi: any; loading: boolean;
  activeStatus: string; activeAging90: boolean; activeAging365: boolean;
  onQuickFilter: (patch: { status?: string; aging90?: boolean; aging365?: boolean }) => void;
}) {
  const cards = [
    { key: 'totalSku',  label: 'Total SKU',     value: kpi?.totalSku,     icon: Box,          color: 'text-slate-700',  bg: 'bg-slate-50',   border: 'border-slate-200', active: false, onClick: undefined },
    { key: 'totalQty',  label: 'Total Qty',     value: kpi?.totalQty,     icon: Layers,       color: 'text-slate-700',  bg: 'bg-slate-50',   border: 'border-slate-200', active: false, onClick: undefined },
    { key: 'available', label: 'Available Qty', value: kpi?.availableQty, icon: CheckCircle2, color: 'text-green-700',  bg: 'bg-green-50',   border: 'border-green-200', active: activeStatus === 'AVAILABLE', onClick: () => onQuickFilter({ status: activeStatus === 'AVAILABLE' ? '' : 'AVAILABLE' }) },
    { key: 'reserved',  label: 'Reserved Qty',  value: kpi?.reservedQty,  icon: Shield,       color: 'text-teal-700',   bg: 'bg-teal-50',    border: 'border-teal-200', active: activeStatus === 'RESERVED', onClick: () => onQuickFilter({ status: activeStatus === 'RESERVED' ? '' : 'RESERVED' }) },
    { key: 'rtv',       label: 'RTV Qty',       value: kpi?.rtvQty,       icon: RefreshCw,    color: (kpi?.rtvQty ?? 0) > 0 ? 'text-orange-700' : 'text-slate-400', bg: (kpi?.rtvQty ?? 0) > 0 ? 'bg-orange-50' : 'bg-slate-50', border: (kpi?.rtvQty ?? 0) > 0 ? 'border-orange-200' : 'border-slate-200', active: activeStatus === 'RTV_PENDING', onClick: () => onQuickFilter({ status: activeStatus === 'RTV_PENDING' ? '' : 'RTV_PENDING' }) },
    { key: 'aging90',   label: 'Aging >90 days',value: kpi?.aging90Count, icon: Clock,        color: (kpi?.aging90Count ?? 0) > 0 ? 'text-amber-700' : 'text-slate-400', bg: (kpi?.aging90Count ?? 0) > 0 ? 'bg-amber-50' : 'bg-slate-50', border: (kpi?.aging90Count ?? 0) > 0 ? 'border-amber-200' : 'border-slate-200', active: activeAging90, onClick: () => onQuickFilter({ aging90: !activeAging90, aging365: false }) },
    { key: 'aging365',  label: 'Aging >1 year', value: kpi?.aging365Count,icon: AlertTriangle,color: (kpi?.aging365Count ?? 0) > 0 ? 'text-red-700' : 'text-slate-400', bg: (kpi?.aging365Count ?? 0) > 0 ? 'bg-red-50' : 'bg-slate-50', border: (kpi?.aging365Count ?? 0) > 0 ? 'border-red-200' : 'border-slate-200', active: activeAging365, onClick: () => onQuickFilter({ aging365: !activeAging365, aging90: false }) },
  ];

  return (
    <div className="grid grid-cols-4 lg:grid-cols-7 gap-2 flex-shrink-0">
      {cards.map(({ key, label, value, icon: Icon, color, bg, border, active, onClick }) => {
        const cardClass = cn('flex items-center gap-2 px-3 py-2.5 rounded-xl border shadow-sm text-left',
          bg, active ? 'border-green-500 ring-2 ring-green-200' : border,
          onClick ? 'transition-colors hover:brightness-95' : 'cursor-default');
        const content = (
          <>
            <Icon className={cn('w-4 h-4 flex-shrink-0', color)} />
            <div className="min-w-0">
              {loading ? <Skeleton className="h-5 w-8" /> : <p className={cn('text-lg font-bold tabular-nums leading-none', color)}>{(value ?? 0).toLocaleString()}</p>}
              <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">{label}</p>
            </div>
          </>
        );
        return onClick
          ? <button key={key} type="button" onClick={onClick} className={cardClass}>{content}</button>
          : <div key={key} className={cardClass}>{content}</div>;
      })}
    </div>
  );
}

// ─── Bottleneck Section ───────────────────────────────────────────────────────
// CR-INV-001 #3: quantity grouped by Available / Reserved / RTV Pending.

function BottleneckSection({ kpi, loading }: { kpi: any; loading: boolean }) {
  const rows = [
    { label: 'Available',    value: kpi?.bottleneck?.available ?? 0,   color: 'bg-green-500',  text: 'text-green-700' },
    { label: 'Reserved',     value: kpi?.bottleneck?.reserved ?? 0,    color: 'bg-teal-500',   text: 'text-teal-700' },
    { label: 'RTV Pending',  value: kpi?.bottleneck?.rtvPending ?? 0,  color: 'bg-orange-500', text: 'text-orange-700' },
  ];
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex-shrink-0">
      <p className="text-xs font-semibold text-slate-600 mb-3">Bottleneck — Quantity by Stage</p>
      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-6" />)}</div>
      ) : (
        <div className="space-y-2.5">
          {rows.map(({ label, value, color, text }) => (
            <div key={label} className="flex items-center gap-3">
              <span className="text-xs text-slate-500 w-24 flex-shrink-0">{label}</span>
              <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
                <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${(value / max) * 100}%` }} />
              </div>
              <span className={cn('text-xs font-bold tabular-nums w-14 text-right', text)}>{value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Detail Drawer ────────────────────────────────────────────────────────────

function InventoryDetailDrawer({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState('info');

  useEffect(() => {
    setLoading(true); setSection('info');
    inventoryApi.detailFull(itemId)
      .then(setData).catch(() => toast.error('Failed to load')).finally(() => setLoading(false));
  }, [itemId]);

  const cfg = data ? (STATUS_CFG[data.status] ?? { label: data.status, bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' }) : null;
  const sections = [
    { id: 'info',     label: 'Info',      icon: Info },
    { id: 'location', label: 'Location',  icon: MapPin },
    { id: 'recv',     label: 'Receiving', icon: FileText },
    { id: 'movement', label: 'Movement',  icon: History },
    { id: 'rtv',      label: 'RTV/RMA',   icon: RefreshCw },
    { id: 'audit',    label: 'Audit',     icon: Clock },
  ];

  const fmt = (d: any) => d ? new Date(d).toLocaleDateString('th-TH') : '—';

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-[460px] bg-white shadow-2xl border-l border-slate-200 flex flex-col">
      <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between bg-slate-50 flex-shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <p className="font-mono font-bold text-slate-900">{loading ? '…' : (data?.serialNumber ?? data?.batchNumber ?? data?.id?.slice(-8))}</p>
            {cfg && !loading && <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full', cfg.bg, cfg.text)}>{cfg.label}</span>}
          </div>
          <p className="text-slate-500 text-xs">{loading ? '' : data?.product?.name}</p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
      </div>

      <div className="flex overflow-x-auto border-b border-slate-100 flex-shrink-0 bg-slate-50">
        {sections.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setSection(id)}
            className={cn('flex items-center gap-1 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors',
              section === id ? 'border-green-600 text-green-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? <div className="space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
        : !data ? <p className="text-slate-400 text-center py-10">Failed to load</p>
        : (
          <>
            {section === 'info' && (
              <div className="grid grid-cols-2 gap-2">
                {[
                  { l: 'Status',       v: data.status?.replace(/_/g,' ') },
                  { l: 'Ownership',    v: OWNERSHIP_LABEL[data.ownershipType] ?? data.ownershipType },
                  { l: 'Quantity',     v: `${data.quantity} ${data.product?.unit ?? ''}` },
                  { l: 'Serial No.',   v: data.serialNumber ?? '—', m: true },
                  { l: 'Batch No.',    v: data.batchNumber ?? '—', m: true },
                  { l: 'SKU / Code',   v: data.product?.code ?? '—', m: true },
                  { l: 'Part #',       v: data.product?.partNumber ?? '—', m: true },
                  { l: 'Brand',        v: data.product?.brand?.name ?? '—' },
                  { l: 'Model',        v: data.product?.model ?? '—' },
                  { l: 'Type',         v: data.product?.productType?.replace('_',' ') ?? '—' },
                  { l: 'Received',     v: fmt(data.receivedDate) },
                  { l: 'Expiry',       v: fmt(data.expiryDate) },
                  { l: 'Created By',   v: data.createdBy?.fullName ?? '—' },
                  { l: 'Notes',        v: data.notes ?? '—' },
                ].map(({ l, v, m }) => (
                  <div key={l} className="bg-slate-50 rounded-lg p-2">
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{l}</p>
                    <p className={cn('text-sm mt-0.5 break-all font-medium text-slate-800', m && 'font-mono text-xs text-green-700')}>{v}</p>
                  </div>
                ))}
              </div>
            )}
            {section === 'location' && (
              <div className="space-y-3">
                <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                  {[
                    { l: 'Warehouse', v: data.warehouse ? `${data.warehouse.code} — ${data.warehouse.name}` : '—', icon: Building2 },
                    { l: 'Zone',      v: data.rack?.zone ?? '—', icon: MapPin },
                    { l: 'Rack',      v: data.rack?.code ?? '—', icon: Layers },
                    { l: 'Slot / Bin',v: data.slot?.code ?? '—', icon: Box },
                  ].map(({ l, v, icon: Icon }) => (
                    <div key={l} className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-slate-500"><Icon className="w-3.5 h-3.5" />{l}</div>
                      <span className="text-xs font-semibold font-mono text-slate-800">{v}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Link href="/transfer" className="flex-1"><Button size="sm" variant="outline" className="w-full gap-1.5 text-xs"><ArrowRightLeft className="w-3.5 h-3.5" /> Transfer</Button></Link>
                  <Link href="/adjustment" className="flex-1"><Button size="sm" variant="outline" className="w-full gap-1.5 text-xs"><SlidersHorizontal className="w-3.5 h-3.5" /> Adjust</Button></Link>
                </div>
              </div>
            )}
            {section === 'recv' && (
              <div className="space-y-2">
                {data.goodsReceivingItems?.length === 0 && <p className="text-slate-400 text-center py-6 text-sm">No receiving records</p>}
                {data.goodsReceivingItems?.map((gri: any) => {
                  const rcv = gri.receiving;
                  return (
                    <div key={gri.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-green-700">{rcv?.refNumber}</span>
                        <span className="text-[10px] text-slate-400">{fmt(rcv?.receivedDate)}</span>
                      </div>
                      {[{ l: 'AWB', v: rcv?.awbNumber || '—' }, { l: 'Invoice No.', v: rcv?.invoiceNumber || '—' }, { l: 'Customer Case', v: rcv?.gswNumber || '—' }, { l: 'Source', v: rcv?.sourceType || '—' }, { l: 'Received By', v: rcv?.receivedBy?.fullName || '—' }, { l: 'Qty', v: String(gri.quantity) }, { l: 'Condition', v: gri.condition || '—' }].map(({ l, v }) => (
                        <div key={l} className="flex justify-between text-xs"><span className="text-slate-400">{l}</span><span className="font-mono text-slate-700">{v}</span></div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
            {section === 'movement' && (
              <div className="space-y-1.5">
                <div className="flex items-start gap-2 border-l-2 border-green-500 pl-3 py-1.5">
                  <div className="flex-1"><p className="text-xs font-medium text-slate-700">Stock Received</p><p className="text-[10px] text-slate-400">Qty {data.quantity} · {fmt(data.receivedDate)}</p></div>
                </div>
                {data.withdrawalRequestItems?.map((wri: any) => (
                  <div key={wri.id} className="flex items-start gap-2 border-l-2 border-green-400 pl-3 py-1.5">
                    <div className="flex-1">
                      <p className="text-xs font-medium text-slate-700">Withdrawal Request</p>
                      <p className="text-[10px] font-mono text-slate-400">{wri.request?.refNumber}</p>
                      <p className="text-[10px] text-slate-400">{wri.request?.department} · {wri.request?.status?.replace(/_/g,' ')}</p>
                    </div>
                    <p className="text-[10px] text-slate-400">{fmt(wri.request?.createdAt)}</p>
                  </div>
                ))}
                {data.rtvCases?.map((rtv: any) => (
                  <div key={rtv.id} className="flex items-start gap-2 border-l-2 border-orange-400 pl-3 py-1.5">
                    <div className="flex-1">
                      <p className="text-xs font-medium text-orange-700">RTV Case</p>
                      <p className="text-[10px] font-mono text-slate-400">{rtv.refNumber}</p>
                      <p className="text-[10px] text-slate-400">{rtv.vendor?.name} · {rtv.status?.replace(/_/g,' ')}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {section === 'rtv' && (
              <div className="space-y-2">
                {data.withdrawalRequestItems?.filter((w: any) => w.request?.rmaCaseNumber).map((wri: any) => (
                  <div key={wri.id} className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <div className="flex justify-between mb-1"><span className="font-mono text-xs font-bold text-amber-700">{wri.request?.refNumber}</span><span className="text-[10px] bg-amber-200 text-amber-800 rounded px-1.5">{wri.request?.status?.replace(/_/g,' ')}</span></div>
                    <p className="text-xs text-amber-600">RMA: {wri.request?.rmaCaseNumber}</p>
                  </div>
                ))}
                {data.rtvCases?.map((rtv: any) => (
                  <div key={rtv.id} className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                    <div className="flex justify-between mb-1"><span className="font-mono text-xs font-bold text-orange-700">{rtv.refNumber}</span><span className="text-[10px] bg-orange-200 text-orange-800 rounded px-1.5">{rtv.status?.replace(/_/g,' ')}</span></div>
                    <p className="text-xs text-orange-600">Vendor: {rtv.vendor?.name ?? '—'} · {rtv.reason}</p>
                  </div>
                ))}
                {!data.withdrawalRequestItems?.some((w: any) => w.request?.rmaCaseNumber) && !data.rtvCases?.length && <p className="text-slate-400 text-center py-6 text-sm">No RTV/RMA records</p>}
              </div>
            )}
            {section === 'audit' && (
              <div className="space-y-1.5">
                {data.auditLogs?.length === 0 && <p className="text-slate-400 text-center py-6 text-sm">No audit records</p>}
                {data.auditLogs?.map((log: any) => (
                  <div key={log.id} className="flex items-start gap-2 text-xs border-b border-slate-50 pb-1.5">
                    <span className="text-[10px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 font-mono flex-shrink-0 mt-0.5 whitespace-nowrap">{log.action.replace(/_/g,' ')}</span>
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

      {data && (
        <div className="border-t border-slate-100 p-3 flex gap-2 flex-shrink-0 bg-slate-50">
          <Button size="sm" variant="outline" className="flex-1 text-xs gap-1.5"
            onClick={() => { inventoryApi.updateStatus(data.id, data.status === 'AVAILABLE' ? 'QUARANTINE' : 'AVAILABLE').then(() => { toast.success('Status updated'); onClose(); }).catch((e: any) => toast.error(e.message)); }}>
            {data.status === 'QUARANTINE'
              ? <><CheckCircle2 className="w-3.5 h-3.5" /> Release</>
              : <><Shield className="w-3.5 h-3.5" /> On Hold</>}
          </Button>
          <Link href="/rtv"><Button size="sm" variant="outline" className="text-xs gap-1"><RefreshCw className="w-3.5 h-3.5" /> RTV</Button></Link>
          <Link href="/adjustment"><Button size="sm" variant="outline" className="text-xs gap-1"><SlidersHorizontal className="w-3.5 h-3.5" /> Adjust</Button></Link>
        </div>
      )}
    </div>
  );
}

// ─── Inventory Row ────────────────────────────────────────────────────────────

function InventoryRow({ item, isSelected, onSelect, visibleColumns, colSpan }: { item: any; isSelected: boolean; onSelect: () => void; visibleColumns: ColumnDef[]; colSpan: number }) {
  const [expanded, setExpanded] = useState(false);
  const rcv = item.goodsReceivingItems?.[0]?.receiving;
  const rmaRef = item.withdrawalRequestItems?.[0]?.request?.rmaCaseNumber;
  const agingDays = item.receivedDate ? Math.floor((Date.now() - new Date(item.receivedDate).getTime()) / 86_400_000) : 0;
  const isAging = agingDays > 90;
  const isAgingCritical = agingDays > 365;
  const fmt = (d: any) => d ? new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
  const ctx: RowCtx = { rcv, rmaRef, agingDays, isAging, isAgingCritical, fmt };

  return (
    <>
      <tr
        className={cn('border-b border-slate-100 hover:bg-slate-50/80 transition-colors cursor-pointer text-xs',
          isSelected ? 'bg-green-50/60 ring-1 ring-inset ring-green-300' : '',
          item.status === 'DOA' ? 'border-l-2 border-l-red-600' :
          item.status === 'RTV_PENDING' ? 'border-l-2 border-l-orange-400' :
          item.status === 'QUARANTINE' ? 'border-l-2 border-l-red-400' :
          isAging ? 'border-l-2 border-l-amber-400' : 'border-l-2 border-l-transparent',
        )}
        onClick={onSelect}
      >
        <td className="px-2 py-2.5 w-8">
          <button onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }} className="text-slate-300 hover:text-slate-600">
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </td>
        {visibleColumns.map((col) => (
          <td key={col.key} className={CELL_CLASS[col.key]}>{CELL_RENDERERS[col.key](item, ctx)}</td>
        ))}
        <td className="px-3 py-2.5">
          <div className="flex gap-1">
            <button onClick={(e) => { e.stopPropagation(); onSelect(); }} className="p-1 rounded hover:bg-green-100 text-slate-400 hover:text-green-600" title="View detail"><Eye className="w-3.5 h-3.5" /></button>
            <DropdownMenu>
              <DropdownMenuTrigger
                onClick={(e) => e.stopPropagation()}
                className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 outline-none"
                title="More actions"
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem render={<Link href="/adjustment" />}><SlidersHorizontal className="w-3.5 h-3.5" /> Adjust</DropdownMenuItem>
                <DropdownMenuItem render={<Link href="/transfer" />}><ArrowRightLeft className="w-3.5 h-3.5" /> Transfer</DropdownMenuItem>
                <DropdownMenuItem render={<Link href="/rtv" />}><RefreshCw className="w-3.5 h-3.5" /> RTV</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </td>
      </tr>

      {/* Expanded row */}
      {expanded && (
        <tr className="bg-slate-50/80 border-b border-slate-200">
          <td colSpan={colSpan} className="px-6 py-3">
            <div className="grid grid-cols-4 gap-4 text-xs">
              <div>
                <p className="font-semibold text-slate-600 mb-1.5 flex items-center gap-1"><Package className="w-3 h-3" /> Product</p>
                {[{ l: 'Name', v: item.product?.name ?? '—' }, { l: 'Manufacturer', v: item.product?.manufacturer || '—' }, { l: 'Category', v: item.product?.category || '—' }, { l: 'Unit Cost', v: item.product?.unitCost ? `฿${item.product.unitCost}` : '—' }].map(({ l, v }) => (
                  <div key={l} className="flex justify-between py-0.5"><span className="text-slate-400">{l}</span><span className="font-medium truncate ml-2">{v}</span></div>
                ))}
              </div>
              <div>
                <p className="font-semibold text-slate-600 mb-1.5 flex items-center gap-1"><MapPin className="w-3 h-3" /> Location Detail</p>
                {[{ l: 'WH Name', v: item.warehouse?.name || '—' }, { l: 'Zone', v: item.rack?.zone || '—' }, { l: 'Rack', v: item.rack?.code || '—' }, { l: 'Slot', v: item.slot?.code || '—' }].map(({ l, v }) => (
                  <div key={l} className="flex justify-between py-0.5"><span className="text-slate-400">{l}</span><span className="font-mono font-medium">{v}</span></div>
                ))}
              </div>
              <div>
                <p className="font-semibold text-slate-600 mb-1.5 flex items-center gap-1"><FileText className="w-3 h-3" /> Receiving</p>
                {[{ l: 'AWB', v: rcv?.awbNumber || '—' }, { l: 'Invoice', v: rcv?.invoiceNumber || '—' }, { l: 'Customer Case', v: rcv?.gswNumber || '—' }, { l: 'Source', v: rcv?.sourceType || '—' }].map(({ l, v }) => (
                  <div key={l} className="flex justify-between py-0.5"><span className="text-slate-400">{l}</span><span className="font-mono">{v}</span></div>
                ))}
              </div>
              <div>
                <p className="font-semibold text-slate-600 mb-1.5 flex items-center gap-1"><Clock className="w-3 h-3" /> Timeline</p>
                {[{ l: 'Received', v: fmt(item.receivedDate) }, { l: 'Aging', v: `${agingDays}d${isAging ? ' ⚠' : ''}` }, { l: 'Expiry', v: fmt(item.expiryDate) }, { l: 'Notes', v: item.notes || '—' }].map(({ l, v }) => (
                  <div key={l} className="flex justify-between py-0.5"><span className="text-slate-400">{l}</span><span className="font-medium">{v}</span></div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const STATUSES = ['AVAILABLE','RESERVED','PICKING','QUARANTINE','RTV_PENDING','DOA','DAMAGED','PENDING_RECEIVING'];

export default function InventoryPage() {
  const [kpi, setKpi] = useState<any>(null);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  const [search, setSearch] = useState('');
  const [whFilter, setWhFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [itemTypeFilter, setItemTypeFilter] = useState('');
  const [serialOnly, setSerialOnly] = useState(false);
  const [aging, setAging] = useState(false);
  const [aging365, setAging365] = useState(false);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadKpi = useCallback(async () => {
    setKpiLoading(true);
    try { setKpi(await inventoryApi.kpi(whFilter || undefined)); } finally { setKpiLoading(false); }
  }, [whFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await inventoryApi.enterpriseList({ search, warehouseId: whFilter, status: statusFilter, brandId: brandFilter, itemType: itemTypeFilter, serialOnly, aging, aging365, page, limit: LIMIT });
      setData(res.data ?? []); setTotal(res.total ?? 0);
    } finally { setLoading(false); }
  }, [search, whFilter, statusFilter, brandFilter, itemTypeFilter, serialOnly, aging, aging365, page]);

  useEffect(() => { warehouseApi.list().then(setWarehouses).catch(() => {}); warehouseApi.brands().then(setBrands).catch(() => {}); }, []);
  useEffect(() => { loadKpi(); }, [loadKpi]);
  useEffect(() => { setPage(1); }, [search, whFilter, statusFilter, brandFilter, itemTypeFilter, serialOnly, aging, aging365]);
  useEffect(() => { load(); }, [load]);

  function applyQuickFilter(patch: { status?: string; aging90?: boolean; aging365?: boolean }) {
    if (patch.status !== undefined) setStatusFilter(patch.status);
    if (patch.aging90 !== undefined) { setAging(patch.aging90); if (patch.aging90) setAging365(false); }
    if (patch.aging365 !== undefined) { setAging365(patch.aging365); if (patch.aging365) setAging(false); }
  }

  const columnPrefs = useColumnPrefs(COLUMN_DEFS, 'inventory');
  const visibleColumns = columnPrefs.visibleColumns;
  const bands = computeBands(visibleColumns);
  const colSpan = 2 + visibleColumns.length; // +1 expand toggle, +1 action column

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex-shrink-0 shadow-sm">
        <div className="flex items-center gap-4 flex-wrap lg:flex-nowrap">
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="w-9 h-9 bg-teal-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <Package className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-slate-900 text-sm leading-none">Inventory Control</h1>
              <p className="text-xs text-slate-500 mt-0.5">Real-time stock visibility · Serial tracking · Audit trail</p>
            </div>
          </div>
          <div className="flex-1 min-w-[180px] max-w-lg relative order-3 lg:order-none basis-full lg:basis-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input placeholder="Search SKU, serial, bin, AWB, invoice, brand, model…" className="pl-9 h-9 text-sm bg-slate-50" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => { loadKpi(); load(); }} disabled={loading}>
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs"><Download className="w-3.5 h-3.5" /> Export</Button>
            <ColumnManagerButton defs={COLUMN_DEFS} moduleKey="inventory" prefs={columnPrefs} />
            <Link href="/adjustment"><Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs"><SlidersHorizontal className="w-3.5 h-3.5" /> Adjust</Button></Link>
            <Link href="/cycle-count"><Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs"><Zap className="w-3.5 h-3.5" /> Cycle Count</Button></Link>
            <Link href="/transfer"><Button size="sm" className="h-8 bg-teal-600 hover:bg-teal-700 text-white gap-1.5 text-xs"><ArrowRightLeft className="w-3.5 h-3.5" /> Transfer</Button></Link>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col gap-3 p-4 min-h-0">
        <InventoryKpiBar
          kpi={kpi} loading={kpiLoading}
          activeStatus={statusFilter} activeAging90={aging} activeAging365={aging365}
          onQuickFilter={applyQuickFilter}
        />

        <BottleneckSection kpi={kpi} loading={kpiLoading} />

        {/* Filter bar */}
        <div className="flex flex-wrap gap-2 items-center flex-shrink-0">
          <select className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white" value={whFilter} onChange={(e) => setWhFilter(e.target.value)}>
            <option value="">All Warehouses</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
          </select>
          <select className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
          </select>
          <select className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white" value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
            <option value="">All Brands</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white" value={itemTypeFilter} onChange={(e) => setItemTypeFilter(e.target.value)}>
            <option value="">All Item Types</option>
            <option value="FINISHED_GOODS">Finished Goods</option>
            <option value="SPARE_PART">Spare Part</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input type="checkbox" checked={serialOnly} onChange={(e) => setSerialOnly(e.target.checked)} className="accent-green-600" />Serialized Only
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input type="checkbox" checked={aging} onChange={(e) => { setAging(e.target.checked); if (e.target.checked) setAging365(false); }} className="accent-amber-500" />Aging &gt;90d
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input type="checkbox" checked={aging365} onChange={(e) => { setAging365(e.target.checked); if (e.target.checked) setAging(false); }} className="accent-red-500" />Aging &gt;1 year
          </label>
          {(statusFilter || whFilter || brandFilter || itemTypeFilter || serialOnly || aging || aging365) && (
            <button onClick={() => { setStatusFilter(''); setWhFilter(''); setBrandFilter(''); setItemTypeFilter(''); setSerialOnly(false); setAging(false); setAging365(false); }} className="text-xs text-slate-400 hover:text-slate-600 px-2">Clear</button>
          )}
          <div className="ml-auto text-xs text-slate-500 tabular-nums">{loading ? '…' : `${total.toLocaleString()} items`}</div>
        </div>

        {/* Legend — placed right above the table it explains, not buried at page bottom */}
        <div className="flex flex-wrap gap-4 text-[10px] text-slate-400 flex-shrink-0">
          {[{ c: 'border-l-red-600', l: 'DOA' }, { c: 'border-l-orange-400', l: 'RTV Pending' }, { c: 'border-l-red-400', l: 'On Hold' }, { c: 'border-l-amber-400', l: 'Aging >90d' }].map(({ c, l }) => (
            <div key={l} className={cn('flex items-center gap-1 border-l-2 pl-1.5', c)}>{l}</div>
          ))}
          <span className="text-slate-300">·</span>
          <span>Click ▶ to expand row · Click row to open detail drawer</span>
        </div>

        {/* Enterprise Table */}
        <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
          <div className="overflow-auto flex-1">
            <table className="w-full text-xs min-w-[1500px]">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="bg-slate-100 border-b border-slate-200 w-8" />
                  {bands.map((b, i) => (
                    <th key={i} colSpan={b.count} className={cn('text-center text-[10px] font-bold py-2 uppercase tracking-widest bg-slate-100 border-b border-r border-slate-200', GROUP_CFG[b.group].accent)}>{GROUP_CFG[b.group].label}</th>
                  ))}
                  <th className="bg-slate-100 border-b border-slate-200" />
                </tr>
                <tr className="bg-slate-50">
                  <th className="w-8 bg-slate-50 border-b border-slate-200" />
                  {visibleColumns.map((col) => (
                    <th key={col.key} className="text-left px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wide whitespace-nowrap text-slate-500 border-b border-r border-slate-200">{col.label}</th>
                  ))}
                  <th className="px-3 py-2.5 bg-slate-50 border-b border-slate-200 w-16 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">Act</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? [...Array(10)].map((_, i) => <tr key={i} className="border-b border-slate-100">{[...Array(colSpan)].map((_, j) => <td key={j} className="px-3 py-2.5"><Skeleton className="h-3.5" /></td>)}</tr>)
                  : data.length === 0
                  ? <tr><td colSpan={colSpan} className="px-4 py-12 text-center text-slate-400">No stock items found</td></tr>
                  : data.map((item) => (
                      <InventoryRow key={item.id} item={item} isSelected={selectedId === item.id} onSelect={() => setSelectedId(selectedId === item.id ? null : item.id)} visibleColumns={visibleColumns} colSpan={colSpan} />
                    ))}
              </tbody>
            </table>
          </div>
          {total > LIMIT && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 bg-slate-50 flex-shrink-0">
              <p className="text-xs text-slate-500">{total.toLocaleString()} items · Page {page} of {Math.ceil(total / LIMIT)}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page >= Math.ceil(total / LIMIT)} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedId && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSelectedId(null)} />
          <InventoryDetailDrawer itemId={selectedId} onClose={() => setSelectedId(null)} />
        </>
      )}
    </div>
  );
}
