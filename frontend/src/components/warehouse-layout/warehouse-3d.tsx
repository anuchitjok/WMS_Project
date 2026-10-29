'use client';

// Warehouse Operations — 3D view tab.
//
// Read-only. Every figure comes from real data through existing APIs:
//   • warehouse tree from the page (/warehouse: racks, slots, placement counts)
//   • rack positions from the 2D floor plan when a RACK object is linked (/warehouse-layout/:id)
//   • slot contents from /warehouse/slots/:id/detail (same call as Racks & slots)
//   • SKU / serial search from /inventory?search= (existing stock search)
//   • stock age from /warehouse/:id/slot-stock-age (oldest receivedDate per slot)
// Nothing here writes anything.

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import {
  Box, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Plus, Minus, RotateCcw, ScanEye, X, MapPin,
  ExternalLink, AlertTriangle, Loader2, Package, Search, Activity, BarChart3, Clock, Crosshair, Maximize2, Minimize2,
} from 'lucide-react';
import { inventoryApi, layoutApi, warehouseApi, type LayoutObject, type SlotStockAge } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useRealtime } from '@/hooks/use-realtime';
import { cn, formatDate } from '@/lib/utils';
import { type WarehouseData, type RackData, type SlotData, rackMetrics, slotItems, slotUtil } from './occupancy';
import {
  type Scene3D, type SlotState3D, type ViewMode, type Band,
  buildScene, rackCorners, slotState3D, slotColor, zoneOf, ageDays,
  STATE_3D, NO_ZONE, FILL_BANDS, AGE_BANDS, NO_AGE_COLOR, PALLET_COLOR,
} from './scene-geometry';
import type { SceneApi, CameraInfo } from './scene-3d';

const WarehouseScene3D = dynamic(() => import('./scene-3d'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center text-sm text-slate-400">
      <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading 3D view…</span>
    </div>
  ),
});

const ALL = '__all';
// Stock rows that no longer occupy a location (backend common/stock-presence.ts).
const NOT_IN_LOCATION = new Set(['SHIPPED', 'CLOSED', 'CANCELLED', 'CONSUMED']);
const pad2 = (n: number) => String(n).padStart(2, '0');
const titleCase = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const pct = (n: number, total: number) => (total ? ((n / total) * 100).toFixed(1) : '0.0');

// ─── WebGL guard ───────────────────────────────────────────────────────────────

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <NoWebGL /> : this.props.children; }
}

function NoWebGL() {
  return (
    <div className="absolute inset-0 grid place-items-center p-6 text-center">
      <div>
        <AlertTriangle className="h-8 w-8 mx-auto text-amber-400" />
        <p className="mt-2 text-sm font-medium text-slate-700">3D view isn't available in this browser</p>
        <p className="text-xs text-slate-500 mt-1">WebGL is turned off or unsupported. Racks &amp; slots and Floor plan show the same data.</p>
      </div>
    </div>
  );
}

// ─── Minimap ───────────────────────────────────────────────────────────────────

