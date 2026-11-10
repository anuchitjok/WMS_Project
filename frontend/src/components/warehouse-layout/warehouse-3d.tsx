'use client';

// Warehouse Operations — 3D view tab (control-tower layout).
//
//   header bar (warehouse · system status · last refresh · view mode) → 6 KPI cards
//   → search & filters → 3D scene | Location Details → bottom summary
//
// Read-only. Every figure comes from real data through existing APIs:
//   • warehouse tree from the page (/warehouse: racks, slots, placement counts)
//   • rack positions + operational areas from the 2D floor plan (/warehouse-layout/:id)
//   • slot contents from /warehouse/slots/:id/detail (same call as Racks & slots)
//   • SKU / serial search and Related from /inventory?search= (existing stock search)
//   • stock age from /warehouse/:id/slot-stock-age (oldest receivedDate per slot)
//   • History from /inventory/:id/detail-full (audit log of the newest stock row)
//   • header + KPI row (PR8 Phase 1): see use-tower-data.ts — Slots Used / Empty Slots
//     use the same whMetrics() as the page's KPI strip and the Racks & slots tab
//
// Split: w3d-panels.tsx (UI around the scene), w3d-overlays.tsx (UI on the scene),
// use-w3d-data.ts (data), scene-geometry.ts (pure layout), scene-3d.tsx (WebGL).

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { Box, AlertTriangle, Loader2, Info } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useRealtime } from '@/hooks/use-realtime';
import { useT } from '@/i18n';
import { type WarehouseData, type RackData, type SlotData, slotItems, slotUtil, whMetrics, withRate, isOccupied } from './occupancy';
import {
  type ViewMode, type EnvMode, type SlotState3D,
  buildScene, slotState3D, slotColor, zoneOf, ageDays, fillBucket, NO_ZONE,
} from './scene-geometry';
import type { SceneApi, CameraInfo, CameraPreset } from './scene-3d';
import { useLayoutObjects, useStockAge, useSlotDetail, useStockHistory, useRelatedStock, useReservedStock, type ReservedSlot } from './use-w3d-data';
import {
  ALL, NO_FILTERS, PopupContainer, type Filters, type DetailTab,
  FilterBar, LocationDetails, BottomSummary, summarizeSlot,
} from './w3d-panels';
import { TowerHeader, TowerKpis } from './w3d-tower';
import { RackPanel } from './w3d-rack-panel';
import { useTowerData } from './use-tower-data';
import { SetupHealthCard } from './setup-health-card';
import { setupHealth } from './setup-health';
import { CameraPresets, ViewControls, Minimap, Legend } from './w3d-overlays';

const WarehouseScene3D = dynamic(() => import('./scene-3d'), {
  ssr: false,
  loading: () => <SceneLoading />,
});

function SceneLoading() {
  const { m } = useT();
  return (
    <div className="absolute inset-0 grid place-items-center text-sm text-slate-400">
      <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> {m.layout3d.view.loading}</span>
    </div>
  );
}

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
  const { m } = useT();
  return (
    <div className="absolute inset-0 grid place-items-center p-6 text-center">
      <div>
        <AlertTriangle className="mx-auto h-8 w-8 text-amber-400" />
        <p className="mt-2 text-sm font-medium text-slate-700">{m.layout3d.view.noWebglTitle}</p>
        <p className="mt-1 text-xs text-slate-500">{m.layout3d.view.noWebglBody}</p>
      </div>
    </div>
  );
}

// ─── Selected-slot tag (inside the 3D view) ───────────────────────────────────

function SlotTag({ slot }: { slot: SlotData }) {
  const { m } = useT();
  return (
    <div className="whitespace-nowrap rounded-lg bg-blue-600 px-3 py-1.5 text-center text-white shadow-lg shadow-blue-600/30">
      <p className="font-mono text-sm font-semibold leading-tight">{slot.code}</p>
      <p className="text-[11px] leading-tight text-blue-100">{m.layout3d.w3d.status[slotState3D(slot)]} · {slotUtil(slot)}%</p>
    </div>
  );
}

