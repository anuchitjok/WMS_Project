'use client';

// Interactive 3D Smart Warehouse — page body.
//
//   data source (mock today)  →  data index / layout / search index
//   interaction store         →  toolbar · navigation · scene · details · legend
//
// The 3D scene is the main interface; panels collapse to give it the room.

import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';
import { useT } from '@/i18n';
import { buildIndex } from './data-index';
import { buildSearchIndex, filtersToShow, type SearchHit } from './filter-search';
import { buildLayout } from './layout';
import { mockDataSource } from './mock-data';
import { useStatusColors } from './status-colors';
import { useSmartStore, type Selection } from './store';
import type { SmartWarehouseData, WarehouseDataSource } from './types';
import { Toolbar } from './panels/toolbar';
import { NavPanel } from './panels/nav-panel';
import { DetailsPanel } from './panels/details-panel';
import { StatusLegend } from './panels/status-legend';

const SmartScene = dynamic(() => import('./scene/smart-scene'), { ssr: false, loading: () => <Overlay kind="scene" /> });

function Overlay({ kind }: { kind: 'data' | 'scene' }) {
  const { m } = useT();
  return (
    <div className="absolute inset-0 grid place-items-center bg-[#f3f5f7]" data-testid="smart3d-loading">
      <span className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> {kind === 'data' ? m.layout3d.smart.loading : m.layout3d.smart.loadingScene}
      </span>
    </div>
  );
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

function NoWebGL() {
  const { m } = useT();
  return (
    <div className="absolute inset-0 grid place-items-center p-6 text-center">
      <div>
        <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
        <p className="mt-2 text-sm font-medium text-slate-700">{m.layout3d.smart.noWebglTitle}</p>
        <p className="mt-1 text-xs text-slate-500">{m.layout3d.smart.noWebglBody}</p>
      </div>
    </div>
  );
}

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <NoWebGL /> : this.props.children; }
}

