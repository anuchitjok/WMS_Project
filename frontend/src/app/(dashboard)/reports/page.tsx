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

const REPORTS: { key: ReportType; label: string; desc: string }[] = [
  { key: 'master-data', label: 'Master Data', desc: 'Full lineage of every stock item' },
  { key: 'balance', label: 'Balance', desc: 'On-hand stock with last in/out dates' },
  { key: 'receive', label: 'Receive', desc: 'Every goods-receiving line' },
];

const DATE_KEYS = new Set(['createDate', 'receiveDate', 'lastInDate', 'lastOutDate']);

function fmtCell(key: string, value: any) {
  if (value == null || value === '') return '—';
  if (DATE_KEYS.has(key)) { try { return formatDate(value); } catch { return value; } }
  return String(value);
}

// ─── KPI summary (unchanged) ──────────────────────────────────────────────────
function SummarySection() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
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
          <StatCard title="Request SLA" value={`${data?.kpis.slaRate ?? 0}%`} icon={Clock} color="green" subtitle="Completed within target" />
          <StatCard title="DOA Rate" value={`${data?.kpis.doaRate ?? 0}%`} icon={AlertTriangle} color="red" subtitle="DOA / damaged ratio" />
          <StatCard title="Open RTV" value={data?.kpis.openRtv ?? 0} icon={RotateCcw} color="yellow" subtitle="Vendor return cases" />
          <StatCard title="Low Stock" value={data?.kpis.lowStockCount ?? 0} icon={TrendingDown} color="yellow" subtitle="Below safety stock" />
        </div>
      )}
    </>
  );
}

// ─── Inventory report viewer ──────────────────────────────────────────────────
function ReportViewer({ report, warehouses }: { report: ReportType; warehouses: any[] }) {
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');

  const filters = useCallback(
    () => ({ warehouseId: warehouseId || undefined, from: from || undefined, to: to || undefined, q: q || undefined }),
    [warehouseId, from, to, q],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await reportsApi.data(report, filters()));
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [report, filters]);

  useEffect(() => { load(); }, [load]);

  async function handleExport(format: 'xlsx' | 'csv') {
    setExporting(true);
    try {
      await reportsApi.export(report, format, filters());
      toast.success(`Exported ${format.toUpperCase()}`);
    } catch (e: any) {
      toast.error(e.message ?? 'Export failed');
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
          <Label className="text-xs">Warehouse</Label>
          <Select value={warehouseId} onValueChange={(v) => setWarehouseId(v ?? '')}>
            <SelectTrigger className="w-full">
              <span className={cn('flex flex-1 text-left truncate text-sm', !warehouseId && 'text-muted-foreground')}>
                {warehouses.find((w) => w.id === warehouseId)?.name || 'All warehouses'}
              </span>
            </SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value="">All warehouses</SelectItem>
              {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[150px]" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[150px]" />
        </div>
        <div className="space-y-1 flex-1 min-w-[180px]">
          <Label className="text-xs">Search</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Brand, SKU, serial…" className="pl-8" />
          </div>
        </div>
        <Button variant="outline" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Apply
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
          <span className="text-sm text-slate-500">{loading ? 'Loading…' : `${rows.length} rows`}</span>
        </div>
        <div className="max-h-[600px] overflow-auto">
          {loading ? (
            <div className="p-4 space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-400 p-8 text-center">No data for the selected filters.</p>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-50">
                <TableRow>
                  {columns.map((c) => <TableHead key={c.key} className="text-xs uppercase tracking-wide text-slate-500">{c.header}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    {columns.map((c) => (
                      <TableCell key={c.key} className="text-slate-700">{fmtCell(c.key, r[c.key])}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [tab, setTab] = useState<ReportType>('master-data');
  const [warehouses, setWarehouses] = useState<any[]>([]);

  useEffect(() => { warehouseApi.list().then(setWarehouses).catch(() => {}); }, []);

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Reports & Dashboard" subtitle="Inventory exports, RMA, RTV, SLA and audit reports" icon={BarChart3} />

      <SummarySection />

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Inventory Reports</h2>
        <Tabs value={tab} onValueChange={(v) => setTab(v as ReportType)}>
          <TabsList>
            {REPORTS.map((r) => <TabsTrigger key={r.key} value={r.key}>{r.label}</TabsTrigger>)}
          </TabsList>
          {REPORTS.map((r) => (
            <TabsContent key={r.key} value={r.key} className="mt-4">
              <p className="text-sm text-slate-500 mb-3">{r.desc}</p>
              {tab === r.key && <ReportViewer report={r.key} warehouses={warehouses} />}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
