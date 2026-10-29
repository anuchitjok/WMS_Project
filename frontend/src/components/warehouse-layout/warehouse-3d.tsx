'use client';

// Warehouse Operations — 3D view tab.
//
// Read-only. Every figure comes from existing APIs:
//   • the warehouse tree from the page (/warehouse: racks, slots, placement counts)
//   • rack positions from the 2D floor plan when a RACK object is linked (/warehouse-layout/:id)
//   • slot contents from /warehouse/slots/:id/detail, the same call as the Racks & slots tab
// Nothing here writes anything.

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import {
  Box, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Plus, Minus, RotateCcw,
  ScanEye, X, MapPin, ExternalLink, AlertTriangle, Loader2, Package,
} from 'lucide-react';
import { layoutApi, warehouseApi, type LayoutObject } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useRealtime } from '@/hooks/use-realtime';
import { cn, formatDate } from '@/lib/utils';
import { type WarehouseData, type RackData, type SlotData, rackMetrics, slotItems } from './occupancy';
import {
  type Scene3D, type SlotState3D, buildScene, rackCorners, slotState3D, zoneOf, STATE_3D, NO_ZONE,
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
const pad2 = (n: number) => String(n).padStart(2, '0');
const titleCase = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

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
  render() {
    if (this.state.failed) return <NoWebGL />;
    return this.props.children;
  }
}

function NoWebGL() {
  return (
    <div className="absolute inset-0 grid place-items-center p-6 text-center">
      <div>
        <AlertTriangle className="h-8 w-8 mx-auto text-amber-400" />
        <p className="mt-2 text-sm font-medium text-slate-700">3D view is not available in this browser</p>
        <p className="text-xs text-slate-500 mt-1">WebGL is turned off or unsupported. The Racks &amp; slots and Floor plan tabs show the same data.</p>
      </div>
    </div>
  );
}

// ─── Minimap ───────────────────────────────────────────────────────────────────