export function SmartWarehouse({ source = mockDataSource }: { source?: WarehouseDataSource }) {
  const { m, t } = useT();
  const P = m.layout3d.smart;
  const [data, setData] = useState<SmartWarehouseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  useEffect(() => { setWebgl(webglAvailable()); }, []);

  // Narrow screens: start with panels folded so the 3D view keeps its room.
  useEffect(() => {
    const w = window.innerWidth;
    const s = useSmartStore.getState();
    if (w < 1280) s.setLeftOpen(false);
    if (w < 1024) s.setRightOpen(false);
  }, []);

  const st = useSmartStore();
  const statusColors = useStatusColors((s) => s.colors);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    source.load(ctrl.signal)
      .then((d) => {
        setData(d);
        const s = useSmartStore.getState();
        if (!d.warehouses.some((w) => w.id === s.filters.warehouseId)) s.init(d.warehouses[0]?.id ?? '');
        else s.select(null);
      })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name === 'AbortError') return;
        setError((e as Error)?.message || P.loadError);
      })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [source, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const index = useMemo(() => (data ? buildIndex(data) : null), [data]);
  const searchIndex = useMemo(() => (data ? buildSearchIndex(data) : null), [data]);
  const warehouseId = st.filters.warehouseId;
  const layout = useMemo(() => (data && warehouseId ? buildLayout(data, warehouseId) : null), [data, warehouseId]);

  /** Select something and fly to it, widening the filters first if it is hidden. */
  const reveal = useCallback((sel: NonNullable<Selection>) => {
    if (!index) return;
    const slot = sel.kind === 'slot' ? index.slot.get(sel.id) : undefined;
    const rack = sel.kind === 'rack' ? index.rack.get(sel.id) : slot ? index.rack.get(slot.rackId) : undefined;
    if (!rack) return;
    const s = useSmartStore.getState();
    const next = filtersToShow(s.filters, { warehouseId: rack.warehouseId, zoneId: rack.zoneId, aisleId: rack.aisleId, rackId: rack.id, status: slot?.status });
    if (next !== s.filters) s.setFilters(next);
    s.select(sel, true);
  }, [index]);

  const onSearchPick = useCallback((h: SearchHit) => reveal({ kind: h.kind, id: h.id }), [reveal]);
  const openRack = useCallback((id: string) => reveal({ kind: 'rack', id }), [reveal]);
  const openSlot = useCallback((id: string) => reveal({ kind: 'slot', id }), [reveal]);
  const onPick = useCallback((sel: Selection, focus: boolean) => st.select(sel, focus), [st]);

  // Leaving the page clears the selection so the next visit starts fresh.
  useEffect(() => () => { useSmartStore.getState().select(null); }, []);

  const stats = layout ? t(P.stats, { racks: layout.racks.length.toLocaleString(), slots: layout.slots.length.toLocaleString() }) : undefined;

  return (
    <div className="flex h-full min-h-[560px] flex-col bg-slate-50" data-testid="smart3d-page">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-white px-4 py-2.5">
        <Link href="/warehouse-layout" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-3.5 w-3.5" /> {P.back}
        </Link>
        <span className="h-4 w-px bg-slate-200" aria-hidden />
        <h1 className="text-base font-semibold text-slate-900">{P.title}</h1>
        <span className="rounded-md bg-amber-500 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white" title={P.demoNote} data-testid="smart3d-demo-badge">
          {P.demoBadge}
        </span>
      </div>
      {/* Sample data only: say so on every visit, in a bar that cannot be closed (PR8). */}
      <div role="note" className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900" data-testid="smart3d-demo-note">
        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-600" /> {P.demoNote}
      </div>

      <Toolbar data={data} searchIndex={searchIndex} onSearchPick={onSearchPick} disabled={!layout} />

      <div className="relative flex min-h-0 flex-1">
        {st.leftOpen && data && index && <NavPanel data={data} index={index} onOpenRack={openRack} />}

        <div className="relative min-w-0 flex-1 bg-[#f3f5f7]" data-testid="smart3d-viewport">
          {/* Watermark on the 3D view itself, so a screenshot can't pass for live stock. */}
          <div aria-hidden className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 select-none rounded-lg bg-white/80 px-3 py-1 text-sm font-bold uppercase tracking-widest text-amber-600 ring-1 ring-amber-200">
            {P.demoBadge}
          </div>
          {error ? (
            <div className="absolute inset-0 grid place-items-center p-6" data-testid="smart3d-error">
              <div className="max-w-sm rounded-xl border border-red-200 bg-white p-5 text-center shadow-sm">
                <AlertTriangle className="mx-auto h-7 w-7 text-red-500" />
                <p className="mt-2 text-sm font-medium text-slate-800">{P.loadError}</p>
                <p className="mt-1 break-words text-xs text-slate-500">{error}</p>
                <button type="button" onClick={() => setAttempt((a) => a + 1)}
                  className="mt-4 inline-flex h-8 items-center rounded-md bg-green-600 px-3 text-sm font-medium text-white hover:bg-green-700">
                  {P.retry}
                </button>
              </div>
            </div>
          ) : loading || !layout || webgl === null ? (
            <Overlay kind="data" />
          ) : !webgl ? (
            <NoWebGL />
          ) : !layout.racks.length ? (
            <div className="absolute inset-0 grid place-items-center text-sm text-slate-500">{P.empty}</div>
          ) : (
            <SceneBoundary>
              <SmartScene key={layout.warehouseId} layout={layout} filters={st.filters} selection={st.selection}
                viewMode={st.viewMode} pickMode={st.pickMode} statusColors={statusColors} camera={st.camera} onPick={onPick} />
            </SceneBoundary>
          )}
        </div>

        {st.rightOpen && data && index && <DetailsPanel data={data} index={index} onOpenRack={openRack} onOpenSlot={openSlot} />}
      </div>

      <StatusLegend data={data} stats={stats} />
    </div>
  );
}
