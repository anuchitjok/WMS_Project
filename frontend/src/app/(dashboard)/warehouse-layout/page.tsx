'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Search, Plus, Filter, ChevronRight, ChevronDown,
  MoreHorizontal, MoreVertical, Warehouse, Layers,
  RefreshCw, Download, MapPin, List, SlidersHorizontal,
  Pencil, ArrowRightLeft, Ban, Zap, X, Package,
} from 'lucide-react';
import { toast } from 'sonner';
import { warehouseApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type SlotStatus = 'EMPTY' | 'OCCUPIED' | 'RESERVED' | 'QUARANTINE' | 'RTV' | 'BLOCKED';

interface SlotData {
  id: string; code: string; name?: string; level: number; column: number;
  status: SlotStatus; slotType: string; capacity: number;
  _count?: { stockItems: number };
  updatedAt?: string;
}
interface RackData {
  id: string; code: string; name?: string; zone?: string; rackType: string;
  levels: number; columns: number; isActive: boolean;
  slots: SlotData[];
  _count?: { slots: number; stockItems: number };
}
interface WarehouseData {
  id: string; code: string; name: string; location?: string;
  racks: RackData[];
  _count?: { racks: number; stockItems: number };
}
interface Stats {
  totalRacks: number; totalSlots: number;
  empty: number; occupied: number; reserved: number;
  quarantine: number; rtv: number; blocked: number; utilizationPct: number;
}

// ─── Slot style map ───────────────────────────────────────────────────────────

const SLOT_CFG: Record<SlotStatus, { label: string; labelColor: string; border: string; bg: string; dot: string }> = {
  EMPTY:      { label: 'Available',  labelColor: 'text-green-600',  border: 'border-slate-200',   bg: 'bg-white',          dot: 'bg-green-500' },
  OCCUPIED:   { label: 'Occupied',   labelColor: 'text-amber-600',  border: 'border-amber-200',   bg: 'bg-amber-50/40',    dot: 'bg-amber-500' },
  RESERVED:   { label: 'Reserved',   labelColor: 'text-yellow-700', border: 'border-yellow-200',  bg: 'bg-yellow-50/40',   dot: 'bg-yellow-500' },
  QUARANTINE: { label: 'Quarantine', labelColor: 'text-purple-700', border: 'border-purple-200',  bg: 'bg-purple-50/40',   dot: 'bg-purple-500' },
  RTV:        { label: 'RTV',        labelColor: 'text-orange-700', border: 'border-orange-200',  bg: 'bg-orange-50/40',   dot: 'bg-orange-500' },
  BLOCKED:    { label: 'Blocked',    labelColor: 'text-red-600',    border: 'border-red-200',     bg: 'bg-red-50/30',      dot: 'bg-red-500' },
};

// ─── Circular progress gauge ──────────────────────────────────────────────────

function CircularGauge({ pct, size = 84 }: { pct: number; size?: number }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#22c55e';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rotate-[-90deg]">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={8} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={8}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      <text x={size/2} y={size/2 + 1} textAnchor="middle" dominantBaseline="middle"
        className="fill-slate-800 font-bold" fontSize={size * 0.18}
        style={{ transform: `rotate(90deg)`, transformOrigin: `${size/2}px ${size/2}px`, fontFamily: 'Segoe UI' }}>
        {pct}%
      </text>
    </svg>
  );
}

// ─── Left Panel: Warehouse Filter ─────────────────────────────────────────────