function Minimap({ scene, active, camera, onPick }: {
  scene: Scene3D; active: Set<string> | null; camera: CameraInfo | null; onPick: (x: number, z: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const b = scene.bounds;
  const m = 2;
  const vb = { x: b.minX - m, y: b.minZ - m, w: b.maxX - b.minX + m * 2, h: b.maxZ - b.minZ + m * 2 };
  const unit = Math.max(vb.w, vb.h) / 60; // keeps marker sizes readable at any warehouse size

  function click(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    onPick(p.x, p.y);
  }

  // Camera marker: a dot at the look-at point and a short line back toward the camera.
  let cam: ReactNode = null;
  if (camera) {
    const dx = camera.x - camera.tx, dz = camera.z - camera.tz;
    const len = Math.hypot(dx, dz) || 1;
    const l = Math.min(len, unit * 9);
    cam = (
      <g pointerEvents="none">
        <line x1={camera.tx} y1={camera.tz} x2={camera.tx + (dx / len) * l} y2={camera.tz + (dz / len) * l}
          stroke="#0f172a" strokeWidth={unit * 0.6} strokeLinecap="round" opacity={0.55} />
        <circle cx={camera.tx} cy={camera.tz} r={unit * 1.4} fill="#16a34a" stroke="#fff" strokeWidth={unit * 0.5} />
      </g>
    );
  }

  return (
    <div className="absolute left-3 bottom-3 z-40 rounded-lg border border-slate-200 bg-white/95 p-1.5 shadow-sm">
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        className="block h-24 w-32 sm:h-28 sm:w-40 cursor-crosshair"
        preserveAspectRatio="xMidYMid meet"
        onClick={click}
        role="img"
        aria-label="Minimap — click to move the view"
      >
        {scene.zones.map((z) => (
          <rect key={z.zone} x={z.minX} y={z.minZ} width={z.maxX - z.minX} height={z.maxZ - z.minZ} fill="#dcfce7" />
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
    </div>
  );
}

// ─── View controls (rotate pad, zoom, top view) ──────────────────────────────

function ViewControls({ api }: { api: React.RefObject<SceneApi | null> }) {
  const STEP = Math.PI / 12;
  const btn = 'grid place-items-center text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 transition-colors';
  return (
    <div className="absolute right-3 top-3 z-40 flex flex-col items-center gap-2">
      <div className="relative h-[76px] w-[76px] rounded-full border border-slate-200 bg-white/95 shadow-sm" role="group" aria-label="Rotate view">
        <button type="button" className={cn(btn, 'absolute left-1/2 top-1 h-6 w-6 -translate-x-1/2 rounded-full')} onClick={() => api.current?.rotate(0, -STEP)} aria-label="Tilt up"><ChevronUp className="h-4 w-4" /></button>
        <button type="button" className={cn(btn, 'absolute bottom-1 left-1/2 h-6 w-6 -translate-x-1/2 rounded-full')} onClick={() => api.current?.rotate(0, STEP)} aria-label="Tilt down"><ChevronDown className="h-4 w-4" /></button>
        <button type="button" className={cn(btn, 'absolute left-1 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full')} onClick={() => api.current?.rotate(-STEP, 0)} aria-label="Rotate left"><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" className={cn(btn, 'absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full')} onClick={() => api.current?.rotate(STEP, 0)} aria-label="Rotate right"><ChevronRight className="h-4 w-4" /></button>
        <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-300" />
      </div>
      <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-sm">
        <button type="button" className={cn(btn, 'h-9 w-9')} onClick={() => api.current?.zoom(0.75)} aria-label="Zoom in" title="Zoom in"><Plus className="h-4 w-4" /></button>
        <span className="h-px bg-slate-200" />
        <button type="button" className={cn(btn, 'h-9 w-9')} onClick={() => api.current?.zoom(1.33)} aria-label="Zoom out" title="Zoom out"><Minus className="h-4 w-4" /></button>
      </div>
      <button type="button" className={cn(btn, 'h-9 w-9 rounded-lg border border-slate-200 bg-white/95 shadow-sm')} onClick={() => api.current?.top()} aria-label="Top view" title="Top view">
        <ScanEye className="h-4 w-4" />
      </button>
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

function SlotDetails({ wh, rack, slot, onClose, onViewStock }: {
  wh: WarehouseData; rack: RackData | null; slot: SlotData | null;
  onClose: () => void; onViewStock: (slotId: string) => void;
}) {
  const [detail, setDetail] = useState<any>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const req = useRef(0);
  const slotId = slot?.id;
  const stamp = slot ? `${slotItems(slot)}|${slot.updatedAt ?? ''}` : '';

  const load = useCallback(() => {
    if (!slotId) { setDetail(null); return; }
    const n = ++req.current;
    setState('loading');
    warehouseApi.getSlotDetail(slotId)
      .then((d) => { if (n === req.current) { setDetail(d); setState('idle'); } })
      .catch(() => { if (n === req.current) { setDetail(null); setState('error'); } });
  }, [slotId]);
  // Re-read when the slot's placement changes (realtime refresh of the tree).
  useEffect(() => { load(); }, [load, stamp]);

  if (!slot) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
        <MapPin className="h-7 w-7 mx-auto text-slate-300" />
        <p className="mt-2 text-sm font-medium text-slate-700">Slot Details</p>
        <p className="text-xs text-slate-500">Click a slot in the 3D view to see its stock.</p>
      </div>
    );
  }

  const st: SlotState3D = slotState3D(slot);
  const items: any[] = detail?.stockItems ?? [];
  const loading = state === 'loading' && !detail;
  const qty = items.reduce((a, it) => a + (it.quantity ?? 0), 0);
  const first = items[0];
  const lastMove = first?.updatedAt ?? slot.updatedAt;
  const rows = slotItems(slot);
  const dash = loading ? '…' : '—';

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Slot Details</h2>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close slot details">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="px-4 pt-3 flex items-center justify-between gap-2">
        <p className="font-mono text-lg font-semibold text-slate-900 truncate">{slot.code}</p>
        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium flex-shrink-0', STATE_3D[st].pill)}>{STATE_3D[st].label}</span>
      </div>

      <dl className="px-4 py-3 space-y-2">
        <DRow k="Warehouse" v={wh.name} />
        <DRow k="Zone" v={rack?.zone || '—'} />
        <DRow k="Rack" v={rack?.code ?? '—'} />
        <DRow k="Level" v={pad2(slot.level)} />
        <DRow k="Slot" v={pad2(slot.column)} />
      </dl>

      <dl className="mx-4 border-t border-slate-100 py-3 space-y-2">
        {state === 'error' ? (
          <p className="flex items-center justify-between gap-2 text-xs text-red-600">
            Could not load stock for this slot.
            <Button size="sm" variant="outline" className="h-7 bg-white text-xs" onClick={load}>Retry</Button>
          </p>
        ) : (
          <>
            <DRow k="Item Code" v={first ? <span className="font-mono">{first.product?.code ?? '—'}{items.length > 1 && <span className="ml-1 font-sans text-xs text-slate-400">+{items.length - 1} more</span>}</span> : dash} />
            <DRow k="Serial No." v={first?.serialNumber ? <span className="font-mono">{first.serialNumber}</span> : dash} />
            <DRow k="Qty" v={loading ? '…' : qty.toLocaleString()} />
            <DRow k="Location Type" v={titleCase(slot.slotType)} />
            <DRow k="Last Move" v={lastMove ? formatDate(lastMove) : '—'} />
          </>
        )}
      </dl>

      {items.length > 1 && (
        <div className="mx-4 border-t border-slate-100 py-3">
          <p className="mb-2 text-xs font-medium text-slate-500">
            Stock in slot{rows > items.length ? ` · latest ${items.length} of ${rows} rows` : ''}
          </p>
          <ul className="max-h-36 space-y-1.5 overflow-y-auto">
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-2 text-xs">
                <Package className="h-3.5 w-3.5 flex-shrink-0 text-slate-300" />
                <span className="font-mono font-semibold text-slate-700">{it.product?.code}</span>
                <span className="flex-1 truncate font-mono text-slate-400">{it.serialNumber ?? ''}</span>
                <span className="tabular-nums text-slate-600">{it.quantity}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="px-4 pb-4 pt-1">
        <Button className="h-10 w-full gap-2 bg-green-600 text-white hover:bg-green-700" onClick={() => onViewStock(slot.id)}>
          <ExternalLink className="h-4 w-4" /> View Stock Detail <ChevronRight className="h-4 w-4" />
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
  const pct = (n: number) => (total ? ((n / total) * 100).toFixed(1) : '0.0');
  const order: SlotState3D[] = ['empty', 'inUse', 'full', 'blocked'];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <div className="lg:col-span-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <p className="text-sm font-semibold text-slate-900">Slot Status{filtered && <span className="ml-1.5 text-xs font-normal text-slate-400">in current filter</span>}</p>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3 sm:divide-x divide-slate-100">
          {order.map((k, i) => (
            <div key={k} className={cn('flex items-start gap-2.5', i > 0 && 'sm:pl-3')}>
              <span className={cn('mt-0.5 h-4 w-4 flex-shrink-0 rounded border', STATE_3D[k].swatch)} />
              <div>
                <p className="text-xs text-slate-500">{STATE_3D[k].label}</p>
                <p className="text-lg font-semibold tabular-nums text-slate-900">{counts[k].toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="lg:col-span-2 flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <span className="hidden sm:grid h-11 w-11 flex-shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600"><Box className="h-5 w-5" /></span>
        <div className="grid flex-1 grid-cols-3 gap-3">
          <div><p className="text-xs text-slate-500">Total Slots</p><p className="text-lg font-semibold tabular-nums text-slate-900">{total.toLocaleString()}</p></div>
          <div><p className="text-xs text-slate-500">Used</p><p className="text-lg font-semibold tabular-nums text-slate-900">{used.toLocaleString()} <span className="text-xs font-normal text-slate-500">({pct(used)}%)</span></p></div>
          <div><p className="text-xs text-slate-500">Available</p><p className="text-lg font-semibold tabular-nums text-slate-900">{available.toLocaleString()} <span className="text-xs font-normal text-slate-500">({pct(available)}%)</span></p></div>
        </div>
      </div>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────

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
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [camera, setCamera] = useState<CameraInfo | null>(null);
  const [gl, setGl] = useState<boolean | null>(null);
  const api = useRef<SceneApi | null>(null);

  useEffect(() => { setGl(webglAvailable()); }, []);

  // Rack positions from the 2D plan, if one exists. Any failure just means the
  // automatic arrangement is used — the 3D view never depends on the plan.
  useEffect(() => {
    if (!warehouseId) return;
    let cancelled = false;
    setObjects(null);
    layoutApi.get(warehouseId)
      .then((r) => { if (!cancelled) setObjects(r.objects ?? []); })
      .catch(() => { if (!cancelled) setObjects([]); });
    return () => { cancelled = true; };
  }, [warehouseId]);

  // Same live signals as the Floor plan tab; re-reads the warehouse tree.
  useRealtime(['inventory:update', 'request:update'], () => { void onReload(); }, { enabled: !!warehouseId });

  const scene = useMemo(() => buildScene(wh, objects ?? []), [wh, objects]);
  const fromPlan = useMemo(() => {
    const ids = new Set((objects ?? []).filter((o) => o.objectType === 'RACK' && o.rackId).map((o) => o.rackId));
    return scene.racks.filter((p) => ids.has(p.rack.id)).length;
  }, [objects, scene]);

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

  const selectRack = useCallback((id: string) => {
    const r = allRacks.find((x) => x.id === id);
    if (!r) return;
    if (zone !== ALL && zoneOf(r) !== zone) setZone(zoneOf(r));
    setRackId(id);
  }, [allRacks, zone]);

  const resetView = () => {
    setZone(ALL); setRackId(ALL);
    api.current?.reset();
  };

  const zoneLabel = (v: string) => (v === ALL ? 'All Zones' : v === NO_ZONE ? 'No zone' : `Zone ${v}`);
  const rackLabel = (v: string) => (v === ALL ? 'All Racks' : allRacks.find((r) => r.id === v)?.code ?? v);

  if (loading || (wh && objects === null)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full max-w-xl rounded-lg" />
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_20rem] gap-4">
          <Skeleton className="h-[560px] rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!wh) return null;

  if (!scene.racks.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
        <Box className="h-10 w-10 mx-auto text-slate-300" />
        <p className="mt-2 text-sm font-medium text-slate-600">No active racks in {wh.name}</p>
        <p className="text-xs text-slate-400 mt-1">Racks created in the Racks &amp; slots tab or Warehouse Master appear here in 3D.</p>
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
        <Button variant="outline" size="sm" className="h-9 gap-1.5 bg-white" onClick={resetView}>
          <RotateCcw className="h-4 w-4" /> Reset View
        </Button>
        <p className="ml-auto text-xs text-slate-400">
          {fromPlan === scene.racks.length
            ? 'Rack positions from the floor plan'
            : fromPlan > 0
              ? `${fromPlan} of ${scene.racks.length} racks placed from the floor plan; the rest arranged by zone`
              : 'Racks arranged by zone (none are placed on the floor plan yet)'}
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_20rem] gap-4 items-start">
        {/* 3D canvas */}
        <div className="relative h-[440px] sm:h-[560px] xl:h-[620px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          {gl === false ? <NoWebGL /> : gl === null ? null : (
            <SceneBoundary>
              <WarehouseScene3D
                scene={scene}
                active={active}
                selectedSlotId={selectedSlotId}
                onSelectSlot={setSelectedSlotId}
                onSelectRack={selectRack}
                apiRef={api}
                onCamera={setCamera}
              />
              <ViewControls api={api} />
              <Minimap scene={scene} active={active} camera={camera} onPick={(x, z) => api.current?.focus(x, z)} />
              <p className="pointer-events-none absolute bottom-3 right-3 z-40 hidden md:block rounded-md bg-white/85 px-2 py-1 text-[11px] text-slate-500">
                Drag to rotate · Right-drag to pan · Scroll to zoom
              </p>
            </SceneBoundary>
          )}
        </div>

        {/* Details */}
        <div className="xl:sticky xl:top-4">
          <SlotDetails
            wh={wh}
            rack={selected?.rack ?? null}
            slot={selected?.slot ?? null}
            onClose={() => setSelectedSlotId(null)}
            onViewStock={onViewStock}
          />
        </div>
      </div>

      <StatusSummary racks={filteredRacks} filtered={filtered} />
    </div>
  );
}
