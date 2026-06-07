'use client';

// Unified Fulfillment Execution Board
// Replaces /fulfillment (V1) and /fulfillment-v2 (V2).
// All execution operations go through /fulfillment backend endpoint.

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Truck, RefreshCw, AlertTriangle, Package, PackageCheck, Clock,
  Zap, ChevronDown, ChevronRight, BarChart3,
  CheckCircle2, Layers, BoxSelect, ShipWheel,
} from 'lucide-react';
import { toast } from 'sonner';
import { fulfillmentApi, requestsApi, documentsApi } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BoardData {
  allocated: any[];
  picking: any[];
  packing: any[];
  shipping: any[];
  exceptions: any[];
}

// The backend may return either the canonical lowercase shape
// ({ allocated, picking, ... }) or a lane-keyed shape ({ lanes: { ALLOCATED, ... } }).
// We accept both and normalize to BoardData so the UI never crashes on a
// missing / non-iterable lane.
type FulfillmentBoardResponse = {
  lanes?: Record<string, any[]>;
  allocated?: any[];
  picking?: any[];
  packing?: any[];
  shipping?: any[];
  exceptions?: any[];
};

const EMPTY_BOARD: BoardData = {
  allocated: [], picking: [], packing: [], shipping: [], exceptions: [],
};

const asArray = (v: any): any[] => (Array.isArray(v) ? v : []);

function normalizeBoard(raw: FulfillmentBoardResponse | null | undefined): BoardData {
  const r = raw ?? {};
  const lanes = r.lanes ?? {};
  return {
    allocated:  asArray(lanes.ALLOCATED  ?? r.allocated),
    picking:    asArray(lanes.PICKING    ?? r.picking),
    packing:    asArray(lanes.PACKING    ?? r.packing),
    shipping:   asArray(lanes.SHIPPING   ?? r.shipping),
    exceptions: asArray(lanes.EXCEPTIONS ?? r.exceptions),
  };
}

// ─── SLA helpers ─────────────────────────────────────────────────────────────

function hoursAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 3_600_000);
}

function SlaChip({ createdAt, warnH = 4, critH = 8 }: { createdAt: string; warnH?: number; critH?: number }) {
  const h = hoursAgo(createdAt);
  const cls =
    h >= critH ? 'bg-red-100 text-red-700 border-red-300' :
    h >= warnH ? 'bg-amber-100 text-amber-700 border-amber-300' :
    'bg-green-100 text-green-700 border-green-300';
  const label = h < 1 ? '<1h' : `${h}h`;
  return (
    <span className={`inline-flex items-center gap-0.5 border rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${cls}`}>
      <Clock className="w-2.5 h-2.5" />{label}
    </span>
  );
}

// ─── Mini progress bar ────────────────────────────────────────────────────────

