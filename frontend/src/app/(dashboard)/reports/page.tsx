'use client';

import { useEffect, useState, useCallback } from 'react';
import { BarChart3, Clock, AlertTriangle, RotateCcw, TrendingDown, Download, Search, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { reportsApi, warehouseApi, type ReportType, type ReportResult } from '@/lib/api';
import { StatCard } from '@/components/dashboard/stat-card';
import { PageHeader } from '@/components/layout/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatDate, cn } from '@/lib/utils';
import { StockDetailDrawer } from '@/components/inventory/stock-detail-drawer';
import { getT, labelOf, useT } from '@/i18n';

const REPORTS: ReportType[] = ['master-data', 'balance', 'receive'];

const DATE_KEYS = new Set(['createDate', 'receiveDate', 'lastInDate', 'lastOutDate', 'createdOn', 'lastModifiedOn']);
const NUMBER_KEYS = new Set(['qty', 'currentCost', 'defaultPrice']);

function fmtCell(key: string, value: any, number: (n: number) => string) {
  if (value == null || value === '') return '—';
  if (DATE_KEYS.has(key)) { try { return formatDate(value); } catch { return value; } }
  if (NUMBER_KEYS.has(key) && typeof value === 'number') return number(value);
  return String(value);
}

// ─── KPI summary (unchanged) ──────────────────────────────────────────────────
function SummarySection() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { m, fmt } = useT();
  const K = m.reports.kpi;
  useEffect(() => {
    reportsApi.summary().then(setData).finally(() => setLoading(false));
  }, []);

  return (
    <>
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard title={K.sla} value={`${fmt.number(data?.kpis.slaRate ?? 0)}%`} icon={Clock} color="green" subtitle={K.slaSub} />
          <StatCard title={K.doa} value={`${fmt.number(data?.kpis.doaRate ?? 0)}%`} icon={AlertTriangle} color="red" subtitle={K.doaSub} />
          <StatCard title={K.rtv} value={fmt.number(data?.kpis.openRtv ?? 0)} icon={RotateCcw} color="yellow" subtitle={K.rtvSub} />
          <StatCard title={K.lowStock} value={fmt.number(data?.kpis.lowStockCount ?? 0)} icon={TrendingDown} color="yellow" subtitle={K.lowStockSub} />
        </div>
      )}
    </>
  );
}

