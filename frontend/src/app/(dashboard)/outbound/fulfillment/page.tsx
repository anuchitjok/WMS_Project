'use client';

// Unified Fulfillment Execution Board — Table Queue Layout
// Business logic unchanged; kanban replaced with sortable/filterable table.

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Truck, RefreshCw, AlertTriangle, Package, PackageCheck, Clock,
  Zap, ChevronUp, ChevronDown, Printer, Search, User,
  CheckCircle2, Layers, BoxSelect, ShipWheel, LayoutGrid,
} from 'lucide-react';
import { toast } from 'sonner';
import { fulfillmentApi, documentsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { DiscardChangesDialog } from '@/components/ui/discard-changes-dialog';
import { useDiscardGuard } from '@/hooks/use-discard-guard';
import { cn, hasUnsavedChanges } from '@/lib/utils';
import Link from 'next/link';
import { INTL_LOCALE, getT, labelOf, useT, type Locale, type Messages } from '@/i18n';

type FMsgs = Messages['fulfillment'];

const BLANK_PACK_FORM = { cartonCount: 1, totalWeight: '', notes: '' };
const BLANK_SHIP_FORM = { carrier: '', trackingNumber: '', receiverName: '', notes: '' };

// ─── Types ────────────────────────────────────────────────────────────────────

interface BoardData {
  allocated: any[];
  picking: any[];
  packing: any[];
  shipping: any[];
  exceptions: any[];
}

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

type LaneKey = 'all' | keyof BoardData;
type SubFilter = 'all' | 'open' | 'assigned' | 'mine';
type SortField = 'time' | 'sla';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hoursAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 3_600_000);
}

function formatRequestTime(dateStr: string | undefined, locale: Locale): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  const now = new Date();
  const intl = INTL_LOCALE[locale];
  const timeStr = d.toLocaleTimeString(intl, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.toDateString() === now.toDateString()) return timeStr;
  return d.toLocaleDateString(intl, { day: '2-digit', month: 'short' }) + ' ' + timeStr;
}

// ─── KPI / Filter Cards ───────────────────────────────────────────────────────

