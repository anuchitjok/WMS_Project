'use client';

// Inventory — view-only stock list. Stock changes only through receiving, requests
// and returns (Phase 2), so this page has no edit, status, transfer or adjust actions.
// Clicking a row opens the shared read-only Stock Detail drawer. Old links with
// ?id=<stock> open that drawer directly.
import { useEffect, useState, useCallback } from 'react';
import {
  Package, Search, ChevronDown, ChevronRight,
  AlertTriangle, RefreshCw, Shield, Clock,
  Box, CheckCircle2, Eye, Layers, MapPin, FileText, Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { inventoryApi, warehouseApi } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ColumnManagerButton, useColumnPrefs, type ColumnDef } from '@/components/inventory/column-manager';
import { StockDetailDrawer } from '@/components/inventory/stock-detail-drawer';
import { typeLabel } from '@/lib/product-terms';
import { getT, labelOf, useT, type Messages } from '@/i18n';

// ─── Columns (user-configurable: show/hide + drag reorder) ────────────────────
// Locked columns (sku, qty, status) carry the row's identity/state and cannot be hidden.

type GroupKey = keyof Messages['inventory']['groups'];
type ColKey = Exclude<keyof Messages['inventory']['cols'], 'actions'>;

const GROUP_ACCENT: Record<GroupKey, string> = {
  product: 'text-slate-500',
  inventory: 'text-green-700',
  location: 'text-teal-700',
  traceability: 'text-indigo-600',
};

const COLUMNS: { key: ColKey; group: GroupKey; locked?: boolean }[] = [
  { key: 'sku', group: 'product', locked: true },
  { key: 'type', group: 'product' },
  { key: 'productModel', group: 'product' },
  { key: 'brand', group: 'product' },
  { key: 'serialBatch', group: 'inventory' },
  { key: 'qty', group: 'inventory', locked: true },
  { key: 'status', group: 'inventory', locked: true },
  { key: 'ownership', group: 'inventory' },
  { key: 'warehouse', group: 'location' },
  { key: 'zone', group: 'location' },
  { key: 'rack', group: 'location' },
  { key: 'slot', group: 'location' },
  { key: 'receiveDate', group: 'traceability' },
  { key: 'agingDays', group: 'traceability' },
  { key: 'recvBy', group: 'traceability' },
  { key: 'awb', group: 'traceability' },
  { key: 'invoiceNo', group: 'traceability' },
  { key: 'rmaRef', group: 'traceability' },
];

interface RowCtx {
  rcv: any; rmaRef: string | undefined; agingDays: number; isAging: boolean; isAgingCritical: boolean;
  m: Messages; fmtDate: (d: any) => string;
}

const STATUS_STYLE: Record<string, { bg: string; text: string; dot: string }> = {
  AVAILABLE:          { bg: 'bg-green-100',  text: 'text-green-800',  dot: 'bg-green-500' },
  RESERVED:           { bg: 'bg-teal-100',   text: 'text-teal-800',   dot: 'bg-teal-500' },
  PICKING:            { bg: 'bg-cyan-100',   text: 'text-cyan-800',   dot: 'bg-cyan-500' },
  PICKED:             { bg: 'bg-cyan-100',   text: 'text-cyan-900',   dot: 'bg-cyan-600' },
  QUARANTINE:         { bg: 'bg-red-100',    text: 'text-red-800',    dot: 'bg-red-500' },
  RTV_PENDING:        { bg: 'bg-orange-100', text: 'text-orange-800', dot: 'bg-orange-500' },
  DOA:                { bg: 'bg-red-100',    text: 'text-red-900',    dot: 'bg-red-700' },
  DAMAGED:            { bg: 'bg-rose-100',   text: 'text-rose-800',   dot: 'bg-rose-500' },
  PENDING_RECEIVING:  { bg: 'bg-yellow-100', text: 'text-yellow-800', dot: 'bg-yellow-500' },
  PENDING_INSPECTION: { bg: 'bg-yellow-100', text: 'text-yellow-900', dot: 'bg-yellow-600' },
};
const STATUS_DEFAULT = { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' };

function StatusBadge({ status, m }: { status: string; m: Messages }) {
  const s = STATUS_STYLE[status] ?? STATUS_DEFAULT;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap', s.bg, s.text)}>
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', s.dot)} />
      {labelOf(m.status.stock, status)}
    </span>
  );
}