function WarehouseFilterPanel({
  warehouses, stats, selectedWhId, onSelectWh, search, onSearch,
}: {
  warehouses: WarehouseData[]; stats: Stats | null;
  selectedWhId: string; onSelectWh: (id: string) => void;
  search: string; onSearch: (v: string) => void;
}) {
  const totalSlots = (warehouses.reduce((a, w) => a + (w._count?.stockItems ?? 0), 0));

  return (
    <div className="w-56 flex-shrink-0 flex flex-col gap-3 overflow-y-auto">
      {/* Warehouse Filter header */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-100">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-widest">Warehouse Filter</span>
          <Filter className="w-3.5 h-3.5 text-slate-400" />
        </div>
        {/* Search */}
        <div className="px-3 py-2 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              value={search} onChange={(e) => onSearch(e.target.value)}
              placeholder="Search warehouse..."
              className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-blue-400 bg-slate-50"
            />
          </div>
        </div>
        {/* All Warehouses */}
        <button
          onClick={() => onSelectWh('')}
          className={cn('w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors border-b border-slate-50',
            selectedWhId === '' ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-slate-50')}
        >
          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', selectedWhId === '' ? 'bg-blue-100' : 'bg-slate-100')}>
            <Warehouse className={cn('w-4 h-4', selectedWhId === '' ? 'text-blue-600' : 'text-slate-500')} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-800">All Warehouses</p>
            <p className="text-[10px] text-slate-400">{warehouses.length} warehouses</p>
          </div>
        </button>
        {/* WH list */}
        {warehouses
          .filter((w) => !search || w.name.toLowerCase().includes(search.toLowerCase()) || w.code.toLowerCase().includes(search.toLowerCase()))
          .map((wh) => {
            const slotCount = wh.racks.reduce((a, r) => a + (r._count?.slots ?? r.slots.length), 0);
            return (
              <button
                key={wh.id}
                onClick={() => onSelectWh(wh.id)}
                className={cn('w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors border-b border-slate-50 last:border-0',
                  selectedWhId === wh.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-slate-50')}
              >
                <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', selectedWhId === wh.id ? 'bg-blue-100' : 'bg-slate-100')}>
                  <Layers className={cn('w-4 h-4', selectedWhId === wh.id ? 'text-blue-600' : 'text-slate-500')} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-800 truncate">{wh.name}</p>
                  <p className="text-[10px] text-slate-400 truncate">{wh.location ?? wh.code}</p>
                </div>
                <span className="text-[10px] bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5 font-bold flex-shrink-0">{slotCount}</span>
              </button>
            );
          })}
      </div>

      {/* Location Summary */}
      {stats && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-3">
          <p className="text-xs font-bold text-slate-700 uppercase tracking-widest mb-3">Location Summary</p>
          <div className="flex items-center gap-3 mb-3">
            <div>
              <p className="text-2xl font-bold text-slate-900 leading-none">{stats.totalSlots}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Active locations</p>
            </div>
            <div className="ml-auto">
              <CircularGauge pct={stats.utilizationPct} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div className="bg-blue-50 rounded-lg p-2">
              <p className="text-[10px] text-blue-500 font-medium">AVL</p>
              <p className="text-base font-bold text-blue-700">{stats.empty}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-2">
              <p className="text-[10px] text-green-500 font-medium">OCC</p>
              <p className="text-base font-bold text-green-700">{stats.occupied}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] text-slate-400">Empty</p>
              <p className="text-sm font-semibold text-slate-700">{stats.empty}</p>
            </div>
            <div>
              <p className="text-[10px] text-red-400 flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block mr-0.5" />Blocked</p>
              <p className="text-sm font-semibold text-red-600">{stats.blocked}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Center Panel: Location Structure Tree ────────────────────────────────────

function LocationTree({
  warehouses, selectedWhId, selectedRackId, onSelectRack,
}: {
  warehouses: WarehouseData[]; selectedWhId: string; selectedRackId: string;
  onSelectRack: (rack: RackData, wh: WarehouseData) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Auto-expand first warehouse or selected
  useEffect(() => {
    const first = warehouses[0];
    if (first && expanded.size === 0) setExpanded(new Set([first.id]));
  }, [warehouses]);

  useEffect(() => {
    if (selectedWhId) setExpanded((prev) => new Set([...prev, selectedWhId]));
  }, [selectedWhId]);

  const display = selectedWhId ? warehouses.filter((w) => w.id === selectedWhId) : warehouses;

  return (
    <div className="w-64 flex-shrink-0 flex flex-col bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <Layers className="w-4 h-4 text-blue-600" />
        <div>
          <p className="text-xs font-bold text-slate-800">Location Structure</p>
          <p className="text-[10px] text-slate-400">Click to expand/collapse structure</p>
        </div>
      </div>
      {/* Tree */}
      <div className="flex-1 overflow-y-auto">
        {display.map((wh) => {
          const isExpanded = expanded.has(wh.id);
          const slotCount = wh.racks.reduce((a, r) => a + (r._count?.slots ?? r.slots.length), 0);
          return (
            <div key={wh.id}>
              {/* Warehouse row */}
              <button
                onClick={() => setExpanded((prev) => { const s = new Set(prev); s.has(wh.id) ? s.delete(wh.id) : s.add(wh.id); return s; })}
                className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-slate-50 transition-colors border-b border-slate-50"
              >
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />}
                <Warehouse className="w-4 h-4 text-blue-600 flex-shrink-0" />
                <span className="text-xs font-semibold text-slate-800 flex-1 text-left truncate">{wh.name}</span>
                <span className="text-[10px] bg-slate-100 text-slate-600 rounded-full px-1.5 py-0.5 font-bold">{slotCount}</span>
                <MoreVertical className="w-3.5 h-3.5 text-slate-300 hover:text-slate-500" />
              </button>
              {/* Rack rows */}
              {isExpanded && wh.racks.map((rack) => {
                const rSlotCount = rack._count?.slots ?? rack.slots.length;
                const isSelected = rack.id === selectedRackId;
                return (
                  <button
                    key={rack.id}
                    onClick={() => onSelectRack(rack, wh)}
                    className={cn('w-full flex items-center gap-2 pl-8 pr-3 py-2 text-left border-b border-slate-50 transition-colors',
                      isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-slate-50')}
                  >
                    <div className="w-4 h-4 rounded border border-slate-300 bg-white flex-shrink-0" />
                    <span className={cn('text-xs flex-1 truncate', isSelected ? 'font-semibold text-blue-700' : 'text-slate-700')}>{rack.code}{rack.name ? ` — ${rack.name}` : ''}</span>
                    <span className="text-[10px] text-slate-500 bg-slate-100 rounded px-1.5 font-medium">{rSlotCount}</span>
                    <MoreVertical className="w-3 h-3 text-slate-300 hover:text-slate-500 flex-shrink-0" />
                  </button>
                );
              })}
              {isExpanded && wh.racks.length === 0 && (
                <p className="pl-8 py-3 text-xs text-slate-400 border-b border-slate-50">No racks</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Slot Card ────────────────────────────────────────────────────────────────

function SlotCard({ slot, isSelected, onClick }: { slot: SlotData; isSelected: boolean; onClick: () => void }) {
  const cfg = SLOT_CFG[slot.status] ?? SLOT_CFG.EMPTY;
  const stockCount = slot._count?.stockItems ?? 0;
  const timeStr = slot.updatedAt ? (() => {
    const diff = Date.now() - new Date(slot.updatedAt).getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 1) return 'Just now';
    if (h < 24) return `${h < 10 ? '0' : ''}${h}:${String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0')} AM`;
    const d = Math.floor(h / 24);
    return `${d} day${d > 1 ? 's' : ''} ago`;
  })() : '';

  return (
    <button
      onClick={onClick}
      className={cn('text-left border rounded-xl p-3 transition-all hover:shadow-md',
        cfg.bg, cfg.border,
        isSelected ? 'ring-2 ring-blue-400 shadow-md' : '',
      )}
    >
      <div className="flex items-start justify-between mb-1.5">
        <span className="font-bold text-slate-800 text-xs">{slot.code}</span>
        <MoreHorizontal className="w-3.5 h-3.5 text-slate-300 hover:text-slate-500" />
      </div>
      <p className={cn('text-xs font-semibold mb-0.5', cfg.labelColor)}>{cfg.label}</p>
      <p className="text-[10px] text-slate-400 mb-1">{slot.slotType === 'STANDARD' ? 'Normal' : slot.slotType}</p>
      {stockCount > 0 && (
        <div className="mb-1">
          <p className="text-[10px] text-amber-600 font-medium">Qty: {stockCount}</p>
        </div>
      )}
      {timeStr && (
        <div className="flex items-center justify-between mt-1">
          <p className="text-[10px] text-slate-400">Updated</p>
          <p className="text-[10px] text-slate-400">{timeStr}</p>
        </div>
      )}
    </button>
  );
}

// ─── Slot Detail Bottom Panel ──────────────────────────────────────────────────

function SlotDetailPanel({ slotDetail, onClose, onStatusChange }: {
  slotDetail: any; onClose: () => void;
  onStatusChange: (id: string, status: string) => void;
}) {
  if (!slotDetail) return null;
  const cfg = SLOT_CFG[slotDetail.status as SlotStatus] ?? SLOT_CFG.EMPTY;
  const first = slotDetail.stockItems?.[0];
  const wh = slotDetail.rack?.warehouse;

  return (
    <div className="border-t border-slate-200 bg-white p-4 flex items-start gap-4 flex-shrink-0">
      {/* Icon box */}
      <div className={cn('w-16 h-16 rounded-xl flex flex-col items-center justify-center flex-shrink-0 border-2', cfg.bg, cfg.border)}>
        <Package className={cn('w-5 h-5 mb-0.5', cfg.labelColor)} />
        <span className="text-[10px] font-bold text-slate-700 text-center leading-tight px-1">{slotDetail.code}</span>
      </div>

      {/* Slot info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-bold text-slate-900 text-sm">{slotDetail.code}</span>
          <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full border', cfg.labelColor, cfg.bg, cfg.border)}>{cfg.label}</span>
        </div>
        {first && <p className="text-xs text-slate-500">{first.product?.code} | {first.product?.name}</p>}
        <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-0.5">
          <MapPin className="w-3 h-3" />
          {[wh?.name, slotDetail.rack?.code, slotDetail.code].filter(Boolean).join(' > ')}
        </div>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-3 gap-x-8 gap-y-1 flex-shrink-0">
        {[
          { label: 'Quantity', value: first ? `${first.quantity} ${first.product?.unit ?? 'pcs'}` : '—' },
          { label: 'UOM',      value: first?.product?.unit ?? '—' },
          { label: 'Status',   value: cfg.label },
          { label: 'Lot/Batch', value: first?.batchNumber ?? '—' },
          { label: 'Expire',   value: first?.expiryDate ? new Date(first.expiryDate).toLocaleDateString('th-TH') : '—' },
          { label: 'Type',     value: slotDetail.slotType ?? '—' },
        ].map(({ label, value }) => (
          <div key={label}>
            <p className="text-[10px] text-slate-400">{label}</p>
            <p className="text-xs font-semibold text-slate-800">{value}</p>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1.5 flex-shrink-0">
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 justify-start border-green-300 text-green-700 hover:bg-green-50">
          <Pencil className="w-3 h-3" /> Edit Location
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 justify-start border-blue-300 text-blue-700 hover:bg-blue-50">
          <ArrowRightLeft className="w-3 h-3" /> Move Stock
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 justify-start border-red-300 text-red-700 hover:bg-red-50"
          onClick={() => onStatusChange(slotDetail.id, slotDetail.status === 'BLOCKED' ? 'EMPTY' : 'BLOCKED')}>
          <Ban className="w-3 h-3" /> {slotDetail.status === 'BLOCKED' ? 'Unblock' : 'Block Location'}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 justify-start">
          <MoreHorizontal className="w-3 h-3" /> More Actions
        </Button>
      </div>

      <button onClick={onClose} className="text-slate-300 hover:text-slate-500 flex-shrink-0 mt-0.5"><X className="w-4 h-4" /></button>
    </div>
  );
}

// ─── Right Panel: Rack & Slot Details ─────────────────────────────────────────

function RackSlotDetails({
  rack, wh, onAddSlot, onBulkGenerate,
}: {
  rack: RackData | null; wh: WarehouseData | null;
  onAddSlot: (rackId: string) => void;
  onBulkGenerate: (rack: RackData) => void;
}) {
  const [selectedSlot, setSelectedSlot] = useState<SlotData | null>(null);
  const [slotDetail, setSlotDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => { setSelectedSlot(null); setSlotDetail(null); }, [rack?.id]);

  async function handleSelectSlot(slot: SlotData) {
    setSelectedSlot(slot);
    setLoadingDetail(true);
    try { setSlotDetail(await warehouseApi.getSlotDetail(slot.id)); }
    catch { setSlotDetail(null); }
    finally { setLoadingDetail(false); }
  }

  async function handleStatusChange(slotId: string, status: string) {
    try { await warehouseApi.updateSlot(slotId, { status }); toast.success(`Slot → ${status}`); setSlotDetail(null); setSelectedSlot(null); }
    catch (e: any) { toast.error(e.message); }
  }

  if (!rack) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white border border-slate-200 rounded-xl shadow-sm text-slate-400">
        <div className="text-center">
          <Layers className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Select a rack from the tree</p>
          <p className="text-sm mt-1">Click any rack in the Location Structure</p>
        </div>
      </div>
    );
  }

  const slots = rack.slots;
  const avail = slots.filter((s) => s.status === 'EMPTY').length;
  const occ   = slots.filter((s) => s.status === 'OCCUPIED').length;
  const blk   = slots.filter((s) => s.status === 'BLOCKED').length;
  const qrn   = slots.filter((s) => s.status === 'QUARANTINE').length;

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-slate-100 flex items-start justify-between flex-shrink-0">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-0.5">
            <span>{wh?.name}</span>
            <ChevronRight className="w-3 h-3" />
            <span className="font-medium text-slate-600">{rack.code}</span>
          </div>
          <h2 className="font-bold text-slate-900 text-base">Rack & Slot Details</h2>
          <div className="flex items-center gap-1 mt-0.5">
            {[
              { dot: 'bg-green-500',  label: 'Available' },
              { dot: 'bg-amber-500',  label: 'Occupied' },
              { dot: 'bg-red-500',    label: 'Blocked' },
              { dot: 'bg-purple-500', label: 'Quarantine' },
            ].map(({ dot, label }) => (
              <div key={label} className="flex items-center gap-1 mr-3">
                <span className={`w-2 h-2 rounded-full ${dot}`} />
                <span className="text-[10px] text-slate-500">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Rack sub-header */}
      <div className="px-5 py-2.5 border-b border-slate-100 flex items-center gap-4 bg-slate-50/50 flex-shrink-0">
        <div>
          <span className="font-bold text-slate-900">{rack.code}</span>
          {rack.name && <span className="text-slate-500 text-xs ml-2">{rack.name}</span>}
          {rack.zone && <span className="ml-2 text-xs bg-slate-200 text-slate-600 rounded px-1.5 py-0.5">{rack.zone}</span>}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>{slots.length} Slots</span>
          {avail > 0 && <span className="text-green-600">{avail} Available</span>}
          {occ > 0   && <span className="text-amber-600">{occ} Occupied</span>}
          {blk > 0   && <span className="text-red-600">{blk} Blocked</span>}
          {qrn > 0   && <span className="text-purple-600">{qrn} Quarantine</span>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onAddSlot(rack.id)}>
            <Plus className="w-3.5 h-3.5" /> Add Slot
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onBulkGenerate(rack)}>
            <Zap className="w-3.5 h-3.5 text-amber-500" /> Bulk Generate
          </Button>
          <button className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-100">
            <MoreVertical className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </div>

      {/* Slot Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {slots.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <div className="w-12 h-12 rounded-xl border-2 border-dashed border-slate-300 mx-auto mb-3 flex items-center justify-center">
              <Plus className="w-5 h-5" />
            </div>
            <p className="font-medium">No slots in this rack</p>
            <p className="text-sm mt-1">Use Bulk Generate to create slots quickly</p>
            <Button className="mt-3 bg-blue-600 hover:bg-blue-700 text-white gap-1.5 text-xs" size="sm" onClick={() => onBulkGenerate(rack)}>
              <Zap className="w-3.5 h-3.5" /> Bulk Generate
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-6 gap-3">
            {slots.map((slot) => (
              <SlotCard
                key={slot.id}
                slot={slot}
                isSelected={selectedSlot?.id === slot.id}
                onClick={() => handleSelectSlot(slot)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Slot detail panel */}
      {loadingDetail && (
        <div className="border-t border-slate-200 p-4 flex items-center gap-3 flex-shrink-0">
          <Skeleton className="w-16 h-16 rounded-xl" />
          <div className="flex-1 space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-56" /></div>
        </div>
      )}
      {!loadingDetail && slotDetail && (
        <SlotDetailPanel
          slotDetail={slotDetail}
          onClose={() => { setSelectedSlot(null); setSlotDetail(null); }}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  );
}

// ─── Modals (Create Rack / Slot / Bulk) ───────────────────────────────────────

function CreateRackModal({ whId, onClose, onDone }: { whId: string; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ code: '', name: '', zone: '', rackType: 'STANDARD', levels: 5, columns: 10 });
  const [busy, setBusy] = useState(false);
  const F = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code) { toast.error('Rack code required'); return; }
    setBusy(true);
    try { await warehouseApi.createRack({ ...form, warehouseId: whId, levels: +form.levels, columns: +form.columns }); toast.success(`Rack ${form.code} created`); onDone(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <ModalWrap title="Create Rack" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Fld label="Rack Code *"><Input placeholder="R-01" value={form.code} onChange={F('code')} /></Fld>
          <Fld label="Name"><Input placeholder="Rack A1" value={form.name} onChange={F('name')} /></Fld>
          <Fld label="Zone"><Input placeholder="ZONE-A" value={form.zone} onChange={F('zone')} /></Fld>
          <Fld label="Type"><select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={form.rackType} onChange={F('rackType')}>
            {['STANDARD','DRIVE_IN','PUSH_BACK','CANTILEVER','FLOW','MEZZANINE','PALLET'].map((t) => <option key={t} value={t}>{t.replace(/_/g,' ')}</option>)}
          </select></Fld>
          <Fld label="Levels"><Input type="number" min={1} value={form.levels} onChange={F('levels')} /></Fld>
          <Fld label="Columns"><Input type="number" min={1} value={form.columns} onChange={F('columns')} /></Fld>
        </div>
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white" disabled={busy}>{busy ? 'Creating…' : 'Create Rack'}</Button>
        </div>
      </form>
    </ModalWrap>
  );
}

function BulkGenerateModal({ rack, onClose, onDone }: { rack: RackData; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ levels: rack.levels, columns: rack.columns, slotType: 'STANDARD', capacity: 1, prefix: rack.code });
  const [busy, setBusy] = useState(false);
  const F = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const preview = +form.levels * +form.columns;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { const r = await warehouseApi.bulkGenerateSlots(rack.id, { ...form, levels: +form.levels, columns: +form.columns, capacity: +form.capacity }); toast.success(`Created ${r.created} slots`); onDone(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <ModalWrap title={`Bulk Generate — ${rack.code}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">Will generate <strong>{preview}</strong> slots ({form.levels}L × {form.columns}C). Existing skipped.</div>
        <div className="grid grid-cols-2 gap-3">
          <Fld label="Levels"><Input type="number" min={1} value={form.levels} onChange={F('levels')} /></Fld>
          <Fld label="Columns"><Input type="number" min={1} value={form.columns} onChange={F('columns')} /></Fld>
          <Fld label="Prefix"><Input value={form.prefix} onChange={F('prefix')} /></Fld>
          <Fld label="Slot Type"><select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={form.slotType} onChange={F('slotType')}>
            {['STANDARD','PALLET','BULK','COLD','HAZMAT','OVERSIZE'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select></Fld>
        </div>
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="flex-1 bg-amber-500 hover:bg-amber-600 text-white" disabled={busy}>{busy ? 'Generating…' : `Generate ${preview} Slots`}</Button>
        </div>
      </form>
    </ModalWrap>
  );
}

function AddSlotModal({ rackId, onClose, onDone }: { rackId: string; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ code: '', level: 1, column: 1, slotType: 'STANDARD', capacity: 1 });
  const [busy, setBusy] = useState(false);
  const F = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code) { toast.error('Slot code required'); return; }
    setBusy(true);
    try { await warehouseApi.createSlot(rackId, { ...form, level: +form.level, column: +form.column, capacity: +form.capacity }); toast.success('Slot created'); onDone(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <ModalWrap title="Add Slot" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Fld label="Slot Code *"><Input placeholder="A01-001" value={form.code} onChange={F('code')} /></Fld>
          <Fld label="Slot Type"><select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={form.slotType} onChange={F('slotType')}>
            {['STANDARD','PALLET','BULK','COLD','HAZMAT','OVERSIZE'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select></Fld>
          <Fld label="Level"><Input type="number" min={1} value={form.level} onChange={F('level')} /></Fld>
          <Fld label="Column"><Input type="number" min={1} value={form.column} onChange={F('column')} /></Fld>
        </div>
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white" disabled={busy}>{busy ? 'Creating…' : 'Add Slot'}</Button>
        </div>
      </form>
    </ModalWrap>
  );
}

// ─── Modal helpers ────────────────────────────────────────────────────────────

function ModalWrap({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-xs font-medium text-slate-600 block mb-1">{label}</label>{children}</div>;
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'structure', label: 'Location Structure', icon: Layers },
  { id: 'map',       label: 'Location Map',       icon: MapPin },
  { id: 'list',      label: 'Location List',      icon: List },
  { id: 'adjust',    label: 'Adjust Location',    icon: SlidersHorizontal },
];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WarehouseLayoutPage() {
  const [warehouses, setWarehouses] = useState<WarehouseData[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('structure');
  const [selectedWhId, setSelectedWhId] = useState('');
  const [selectedRack, setSelectedRack] = useState<RackData | null>(null);
  const [selectedWh, setSelectedWh] = useState<WarehouseData | null>(null);
  const [whSearch, setWhSearch] = useState('');

  // Modals
  type ModalState =
    | { type: 'createRack'; whId: string }
    | { type: 'bulkGenerate'; rack: RackData }
    | { type: 'addSlot'; rackId: string }
    | null;
  const [modal, setModal] = useState<ModalState>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [whs, s] = await Promise.all([warehouseApi.list(), warehouseApi.stats()]);
      setWarehouses(whs);
      setStats(s);
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleSelectWh(id: string) {
    setSelectedWhId(id);
    setSelectedRack(null);
    setSelectedWh(warehouses.find((w) => w.id === id) ?? null);
  }

  function handleSelectRack(rack: RackData, wh: WarehouseData) {
    setSelectedRack(rack);
    setSelectedWh(wh);
    setSelectedWhId(wh.id);
  }

  const currentWh = warehouses.find((w) => w.id === selectedWhId) ?? null;
  const createWhId = currentWh?.id ?? warehouses[0]?.id ?? '';

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-100">

      {/* ── Page Header ───────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex-shrink-0">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Warehouse / Rack / Slot</h1>
            <nav className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
              <span>Home</span><ChevronRight className="w-3 h-3" />
              <span>Warehouse</span><ChevronRight className="w-3 h-3" />
              <span className="text-slate-600 font-medium">Location Structure</span>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={load} disabled={loading}>
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <Download className="w-3.5 h-3.5" /> Import Locations
            </Button>
            <Button size="sm" className="h-8 bg-teal-600 hover:bg-teal-700 text-white gap-1.5 text-xs"
              onClick={() => setModal({ type: 'createRack', whId: createWhId })}>
              <Plus className="w-3.5 h-3.5" /> Create Location
            </Button>
          </div>
        </div>
        {/* Tab bar */}
        <div className="flex gap-1 mt-2">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn('flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all',
                tab === id ? 'bg-teal-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100')}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────── */}
      {tab === 'structure' ? (
        <div className="flex-1 overflow-hidden p-4 flex gap-4 min-h-0">
          {loading ? (
            <div className="flex gap-4 w-full">
              <Skeleton className="w-56 rounded-xl flex-shrink-0" />
              <Skeleton className="w-64 rounded-xl flex-shrink-0" />
              <Skeleton className="flex-1 rounded-xl" />
            </div>
          ) : (
            <>
              <WarehouseFilterPanel
                warehouses={warehouses} stats={stats}
                selectedWhId={selectedWhId} onSelectWh={handleSelectWh}
                search={whSearch} onSearch={setWhSearch}
              />
              <LocationTree
                warehouses={warehouses} selectedWhId={selectedWhId}
                selectedRackId={selectedRack?.id ?? ''}
                onSelectRack={handleSelectRack}
              />
              <RackSlotDetails
                rack={selectedRack} wh={selectedWh}
                onAddSlot={(rackId) => setModal({ type: 'addSlot', rackId })}
                onBulkGenerate={(rack) => setModal({ type: 'bulkGenerate', rack })}
              />
            </>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-400">
          <div className="text-center">
            <Layers className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="font-medium">{TABS.find((t) => t.id === tab)?.label}</p>
            <p className="text-sm mt-1">Coming soon</p>
          </div>
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────── */}
      {modal?.type === 'createRack' && (
        <CreateRackModal whId={modal.whId} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />
      )}
      {modal?.type === 'bulkGenerate' && (
        <BulkGenerateModal rack={modal.rack} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />
      )}
      {modal?.type === 'addSlot' && (
        <AddSlotModal rackId={modal.rackId} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />
      )}
    </div>
  );
}