function KpiFilterBar({
  board,
  loading,
  selected,
  onSelect,
}: {
  board: BoardData;
  loading: boolean;
  selected: LaneKey;
  onSelect: (lane: LaneKey) => void;
}) {
  const allocated  = asArray(board.allocated);
  const picking    = asArray(board.picking);
  const packing    = asArray(board.packing);
  const shipping   = asArray(board.shipping);
  const exceptions = asArray(board.exceptions);
  const allTasks   = [...allocated, ...picking, ...packing, ...shipping, ...exceptions];
  const slaRisk    = allTasks.filter((t) => hoursAgo(t.createdAt ?? t.updatedAt) >= 4).length;
  const { m } = useT();
  const L = m.fulfillment.lanes;

  const cards: {
    key: LaneKey; label: string; icon: any; count: number;
    numCls: string; activeCls: string;
  }[] = [
    { key: 'all',        label: L.all,        icon: LayoutGrid,    count: allTasks.length,   numCls: 'text-slate-700',  activeCls: 'border-slate-400 bg-slate-50 ring-1 ring-slate-200' },
    { key: 'allocated',  label: L.allocated, icon: Layers,        count: allocated.length,  numCls: 'text-amber-700',  activeCls: 'border-amber-400 bg-amber-50 ring-1 ring-amber-200' },
    { key: 'picking',    label: L.picking,            icon: BoxSelect,     count: picking.length,    numCls: 'text-cyan-700',   activeCls: 'border-cyan-400 bg-cyan-50 ring-1 ring-cyan-200' },
    { key: 'packing',    label: L.packing,   icon: Package,       count: packing.length,    numCls: 'text-teal-700',   activeCls: 'border-teal-400 bg-teal-50 ring-1 ring-teal-200' },
    { key: 'shipping',   label: L.shipping,   icon: Truck,         count: shipping.length,   numCls: 'text-green-700',  activeCls: 'border-green-400 bg-green-50 ring-1 ring-green-200' },
    { key: 'exceptions', label: L.exceptions,          icon: AlertTriangle, count: exceptions.length, numCls: 'text-red-700',    activeCls: 'border-red-400 bg-red-50 ring-1 ring-red-200' },
  ];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {cards.map(({ key, label, icon: Icon, count, numCls, activeCls }) => (
        <button
          key={key}
          onClick={() => onSelect(key)}
          className={cn(
            'flex items-center gap-2.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white shadow-sm transition-all cursor-pointer hover:border-slate-300',
            selected === key && activeCls,
          )}
        >
          <Icon className={cn('w-4 h-4 flex-shrink-0', numCls)} />
          <div className="text-left">
            {loading
              ? <Skeleton className="h-5 w-8" />
              : <p className="text-xl font-bold tabular-nums leading-none text-slate-900">{count}</p>
            }
            <p className="text-[11px] text-slate-500 mt-1 whitespace-nowrap">{label}</p>
          </div>
        </button>
      ))}
      {/* SLA Risk — info only */}
      <div className={cn(
        'flex items-center gap-2.5 px-3.5 py-2 rounded-lg border shadow-sm',
        slaRisk > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200',
      )}>
        <Clock className={cn('w-4 h-4 flex-shrink-0', slaRisk > 0 ? 'text-red-600' : 'text-slate-400')} />
        <div>
          {loading ? <Skeleton className="h-5 w-8" /> : (
            <p className={cn('text-xl font-bold tabular-nums leading-none', slaRisk > 0 ? 'text-red-700' : 'text-slate-500')}>{slaRisk}</p>
          )}
          <p className="text-[11px] text-slate-500 mt-1 whitespace-nowrap">{m.fulfillment.slaRisk}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SlaCell({ createdAt }: { createdAt: string }) {
  const h = hoursAgo(createdAt);
  const cls =
    h >= 8 ? 'text-red-700 font-semibold' :
    h >= 4 ? 'text-amber-700 font-medium' :
    'text-green-700';
  return <span className={cn('tabular-nums text-xs', cls)}>{h < 1 ? '<1h' : `${h}h`}</span>;
}

function ProgressCell({ task }: { task: any }) {
  const pct    = task.progressPct ?? 0;
  const items  = task.items?.length ?? 0;
  const picked = task.items?.filter((i: any) => i.pickedAt).length ?? 0;
  const bar    = pct === 100 ? 'bg-green-500' : pct > 50 ? 'bg-cyan-500' : 'bg-amber-400';
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden min-w-[40px]">
        <div className={cn('h-full rounded-full transition-all', bar)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-[11px] text-slate-500 tabular-nums whitespace-nowrap">{picked}/{items}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { m } = useT();
  const cls =
    status === 'ALLOCATED'     ? 'bg-amber-100 text-amber-800 border-amber-300' :
    status === 'PICKING'       ? 'bg-cyan-100 text-cyan-800 border-cyan-300' :
    status === 'PICKED'        ? 'bg-cyan-200 text-cyan-900 border-cyan-400' :
    status === 'PACKING'       ? 'bg-teal-100 text-teal-800 border-teal-300' :
    status === 'PACKED'        ? 'bg-teal-200 text-teal-900 border-teal-400' :
    status === 'READY_TO_SHIP' ? 'bg-green-100 text-green-800 border-green-300' :
    status === 'SHIPPED'       ? 'bg-green-200 text-green-900 border-green-400' :
    status === 'DELIVERED'     ? 'bg-emerald-100 text-emerald-800 border-emerald-300' :
    'bg-red-100 text-red-800 border-red-300';
  return (
    <span className={cn('inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', cls)}>
      {labelOf(m.status.fulfillment, status)}
    </span>
  );
}

function ExtraCell({ task, lane }: { task: any; lane: LaneKey }) {
  const { m, t } = useT();
  if (lane === 'exceptions') return <StatusBadge status={task.status} />;
  if (lane === 'shipping')   return <span className="text-xs text-slate-500">{task.carrier ?? '—'}</span>;
  if (lane === 'packing')    return <span className="text-xs text-slate-500">{task.cartonCount ? t(m.fulfillment.ctn, { count: task.cartonCount }) : '—'}</span>;
  return <ProgressCell task={task} />;
}

function extraColHeader(lane: LaneKey, F: FMsgs): string {
  if (lane === 'exceptions') return F.col.exceptionType;
  if (lane === 'shipping')   return F.col.carrier;
  if (lane === 'packing')    return F.col.cartons;
  return F.col.pickProgress;
}

function ownerColHeader(lane: LaneKey, F: FMsgs): string {
  if (lane === 'exceptions') return F.col.assignedTo;
  if (lane === 'packing')    return F.col.packer;
  if (lane === 'shipping')   return F.col.handler;
  return F.col.owner;
}

function SortTh({
  label, field, current, asc, onSort, className,
}: {
  label: string; field: SortField; current: SortField; asc: boolean;
  onSort: (f: SortField) => void; className?: string;
}) {
  const active = current === field;
  return (
    <th className={cn('px-3 py-3 text-left', className)}>
      <button
        onClick={() => onSort(field)}
        className={cn(
          'flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap group',
          active ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700',
        )}
      >
        {label}
        {active
          ? (asc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
          : <ChevronDown className="w-3 h-3 opacity-0 group-hover:opacity-40" />
        }
      </button>
    </th>
  );
}

function ActionCell({
  task, onAdvance, onPack, onShip, onException,
}: {
  task: any;
  onAdvance: (id: string) => void;
  onPack: (t: any) => void;
  onShip: (t: any) => void;
  onException: (id: string) => void;
}) {
  const isExc  = ['SHORT_PICK', 'DAMAGED', 'HOLD', 'CANCELLED', 'RETURNED'].includes(task.status);
  const canPack = ['PICKED', 'PACKING'].includes(task.status);
  const canShip = ['PACKED', 'READY_TO_SHIP'].includes(task.status);
  const { m } = useT();
  const F = m.fulfillment;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {!isExc && (
        <Button size="sm" className="h-7 text-xs px-2.5 bg-green-600 hover:bg-green-700 text-white"
          onClick={() => onAdvance(task.id)}>
          {F.next}
        </Button>
      )}
      {canPack && (
        <Button size="sm" className="h-7 text-xs px-2.5 bg-teal-600 hover:bg-teal-700 text-white"
          onClick={() => onPack(task)} title={F.pack} aria-label={F.pack}>
          <Package className="w-3.5 h-3.5" />
        </Button>
      )}
      {canShip && (
        <Button size="sm" className="h-7 text-xs px-2.5 bg-purple-600 hover:bg-purple-700 text-white"
          onClick={() => onShip(task)} title={F.ship} aria-label={F.ship}>
          <Truck className="w-3.5 h-3.5" />
        </Button>
      )}
      <button
        onClick={() => documentsApi.openWithAuth(documentsApi.pickingSlipUrl(task.requestId ?? task.id))}
        className="h-7 w-7 flex items-center justify-center border border-slate-200 rounded-md text-slate-400 hover:text-green-600 hover:border-green-300 transition-colors"
        title={F.printSlip}
        aria-label={F.printSlip}
      >
        <Printer className="w-3.5 h-3.5" />
      </button>
      {!isExc && (
        <button
          className="h-7 w-7 flex items-center justify-center border border-slate-200 rounded-md text-slate-400 hover:text-red-600 hover:border-red-300 transition-colors"
          onClick={() => onException(task.id)}
          title={F.markException}
          aria-label={F.markException}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
        </button>
      )}
      <Link href={`/shipment-detail?taskId=${task.id}`}>
        <button className="h-7 px-2.5 text-xs border border-slate-200 rounded-md text-slate-500 hover:text-slate-800 hover:border-slate-300 transition-colors">
          {F.detail}
        </button>
      </Link>
    </div>
  );
}

// ─── Action Queue Table ───────────────────────────────────────────────────────

const SUB_FILTERS: SubFilter[] = ['all', 'open', 'assigned', 'mine'];

function ActionQueueTable({
  board, loading, selectedLane, subFilter, sortField, sortAsc,
  onSort, onSubFilter, onAdvance, onPack, onShip, onException,
}: {
  board: BoardData; loading: boolean; selectedLane: LaneKey; subFilter: SubFilter;
  sortField: SortField; sortAsc: boolean;
  onSort: (f: SortField) => void; onSubFilter: (f: SubFilter) => void;
  onAdvance: (id: string) => void; onPack: (t: any) => void;
  onShip: (t: any) => void; onException: (id: string) => void;
}) {
  const { m, t, locale } = useT();
  const F = m.fulfillment;
  const allTasks = [
    ...asArray(board.allocated).map((t) => ({ ...t, _lane: 'allocated' as LaneKey })),
    ...asArray(board.picking).map((t)   => ({ ...t, _lane: 'picking'   as LaneKey })),
    ...asArray(board.packing).map((t)   => ({ ...t, _lane: 'packing'   as LaneKey })),
    ...asArray(board.shipping).map((t)  => ({ ...t, _lane: 'shipping'  as LaneKey })),
    ...asArray(board.exceptions).map((t)=> ({ ...t, _lane: 'exceptions'as LaneKey })),
  ];

  let rows = selectedLane === 'all'
    ? allTasks
    : allTasks.filter((t) => t._lane === selectedLane);

  if (subFilter === 'open')     rows = rows.filter((t) => !['SHIPPED', 'DELIVERED'].includes(t.status));
  if (subFilter === 'assigned') rows = rows.filter((t) => t.assignedTo || t.owner);

  rows = [...rows].sort((a, b) => {
    if (sortField === 'time') {
      const ta = new Date(a.createdAt ?? a.updatedAt ?? 0).getTime();
      const tb = new Date(b.createdAt ?? b.updatedAt ?? 0).getTime();
      return sortAsc ? ta - tb : tb - ta;
    }
    const ha = hoursAgo(a.createdAt ?? a.updatedAt);
    const hb = hoursAgo(b.createdAt ?? b.updatedAt);
    return sortAsc ? hb - ha : ha - hb;
  });

  const totalCount =
    asArray(board.allocated).length + asArray(board.picking).length +
    asArray(board.packing).length   + asArray(board.shipping).length +
    asArray(board.exceptions).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800">{F.actionQueue}</span>
          <span className="text-xs text-slate-400">
            {t(F.laneCount, { lane: F.lanes[selectedLane], count: rows.length })}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {SUB_FILTERS.map((key) => (
            <button
              key={key}
              onClick={() => onSubFilter(key)}
              className={cn(
                'px-3 py-1 rounded-full text-[11px] border transition-colors',
                subFilter === key
                  ? 'bg-slate-100 border-slate-300 text-slate-800 font-medium'
                  : 'border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300',
              )}
            >
              {F.sub[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {loading && rows.length === 0 ? (
          <div className="p-6 space-y-2">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-9 w-full rounded" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">
            <Package className="w-8 h-8 mx-auto mb-2 opacity-20" />
            {F.noTasks}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <SortTh label={F.col.requestTime} field="time" current={sortField} asc={sortAsc} onSort={onSort} className="w-[110px]" />
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide w-[130px]">{F.col.orderNo}</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide w-[120px]">{F.col.status}</th>
                  <SortTh label={F.col.sla} field="sla"  current={sortField} asc={sortAsc} onSort={onSort} className="w-[72px]" />
                  <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-slate-500 uppercase tracking-wide w-[56px]">{F.col.items}</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide w-[96px]">
                    {ownerColHeader(selectedLane, F)}
                  </th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide w-[140px]">
                    {extraColHeader(selectedLane, F)}
                  </th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{F.col.action}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((task) => {
                  const effectiveLane = selectedLane === 'all' ? task._lane : selectedLane;
                  return (
                    <tr key={task.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-3 py-3 font-mono text-xs text-slate-600">
                        {formatRequestTime(task.createdAt ?? task.updatedAt, locale)}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col">
                          <span className="font-mono text-xs font-semibold text-green-700">{task.refNumber}</span>
                          {task.requestRef && task.requestRef !== task.refNumber && (
                            <span className="font-mono text-[11px] text-slate-400">{task.requestRef}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3"><StatusBadge status={task.status} /></td>
                      <td className="px-3 py-3">
                        <SlaCell createdAt={task.createdAt ?? task.updatedAt} />
                      </td>
                      <td className="px-3 py-3 text-center text-xs text-slate-500">
                        {task.items?.length ?? 0}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500 truncate max-w-[96px]">
                        {task.assignedTo ?? task.owner ?? '—'}
                      </td>
                      <td className="px-3 py-3">
                        <ExtraCell task={task} lane={effectiveLane} />
                      </td>
                      <td className="px-3 py-3">
                        <ActionCell
                          task={task}
                          onAdvance={onAdvance}
                          onPack={onPack}
                          onShip={onShip}
                          onException={onException}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 && (
          <div className="px-3 py-2 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">{t(F.showing, { count: rows.length, total: totalCount })}</span>
            <span className="text-[11px] text-slate-400">{F.defaultSort}</span>
          </div>
        )}
      </div>
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
  const { m } = useT();
  const F = m.fulfillment;
  const OPTIONS = (['HOLD', 'SHORT_PICK', 'DAMAGED', 'CANCELLED', 'RETURNED'] as const)
    .map((value) => ({ value, label: F.exc[value] }));
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-red-700">{F.markException}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs mb-1 block">{F.col.exceptionType}</Label>
            <div className="space-y-1">
              {OPTIONS.map((o) => (
                <label key={o.value} className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors',
                  status === o.value ? 'bg-red-50 border-red-400 text-red-800 font-medium' : 'border-slate-200 hover:bg-slate-50',
                )}>
                  <input type="radio" className="accent-red-600" checked={status === o.value} onChange={() => setStatus(o.value)} />
                  {o.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs mb-1 block">{F.reasonNotes}</Label>
            <Input placeholder={F.reasonPlaceholder} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{m.common.actions.cancel}</Button>
          <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => onConfirm(taskId, status, reason)}>
            <AlertTriangle className="w-3.5 h-3.5 mr-1" /> {F.confirmException}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FulfillmentBoardPage() {
  const { m, t } = useT();
  const F = m.fulfillment;
  const [board, setBoard]           = useState<BoardData>(EMPTY_BOARD);
  const [loading, setLoading]       = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef                 = useRef<NodeJS.Timeout | null>(null);

  const [packTask, setPackTask]     = useState<any>(null);
  const [packForm, setPackForm]     = useState(BLANK_PACK_FORM);
  const [shipTask, setShipTask]     = useState<any>(null);
  const [shipForm, setShipForm]     = useState(BLANK_SHIP_FORM);
  const [allocOpen, setAllocOpen]   = useState(false);
  const [allocatable, setAllocatable] = useState<any[]>([]);
  const [allocLoading, setAllocLoading] = useState(false);
  const [allocSearch, setAllocSearch] = useState('');
  const [allocatingId, setAllocatingId] = useState<string | null>(null);
  // Reservation wording comes from the server's real mode, never a hard-coded guess.
  const [reservationSummary, setReservationSummary] = useState<string | null>(null);
  const [exceptionTaskId, setExceptionTaskId] = useState<string | null>(null);

  // Table state
  const [selectedLane, setSelectedLane] = useState<LaneKey>('all');
  const [subFilter, setSubFilter]       = useState<SubFilter>('all');
  const [sortField, setSortField]       = useState<SortField>('time');
  const [sortAsc, setSortAsc]           = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await fulfillmentApi.board();
      setBoard(normalizeBoard(raw as FulfillmentBoardResponse));
    } catch {
      toast.error(getT().m.fulfillment.toast.loadFailed);
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
    try { await fulfillmentApi.advance(id); toast.success(F.toast.advanced); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  async function handleException(id: string, status: string, reason: string) {
    try {
      await fulfillmentApi.setException(id, status, reason);
      toast.success(t(F.toast.exception, { status: labelOf(m.status.fulfillment, status) })); setExceptionTaskId(null); load();
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
      toast.success(F.toast.packed); setPackTask(null); setPackForm(BLANK_PACK_FORM); load();
    } catch (e: any) { toast.error(e.message); }
  }

  async function confirmShip() {
    if (!shipTask) return;
    try {
      const sh = await fulfillmentApi.createShipment(shipTask.id, shipForm);
      await fulfillmentApi.confirmDispatch(sh.id);
      toast.success(F.toast.dispatched); setShipTask(null); setShipForm(BLANK_SHIP_FORM); load();
    } catch (e: any) { toast.error(e.message); }
  }

  const loadAllocatable = useCallback(async () => {
    setAllocLoading(true);
    fulfillmentApi.reservationMode().then((m) => setReservationSummary(m.summary)).catch(() => setReservationSummary(null));
    try { setAllocatable(await fulfillmentApi.allocatableRequests()); }
    catch { toast.error(getT().m.fulfillment.toast.allocLoadFailed); setAllocatable([]); }
    finally { setAllocLoading(false); }
  }, []);

  function openAllocate() {
    setAllocOpen(true);
    setAllocSearch('');
    loadAllocatable();
  }

  async function allocateRequest(req: any) {
    setAllocatingId(req.id);
    try {
      await fulfillmentApi.allocate(req.id);
      toast.success(t(F.toast.allocated, { ref: req.refNumber })); setAllocOpen(false); load();
    } catch (e: any) { toast.error(e.message); }
    finally { setAllocatingId(null); }
  }

  const filteredAllocatable = allocatable.filter((r) => {
    if (!allocSearch.trim()) return true;
    const q = allocSearch.toLowerCase();
    return r.refNumber?.toLowerCase().includes(q)
      || r.requester?.fullName?.toLowerCase().includes(q)
      || r.department?.toLowerCase().includes(q);
  });

  function handleSort(field: SortField) {
    if (sortField === field) setSortAsc((v) => !v);
    else { setSortField(field); setSortAsc(field === 'time'); }
  }

  const packGuard = useDiscardGuard(hasUnsavedChanges(packForm, BLANK_PACK_FORM), () => { setPackTask(null); setPackForm(BLANK_PACK_FORM); });
  const shipGuard = useDiscardGuard(hasUnsavedChanges(shipForm, BLANK_SHIP_FORM), () => { setShipTask(null); setShipForm(BLANK_SHIP_FORM); });

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      {/* Top Control Bar */}
      <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center gap-4 flex-wrap flex-shrink-0 shadow-sm">
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="w-8 h-8 bg-green-700 rounded-lg flex items-center justify-center">
            <ShipWheel className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-slate-900 text-sm leading-none">{F.title}</h1>
            <p className="text-xs text-slate-500 mt-0.5">{F.subtitle}</p>
          </div>
        </div>

        <div className="flex-1 overflow-x-auto">
          <KpiFilterBar
            board={board}
            loading={loading}
            selected={selectedLane}
            onSelect={setSelectedLane}
          />
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors',
              autoRefresh ? 'bg-green-50 border-green-300 text-green-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50',
            )}
          >
            <Zap className="w-3 h-3" />{autoRefresh ? F.live : F.auto}
          </button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={load} disabled={loading} aria-label={m.common.actions.refresh} title={m.common.actions.refresh}>
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </Button>
          <Button size="sm" className="h-8 bg-green-700 hover:bg-green-800 text-white gap-1.5 text-xs" onClick={openAllocate}>
            {F.allocateNew}
          </Button>
        </div>
      </div>

      {/* Action Queue */}
      <div className="flex-1 overflow-y-auto p-4">
        <ActionQueueTable
          board={board}
          loading={loading}
          selectedLane={selectedLane}
          subFilter={subFilter}
          sortField={sortField}
          sortAsc={sortAsc}
          onSort={handleSort}
          onSubFilter={setSubFilter}
          onAdvance={advance}
          onPack={setPackTask}
          onShip={setShipTask}
          onException={(id) => setExceptionTaskId(id)}
        />
      </div>

      {/* Legend */}
      <div className="bg-white border-t border-slate-100 px-5 py-2 flex flex-wrap gap-4 text-[10px] text-slate-400 flex-shrink-0">
        <span><Clock className="w-3 h-3 inline mr-0.5 text-green-500" /> {F.legend.ok}</span>
        <span><Clock className="w-3 h-3 inline mr-0.5 text-amber-500" /> {F.legend.warn}</span>
        <span><Clock className="w-3 h-3 inline mr-0.5 text-red-500" /> {F.legend.risk}</span>
        <span className="text-slate-300">|</span>
        <span>{F.legend.hint}</span>
      </div>

      {/* Modals — unchanged */}
      {exceptionTaskId && (
        <ExceptionModal taskId={exceptionTaskId} onClose={() => setExceptionTaskId(null)} onConfirm={handleException} />
      )}

      <Dialog open={allocOpen} onOpenChange={setAllocOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{F.alloc.title}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              {F.alloc.hint}
              {reservationSummary && <> {reservationSummary}</>}
            </p>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <Input
                value={allocSearch}
                onChange={(e) => setAllocSearch(e.target.value)}
                placeholder={F.alloc.search}
                className="pl-8 h-9 text-sm"
              />
            </div>

            <div className="max-h-80 overflow-y-auto -mx-1 px-1 space-y-2">
              {allocLoading ? (
                [...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)
              ) : filteredAllocatable.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-sm">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  {allocatable.length === 0 ? F.alloc.none : F.alloc.noMatch}
                </div>
              ) : (
                filteredAllocatable.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 border border-slate-200 rounded-lg p-3 hover:border-green-300 hover:bg-green-50/30 transition-colors">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-green-700">{r.refNumber}</span>
                        {r.rmaCaseNumber && <span className="text-[10px] text-slate-400">RMA {r.rmaCaseNumber}</span>}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                        <User className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{r.requester?.fullName ?? F.alloc.unknown}</span>
                        {r.department && <span className="text-slate-300">·</span>}
                        {r.department && <span className="truncate">{r.department}</span>}
                        <span className="text-slate-300">·</span>
                        <span className="whitespace-nowrap">{t(F.alloc.itemCount, { count: r.items?.length ?? 0 })}</span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="h-8 bg-green-700 hover:bg-green-800 text-white gap-1.5 text-xs flex-shrink-0"
                      disabled={!!allocatingId}
                      onClick={() => allocateRequest(r)}
                    >
                      {allocatingId === r.id ? F.allocating : F.allocate}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAllocOpen(false)}>{m.common.actions.close}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!packTask} onOpenChange={(o) => { if (!o) packGuard.requestClose(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-4 h-4 text-teal-600" /> {t(F.packing.title, { ref: packTask?.refNumber ?? '' })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">{F.packing.cartonCount}</Label>
                <Input type="number" min={1} value={packForm.cartonCount}
                  onChange={(e) => setPackForm((f) => ({ ...f, cartonCount: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1"><Label className="text-xs">{F.packing.totalWeight}</Label>
                <Input type="number" min={0} value={packForm.totalWeight}
                  onChange={(e) => setPackForm((f) => ({ ...f, totalWeight: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1"><Label className="text-xs">{F.packing.notes}</Label>
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
            <Button variant="outline" onClick={packGuard.requestClose}>{m.common.actions.cancel}</Button>
            <Button onClick={confirmPack} className="bg-teal-600 hover:bg-teal-700 text-white">
              <Package className="w-3.5 h-3.5 mr-1" /> {F.packing.complete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!shipTask} onOpenChange={(o) => { if (!o) shipGuard.requestClose(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-purple-600" /> {t(F.shipping.title, { ref: shipTask?.refNumber ?? '' })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">{F.shipping.carrier}</Label>
                <Input value={shipForm.carrier}
                  onChange={(e) => setShipForm((f) => ({ ...f, carrier: e.target.value }))}
                  placeholder="DHL, FedEx, J&T…" />
              </div>
              <div className="space-y-1"><Label className="text-xs">{F.shipping.tracking}</Label>
                <Input value={shipForm.trackingNumber}
                  onChange={(e) => setShipForm((f) => ({ ...f, trackingNumber: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1"><Label className="text-xs">{F.shipping.receiver}</Label>
              <Input value={shipForm.receiverName}
                onChange={(e) => setShipForm((f) => ({ ...f, receiverName: e.target.value }))} />
            </div>
            <div className="space-y-1"><Label className="text-xs">{F.shipping.notes}</Label>
              <Input value={shipForm.notes}
                onChange={(e) => setShipForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              ⚠ {F.shipping.warning}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={shipGuard.requestClose}>{m.common.actions.cancel}</Button>
            <Button onClick={confirmShip} className="bg-purple-600 hover:bg-purple-700 text-white">
              <Truck className="w-3.5 h-3.5 mr-1" /> {F.shipping.dispatch}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DiscardChangesDialog open={packGuard.confirming} onKeepEditing={packGuard.keepEditing} onDiscard={packGuard.confirmDiscard} />
      <DiscardChangesDialog open={shipGuard.confirming} onKeepEditing={shipGuard.keepEditing} onDiscard={shipGuard.confirmDiscard} />
    </div>
  );
}