/** Copy of the warehouse with each slot's reserved stock (3D only; the tree itself is untouched). */
function withReserved(wh: WarehouseData | null, bySlot: Map<string, ReservedSlot> | null): WarehouseData | null {
  if (!wh || !bySlot?.size) return wh;
  return {
    ...wh,
    racks: wh.racks.map((r) => ({
      ...r,
      slots: (r.slots ?? []).map((s) => {
        const x = bySlot.get(s.id);
        return x ? { ...s, reservedRows: x.rows, reservedQty: x.qty } : s;
      }),
    })),
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

export function Warehouse3D({ warehouses, wh: whTree, onSelectWarehouse, loading, onReload, onViewStock }: {
  warehouses: WarehouseData[];
  wh: WarehouseData | null;
  onSelectWarehouse: (id: string) => void;
  loading: boolean;
  onReload: () => void | Promise<void>;
  onViewStock: (slotId: string) => void;
}) {
  const { m, t } = useT();
  const V = m.layout3d.view, W = m.layout3d.w3d;
  const warehouseId = whTree?.id ?? '';
  const objects = useLayoutObjects(warehouseId);
  const age = useStockAge(warehouseId);
  const tower = useTowerData(warehouseId);
  const reserved = useReservedStock(warehouseId);
  const wh = useMemo(() => withReserved(whTree, reserved.bySlot), [whTree, reserved.bySlot]);

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [colorMode, setColorMode] = useState<ViewMode>('status');
  const [envMode, setEnvMode] = useState<EnvMode>('open');
  const [roof, setRoof] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>('stock');
  const [camera, setCamera] = useState<CameraInfo | null>(null);
  const [preset, setPreset] = useState<CameraPreset | null>('iso');
  const [miniOpen, setMiniOpen] = useState(false);
  const [gl, setGl] = useState<boolean | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [hideBoxes, setHideBoxes] = useState(false);
  const api = useRef<SceneApi | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageW, setStageW] = useState(0);
  const [barH, setBarH] = useState(0);
  // Wide stage: the filter bar floats over the top of the 3D scene (one-screen layout).
  const barInScene = stageW > 760;


  useEffect(() => { setGl(webglAvailable()); }, []);
  useEffect(() => {
    const on = () => setFullscreen(document.fullscreenElement === stageRef.current && !!stageRef.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  // One refresh signal for everything on this tab: server events, a 60 s poll while
  // the browser tab is visible, and coming back to the tab (debounced together).
  // No duplicates: skipped while a refresh is still running or within 3 s of the last one.
  const { reload: reloadAge } = age, { reload: reloadTower } = tower, { reload: reloadReserved } = reserved;
  const lastRefresh = useRef(0);
  const refreshing = useRef(false);
  const refreshAll = useCallback(() => {
    const now = Date.now();
    if (refreshing.current || now - lastRefresh.current < 3_000) return;
    lastRefresh.current = now;
    refreshing.current = true;
    reloadAge();
    void Promise.allSettled([onReload(), reloadTower(), reloadReserved()]).finally(() => { refreshing.current = false; });
  }, [onReload, reloadAge, reloadTower, reloadReserved]);
  useRealtime(['inventory:update', 'request:update'], refreshAll, { enabled: !!warehouseId });

  const scene = useMemo(() => buildScene(wh, objects ?? []), [wh, objects]);

  // Track the stage width whenever the stage mounts (it appears once loading is over and there are racks).
  const stageObs = useRef<ResizeObserver | null>(null);
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const stageCallbackRef = useCallback((el: HTMLDivElement | null) => {
    stageRef.current = el;
    setStageEl(el);
    stageObs.current?.disconnect();
    stageObs.current = null;
    if (!el) return;
    setStageW(el.clientWidth);
    if (typeof ResizeObserver !== 'undefined') {
      stageObs.current = new ResizeObserver(() => setStageW(el.clientWidth));
      stageObs.current.observe(el);
    }
  }, []);
  // Measure the floating bar whenever it mounts (it appears only once WebGL is confirmed).
  const barObs = useRef<ResizeObserver | null>(null);
  const barRef = useCallback((el: HTMLDivElement | null) => {
    barObs.current?.disconnect();
    barObs.current = null;
    if (!el) { setBarH(0); return; }
    setBarH(el.offsetHeight);
    if (typeof ResizeObserver !== 'undefined') {
      barObs.current = new ResizeObserver(() => setBarH(el.offsetHeight));
      barObs.current.observe(el);
    }
  }, []);
  const fromPlan = useMemo(() => {
    const ids = new Set((objects ?? []).filter((o) => o.objectType === 'RACK' && o.rackId).map((o) => o.rackId));
    return scene.racks.filter((p) => ids.has(p.rack.id)).length;
  }, [objects, scene]);

  const ageMap = useMemo(() => {
    const out = new Map<string, { days: number; oldest: string }>();
    const d = age.data;
    if (d) for (const s of d.slots) out.set(s.slotId, { days: ageDays(s.oldestReceivedDate, d.asOf), oldest: s.oldestReceivedDate });
    return out;
  }, [age.data]);

  const colors = useMemo(() => {
    const ageOf = (id: string) => ageMap.get(id)?.days ?? null;
    return scene.slots.map((s) => slotColor(s.slot, colorMode, ageOf));
  }, [scene, colorMode, ageMap]);

  // ── Filters ──
  const allRacks = useMemo(() => scene.racks.map((p) => p.rack), [scene]);
  const zones = useMemo(() => [...new Set(allRacks.map(zoneOf))].sort((a, b) => (a === NO_ZONE ? 1 : b === NO_ZONE ? -1 : a.localeCompare(b, undefined, { numeric: true }))), [allRacks]);
  const zoneRacks = useMemo(() => allRacks.filter((r) => filters.zone === ALL || zoneOf(r) === filters.zone)
    .slice().sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })), [allRacks, filters.zone]);

  const filtered = filters.zone !== ALL || filters.rackId !== ALL || filters.status !== ALL || filters.fill !== ALL;
  const matches = useCallback((s: SlotData, r: RackData) => (
    (filters.zone === ALL || zoneOf(r) === filters.zone)
    && (filters.rackId === ALL || r.id === filters.rackId)
    && (filters.status === ALL || slotState3D(s) === filters.status)
    && (filters.fill === ALL || fillBucket(s) === filters.fill)
  ), [filters]);

  // Per scene slot: in the filter or not (null = no filter).
  const slotOn = useMemo(() => (filtered ? scene.slots.map((s) => matches(s.slot, s.rack)) : null), [filtered, scene, matches]);
  // Racks that keep at least one slot in the filter (frame the camera on them).
  const active = useMemo(() => {
    if (!slotOn) return null;
    const set = new Set<string>();
    scene.slots.forEach((s, i) => { if (slotOn[i]) set.add(s.rack.id); });
    // A rack with no slots yet still shows when it is picked by zone/rack.
    for (const r of zoneRacks) if (!(r.slots ?? []).length && (filters.rackId === ALL || r.id === filters.rackId) && filters.status === ALL && filters.fill === ALL) set.add(r.id);
    return set;
  }, [slotOn, scene, zoneRacks, filters]);

  const counts = useMemo(() => {
    const c: Record<SlotState3D, number> = { empty: 0, inUse: 0, full: 0, reserved: 0, blocked: 0 };
    scene.slots.forEach((s, i) => { if (!slotOn || slotOn[i]) c[s.state]++; });
    return c;
  }, [scene, slotOn]);
  const inFilter = counts.empty + counts.inUse + counts.full + counts.reserved + counts.blocked;

  const slotIndex = useMemo(() => {
    const out = new Map<string, { slot: SlotData; rack: RackData; i: number }>();
    scene.slots.forEach((s, i) => out.set(s.slot.id, { slot: s.slot, rack: s.rack, i }));
    return out;
  }, [scene]);
  const selected = selectedSlotId ? slotIndex.get(selectedSlotId) ?? null : null;
  const isOn = useCallback((slotId: string) => {
    const s = slotIndex.get(slotId);
    return !!s && (!slotOn || slotOn[s.i]);
  }, [slotIndex, slotOn]);

  // A slot outside the filter (or deleted by a refresh) is no longer selectable.
  // One rack in focus: clear it, so the rack panel shows (PR8 Phase 2).
  // A zone in focus: move the selection to the first slot with stock inside it
  // (none → clear), so the details panel follows the focus.
  useEffect(() => {
    if (!selectedSlotId || isOn(selectedSlotId)) return;
    const zoneFocus = filters.rackId === ALL && filters.zone !== ALL;
    const next = zoneFocus && slotOn ? scene.slots.find((s, i) => slotOn[i] && isOccupied(s.slot)) : undefined;
    setSelectedSlotId(next ? next.slot.id : null);
  }, [selectedSlotId, isOn, filters.rackId, filters.zone, slotOn, scene]);

  // ── Selected slot data ──
  const stamp = selected ? `${slotItems(selected.slot)}|${selected.slot.updatedAt ?? ''}` : '';
  const slotDetail = useSlotDetail(selectedSlotId, stamp);
  const summary = selected ? summarizeSlot(selected.slot, slotDetail.detail) : null;
  const history = useStockHistory(summary?.first?.id ?? null, tab === 'history');
  const related = useRelatedStock(warehouseId, summary?.skus[0] ?? null, selectedSlotId, tab === 'related',
    (id) => slotIndex.has(id));

  const selectRack = useCallback((id: string) => {
    const r = allRacks.find((x) => x.id === id);
    if (!r) return;
    setFilters((f) => ({ ...f, zone: f.zone !== ALL && zoneOf(r) !== f.zone ? zoneOf(r) : f.zone, rackId: id }));
    setPreset(null);
  }, [allRacks]);
  // Rack sign / setup card: focus the rack and show its panel (no slot picked).
  const openRack = useCallback((id: string) => {
    selectRack(id);
    setSelectedSlotId(null);
  }, [selectRack]);
  const focusedRack = filters.rackId !== ALL ? allRacks.find((r) => r.id === filters.rackId) ?? null : null;
  // Setup health: racks whose master data looks wrong get a red outline; a code in the card zooms to its rack.
  const flagged = useMemo(() => (wh ? setupHealth(wh).flagged : undefined), [wh]);
  const focusRackFromCard = useCallback((id: string) => {
    openRack(id);
    stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [openRack]);
  // Clicking a slot in the scene selects it and focuses its rack: the other racks fade out.
  const selectSlot = useCallback((slotId: string) => {
    setSelectedSlotId(slotId);
    const hit = slotIndex.get(slotId);
    if (hit && filters.rackId !== hit.rack.id) selectRack(hit.rack.id);
  }, [slotIndex, filters.rackId, selectRack]);
  // Zone name on the floor: focus every rack in the zone (same as picking it in the Zone filter).
  const selectZone = useCallback((zone: string) => {
    setFilters((f) => ({ ...f, zone, rackId: ALL }));
    setPreset(null);
  }, []);

  // Search hit / Related / Focus: make sure the slot is in view, select it, glide in.
  const goToSlot = useCallback((slotId: string) => {
    const hit = slotIndex.get(slotId);
    if (!hit) return;
    if (!isOn(slotId)) setFilters(NO_FILTERS);
    setSelectedSlotId(slotId);
    setPreset(null);
    // After any filter change has re-framed the camera.
    setTimeout(() => api.current?.flyTo(slotId), 80);
  }, [slotIndex, isOn]);

  // Rack code from the search box: show that rack (out of any other filter) and glide to it.
  const searchRack = useCallback((id: string) => {
    if (!allRacks.some((r) => r.id === id)) return;
    setFilters({ ...NO_FILTERS, rackId: id });
    setSelectedSlotId(null);
    setPreset(null);
    setTimeout(() => api.current?.focusRack(id), 80);
  }, [allRacks]);

  const pickPreset = (p: CameraPreset) => { setPreset(p); api.current?.preset(p); };
  // ⟲ in the scene: back to the start view and out of any rack / zone focus (other filters stay).
  const resetView = () => {
    setFilters((f) => ({ ...f, zone: ALL, rackId: ALL }));
    setPreset('iso');
    // After the focus change has re-framed the camera, so the start view wins.
    setTimeout(() => api.current?.reset(), 80);
  };
  const resetAll = () => { setFilters(NO_FILTERS); setPreset('iso'); api.current?.reset(); };
  const toggleFullscreen = () => {
    const el = stageRef.current;
    if (!el) return;
    const p = document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.();
    Promise.resolve(p).catch(() => {});
  };

  const metrics = useMemo(() => withRate(wh ? whMetrics(wh) : { total: 0, occupied: 0, available: 0, blocked: 0, items: 0, utilPct: 0 }), [wh]);
  const selPos = selected ? scene.slots[selected.i].pos : null;

  if (loading || (wh && objects === null)) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-14 w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}
        </div>
        <Skeleton className="h-12 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-[600px] rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!wh) return null;

  const header = (
    <>
      <TowerHeader wh={wh} system={tower.system} updatedAt={tower.updatedAt} refreshing={tower.refreshing} failed={tower.failed || reserved.stale}
        onRefresh={refreshAll} mode={envMode} onMode={setEnvMode} />
      <TowerKpis metrics={metrics} stock={tower.stock} tasks={tower.tasks} />
      <SetupHealthCard wh={wh} onRack={focusRackFromCard} />
    </>
  );

  const filterBar = (
    <FilterBar warehouses={warehouses} wh={wh} onWarehouse={onSelectWarehouse}
      slots={slotIndex} zones={zones} zoneRacks={zoneRacks}
      filters={filters} onFilters={setFilters} onPickSlot={goToSlot} onReset={resetAll}
      racks={allRacks} onPickRack={searchRack} />
  );
  // Overlays at the top of the stage start below the floating bar; the camera keeps that band free too.
  const overlayTop = barInScene ? barH + 20 : 12;
  const topInset = overlayTop + 44; // the camera preset buttons always float at the top

  if (!scene.racks.length) {
    return (
      <div className="space-y-3">
        {header}
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <Box className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-600">{t(V.noRacks, { name: wh.name })}</p>
          <p className="mt-1 text-xs text-slate-400">{V.noRacksHint}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {header}

      {!barInScene && filterBar}

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div ref={stageCallbackRef}
          className="relative h-[460px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm sm:h-[600px] xl:h-[max(540px,calc(100vh-400px))] [&:fullscreen]:h-screen [&:fullscreen]:rounded-none">
          {gl === false ? <NoWebGL /> : gl === null ? null : (
            <SceneBoundary>
              <WarehouseScene3D
                scene={scene}
                active={active}
                slotOn={slotOn}
                colors={colors}
                colorMode={colorMode}
                envMode={envMode}
                roof={roof}
                hideBoxes={colorMode === 'status' && hideBoxes}
                flagged={flagged}
                topInset={topInset}
                selectedSlotId={selectedSlotId}
                focusRackId={filters.rackId !== ALL ? filters.rackId : null}
                onSelectSlot={selectSlot}
                onSelectRack={openRack}
                onSelectZone={selectZone}
                apiRef={api}
                onCamera={setCamera}
                onUserCamera={() => setPreset(null)}
                tooltip={selected ? <SlotTag slot={selected.slot} /> : null}
              />
              {barInScene && (
                <div ref={barRef} className="absolute inset-x-3 top-3 z-50 rounded-2xl bg-white/70 p-1.5 shadow-md ring-1 ring-slate-200 backdrop-blur-sm">
                  <PopupContainer.Provider value={fullscreen ? stageEl : null}>{filterBar}</PopupContainer.Provider>
                </div>
              )}
              <CameraPresets active={preset} onPick={pickPreset} top={overlayTop}>
                {/* Shaped floors have no roof frame yet (D6), so no roof switch either */}
                {envMode === 'full' && !scene.floor.outline && (
                  <label className="flex items-center gap-2 rounded-lg bg-white/95 px-3 py-1.5 text-xs text-slate-700 shadow-md ring-1 ring-slate-200">
                    <input type="checkbox" checked={roof} onChange={(e) => setRoof(e.target.checked)} className="h-3.5 w-3.5 accent-emerald-700" />
                    {W.viewMode.roof}
                  </label>
                )}
              </CameraPresets>
              <ViewControls api={api} onReset={resetView} hasSelection={!!selected} fullscreen={fullscreen} onFullscreen={toggleFullscreen} top={overlayTop} />
              <Minimap scene={scene} active={active} camera={camera} selected={selPos ? [selPos[0], selPos[2]] : null}
                expanded={miniOpen} onToggle={() => setMiniOpen((v) => !v)} onPick={(x, z) => { setPreset(null); api.current?.focus(x, z); }} />
              <Legend mode={colorMode} onMode={setColorMode} counts={counts} ageState={age.state} onRetryAge={age.reload}
                reservedState={reserved.state} reservedPartial={reserved.partial} onRetryReserved={() => void reserved.reload()}
                hideBoxes={hideBoxes} onHideBoxes={setHideBoxes} />
              {filtered && inFilter === 0 && (
                <div style={{ top: overlayTop + 52 }} className="pointer-events-none absolute inset-x-0 z-30 mx-auto w-fit rounded-lg bg-white/95 px-4 py-2 text-sm text-slate-600 shadow-md ring-1 ring-slate-200">
                  {W.filters.noMatch}
                </div>
              )}
            </SceneBoundary>
          )}
        </div>

        <div className="xl:sticky xl:top-4">
          {!selected && focusedRack ? (
            <RackPanel
              rack={focusedRack}
              onClose={() => setFilters((f) => ({ ...f, rackId: ALL }))}
              onZoom={() => { setPreset(null); api.current?.focusRack(focusedRack.id); }}
              onShowAll={resetView}
              onPickSlot={goToSlot}
            />
          ) : (
          <LocationDetails
            wh={wh}
            rack={selected?.rack ?? null}
            slot={selected?.slot ?? null}
            detail={slotDetail.detail}
            detailState={slotDetail.state}
            age={selected ? ageMap.get(selected.slot.id) ?? null : null}
            ageState={age.state}
            tab={tab}
            onTab={setTab}
            history={history}
            related={related}
            slotCode={(id) => slotIndex.get(id)?.slot.code ?? null}
            onRetry={slotDetail.reload}
            onClose={() => setSelectedSlotId(null)}
            onFocusSlot={() => selected && goToSlot(selected.slot.id)}
            onFocusRack={() => { setPreset(null); api.current?.focusSelectedRack(); }}
            onViewStock={onViewStock}
            onGoSlot={goToSlot}
            onOpenRack={selected ? () => openRack(selected.rack.id) : undefined}
          />
          )}
        </div>
      </div>

      <BottomSummary rack={selected?.rack ?? null} slot={selected?.slot ?? null} detail={slotDetail.detail}
        detailLoading={slotDetail.state === 'loading' && !slotDetail.detail} />

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
        <Info className="h-3.5 w-3.5" />
        <span>{fromPlan === scene.racks.length ? V.posAllPlan : fromPlan > 0 ? t(V.posSome, { n: fromPlan, total: scene.racks.length }) : V.posNone}</span>
        {filtered && <span>· {t(W.filters.inFilter, { n: inFilter, total: scene.slots.length })}</span>}
        {envMode === 'full' && <span>· {W.viewMode.estimated}</span>}
      </p>
    </div>
  );
}