function Minimap({ scene, active, camera, expanded, onToggle, onPick }: {
  scene: Scene3D; active: Set<string> | null; camera: CameraInfo | null;
  expanded: boolean; onToggle: () => void; onPick: (x: number, z: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const b = scene.bounds;
  const m = 2.5;
  const vb = { x: b.minX - m, y: b.minZ - m, w: b.maxX - b.minX + m * 2, h: b.maxZ - b.minZ + m * 2 };
  const unit = Math.max(vb.w, vb.h) / 60;

  function click(e: React.MouseEvent<SVGSVGElement>) {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    onPick(p.x, p.y);
  }

  let cam: ReactNode = null;
  if (camera) {
    const dx = camera.x - camera.tx, dz = camera.z - camera.tz;
    const len = Math.hypot(dx, dz) || 1;
    const l = Math.min(len, unit * 9);
    // A small view cone from the camera toward the look-at point.
    const ang = Math.atan2(-dz, -dx), spread = 0.45;
    const ox = camera.tx + (dx / len) * l, oz = camera.tz + (dz / len) * l;
    const r = l * 1.1;
    cam = (
      <g pointerEvents="none">
        <polygon points={`${ox},${oz} ${ox + Math.cos(ang - spread) * r},${oz + Math.sin(ang - spread) * r} ${ox + Math.cos(ang + spread) * r},${oz + Math.sin(ang + spread) * r}`}
          fill="#16a34a" opacity={0.18} />
        <circle cx={camera.tx} cy={camera.tz} r={unit * 1.3} fill="#16a34a" stroke="#fff" strokeWidth={unit * 0.5} />
      </g>
    );
  }

  return (
    <div className="absolute left-3 bottom-3 z-40 rounded-xl border border-white bg-white/95 p-1.5 shadow-md ring-1 ring-slate-200">
      <svg ref={svgRef} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet"
        className={cn('block cursor-crosshair rounded-lg bg-slate-50 transition-[width,height]', expanded ? 'h-44 w-60 sm:h-56 sm:w-80' : 'h-24 w-32 sm:h-28 sm:w-40')}
        onClick={click} role="img" aria-label="Minimap — click to move the view">
        {scene.zones.map((z) => (
          <rect key={z.zone} x={z.minX} y={z.minZ} width={z.maxX - z.minX} height={z.maxZ - z.minZ}
            fill="#e3f1e8" stroke="#16a34a" strokeWidth={unit * 0.25} strokeDasharray={`${unit} ${unit * 0.7}`} />
        ))}
        {scene.racks.map((p) => {
          const on = !active || active.has(p.rack.id);
          return (
            <polygon key={p.rack.id} points={rackCorners(p).map(([x, z]) => `${x},${z}`).join(' ')}
              fill={on ? '#86efac' : '#e2e8f0'} stroke={on ? '#15803d' : '#cbd5e1'} strokeWidth={unit * 0.3} />
          );
        })}
        {cam}
      </svg>
      <button type="button" onClick={onToggle} aria-label={expanded ? 'Shrink minimap' : 'Expand minimap'}
        className="absolute bottom-2.5 right-2.5 grid h-6 w-6 place-items-center rounded-md bg-white/95 text-slate-500 shadow-sm ring-1 ring-slate-200 hover:text-emerald-700">
        {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// ─── Camera controls ───────────────────────────────────────────────────────────

function ViewControls({ api }: { api: React.RefObject<SceneApi | null> }) {
  const STEP = Math.PI / 12;
  const btn = 'grid place-items-center text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 transition-colors';
  const card = 'rounded-xl border border-white bg-white/95 shadow-md ring-1 ring-slate-200';
  return (
    <div className="absolute right-3 top-3 z-40 flex flex-col items-center gap-2">
      <div className={cn('relative h-[76px] w-[76px] !rounded-full', card)} role="group" aria-label="Rotate view">
        <button type="button" className={cn(btn, 'absolute left-1/2 top-1 h-6 w-6 -translate-x-1/2 rounded-full')} onClick={() => api.current?.rotate(0, -STEP)} aria-label="Tilt up" title="Tilt up"><ChevronUp className="h-4 w-4" /></button>
        <button type="button" className={cn(btn, 'absolute bottom-1 left-1/2 h-6 w-6 -translate-x-1/2 rounded-full')} onClick={() => api.current?.rotate(0, STEP)} aria-label="Tilt down" title="Tilt down"><ChevronDown className="h-4 w-4" /></button>
        <button type="button" className={cn(btn, 'absolute left-1 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full')} onClick={() => api.current?.rotate(-STEP, 0)} aria-label="Rotate left" title="Rotate left"><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" className={cn(btn, 'absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full')} onClick={() => api.current?.rotate(STEP, 0)} aria-label="Rotate right" title="Rotate right"><ChevronRight className="h-4 w-4" /></button>
        <span className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-300" />
      </div>
      <div className={cn('flex flex-col overflow-hidden', card)}>
        <button type="button" className={cn(btn, 'h-9 w-9')} onClick={() => api.current?.zoom(0.75)} aria-label="Zoom in" title="Zoom in"><Plus className="h-4 w-4" /></button>
        <span className="h-px bg-slate-200" />
        <button type="button" className={cn(btn, 'h-9 w-9')} onClick={() => api.current?.zoom(1.33)} aria-label="Zoom out" title="Zoom out"><Minus className="h-4 w-4" /></button>
      </div>
      <button type="button" className={cn(btn, 'h-9 w-9', card)} onClick={() => api.current?.reset()} aria-label="3D view" title="3D view (whole warehouse)"><Box className="h-4 w-4" /></button>
      <button type="button" className={cn(btn, 'h-9 w-9', card)} onClick={() => api.current?.top()} aria-label="Top view" title="Top view"><ScanEye className="h-4 w-4" /></button>
    </div>
  );
}

// ─── Search: location code (local), SKU / serial (existing /inventory search) ──

interface SearchHit { key: string; slotId: string; title: string; sub: string; kind: 'location' | 'stock' }

function SlotSearch({ warehouseId, slots, onPick }: {
  warehouseId: string;
  slots: Map<string, { slot: SlotData; rack: RackData }>;
  onPick: (slotId: string) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [stock, setStock] = useState<SearchHit[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const boxRef = useRef<HTMLDivElement>(null);
  const term = q.trim();

  const locations = useMemo<SearchHit[]>(() => {
    if (!term) return [];
    const t = term.toLowerCase();
    const out: SearchHit[] = [];
    for (const { slot, rack } of slots.values()) {
      if (slot.code.toLowerCase().includes(t)) {
        out.push({ key: `l:${slot.id}`, slotId: slot.id, kind: 'location', title: slot.code,
          sub: `Rack ${rack.code}${rack.zone ? ` · Zone ${rack.zone}` : ''} · ${STATE_3D[slotState3D(slot)].label}` });
        if (out.length >= 5) break;
      }
    }
    return out;
  }, [term, slots]);

  // SKU / serial / batch / product name through the existing inventory search.
  useEffect(() => {
    if (term.length < 2) { setStock([]); setState('idle'); return; }
    let cancelled = false;
    setState('loading');
    const t = setTimeout(() => {
      inventoryApi.list({ search: term, warehouseId, limit: 20 })
        .then((res) => {
          if (cancelled) return;
          const hits: SearchHit[] = [];
          const seen = new Set<string>();
          for (const it of res.data ?? []) {
            if (!it.slotId || !slots.has(it.slotId) || NOT_IN_LOCATION.has(String(it.status))) continue;
            const key = `s:${it.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const loc = slots.get(it.slotId)!;
            hits.push({ key, slotId: it.slotId, kind: 'stock',
              title: `${it.product?.code ?? 'Item'}${it.serialNumber ? ` · ${it.serialNumber}` : ''}`,
              sub: `In ${loc.slot.code} · qty ${it.quantity}` });
            if (hits.length >= 6) break;
          }
          setStock(hits); setState('idle');
        })
        .catch(() => { if (!cancelled) { setStock([]); setState('error'); } });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [term, warehouseId, slots]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const hits = [...locations, ...stock];
  const pick = (h: SearchHit) => { onPick(h.slotId); setOpen(false); };

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits[0]) { e.preventDefault(); pick(hits[0]); }
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Search by location code, SKU or serial number…"
        aria-label="Search location, SKU or serial number"
        className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-sm text-slate-800 shadow-sm outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      />
      {q && (
        <button type="button" onClick={() => { setQ(''); setStock([]); }} aria-label="Clear search"
          className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {open && term && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
          {hits.map((h) => (
            <button key={h.key} type="button" onClick={() => pick(h)}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-emerald-50">
              {h.kind === 'location'
                ? <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                : <Package className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />}
              <span className="min-w-0">
                <span className="block truncate font-mono text-sm font-semibold text-slate-800">{h.title}</span>
                <span className="block truncate text-xs text-slate-500">{h.sub}</span>
              </span>
            </button>
          ))}
          {state === 'loading' && (
            <p className="flex items-center gap-2 px-2.5 py-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching stock…</p>
          )}
          {state === 'error' && <p className="px-2.5 py-2 text-xs text-red-600">Couldn't search stock. Location codes still match.</p>}
          {state === 'idle' && hits.length === 0 && (
            <p className="px-2.5 py-2 text-xs text-slate-500">No location or stock in this warehouse matches “{term}”.</p>
          )}
          {term.length === 1 && <p className="px-2.5 pb-1 text-[11px] text-slate-400">Type 2+ characters to search SKU or serial.</p>}
        </div>
      )}
    </div>
  );
}

// ─── View mode switch + legend ────────────────────────────────────────────────

const MODES: { id: ViewMode; label: string; icon: React.ElementType }[] = [
  { id: 'status', label: 'Status', icon: Activity },
  { id: 'fill', label: 'Fill %', icon: BarChart3 },
  { id: 'age', label: 'Stock Age', icon: Clock },
];

function ModeSwitch({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="inline-flex flex-shrink-0 rounded-xl border border-slate-200 bg-white p-1 shadow-sm" role="radiogroup" aria-label="Colour slots by">
      {MODES.map((m) => (
        <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} onClick={() => onChange(m.id)}
          className={cn('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors',
            mode === m.id ? 'bg-emerald-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50')}>
          <m.icon className="h-4 w-4" /> {m.label}
        </button>
      ))}
    </div>
  );
}

function ModeLegend({ mode, ageState, onRetryAge }: { mode: ViewMode; ageState: AgeState['state']; onRetryAge: () => void }) {
  if (mode === 'status') return null;
  const bands: Band[] = mode === 'fill' ? FILL_BANDS : [...AGE_BANDS, { label: 'No date', color: NO_AGE_COLOR }];
  return (
    <div className="absolute bottom-3 right-3 z-40 max-w-[calc(100%-12rem)] rounded-xl border border-white bg-white/95 px-3 py-2 shadow-md ring-1 ring-slate-200">
      <p className="mb-1 text-[11px] font-medium text-slate-500">
        {mode === 'fill' ? 'Fill % — stock rows ÷ slot capacity' : 'Stock age — days since oldest stock was received'}
      </p>
      {mode === 'age' && ageState === 'loading' ? (
        <p className="flex items-center gap-1.5 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading stock age…</p>
      ) : mode === 'age' && ageState === 'error' ? (
        <p className="flex items-center gap-2 text-xs text-red-600">Couldn't load stock age.
          <button type="button" onClick={onRetryAge} className="pointer-events-auto font-medium underline">Retry</button></p>
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {[{ label: 'Empty', color: PALLET_COLOR }, ...bands, { label: 'Blocked', color: STATE_3D.blocked.color }].map((b) => (
            <span key={b.label} className="flex items-center gap-1.5 text-xs text-slate-600">
              <span className="h-3 w-3 rounded-[3px] ring-1 ring-black/10" style={{ background: b.color }} />{b.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Selected-slot tooltip (inside the 3D view) ───────────────────────────────

function SlotTooltip({ slot, detail, loading }: { slot: SlotData; detail: any; loading: boolean }) {
  const items: any[] = detail?.stockItems ?? [];
  const qty = items.reduce((a, it) => a + (it.quantity ?? 0), 0);
  const util = slotUtil(slot);
  return (
    <div className="w-44 overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200">
      <div className="bg-emerald-700 px-3 py-1.5 font-mono text-sm font-semibold text-white">{slot.code}</div>
      <div className="px-3 py-2">
        <p className="truncate font-mono text-sm font-medium text-slate-800">
          {loading ? '…' : items[0]?.product?.code ?? (slotItems(slot) ? '—' : 'Empty')}
          {items.length > 1 && <span className="ml-1 font-sans text-xs text-slate-400">+{items.length - 1}</span>}
        </p>
        <p className="text-xs text-slate-500">Qty {loading ? '…' : qty.toLocaleString()}</p>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded-full bg-slate-200"><div className="h-1.5 rounded-full bg-emerald-600" style={{ width: `${util}%` }} /></div>
          <span className="text-xs font-medium tabular-nums text-slate-700">{util}%</span>
        </div>
      </div>
    </div>
  );
}

// ─── Slot details panel ────────────────────────────────────────────────────────

function DRow({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 text-sm">
      <dt className="text-slate-500">{k}</dt>
      <dd className="font-medium text-slate-800 break-words">{v}</dd>
    </div>
  );
}

function SlotDetails({ wh, rack, slot, detail, detailState, age, onRetry, onClose, onFly, onViewStock }: {
  wh: WarehouseData; rack: RackData | null; slot: SlotData | null;
  detail: any; detailState: 'idle' | 'loading' | 'error';
  age: { days: number; oldest: string } | null;
  onRetry: () => void; onClose: () => void; onFly: () => void; onViewStock: (slotId: string) => void;
}) {
  if (!slot) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <MapPin className="h-7 w-7 mx-auto text-slate-300" />
        <p className="mt-2 text-sm font-medium text-slate-700">Slot Details</p>
        <p className="text-xs text-slate-500">Click a slot in the 3D view, or search for a location, SKU or serial.</p>
      </div>
    );
  }

  const st: SlotState3D = slotState3D(slot);
  const items: any[] = detail?.stockItems ?? [];
  const loading = detailState === 'loading' && !detail;
  const qty = items.reduce((a, it) => a + (it.quantity ?? 0), 0);
  const first = items[0];
  const lastMove = first?.updatedAt ?? slot.updatedAt;
  const rows = slotItems(slot);
  const util = slotUtil(slot);
  const dash = loading ? '…' : '—';

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="text-base font-semibold text-slate-900">Slot Details</h2>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close slot details">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <p className="truncate font-mono text-lg font-semibold text-slate-900">{slot.code}</p>
        <span className={cn('flex-shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium', STATE_3D[st].pill)}>{STATE_3D[st].label}</span>
      </div>

      <dl className="space-y-2 px-4 py-3">
        <DRow k="Warehouse" v={wh.name} />
        <DRow k="Zone" v={rack?.zone || '—'} />
        <DRow k="Rack" v={rack?.code ?? '—'} />
        <DRow k="Level" v={pad2(slot.level)} />
        <DRow k="Column" v={pad2(slot.column)} />
      </dl>

      <dl className="mx-4 space-y-2 border-t border-slate-100 py-3">
        {detailState === 'error' ? (
          <div className="flex items-center justify-between gap-2 text-xs text-red-600">
            Couldn't load stock for this slot.
            <Button size="sm" variant="outline" className="h-7 bg-white text-xs" onClick={onRetry}>Retry</Button>
          </div>
        ) : (
          <>
            <DRow k="Item Code" v={first ? <span className="font-mono">{first.product?.code ?? '—'}{items.length > 1 && <span className="ml-1 font-sans text-xs text-slate-400">+{items.length - 1} more</span>}</span> : dash} />
            <DRow k="Serial No." v={first?.serialNumber ? <span className="font-mono">{first.serialNumber}</span> : dash} />
            <DRow k="Qty" v={loading ? '…' : `${qty.toLocaleString()}${rows > items.length && !loading ? '+' : ''}`} />
            <DRow k="Location Type" v={titleCase(slot.slotType)} />
            <DRow k="Last Move" v={lastMove ? formatDate(lastMove) : '—'} />
            {age && <DRow k="Stock Age" v={`${age.days} day${age.days === 1 ? '' : 's'} (since ${formatDate(age.oldest)})`} />}
          </>
        )}
      </dl>

      <div className="mx-4 border-t border-slate-100 py-3">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold text-slate-900">Slot Utilization</p>
          <p className="text-sm font-semibold tabular-nums text-slate-900">{util}%</p>
        </div>
        <div className="mt-2 h-2 rounded-full bg-slate-200"><div className="h-2 rounded-full bg-emerald-600 transition-[width]" style={{ width: `${util}%` }} /></div>
        <p className="mt-1 text-[11px] text-slate-400">{rows} of {slot.capacity} stock rows (capacity)</p>
        <Button className="mt-3 h-10 w-full gap-2 bg-emerald-700 text-white hover:bg-emerald-800" onClick={onFly}>
          <Crosshair className="h-4 w-4" /> Fly to Slot
        </Button>
      </div>

      {items.length > 0 && (
        <div className="mx-4 border-t border-slate-100 py-3">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Package className="h-4 w-4 text-emerald-600" /> Stock in Slot
            {rows > items.length && <span className="text-xs font-normal text-slate-400">· latest {items.length} of {rows}</span>}
          </p>
          <ul className="max-h-44 space-y-1.5 overflow-y-auto">
            {items.map((it) => (
              <li key={it.id} className="rounded-lg border border-slate-100 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
                    <span className="truncate font-mono text-xs font-semibold text-slate-800">{it.product?.code}</span>
                  </span>
                  <span className="flex-shrink-0 text-xs tabular-nums text-slate-600">{it.quantity} {it.product?.unit ?? 'pcs'}</span>
                </div>
                {it.serialNumber && <p className="mt-0.5 truncate pl-3 font-mono text-[11px] text-slate-500">{it.serialNumber}</p>}
                {it.updatedAt && <p className="pl-3 text-[11px] text-slate-400">Last update {formatDate(it.updatedAt)}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="px-4 pb-4 pt-1">
        <Button variant="outline" className="h-10 w-full gap-2 border-emerald-600 bg-white text-emerald-700 hover:bg-emerald-50" onClick={() => onViewStock(slot.id)}>
          <ExternalLink className="h-4 w-4" /> View Stock Detail
        </Button>
      </div>
    </div>
  );
}

// ─── Bottom summary ────────────────────────────────────────────────────────────

function StatusSummary({ racks, filtered }: { racks: RackData[]; filtered: boolean }) {
  const counts: Record<SlotState3D, number> = { empty: 0, inUse: 0, full: 0, blocked: 0 };
  let total = 0, used = 0, available = 0;
  for (const r of racks) {
    for (const s of r.slots ?? []) counts[slotState3D(s)]++;
    const m = rackMetrics(r);
    total += m.total; used += m.occupied; available += m.available;
  }
  const order: [SlotState3D, string][] = [['empty', 'Available'], ['inUse', 'In Use'], ['full', 'Full'], ['blocked', 'Blocked']];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Slot Status{filtered && <span className="ml-1.5 text-xs font-normal text-slate-400">in current filter</span>}</p>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:divide-x divide-slate-100">
          {order.map(([k, label], i) => (
            <div key={k} className={cn('flex items-start gap-2.5', i > 0 && 'sm:pl-3')}>
              <span className={cn('mt-0.5 h-4 w-4 flex-shrink-0 rounded border', k === 'empty' ? 'border-slate-300 bg-slate-300' : STATE_3D[k].swatch)} />
              <div>
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-lg font-semibold tabular-nums text-slate-900">{counts[k].toLocaleString()}</p>
                <p className="text-[11px] tabular-nums text-slate-400">({pct(counts[k], total)}%)</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <span className="hidden h-12 w-12 flex-shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 sm:grid"><Box className="h-6 w-6" /></span>
        <div className="grid flex-1 grid-cols-3 gap-3">
          <div><p className="text-xs text-slate-500">Total Slots</p><p className="text-lg font-semibold tabular-nums text-slate-900">{total.toLocaleString()}</p></div>
          <div><p className="text-xs text-slate-500">Used</p><p className="text-lg font-semibold tabular-nums text-slate-900">{used.toLocaleString()} <span className="text-[11px] font-normal text-slate-400">({pct(used, total)}%)</span></p></div>
          <div><p className="text-xs text-slate-500">Available</p><p className="text-lg font-semibold tabular-nums text-slate-900">{available.toLocaleString()} <span className="text-[11px] font-normal text-slate-400">({pct(available, total)}%)</span></p></div>
        </div>
      </div>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────

interface AgeState { state: 'idle' | 'loading' | 'error' | 'ready'; data: SlotStockAge | null }

export function Warehouse3D({ wh, loading, onReload, onViewStock }: {
  wh: WarehouseData | null;
  loading: boolean;
  onReload: () => void | Promise<void>;
  onViewStock: (slotId: string) => void;
}) {
  const warehouseId = wh?.id ?? '';
  const [objects, setObjects] = useState<LayoutObject[] | null>(null);
  const [zone, setZone] = useState(ALL);
  const [rackId, setRackId] = useState(ALL);
  const [mode, setMode] = useState<ViewMode>('status');
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [camera, setCamera] = useState<CameraInfo | null>(null);
  const [miniOpen, setMiniOpen] = useState(false);
  const [gl, setGl] = useState<boolean | null>(null);
  const [age, setAge] = useState<AgeState>({ state: 'idle', data: null });
  const [detail, setDetail] = useState<any>(null);
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'error'>('idle');
  const api = useRef<SceneApi | null>(null);
  const detailReq = useRef(0);

  useEffect(() => { setGl(webglAvailable()); }, []);

  // Rack positions from the 2D plan, if one exists; any failure falls back to the automatic arrangement.
  useEffect(() => {
    if (!warehouseId) return;
    let cancelled = false;
    setObjects(null);
    layoutApi.get(warehouseId)
      .then((r) => { if (!cancelled) setObjects(r.objects ?? []); })
      .catch(() => { if (!cancelled) setObjects([]); });
    return () => { cancelled = true; };
  }, [warehouseId]);

  const loadAge = useCallback(() => {
    if (!warehouseId) return;
    setAge((a) => ({ state: 'loading', data: a.data }));
    warehouseApi.slotStockAge(warehouseId)
      .then((d) => setAge({ state: 'ready', data: d }))
      .catch(() => setAge((a) => ({ state: 'error', data: a.data })));
  }, [warehouseId]);

  // Stock age is fetched only when that mode is first opened.
  useEffect(() => { if (mode === 'age' && age.state === 'idle') loadAge(); }, [mode, age.state, loadAge]);

  // Same live signals as the Floor plan tab: re-read the tree (and ages if shown).
  useRealtime(['inventory:update', 'request:update'], () => {
    void onReload();
    if (mode === 'age') loadAge();
  }, { enabled: !!warehouseId });

  const scene = useMemo(() => buildScene(wh, objects ?? []), [wh, objects]);
  const fromPlan = useMemo(() => {
    const ids = new Set((objects ?? []).filter((o) => o.objectType === 'RACK' && o.rackId).map((o) => o.rackId));
    return scene.racks.filter((p) => ids.has(p.rack.id)).length;
  }, [objects, scene]);

  const ageMap = useMemo(() => {
    const m = new Map<string, { days: number; oldest: string }>();
    const d = age.data;
    if (d) for (const s of d.slots) m.set(s.slotId, { days: ageDays(s.oldestReceivedDate, d.asOf), oldest: s.oldestReceivedDate });
    return m;
  }, [age.data]);

  const colors = useMemo(() => {
    const ageOf = (id: string) => ageMap.get(id)?.days ?? null;
    return scene.slots.map((s) => slotColor(s.slot, mode, ageOf));
  }, [scene, mode, ageMap]);

  const allRacks = useMemo(() => scene.racks.map((p) => p.rack), [scene]);
  const zones = useMemo(() => [...new Set(allRacks.map(zoneOf))].sort((a, b) => (a === NO_ZONE ? 1 : b === NO_ZONE ? -1 : a.localeCompare(b, undefined, { numeric: true }))), [allRacks]);
  const zoneRacks = useMemo(() => allRacks.filter((r) => zone === ALL || zoneOf(r) === zone)
    .slice().sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })), [allRacks, zone]);
  const filteredRacks = useMemo(() => (rackId === ALL ? zoneRacks : zoneRacks.filter((r) => r.id === rackId)), [zoneRacks, rackId]);
  const filtered = zone !== ALL || rackId !== ALL;
  const active = useMemo(() => (filtered ? new Set(filteredRacks.map((r) => r.id)) : null), [filtered, filteredRacks]);

  const slotIndex = useMemo(() => {
    const m = new Map<string, { slot: SlotData; rack: RackData }>();
    for (const r of allRacks) for (const s of r.slots ?? []) m.set(s.id, { slot: s, rack: r });
    return m;
  }, [allRacks]);
  const selected = selectedSlotId ? slotIndex.get(selectedSlotId) ?? null : null;

  // A slot outside the filter (or deleted by a refresh) is no longer selectable.
  useEffect(() => {
    if (!selectedSlotId) return;
    const s = slotIndex.get(selectedSlotId);
    if (!s || (active && !active.has(s.rack.id))) setSelectedSlotId(null);
  }, [selectedSlotId, slotIndex, active]);

  // Slot contents, shared by the tooltip and the details panel. Re-read when
  // the slot's placement count changes after a realtime refresh.
  const stamp = selected ? `${slotItems(selected.slot)}|${selected.slot.updatedAt ?? ''}` : '';
  const loadDetail = useCallback(() => {
    if (!selectedSlotId) { setDetail(null); setDetailState('idle'); return; }
    const n = ++detailReq.current;
    setDetail(null);
    setDetailState('loading');
    warehouseApi.getSlotDetail(selectedSlotId)
      .then((d) => { if (n === detailReq.current) { setDetail(d); setDetailState('idle'); } })
      .catch(() => { if (n === detailReq.current) { setDetail(null); setDetailState('error'); } });
  }, [selectedSlotId]);
  useEffect(() => { loadDetail(); }, [loadDetail, stamp]);

  const selectRack = useCallback((id: string) => {
    const r = allRacks.find((x) => x.id === id);
    if (!r) return;
    if (zone !== ALL && zoneOf(r) !== zone) setZone(zoneOf(r));
    setRackId(id);
  }, [allRacks, zone]);

  // Search hit / Fly to Slot: make sure the slot is in view, select it, glide in.
  const goToSlot = useCallback((slotId: string) => {
    const hit = slotIndex.get(slotId);
    if (!hit) return;
    if (active && !active.has(hit.rack.id)) { setZone(ALL); setRackId(ALL); }
    setSelectedSlotId(slotId);
    // After any filter change has re-framed the camera.
    setTimeout(() => api.current?.flyTo(slotId), 80);
  }, [slotIndex, active]);

  const resetView = () => { setZone(ALL); setRackId(ALL); api.current?.reset(); };

  const zoneLabel = (v: string) => (v === ALL ? 'All Zones' : v === NO_ZONE ? 'No zone' : `Zone ${v}`);
  const rackLabel = (v: string) => (v === ALL ? 'All Racks' : allRacks.find((r) => r.id === v)?.code ?? v);

  if (loading || (wh && objects === null)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full max-w-xl rounded-lg" />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_21rem]">
          <Skeleton className="h-[600px] rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!wh) return null;

  if (!scene.racks.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
        <Box className="h-10 w-10 mx-auto text-slate-300" />
        <p className="mt-2 text-sm font-medium text-slate-600">No active racks in {wh.name}</p>
        <p className="text-xs text-slate-400 mt-1">Racks created in Racks &amp; slots or Warehouse Master appear here in 3D.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-600">Zone</p>
          <Select value={zone} onValueChange={(v) => { setZone((v as string) ?? ALL); setRackId(ALL); }}>
            <SelectTrigger className="h-9 w-44 bg-white"><SelectValue>{(v: string) => zoneLabel(v)}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Zones</SelectItem>
              {zones.map((z) => <SelectItem key={z} value={z}>{zoneLabel(z)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-600">Rack</p>
          <Select value={rackId} onValueChange={(v) => setRackId((v as string) ?? ALL)}>
            <SelectTrigger className="h-9 w-44 bg-white"><SelectValue>{(v: string) => rackLabel(v)}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Racks</SelectItem>
              {zoneRacks.map((r) => <SelectItem key={r.id} value={r.id}>{r.code}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-slate-400 sm:ml-2 sm:pb-2">
          {fromPlan === scene.racks.length
            ? 'Rack positions from the floor plan'
            : fromPlan > 0
              ? `${fromPlan} of ${scene.racks.length} racks placed from the floor plan; the rest arranged by zone`
              : 'Racks arranged by zone (none placed on the floor plan yet)'}
        </p>
        <Button variant="outline" size="sm" className="ml-auto h-9 gap-1.5 bg-white" onClick={resetView}>
          <RotateCcw className="h-4 w-4" /> Reset View
        </Button>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-3">
          {/* Search + view mode */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <SlotSearch warehouseId={warehouseId} slots={slotIndex} onPick={goToSlot} />
            <ModeSwitch mode={mode} onChange={setMode} />
          </div>

          {/* 3D canvas */}
          <div className="relative h-[460px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm sm:h-[600px] xl:h-[640px]">
            {gl === false ? <NoWebGL /> : gl === null ? null : (
              <SceneBoundary>
                <WarehouseScene3D
                  scene={scene}
                  active={active}
                  colors={colors}
                  selectedSlotId={selectedSlotId}
                  onSelectSlot={setSelectedSlotId}
                  onSelectRack={selectRack}
                  apiRef={api}
                  onCamera={setCamera}
                  tooltip={selected ? <SlotTooltip slot={selected.slot} detail={detail} loading={detailState === 'loading'} /> : null}
                />
                <ViewControls api={api} />
                <Minimap scene={scene} active={active} camera={camera} expanded={miniOpen}
                  onToggle={() => setMiniOpen((v) => !v)} onPick={(x, z) => api.current?.focus(x, z)} />
                <ModeLegend mode={mode} ageState={age.state} onRetryAge={loadAge} />
              </SceneBoundary>
            )}
          </div>
        </div>

        {/* Details */}
        <div className="xl:sticky xl:top-4">
          <SlotDetails
            wh={wh}
            rack={selected?.rack ?? null}
            slot={selected?.slot ?? null}
            detail={detail}
            detailState={detailState}
            age={selected ? ageMap.get(selected.slot.id) ?? null : null}
            onRetry={loadDetail}
            onClose={() => setSelectedSlotId(null)}
            onFly={() => selected && goToSlot(selected.slot.id)}
            onViewStock={onViewStock}
          />
        </div>
      </div>

      <StatusSummary racks={filteredRacks} filtered={filtered} />
    </div>
  );
}