function MiniBar({ pct, color = 'bg-cyan-500' }: { pct: number; color?: string }) {
  return (
    <div className="h-1 bg-slate-200 rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

// ─── Task Card ────────────────────────────────────────────────────────────────

function TaskCard({
  task, lane, onAdvance, onPack, onShip, onException,
}: {
  task: any; lane: string;
  onAdvance: (id: string) => void;
  onPack: (t: any) => void;
  onShip: (t: any) => void;
  onException: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isException = ['SHORT_PICK', 'DAMAGED', 'HOLD', 'CANCELLED', 'RETURNED'].includes(task.status);
  const pct = task.progressPct ?? 0;
  const itemCount = task.items?.length ?? 0;
  const pickedCount = task.items?.filter((i: any) => i.pickedAt).length ?? 0;
  const hasShortPick = task.items?.some((i: any) => i.isShortPick);
  const slaRisk = hoursAgo(task.createdAt ?? task.updatedAt) >= 8;

  const LANE_ACCENT: Record<string, string> = {
    allocated:  'border-l-amber-400',
    picking:    'border-l-cyan-500',
    packing:    'border-l-teal-500',
    shipping:   'border-l-green-500',
    exceptions: 'border-l-red-500',
  };

  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('taskId', task.id)}
      className={cn(
        'bg-white border border-slate-200 rounded-lg shadow-sm border-l-4 cursor-grab active:cursor-grabbing select-none',
        LANE_ACCENT[lane] ?? 'border-l-slate-300',
        isException && 'bg-red-50/60 border-red-200',
        slaRisk && !isException && 'ring-1 ring-red-300',
      )}
    >
      <div className="px-3 pt-2.5 pb-2">
        <div className="flex items-start justify-between gap-1.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-mono text-xs font-bold text-blue-700">{task.refNumber}</span>
              {task.requestRef && task.requestRef !== task.refNumber && (
                <span className="text-[10px] text-slate-400 font-mono">{task.requestRef}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <SlaChip createdAt={task.createdAt ?? task.updatedAt} />
              {hasShortPick && (
                <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-300 rounded px-1 font-medium">⚠ SHORT</span>
              )}
              <Badge variant="outline" className={cn('text-[9px] px-1 py-0',
                task.status === 'ALLOCATED'    ? 'bg-slate-100 text-slate-600' :
                task.status === 'PICKING'      ? 'bg-cyan-100 text-cyan-700' :
                task.status === 'PICKED'       ? 'bg-cyan-200 text-cyan-800' :
                task.status === 'PACKING'      ? 'bg-teal-100 text-teal-700' :
                task.status === 'PACKED'       ? 'bg-teal-200 text-teal-800' :
                task.status === 'READY_TO_SHIP'? 'bg-green-100 text-green-700' :
                task.status === 'SHIPPED'      ? 'bg-blue-100 text-blue-700' :
                task.status === 'DELIVERED'    ? 'bg-emerald-100 text-emerald-700' :
                'bg-red-100 text-red-700'
              )}>{task.status.replace(/_/g, ' ')}</Badge>
            </div>
          </div>
          <button onClick={() => setExpanded((v) => !v)} className="text-slate-300 hover:text-slate-500 flex-shrink-0 mt-0.5">
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </div>

        <div className="mt-2 space-y-1">
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>Pick progress</span>
            <span className="font-medium tabular-nums">{pickedCount}/{itemCount} · {pct}%</span>
          </div>
          <MiniBar pct={pct} color={pct === 100 ? 'bg-green-500' : pct > 50 ? 'bg-cyan-500' : 'bg-amber-400'} />
        </div>

        <div className="mt-2 space-y-0.5">
          {task.items?.slice(0, expanded ? 20 : 2).map((it: any) => (
            <div key={it.id} className="flex items-center justify-between text-[11px]">
              <span className="text-slate-600 truncate font-mono">{it.product?.code ?? '—'}</span>
              <span className="text-slate-400 tabular-nums flex-shrink-0 ml-1">
                {it.pickedAt ? <span className="text-green-600 font-medium">{it.qtyPicked}</span> : it.qtyRequested}
                /{it.qtyRequested}
              </span>
            </div>
          ))}
          {!expanded && itemCount > 2 && (
            <button onClick={() => setExpanded(true)} className="text-[10px] text-blue-500 hover:underline">
              +{itemCount - 2} more items
            </button>
          )}
        </div>

        {task.warehouseId && (
          <p className="text-[10px] text-slate-400 mt-1 truncate">WH: {task.warehouseId.slice(-8)}</p>
        )}
      </div>

      <div className="px-3 pb-2.5 flex gap-1 flex-wrap border-t border-slate-100 pt-2">
        {!isException && (
          <Button size="sm" className="h-6 text-[11px] px-2 bg-blue-600 hover:bg-blue-700 text-white flex-1" onClick={() => onAdvance(task.id)}>
            Next →
          </Button>
        )}
        {['PICKED', 'PACKING'].includes(task.status) && (
          <Button size="sm" className="h-6 text-[11px] px-2 bg-teal-600 hover:bg-teal-700 text-white" onClick={() => onPack(task)}>
            <Package className="w-3 h-3" />
          </Button>
        )}
        {['PACKED', 'READY_TO_SHIP'].includes(task.status) && (
          <Button size="sm" className="h-6 text-[11px] px-2 bg-purple-600 hover:bg-purple-700 text-white" onClick={() => onShip(task)}>
            <Truck className="w-3 h-3" />
          </Button>
        )}
        <button
          onClick={() => documentsApi.openWithAuth(documentsApi.pickingSlipUrl(task.requestId ?? task.id))}
          className="h-6 px-1.5 text-[10px] border border-slate-200 rounded text-slate-500 hover:text-blue-600 hover:border-blue-300 flex items-center gap-0.5"
          title="Print Picking Slip"
        >
          🖨
        </button>
        {!isException && (
          <button
            className="h-6 px-1.5 text-[10px] border border-slate-200 rounded text-slate-500 hover:text-red-600 hover:border-red-300 flex items-center"
            onClick={() => onException(task.id)}
            title="Mark Exception"
          >
            <AlertTriangle className="w-3 h-3" />
          </button>
        )}
        <Link href={`/shipment-detail?taskId=${task.id}`}>
          <button className="h-6 px-1.5 text-[10px] border border-slate-200 rounded text-slate-500 hover:text-slate-800 flex items-center">Detail</button>
        </Link>
      </div>
    </div>
  );
}

// ─── Lane Column ──────────────────────────────────────────────────────────────

interface LaneConfig {
  key: keyof BoardData;
  title: string;
  icon: any;
  headerBg: string;
  headerText: string;
  accentBar: string;
  dropAccent: string;
}

const LANES: LaneConfig[] = [
  { key: 'allocated',  title: 'Pending Inventory', icon: Layers,        headerBg: 'bg-amber-600',  headerText: 'text-white', accentBar: 'bg-amber-500',  dropAccent: 'border-amber-400 bg-amber-50/40' },
  { key: 'picking',    title: 'Picking',            icon: BoxSelect,     headerBg: 'bg-cyan-700',   headerText: 'text-white', accentBar: 'bg-cyan-500',   dropAccent: 'border-cyan-400 bg-cyan-50/40' },
  { key: 'packing',    title: 'Packing / Label',    icon: Package,       headerBg: 'bg-teal-700',   headerText: 'text-white', accentBar: 'bg-teal-500',   dropAccent: 'border-teal-400 bg-teal-50/40' },
  { key: 'shipping',   title: 'Ready / Shipped',    icon: Truck,         headerBg: 'bg-green-700',  headerText: 'text-white', accentBar: 'bg-green-500',  dropAccent: 'border-green-400 bg-green-50/40' },
  { key: 'exceptions', title: 'Exception',          icon: AlertTriangle, headerBg: 'bg-red-700',    headerText: 'text-white', accentBar: 'bg-red-500',    dropAccent: 'border-red-400 bg-red-50/40' },
];

function FulfillmentLane({ cfg, tasks, onAdvance, onPack, onShip, onException, onDrop }: {
  cfg: LaneConfig; tasks: any[];
  onAdvance: (id: string) => void;
  onPack: (t: any) => void;
  onShip: (t: any) => void;
  onException: (id: string) => void;
  onDrop: (id: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const Icon = cfg.icon;
  const safeTasks = asArray(tasks);
  const slaRiskCount = safeTasks.filter((t) => hoursAgo(t.createdAt ?? t.updatedAt) >= 4).length;

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border-2 transition-colors min-w-[220px] flex-1',
        dragging ? cfg.dropAccent + ' border-2' : 'border-slate-200 bg-slate-50/50',
      )}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const id = e.dataTransfer.getData('taskId'); if (id) onDrop(id); }}
    >
      <div className={cn('rounded-t-[10px] px-3 py-2.5', cfg.headerBg)}>
        <div className="flex items-center gap-2">
          <Icon className={cn('w-4 h-4', cfg.headerText)} />
          <span className={cn('font-semibold text-sm', cfg.headerText)}>{cfg.title}</span>
          <div className="ml-auto flex items-center gap-1.5">
            {slaRiskCount > 0 && (
              <span className="bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center" title="SLA at risk">
                {slaRiskCount}
              </span>
            )}
            <span className="bg-white/20 text-white text-xs font-bold rounded-full px-2 py-0.5">
              {safeTasks.length}
            </span>
          </div>
        </div>
        <div className={cn('h-0.5 rounded-full mt-2 opacity-60', cfg.accentBar)} />
      </div>
      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-260px)]">
        {safeTasks.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-xs">
            <Icon className="w-6 h-6 mx-auto mb-1.5 opacity-30" />No tasks
          </div>
        ) : (
          safeTasks.map((t) => (
            <TaskCard key={t.id} task={t} lane={cfg.key}
              onAdvance={onAdvance} onPack={onPack} onShip={onShip} onException={onException}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── KPI Bar ──────────────────────────────────────────────────────────────────

function KpiBar({ board, loading }: { board: BoardData; loading: boolean }) {
  const allocated  = asArray(board.allocated);
  const picking    = asArray(board.picking);
  const packing    = asArray(board.packing);
  const shipping   = asArray(board.shipping);
  const exceptions = asArray(board.exceptions);
  const allTasks = [...allocated, ...picking, ...packing, ...shipping, ...exceptions];
  const slaRisk = allTasks.filter((t) => hoursAgo(t.createdAt ?? t.updatedAt) >= 4).length;

  const kpis = [
    { label: 'Pending Inv.', value: allocated.length,  icon: Layers,        color: 'text-amber-600',  bg: 'bg-amber-50',  border: 'border-amber-200' },
    { label: 'Picking',      value: picking.length,    icon: BoxSelect,     color: 'text-cyan-700',   bg: 'bg-cyan-50',   border: 'border-cyan-200' },
    { label: 'Packing',      value: packing.length,    icon: Package,       color: 'text-teal-700',   bg: 'bg-teal-50',   border: 'border-teal-200' },
    { label: 'Ready/Ship',   value: shipping.length,   icon: Truck,         color: 'text-green-700',  bg: 'bg-green-50',  border: 'border-green-200' },
    { label: 'Exception',    value: exceptions.length, icon: AlertTriangle, color: 'text-red-700',    bg: 'bg-red-50',    border: 'border-red-200' },
    { label: 'SLA Risk',     value: slaRisk, icon: Clock,
      color: slaRisk > 0 ? 'text-red-700' : 'text-slate-500',
      bg:    slaRisk > 0 ? 'bg-red-50'    : 'bg-slate-50',
      border:slaRisk > 0 ? 'border-red-200' : 'border-slate-200',
    },
    { label: 'Total Active', value: allTasks.length, icon: BarChart3, color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' },
  ];

  return (
    <div className="flex gap-2 flex-wrap">
      {kpis.map(({ label, value, icon: Icon, color, bg, border }) => (
        <div key={label} className={cn('flex items-center gap-2.5 px-3 py-2 rounded-lg border shadow-sm min-w-[110px]', bg, border)}>
          <div className={cn('flex-shrink-0', color)}><Icon className="w-4 h-4" /></div>
          <div>
            {loading ? <Skeleton className="h-5 w-8" /> : (
              <p className={cn('text-xl font-bold tabular-nums leading-none', color)}>{value}</p>
            )}
            <p className="text-[10px] text-slate-500 mt-0.5">{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Exception Modal ──────────────────────────────────────────────────────────

function ExceptionModal({ taskId, onClose, onConfirm }: {
  taskId: string; onClose: () => void;
  onConfirm: (id: string, status: string, reason: string) => void;
}) {
  const [status, setStatus] = useState('HOLD');
  const [reason, setReason] = useState('');
  const OPTIONS = [
    { value: 'HOLD',       label: 'Hold — Pending review' },
    { value: 'SHORT_PICK', label: 'Short Pick — Insufficient stock' },
    { value: 'DAMAGED',    label: 'Damaged — Item damaged' },
    { value: 'CANCELLED',  label: 'Cancelled' },
    { value: 'RETURNED',   label: 'Returned' },
  ];
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-red-700">Mark Exception</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs mb-1 block">Exception Type</Label>
            <div className="space-y-1">
              {OPTIONS.map((o) => (
                <label key={o.value} className={cn('flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors',
                  status === o.value ? 'bg-red-50 border-red-400 text-red-800 font-medium' : 'border-slate-200 hover:bg-slate-50')}>
                  <input type="radio" className="accent-red-600" checked={status === o.value} onChange={() => setStatus(o.value)} />
                  {o.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Reason / Notes</Label>
            <Input placeholder="Describe the exception…" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => onConfirm(taskId, status, reason)}>
            <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Confirm Exception
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FulfillmentBoardPage() {
  const [board, setBoard] = useState<BoardData>(EMPTY_BOARD);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const [packTask, setPackTask] = useState<any>(null);
  const [packForm, setPackForm] = useState({ cartonCount: 1, totalWeight: '', notes: '' });
  const [shipTask, setShipTask] = useState<any>(null);
  const [shipForm, setShipForm] = useState({ carrier: '', trackingNumber: '', receiverName: '', notes: '' });
  const [allocOpen, setAllocOpen] = useState(false);
  const [reqRef, setReqRef] = useState('');
  const [exceptionTaskId, setExceptionTaskId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await fulfillmentApi.board();
      setBoard(normalizeBoard(raw as FulfillmentBoardResponse));
    } catch {
      toast.error('Failed to load board');
      setBoard(EMPTY_BOARD);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (autoRefresh) intervalRef.current = setInterval(load, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, load]);

  async function advance(id: string) {
    try { await fulfillmentApi.advance(id); toast.success('Status advanced'); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  async function handleException(id: string, status: string, reason: string) {
    try {
      await fulfillmentApi.setException(id, status, reason);
      toast.success(`Exception: ${status}`); setExceptionTaskId(null); load();
    } catch (e: any) { toast.error(e.message); }
  }

  async function confirmPack() {
    if (!packTask) return;
    try {
      await fulfillmentApi.startPacking(packTask.id);
      await fulfillmentApi.updatePacking(packTask.id, {
        cartonCount: Number(packForm.cartonCount),
        totalWeight: packForm.totalWeight ? Number(packForm.totalWeight) : undefined,
        notes: packForm.notes || undefined,
      });
      await fulfillmentApi.completePacking(packTask.id);
      toast.success('Packing completed'); setPackTask(null); load();
    } catch (e: any) { toast.error(e.message); }
  }

  async function confirmShip() {
    if (!shipTask) return;
    try {
      const sh = await fulfillmentApi.createShipment(shipTask.id, shipForm);
      await fulfillmentApi.confirmDispatch(sh.id);
      toast.success('Dispatched — Goods Issued!'); setShipTask(null); load();
    } catch (e: any) { toast.error(e.message); }
  }

  async function allocate() {
    const reqs = await requestsApi.list({ limit: 5 }).catch(() => ({ data: [] }));
    const req = (reqs as any).data?.find(
      (r: any) => r.refNumber === reqRef.trim() || r.id === reqRef.trim(),
    );
    if (!req) { toast.error('Request not found'); return; }
    try {
      await fulfillmentApi.allocate(req.id);
      toast.success(`Allocated ${req.refNumber}`); setAllocOpen(false); setReqRef(''); load();
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      {/* Top Control Bar */}
      <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center gap-4 flex-shrink-0 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-blue-700 rounded-lg flex items-center justify-center flex-shrink-0">
            <ShipWheel className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-slate-900 text-sm leading-none">Fulfillment Execution</h1>
            <p className="text-xs text-slate-500 mt-0.5">Pick / Pack / Ship — Unified Board</p>
          </div>
        </div>
        <div className="flex-1 overflow-x-auto">
          <KpiBar board={board} loading={loading} />
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={cn('flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors',
              autoRefresh ? 'bg-green-50 border-green-300 text-green-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50')}
          >
            <Zap className="w-3 h-3" />{autoRefresh ? 'Live' : 'Auto'}
          </button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={load} disabled={loading}>
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </Button>
          <Button size="sm" className="h-8 bg-blue-700 hover:bg-blue-800 text-white gap-1.5 text-xs" onClick={() => setAllocOpen(true)}>
            + Allocate
          </Button>
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-hidden p-4">
        {loading && asArray(board.allocated).length === 0 ? (
          <div className="flex gap-3 h-full">
            {LANES.map((l) => <Skeleton key={l.key} className="flex-1 min-w-[220px] rounded-xl" />)}
          </div>
        ) : (
          <div className="flex gap-3 h-full overflow-x-auto pb-1">
            {LANES.map((cfg) => (
              <FulfillmentLane
                key={cfg.key} cfg={cfg} tasks={asArray(board[cfg.key])}
                onAdvance={advance} onPack={setPackTask} onShip={setShipTask}
                onException={(id) => setExceptionTaskId(id)} onDrop={advance}
              />
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="bg-white border-t border-slate-100 px-5 py-2 flex flex-wrap gap-4 text-[10px] text-slate-400 flex-shrink-0">
        <span><Clock className="w-3 h-3 inline mr-0.5 text-green-500" /> &lt;4h = OK</span>
        <span><Clock className="w-3 h-3 inline mr-0.5 text-amber-500" /> 4–8h = Warn</span>
        <span><Clock className="w-3 h-3 inline mr-0.5 text-red-500" /> &gt;8h = SLA Risk</span>
        <span className="text-slate-300">|</span>
        <span>Drag → advance &nbsp;·&nbsp; 📦 = Pack &nbsp;·&nbsp; 🚚 = Ship (Goods Issue) &nbsp;·&nbsp; ⚠ = Exception</span>
      </div>

      {/* Modals */}
      {exceptionTaskId && (
        <ExceptionModal taskId={exceptionTaskId} onClose={() => setExceptionTaskId(null)} onConfirm={handleException} />
      )}

      <Dialog open={allocOpen} onOpenChange={setAllocOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Allocate Request → Fulfillment Task</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Request Ref / ID</Label>
            <Input value={reqRef} onChange={(e) => setReqRef(e.target.value)} placeholder="WR-2026-XXXXXX" autoFocus />
            <p className="text-xs text-slate-400">Request must be APPROVED. Stock will be reserved (FIFO).</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAllocOpen(false)}>Cancel</Button>
            <Button onClick={allocate} className="bg-blue-700 hover:bg-blue-800 text-white">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Allocate (FIFO)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!packTask} onOpenChange={(o) => !o && setPackTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-4 h-4 text-teal-600" /> Packing — {packTask?.refNumber}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Carton Count</Label>
                <Input type="number" min={1} value={packForm.cartonCount} onChange={(e) => setPackForm((f) => ({ ...f, cartonCount: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1"><Label className="text-xs">Total Weight (kg)</Label>
                <Input type="number" min={0} value={packForm.totalWeight} onChange={(e) => setPackForm((f) => ({ ...f, totalWeight: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1"><Label className="text-xs">Notes</Label>
              <Input value={packForm.notes} onChange={(e) => setPackForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="space-y-1">
              {packTask?.items?.map((it: any) => (
                <div key={it.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                  <div className="flex items-center gap-2">
                    <PackageCheck className="w-3.5 h-3.5 text-teal-600" />
                    <span className="font-mono font-medium">{it.product?.code}</span>
                  </div>
                  <span className="text-slate-500">{it.qtyPicked}/{it.qtyRequested}</span>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPackTask(null)}>Cancel</Button>
            <Button onClick={confirmPack} className="bg-teal-600 hover:bg-teal-700 text-white">
              <Package className="w-3.5 h-3.5 mr-1" /> Complete Packing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!shipTask} onOpenChange={(o) => !o && setShipTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-purple-600" /> Create Shipment & Dispatch — {shipTask?.refNumber}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Carrier</Label>
                <Input value={shipForm.carrier} onChange={(e) => setShipForm((f) => ({ ...f, carrier: e.target.value }))} placeholder="DHL, FedEx, J&T…" />
              </div>
              <div className="space-y-1"><Label className="text-xs">Tracking No.</Label>
                <Input value={shipForm.trackingNumber} onChange={(e) => setShipForm((f) => ({ ...f, trackingNumber: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1"><Label className="text-xs">Receiver Name</Label>
              <Input value={shipForm.receiverName} onChange={(e) => setShipForm((f) => ({ ...f, receiverName: e.target.value }))} />
            </div>
            <div className="space-y-1"><Label className="text-xs">Notes</Label>
              <Input value={shipForm.notes} onChange={(e) => setShipForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              ⚠ Confirming dispatch will trigger Goods Issue — stock will be deducted from inventory.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShipTask(null)}>Cancel</Button>
            <Button onClick={confirmShip} className="bg-purple-600 hover:bg-purple-700 text-white">
              <Truck className="w-3.5 h-3.5 mr-1" /> Dispatch & Issue Stock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