// ─── Inventory report viewer ──────────────────────────────────────────────────
function ReportViewer({ report, warehouses, initialStockId, initialWarehouseId, initialQ }: { report: ReportType; warehouses: any[]; initialStockId?: string; initialWarehouseId?: string; initialQ?: string }) {
  const [detailId, setDetailId] = useState<string | null>(initialStockId ?? null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [warehouseId, setWarehouseId] = useState(initialWarehouseId ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState(initialQ ?? '');
  const { m, t, fmt } = useT();
  const RP = m.reports;
  const colHeader = (key: string, fallback: string) =>
    (report === 'receive' ? (RP.receiveColumns as Record<string, string>)[key] : undefined)
    ?? (RP.columns as Record<string, string>)[key] ?? fallback;
  // Screen-only labels from the stored values the API sends next to the English export text
  // (e.g. 'RTV Replacement' → "RTV Return" in the user's language). Exports keep the English text.
  const cell = (key: string, r: Record<string, any>) => {
    if (key === 'sourceType' && r.sourceTypeValue) return labelOf(m.receiving.sourceType, r.sourceTypeValue);
    if (report === 'receive') {
      if (key === 'condition') {
        if (r.itemCondition) return labelOf(m.receiving.form.itemCondition, r.itemCondition);
        if (r.qcCondition) return t(RP.qcCondition, { value: labelOf(m.receiving.condition, String(r.qcCondition).toLowerCase()) });
      }
      if (key === 'itemStatus' && r.itemStatusValue) return labelOf(m.products.status, r.itemStatusValue);
      if (key === 'itemType' && r.itemTypeValue) return labelOf(m.products.type, r.itemTypeValue);
    }
    return fmtCell(key, r[key], fmt.number);
  };

  const filters = useCallback(
    () => ({ warehouseId: warehouseId || undefined, from: from || undefined, to: to || undefined, q: q || undefined }),
    [warehouseId, from, to, q],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await reportsApi.data(report, filters()));
    } catch (e: any) {
      toast.error(e.message || getT().m.reports.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [report, filters]);

  useEffect(() => { load(); }, [load]);

  async function handleExport(format: 'xlsx' | 'csv') {
    setExporting(true);
    try {
      await reportsApi.export(report, format, filters());
      toast.success(t(RP.exported, { format: format.toUpperCase() }));
    } catch (e: any) {
      toast.error(e.message || RP.exportFailed);
    } finally {
      setExporting(false);
    }
  }

  const columns = result?.columns ?? [];
  const rows = result?.rows ?? [];

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="space-y-1 min-w-[180px]">
          <Label className="text-xs">{RP.filter.warehouse}</Label>
          <Select value={warehouseId} onValueChange={(v) => setWarehouseId(v ?? '')}>
            <SelectTrigger className="w-full">
              <span className={cn('flex flex-1 text-left truncate text-sm', !warehouseId && 'text-muted-foreground')}>
                {warehouses.find((w) => w.id === warehouseId)?.name || RP.filter.allWarehouses}
              </span>
            </SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value="">{RP.filter.allWarehouses}</SelectItem>
              {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{RP.filter.from}</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[150px]" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{RP.filter.to}</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[150px]" />
        </div>
        <div className="space-y-1 flex-1 min-w-[180px]">
          <Label className="text-xs">{RP.filter.search}</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={RP.filter.searchPlaceholder} className="pl-8" />
          </div>
        </div>
        <Button variant="outline" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> {RP.filter.apply}
        </Button>
        <div className="flex gap-2">
          <Button onClick={() => handleExport('xlsx')} disabled={exporting || rows.length === 0} className="bg-green-600 hover:bg-green-700 text-white gap-1.5">
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </Button>
          <Button variant="outline" onClick={() => handleExport('csv')} disabled={exporting || rows.length === 0} className="gap-1.5">
            <Download className="h-4 w-4" /> CSV
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <span className="text-sm text-slate-500">{loading ? m.common.states.loading : t(RP.rows, { count: fmt.number(rows.length) })}</span>
        </div>
        <div className="max-h-[600px] overflow-auto">
          {loading ? (
            <div className="p-4 space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-400 p-8 text-center">{RP.noData}</p>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-50">
                <TableRow>
                  {columns.map((c) => <TableHead key={c.key} className="text-xs uppercase tracking-wide text-slate-500 whitespace-nowrap">{colHeader(c.key, c.header)}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i}
                    className={cn(r.stockId && 'cursor-pointer hover:bg-slate-50', r.stockId && r.stockId === detailId && 'bg-green-50')}
                    onClick={r.stockId ? () => setDetailId(r.stockId) : undefined}
                    title={r.stockId ? RP.openDetail : undefined}>
                    {columns.map((c) => (
                      <TableCell key={c.key} className="text-slate-700">{cell(c.key, r)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
      {detailId && <StockDetailDrawer itemId={detailId} onClose={() => setDetailId(null)} onChanged={load} />}
    </div>
  );
}

export default function ReportsPage() {
  const [tab, setTab] = useState<ReportType>('master-data');
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [linkedStock, setLinkedStock] = useState<string | undefined>();
  const [linkedFilter, setLinkedFilter] = useState<{ warehouseId?: string; q?: string }>({});
  const { m } = useT();
  const RP = m.reports;

  useEffect(() => { warehouseApi.list().then(setWarehouses).catch(() => {}); }, []);

  // Deep links (static export, so read the query on the client): ?tab=balance&stock=<id>
  // is where the retired Inventory page and dashboard links now land.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('tab');
    if (t && REPORTS.includes(t as ReportType)) setTab(t as ReportType);
    const s = params.get('stock');
    if (s) setLinkedStock(s);
    // Dashboard drill-downs: ?warehouse=<id>&q=<sku>
    setLinkedFilter({ warehouseId: params.get('warehouse') ?? undefined, q: params.get('q') ?? undefined });
  }, []);

  return (
    <div className="p-6 space-y-6">
      <PageHeader title={RP.title} subtitle={RP.subtitle} icon={BarChart3} />

      <SummarySection />

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">{RP.inventoryReports}</h2>
        <Tabs value={tab} onValueChange={(v) => setTab(v as ReportType)}>
          <TabsList>
            {REPORTS.map((r) => <TabsTrigger key={r} value={r}>{RP.tabs[r]}</TabsTrigger>)}
          </TabsList>
          {REPORTS.map((r) => (
            <TabsContent key={r} value={r} className="mt-4">
              <p className="text-sm text-slate-500 mb-3">{RP.desc[r]}</p>
              {tab === r && <ReportViewer key={r === 'balance' ? `${linkedFilter.warehouseId ?? ''}|${linkedFilter.q ?? ''}` : r} report={r} warehouses={warehouses} initialStockId={r === 'balance' ? linkedStock : undefined} initialWarehouseId={r === 'balance' ? linkedFilter.warehouseId : undefined} initialQ={r === 'balance' ? linkedFilter.q : undefined} />}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