const CELL_RENDERERS: Record<ColKey, (item: any, ctx: RowCtx) => React.ReactNode> = {
  sku: (item) => (
    <>
      <p className="font-mono font-bold text-green-700 text-[11px]">{item.product?.code}</p>
      {item.product?.partNumber && <p className="text-[10px] text-slate-400 font-mono">{item.product.partNumber}</p>}
    </>
  ),
  type: (item) => (
    <Badge variant="outline" className={cn('text-[11px]', item.product?.productType === 'SPARE_PART' ? 'bg-teal-50 text-teal-700' : 'bg-emerald-50 text-emerald-700')}>
      {typeLabel(item.product?.productType)}
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
  status: (item, ctx) => <StatusBadge status={item.status} m={ctx.m} />,
  ownership: (item, ctx) => (
    <span className="text-[11px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 font-medium">{labelOf(ctx.m.reports.drawer.ownership, item.ownershipType)}</span>
  ),
  warehouse: (item) => item.warehouse?.code ?? '—',
  zone: (item) => item.rack?.zone ?? '—',
  rack: (item) => item.rack?.code ?? '—',
  slot: (item) => item.slot?.code ?? '—',
  receiveDate: (item, ctx) => ctx.fmtDate(item.receivedDate),
  agingDays: (_item, ctx) => (
    <span className={cn('px-1.5 py-0.5 rounded text-[11px] font-bold tabular-nums',
      ctx.isAgingCritical ? 'bg-red-100 text-red-700' : ctx.isAging ? 'bg-amber-100 text-amber-700' : 'text-slate-400')}>
      {ctx.m.inventory.days.replace('{count}', String(ctx.agingDays))}
    </span>
  ),
  recvBy: (item) => item.createdBy?.fullName ?? '—',
  awb: (_item, ctx) => ctx.rcv?.awbNumber ?? '—',
  invoiceNo: (_item, ctx) => ctx.rcv?.invoiceNumber ?? '—',
  rmaRef: (_item, ctx) => ctx.rmaRef ?? '—',
};

const CELL_CLASS: Record<ColKey, string> = {
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

// Groups columns into contiguous header bands, in the user's current order.
function computeBands(cols: ColumnDef[]) {
  const bands: { group: string; count: number }[] = [];
  for (const c of cols) {
    const last = bands[bands.length - 1];
    if (last && last.group === c.group) last.count += 1;
    else bands.push({ group: c.group, count: 1 });
  }
  return bands;
}

// ─── KPI bar (cards act as quick filters) ────────────────────────────────────

function InventoryKpiBar({
  kpi, loading, activeStatus, activeAging90, activeAging365, onQuickFilter,
}: {
  kpi: any; loading: boolean;
  activeStatus: string; activeAging90: boolean; activeAging365: boolean;
  onQuickFilter: (patch: { status?: string; aging90?: boolean; aging365?: boolean }) => void;
}) {
  const { m, fmt } = useT();
  const K = m.inventory.kpi;
  const warn = (n: number | undefined, on: string) => ((n ?? 0) > 0 ? on : 'text-slate-400');
  const toggleStatus = (s: string) => () => onQuickFilter({ status: activeStatus === s ? '' : s });
  const cards = [
    { key: 'totalSku',  label: K.totalSku,  value: kpi?.totalSku,      icon: Box,           color: 'text-slate-700', active: false, onClick: undefined },
    { key: 'totalQty',  label: K.totalQty,  value: kpi?.totalQty,      icon: Layers,        color: 'text-slate-700', active: false, onClick: undefined },
    { key: 'available', label: K.available, value: kpi?.availableQty,  icon: CheckCircle2,  color: 'text-green-700', active: activeStatus === 'AVAILABLE', onClick: toggleStatus('AVAILABLE') },
    { key: 'reserved',  label: K.reserved,  value: kpi?.reservedQty,   icon: Shield,        color: 'text-teal-700',  active: activeStatus === 'RESERVED', onClick: toggleStatus('RESERVED') },
    { key: 'rtv',       label: K.rtv,       value: kpi?.rtvQty,        icon: RefreshCw,     color: warn(kpi?.rtvQty, 'text-orange-700'), active: activeStatus === 'RTV_PENDING', onClick: toggleStatus('RTV_PENDING') },
    { key: 'aging90',   label: K.aging90,   value: kpi?.aging90Count,  icon: Clock,         color: warn(kpi?.aging90Count, 'text-amber-700'), active: activeAging90, onClick: () => onQuickFilter({ aging90: !activeAging90, aging365: false }) },
    { key: 'aging365',  label: K.aging365,  value: kpi?.aging365Count, icon: AlertTriangle, color: warn(kpi?.aging365Count, 'text-red-700'), active: activeAging365, onClick: () => onQuickFilter({ aging365: !activeAging365, aging90: false }) },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 flex-shrink-0">
      {cards.map(({ key, label, value, icon: Icon, color, active, onClick }) => {
        const cardClass = cn('flex items-center gap-2 px-3 py-2.5 rounded-xl border bg-white shadow-sm text-left',
          active ? 'border-green-500 ring-2 ring-green-200' : 'border-slate-200',
          onClick ? 'transition-colors hover:bg-slate-50' : 'cursor-default');
        const content = (
          <>
            <Icon className={cn('w-4 h-4 flex-shrink-0', color)} />
            <div className="min-w-0">
              {loading ? <Skeleton className="h-5 w-8" /> : <p className={cn('text-lg font-bold tabular-nums leading-none', color)}>{fmt.number(value ?? 0)}</p>}
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

// ─── Quantity by stage ───────────────────────────────────────────────────────

function BottleneckSection({ kpi, loading }: { kpi: any; loading: boolean }) {
  const { m, fmt } = useT();
  const B = m.inventory.bottleneck;
  const rows = [
    { label: B.available,  value: kpi?.bottleneck?.available ?? 0,  color: 'bg-green-500',  text: 'text-green-700' },
    { label: B.reserved,   value: kpi?.bottleneck?.reserved ?? 0,   color: 'bg-teal-500',   text: 'text-teal-700' },
    { label: B.rtvPending, value: kpi?.bottleneck?.rtvPending ?? 0, color: 'bg-orange-500', text: 'text-orange-700' },
  ];
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex-shrink-0">
      <p className="text-xs font-semibold text-slate-600 mb-3">{B.title}</p>
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
              <span className={cn('text-xs font-bold tabular-nums w-14 text-right', text)}>{fmt.number(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function InventoryRow({ item, isSelected, onSelect, visibleColumns, colSpan }: { item: any; isSelected: boolean; onSelect: () => void; visibleColumns: ColumnDef[]; colSpan: number }) {
  const [expanded, setExpanded] = useState(false);
  const { m, fmt } = useT();
  const E = m.inventory.expand;
  const rcv = item.goodsReceivingItems?.[0]?.receiving;
  const rmaRef = item.withdrawalRequestItems?.[0]?.request?.rmaCaseNumber;
  const agingDays = item.receivedDate ? Math.floor((Date.now() - new Date(item.receivedDate).getTime()) / 86_400_000) : 0;
  const isAging = agingDays > 90;
  const isAgingCritical = agingDays > 365;
  const ctx: RowCtx = { rcv, rmaRef, agingDays, isAging, isAgingCritical, m, fmtDate: fmt.date };

  const detailGroups = [
    { title: E.product, icon: Package, mono: false, rows: [
      { l: E.productName, v: item.product?.name || '—' },
      { l: E.manufacturer, v: item.product?.manufacturer || '—' },
      { l: E.category, v: item.product?.category || '—' },
      { l: E.unitCost, v: item.product?.unitCost ? fmt.currency(Number(item.product.unitCost)) : '—' },
    ] },
    { title: E.location, icon: MapPin, mono: true, rows: [
      { l: E.whName, v: item.warehouse?.name || '—' },
      { l: E.zone, v: item.rack?.zone || '—' },
      { l: E.rack, v: item.rack?.code || '—' },
      { l: E.slot, v: item.slot?.code || '—' },
    ] },
    { title: E.receiving, icon: FileText, mono: true, rows: [
      { l: E.awb, v: rcv?.awbNumber || '—' },
      { l: E.invoice, v: rcv?.invoiceNumber || '—' },
      { l: E.customerCase, v: rcv?.gswNumber || '—' },
      { l: E.source, v: rcv?.sourceType || '—' },
    ] },
    { title: E.timeline, icon: Clock, mono: false, rows: [
      { l: E.received, v: fmt.date(item.receivedDate) },
      { l: E.aging, v: m.inventory.days.replace('{count}', String(agingDays)) },
      { l: E.expiry, v: fmt.date(item.expiryDate) },
      { l: E.notes, v: item.notes || '—' },
    ] },
  ];

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
          <td key={col.key} className={CELL_CLASS[col.key as ColKey]}>{CELL_RENDERERS[col.key as ColKey](item, ctx)}</td>
        ))}
        <td className="px-3 py-2.5 text-center">
          <button onClick={(e) => { e.stopPropagation(); onSelect(); }} className="p-1 rounded hover:bg-green-100 text-slate-400 hover:text-green-600" title={m.inventory.viewDetail}>
            <Eye className="w-3.5 h-3.5" />
          </button>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-slate-50/80 border-b border-slate-200">
          <td colSpan={colSpan} className="px-6 py-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              {detailGroups.map(({ title, icon: Icon, mono, rows }) => (
                <div key={title}>
                  <p className="font-semibold text-slate-600 mb-1.5 flex items-center gap-1"><Icon className="w-3 h-3" /> {title}</p>
                  {rows.map(({ l, v }) => (
                    <div key={l} className="flex justify-between py-0.5">
                      <span className="text-slate-400">{l}</span>
                      <span className={cn('font-medium truncate ml-2', mono && 'font-mono')}>{v}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

const STATUSES = ['AVAILABLE', 'RESERVED', 'PICKING', 'QUARANTINE', 'RTV_PENDING', 'DOA', 'DAMAGED', 'PENDING_RECEIVING'];
const LIMIT = 50;

export default function InventoryPage() {
  const { m, t, fmt } = useT();
  const I = m.inventory;
  const F = I.filter;

  const [kpi, setKpi] = useState<any>(null);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

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
    try { setKpi(await inventoryApi.kpi(whFilter || undefined)); }
    catch { /* KPI cards just stay empty */ }
    finally { setKpiLoading(false); }
  }, [whFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await inventoryApi.enterpriseList({ search, warehouseId: whFilter, status: statusFilter, brandId: brandFilter, itemType: itemTypeFilter, serialOnly, aging, aging365, page, limit: LIMIT });
      setData(res.data ?? []); setTotal(res.total ?? 0);
    } catch {
      toast.error(getT().m.inventory.loadFailed);
    } finally { setLoading(false); }
  }, [search, whFilter, statusFilter, brandFilter, itemTypeFilter, serialOnly, aging, aging365, page]);

  useEffect(() => {
    warehouseApi.list().then(setWarehouses).catch(() => {});
    warehouseApi.brands().then(setBrands).catch(() => {});
    const id = new URLSearchParams(window.location.search).get('id');
    if (id) setSelectedId(id);
  }, []);
  useEffect(() => { loadKpi(); }, [loadKpi]);
  useEffect(() => { setPage(1); }, [search, whFilter, statusFilter, brandFilter, itemTypeFilter, serialOnly, aging, aging365]);
  useEffect(() => { load(); }, [load]);

  function applyQuickFilter(patch: { status?: string; aging90?: boolean; aging365?: boolean }) {
    if (patch.status !== undefined) setStatusFilter(patch.status);
    if (patch.aging90 !== undefined) { setAging(patch.aging90); if (patch.aging90) setAging365(false); }
    if (patch.aging365 !== undefined) { setAging365(patch.aging365); if (patch.aging365) setAging(false); }
  }

  const columnDefs: ColumnDef[] = COLUMNS.map((c) => ({ ...c, label: I.cols[c.key] }));
  const columnPrefs = useColumnPrefs(columnDefs, 'inventory');
  const visibleColumns = columnPrefs.visibleColumns;
  const bands = computeBands(visibleColumns);
  const colSpan = 2 + visibleColumns.length; // +1 expand toggle, +1 view column
  const pages = Math.ceil(total / LIMIT);
  const hasFilter = !!(statusFilter || whFilter || brandFilter || itemTypeFilter || serialOnly || aging || aging365);
  const selectClass = 'border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white';

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex-shrink-0 shadow-sm">
        <div className="flex items-center gap-4 flex-wrap lg:flex-nowrap">
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="w-9 h-9 bg-green-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <Package className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-slate-900 text-sm leading-none">{I.title}</h1>
              <p className="text-xs text-slate-500 mt-0.5">{I.subtitle}</p>
            </div>
          </div>
          <div className="flex-1 min-w-[180px] max-w-lg relative order-3 lg:order-none basis-full lg:basis-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input placeholder={I.searchPlaceholder} className="pl-9 h-9 text-sm bg-slate-50" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => { loadKpi(); load(); }} disabled={loading} title={I.refresh}>
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            </Button>
            <ColumnManagerButton defs={columnDefs} moduleKey="inventory" prefs={columnPrefs} />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto flex flex-col gap-3 p-4 min-h-0">
        <div className="flex items-center gap-2 text-xs text-slate-500 flex-shrink-0">
          <Info className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{I.viewOnly}</span>
        </div>

        <InventoryKpiBar
          kpi={kpi} loading={kpiLoading}
          activeStatus={statusFilter} activeAging90={aging} activeAging365={aging365}
          onQuickFilter={applyQuickFilter}
        />

        <BottleneckSection kpi={kpi} loading={kpiLoading} />

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center flex-shrink-0">
          <select className={selectClass} value={whFilter} onChange={(e) => setWhFilter(e.target.value)}>
            <option value="">{F.allWarehouses}</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
          </select>
          <select className={selectClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{F.allStatus}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{labelOf(m.status.stock, s)}</option>)}
          </select>
          <select className={selectClass} value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
            <option value="">{F.allBrands}</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className={selectClass} value={itemTypeFilter} onChange={(e) => setItemTypeFilter(e.target.value)}>
            <option value="">{F.allTypes}</option>
            <option value="FINISHED_GOODS">{F.finishedGoods}</option>
            <option value="SPARE_PART">{F.sparePart}</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input type="checkbox" checked={serialOnly} onChange={(e) => setSerialOnly(e.target.checked)} className="accent-green-600" />{F.serialOnly}
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input type="checkbox" checked={aging} onChange={(e) => applyQuickFilter({ aging90: e.target.checked })} className="accent-amber-500" />{F.aging90}
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input type="checkbox" checked={aging365} onChange={(e) => applyQuickFilter({ aging365: e.target.checked })} className="accent-red-500" />{F.aging365}
          </label>
          {hasFilter && (
            <button onClick={() => { setStatusFilter(''); setWhFilter(''); setBrandFilter(''); setItemTypeFilter(''); setSerialOnly(false); setAging(false); setAging365(false); }} className="text-xs text-slate-400 hover:text-slate-600 px-2">{F.clear}</button>
          )}
          <div className="ml-auto text-xs text-slate-500 tabular-nums">{loading ? '…' : t(I.items, { count: fmt.number(total) })}</div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 text-[10px] text-slate-400 flex-shrink-0">
          {[{ c: 'border-l-red-600', l: I.legend.doa }, { c: 'border-l-orange-400', l: I.legend.rtv }, { c: 'border-l-red-400', l: I.legend.hold }, { c: 'border-l-amber-400', l: I.legend.aging }].map(({ c, l }) => (
            <div key={c} className={cn('flex items-center gap-1 border-l-2 pl-1.5', c)}>{l}</div>
          ))}
          <span className="text-slate-300">·</span>
          <span>{I.legend.hint}</span>
        </div>

        {/* Table */}
        <div className="flex-1 min-h-[320px] bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
          <div className="overflow-auto flex-1">
            <table className="w-full text-xs min-w-[1500px]">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="bg-slate-100 border-b border-slate-200 w-8" />
                  {bands.map((b, i) => (
                    <th key={i} colSpan={b.count} className={cn('text-center text-[10px] font-bold py-2 uppercase tracking-widest bg-slate-100 border-b border-r border-slate-200', GROUP_ACCENT[b.group as GroupKey])}>{I.groups[b.group as GroupKey]}</th>
                  ))}
                  <th className="bg-slate-100 border-b border-slate-200" />
                </tr>
                <tr className="bg-slate-50">
                  <th className="w-8 bg-slate-50 border-b border-slate-200" />
                  {visibleColumns.map((col) => (
                    <th key={col.key} className="text-left px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wide whitespace-nowrap text-slate-500 border-b border-r border-slate-200">{col.label}</th>
                  ))}
                  <th className="px-3 py-2.5 bg-slate-50 border-b border-slate-200 w-16 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">{I.cols.actions}</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? [...Array(10)].map((_, i) => <tr key={i} className="border-b border-slate-100">{[...Array(colSpan)].map((_, j) => <td key={j} className="px-3 py-2.5"><Skeleton className="h-3.5" /></td>)}</tr>)
                  : data.length === 0
                  ? <tr><td colSpan={colSpan} className="px-4 py-12 text-center text-slate-400">{I.empty}</td></tr>
                  : data.map((item) => (
                      <InventoryRow key={item.id} item={item} isSelected={selectedId === item.id} onSelect={() => setSelectedId(selectedId === item.id ? null : item.id)} visibleColumns={visibleColumns} colSpan={colSpan} />
                    ))}
              </tbody>
            </table>
          </div>
          {total > LIMIT && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 bg-slate-50 flex-shrink-0">
              <p className="text-xs text-slate-500">{t(I.pageOf, { count: fmt.number(total), page, pages })}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>{I.previous}</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{I.next}</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedId && (
        <StockDetailDrawer itemId={selectedId} onClose={() => setSelectedId(null)} onChanged={() => { loadKpi(); load(); }} />
      )}
    </div>
  );
}
