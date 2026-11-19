'use client';

// 2D floor-plan canvas. Read-only by default (Sprint 4); when `editable` is set
// it also supports drag, resize, marquee multi-select and snap-to-grid (Sprint 5).
//
// SVG rather than <canvas>: pan/zoom come free from the viewBox, and every
// object stays a real DOM node, so focus, keyboard access and hit-testing work
// without a picking layer. A floor plan is hundreds of rects, not thousands.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ZoomIn, ZoomOut, Maximize2, Ruler, X, AlertTriangle } from 'lucide-react';
import type { LayoutObject, WarehouseLayout, LayoutOccupancy } from '@/lib/api';
import { useT } from '@/i18n';
import { LayoutObjectShape } from './layout-object';
import {
  GRID_REVEAL_PX, MIN_OBJECT_SIZE, SNAP_STEP, planDistance, scaleReadout, snapToGrid,
} from './plan-geometry';
import { cn } from '@/lib/utils';

interface View { x: number; y: number; w: number; h: number }
type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type Pt = [number, number];
/** Ruler (RQ12): `a` is fixed on the first click, `b` follows until the second. */
interface Measure { a: Pt; b: Pt; done: boolean }

const PAD = 2;
const MIN_SPAN = 4;
const MAX_SPAN_MULT = 3;
// Smallest object, in grid units. Was 0.5 (50 cm), which is wider than a door
// post or a column — and a floor of 0.5 while snapping is 0.1 would mean the
// snap grid could not produce the smallest size. One snap step is the floor.
const MIN_SIZE = MIN_OBJECT_SIZE;

function fitView(layout: WarehouseLayout): View {
  return { x: -PAD, y: -PAD, w: layout.widthUnits + PAD * 2, h: layout.heightUnits + PAD * 2 };
}

const HANDLES: { id: HandleId; fx: number; fy: number; cursor: string }[] = [
  { id: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize' },
  { id: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize' },
  { id: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize' },
  { id: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { id: 'se', fx: 1, fy: 1, cursor: 'nwse-resize' },
  { id: 's', fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { id: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize' },
  { id: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize' },
];

export function LayoutCanvas({
  layout, objects, selectedIds, onSelect,
  editable = false, snapEnabled = true, onCheckpoint, onPatch, occupancyByObject, focus,
}: {
  layout: WarehouseLayout;
  objects: LayoutObject[];
  selectedIds: string[];
  onSelect: (ids: string[], additive?: boolean) => void;
  editable?: boolean;
  snapEnabled?: boolean;
  onCheckpoint?: () => void;
  onPatch?: (ids: string[], patch: Partial<LayoutObject>, history?: boolean) => void;
  occupancyByObject?: Map<string, LayoutOccupancy>;
  /**
   * RQ10: bring one object into view. `nonce` is what triggers it, so asking for
   * the SAME object twice still re-frames it after the user has panned away.
   */
  focus?: { id: string; nonce: number } | null;
}) {
  const { m, t, fmt } = useT();
  const F = m.layout3d.floor;
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(() => fitView(layout));
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [panning, setPanning] = useState(false);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // RQ12 ruler. `measuring` is the mode; `measure` is the current two points.
  const [measuring, setMeasuring] = useState(false);
  const [measure, setMeasure] = useState<Measure | null>(null);
  // RQ11: shown after dragging an object that holds stock. Information, never a
  // block — under decision C5 the drag is legitimate, it just isn't a move.
  const [movedStock, setMovedStock] = useState<{ name: string; items: number } | null>(null);

  const panRef = useRef<{ x: number; y: number; view: View } | null>(null);
  const dragRef = useRef<{ ox: number; oy: number; start: Record<string, LayoutObject> } | null>(null);
  const resizeRef = useRef<{ handle: HandleId; ox: number; oy: number; start: LayoutObject } | null>(null);
  // The marquee lives in a ref as well as state: state drives the rendering,
  // but pointerup must read the ref — on a fast drag, pointerup can land before
  // React has re-rendered, and reading state there would drop the selection.
  const marqueeRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const panMovedRef = useRef(false);
  // Set when the drag that is starting includes an object that holds stock.
  const dragStockRef = useRef<{ name: string; items: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize({ w: Math.max(1, r.width), h: Math.max(1, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { setView(fitView(layout)); }, [layout.id, layout.widthUnits, layout.heightUnits]); // eslint-disable-line

  // RQ10: centre the view on a requested object, zoomed in enough to see it with
  // its surroundings. A door 30 cm deep would be a hairline at fit-to-floor zoom,
  // so the span is taken from the object's own size with a floor of MIN_SPAN. The
  // current aspect ratio is kept, so the plan never stretches.
  useEffect(() => {
    if (!focus) return;
    const o = objects.find((x) => x.id === focus.id);
    if (!o) return;
    setView((v) => {
      const span = Math.max(o.width, o.height, MIN_SIZE) * 5;
      const w = Math.min(Math.max(span, MIN_SPAN), layout.widthUnits * MAX_SPAN_MULT);
      const h = w * (v.h / Math.max(v.w, 1e-6));
      return { w, h, x: o.x + o.width / 2 - w / 2, y: o.y + o.height / 2 - h / 2 };
    });
  }, [focus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const pxPerUnit = Math.min(size.w / view.w, size.h / view.h);

  const toUser = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, []);

  // RQ9 / C2: snap now locks to the 10 cm grid rather than a whole metre. Snap
  // off still gives 1 cm, as before. Both call sites (resize and drag, below)
  // pass raw user-space values, so this is the only place the step is decided.
  const snapVal = useCallback((n: number) => snapToGrid(n, snapEnabled), [snapEnabled]);

  // RQ11: how much stock each drawn object is holding right now.
  //
  // `/occupancy` only returns rows for objects linked to a WMS SLOT, i.e. drawn
  // bins. A RACK object is linked by rackId and gets no row of its own, so the
  // figures are rolled up the parentObjectId chain — a rack drawn with its bins
  // (“Draw bins from slots”) therefore shows its own total.
  const stockByObject = useMemo(() => {
    const agg = new Map<string, { items: number; quantity: number; ownRow: boolean }>();
    if (!occupancyByObject || occupancyByObject.size === 0) return agg;
    const byId = new Map(objects.map((o) => [o.id, o]));
    for (const o of objects) {
      const row = occupancyByObject.get(o.id);
      if (!row || row.orphaned || row.items <= 0) continue;
      let cur: LayoutObject | undefined = o;
      const seen = new Set<string>(); // a bad parent cycle must not hang the canvas
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        const e = agg.get(cur.id) ?? { items: 0, quantity: 0, ownRow: false };
        e.items += row.items;
        e.quantity += row.quantity;
        if (cur.id === o.id) e.ownRow = true;
        agg.set(cur.id, e);
        cur = cur.parentObjectId ? byId.get(cur.parentObjectId) : undefined;
      }
    }
    return agg;
  }, [objects, occupancyByObject]);

  // Ruler on/off from the keyboard. `M` is free: the Floor Plan's own shortcuts
  // are all Ctrl/Cmd-based plus Delete and Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        setMeasuring((v) => !v);
        setMeasure(null);
        return;
      }
      if (e.key === 'Escape') { setMeasuring(false); setMeasure(null); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const zoomAround = useCallback((ux: number, uy: number, k: number) => {
    setView((v) => {
      const maxSpan = layout.widthUnits * MAX_SPAN_MULT;
      const nextW = Math.min(Math.max(v.w * k, MIN_SPAN), maxSpan);
      const actual = nextW / v.w;
      return { w: nextW, h: v.h * actual, x: ux - (ux - v.x) * actual, y: uy - (uy - v.y) * actual };
    });
  }, [layout.widthUnits]);

  function onWheel(e: React.WheelEvent) {
    const p = toUser(e.clientX, e.clientY);
    if (!p) return;
    zoomAround(p.x, p.y, e.deltaY > 0 ? 1.12 : 1 / 1.12);
  }
  const zoomButton = (k: number) => zoomAround(view.x + view.w / 2, view.y + view.h / 2, k);

  // ── Object interaction ─────────────────────────────────────────────────────

  function startObjectDrag(e: React.PointerEvent, obj: LayoutObject) {
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const already = selectedIds.includes(obj.id);
    const ids = additive ? (already ? selectedIds.filter((i) => i !== obj.id) : [...selectedIds, obj.id])
      : (already ? selectedIds : [obj.id]);
    onSelect(additive ? [obj.id] : ids, additive);

    if (!editable || !onPatch) return;
    const p = toUser(e.clientX, e.clientY);
    if (!p) return;
    const moving = (additive ? ids : (already ? selectedIds : [obj.id]));
    const start: Record<string, LayoutObject> = {};
    for (const id of moving) {
      const o = objects.find((x) => x.id === id);
      if (o) start[id] = o;
    }
    onCheckpoint?.();
    dragRef.current = { ox: p.x, oy: p.y, start };
    // RQ11: remember whether this gesture is dragging stock, so the drawing-only
    // notice can be shown once the drag actually changes a position.
    dragStockRef.current = null;
    for (const id of moving) {
      const s = stockByObject.get(id);
      if (s && s.items > 0) { dragStockRef.current = { name: start[id]?.name ?? '', items: s.items }; break; }
    }
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }

  // ── Ruler (RQ12) ───────────────────────────────────────────────────────────
  // Handled by a transparent overlay that sits ABOVE every object while the
  // ruler is on, so a measuring click can never land on a shape and start a
  // drag, and so no object code needs to know about the ruler at all.

  function measureDown(e: React.PointerEvent) {
    e.stopPropagation();
    const p = toUser(e.clientX, e.clientY);
    if (!p) return;
    const pt: Pt = [p.x, p.y];
    setMeasure((cur) => (cur && !cur.done ? { ...cur, b: pt, done: true } : { a: pt, b: pt, done: false }));
  }

  function measureMove(e: React.PointerEvent) {
    e.stopPropagation();
    const p = toUser(e.clientX, e.clientY);
    if (!p) return;
    setMeasure((cur) => (cur && !cur.done ? { ...cur, b: [p.x, p.y] } : cur));
  }

  function startResize(e: React.PointerEvent, handle: HandleId, obj: LayoutObject) {
    e.stopPropagation();
    const p = toUser(e.clientX, e.clientY);
    if (!p || !onPatch) return;
    onCheckpoint?.();
    resizeRef.current = { handle, ox: p.x, oy: p.y, start: obj };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }

  // ── Canvas-level pointer handling ──────────────────────────────────────────

  function onPointerDown(e: React.PointerEvent) {
    if (measuring) return; // the ruler overlay owns every gesture
    const p = toUser(e.clientX, e.clientY);
    // Shift+drag on empty canvas draws a marquee; plain drag pans, in both modes.
    if (editable && e.shiftKey && p) {
      marqueeRef.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      setMarquee(marqueeRef.current);
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }
    // Deselect on a CLICK, not on a pan — panning to see context shouldn't drop
    // the selection and reset the property panel.
    panRef.current = { x: e.clientX, y: e.clientY, view };
    panMovedRef.current = false;
    setPanning(true);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = toUser(e.clientX, e.clientY);

    if (resizeRef.current && p && onPatch) {
      const { handle, ox, oy, start } = resizeRef.current;
      const dx = p.x - ox, dy = p.y - oy;
      let { x, y, width, height } = start;
      if (handle.includes('w')) { const nx = snapVal(start.x + dx); width = Math.max(MIN_SIZE, start.x + start.width - nx); x = Math.max(0, nx); }
      if (handle.includes('e')) { width = Math.max(MIN_SIZE, snapVal(start.width + dx)); }
      if (handle.includes('n')) { const ny = snapVal(start.y + dy); height = Math.max(MIN_SIZE, start.y + start.height - ny); y = Math.max(0, ny); }
      if (handle.includes('s')) { height = Math.max(MIN_SIZE, snapVal(start.height + dy)); }
      onPatch([start.id], { x, y, width, height }, false);
      return;
    }

    if (dragRef.current && p && onPatch) {
      const { ox, oy, start } = dragRef.current;
      const rawDx = p.x - ox, rawDy = p.y - oy;
      for (const [id, o] of Object.entries(start)) {
        onPatch([id], {
          x: Math.max(0, snapVal(o.x + rawDx)),
          y: Math.max(0, snapVal(o.y + rawDy)),
        }, false);
      }
      return;
    }

    if (marqueeRef.current && p) {
      marqueeRef.current = { ...marqueeRef.current, x1: p.x, y1: p.y };
      setMarquee(marqueeRef.current);
      return;
    }

    const start = panRef.current;
    if (!start) return;
    if (Math.abs(e.clientX - start.x) > 3 || Math.abs(e.clientY - start.y) > 3) panMovedRef.current = true;
    const dx = (e.clientX - start.x) / pxPerUnit;
    const dy = (e.clientY - start.y) / pxPerUnit;
    setView({ ...start.view, x: start.view.x - dx, y: start.view.y - dy });
  }

  function endPointer(e: React.PointerEvent) {
    if (measuring) return;
    // RQ11: the drag is finished — if it actually moved an object that holds
    // stock, say plainly that the goods did not move with it.
    if (dragRef.current && dragStockRef.current) {
      const { start } = dragRef.current;
      const changed = Object.values(start).some((o) => {
        const now = objects.find((x) => x.id === o.id);
        return !!now && (now.x !== o.x || now.y !== o.y);
      });
      if (changed) setMovedStock(dragStockRef.current);
    }
    dragStockRef.current = null;
    // A background press that never moved is a click on empty space: deselect.
    if (panRef.current && !panMovedRef.current && !marqueeRef.current) onSelect([]);
    const m = marqueeRef.current;
    if (m) {
      const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1);
      const y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
      const hit = objects
        .filter((o) => o.x < x1 && o.x + o.width > x0 && o.y < y1 && o.y + o.height > y0)
        .map((o) => o.id);
      onSelect(hit);
    }
    dragRef.current = null;
    resizeRef.current = null;
    marqueeRef.current = null;
    panRef.current = null;
    setMarquee(null);
    setPanning(false);
    if ((e.currentTarget as Element).hasPointerCapture?.(e.pointerId)) {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    }
  }

  // Grid tiers are revealed by zoom, each once its own cell is wide enough to
  // read: 1 unit (1 m) from 7 px, and the 10 cm tier from 7 px per 0.1 unit.
  const showMinorGrid = pxPerUnit >= GRID_REVEAL_PX;
  const showFineGrid = pxPerUnit * SNAP_STEP >= GRID_REVEAL_PX;
  const majorStep = 5;
  const zoomPct = Math.round((pxPerUnit / (size.w / (layout.widthUnits + PAD * 2))) * 100);
  const ordered = [...objects].sort((a, b) => (a.zIndex - b.zIndex) || (a.displayOrder - b.displayOrder));
  const soleSelected = selectedIds.length === 1 ? objects.find((o) => o.id === selectedIds[0]) : null;
  const handleSize = 8 / Math.max(pxPerUnit, 0.001); // constant on-screen size
  const unitPx = 1 / Math.max(pxPerUnit, 0.001);     // one screen pixel, in grid units

  // ── Scale and ruler read-outs ──────────────────────────────────────────────

  const metresPerUnit = layout.metersPerUnit && layout.metersPerUnit > 0 ? layout.metersPerUnit : null;
  const sc = scaleReadout(pxPerUnit, metresPerUnit);
  const metres = (units: number) => units * (metresPerUnit ?? 1);
  const lengthLabel = (mValue: number) => (mValue < 1
    ? t(F.measure.cm, { value: fmt.number(mValue * 100, 0) })
    : t(F.measure.m, { value: fmt.number(mValue, 2) }));
  const scaleTitle = [
    t(F.scale.title, { meters: fmt.number(sc.metresPerScreenCm, 2) }),
    metresPerUnit ? '' : t(F.scale.assumed, { unit: layout.unitLabel }),
  ].filter(Boolean).join(' ');

  // RQ11: objects holding stock, labelled with how much, where there is room on
  // screen for the number. The colour fill already answers “which”; the badge
  // answers “how much”, and it is the only way a rack shows its roll-up.
  const stockBadges = ordered
    .map((o) => ({ o, s: stockByObject.get(o.id) }))
    .filter(({ o, s }) => !!s && s.items > 0 && o.width * pxPerUnit >= 44 && o.height * pxPerUnit >= 18);

  return (
    <div className="relative bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur">
        <button type="button" onClick={() => { setMeasuring((v) => !v); setMeasure(null); }}
          title={measuring ? F.measure.stop : F.measure.start} aria-label={measuring ? F.measure.stop : F.measure.start}
          aria-pressed={measuring}
          className={cn('h-7 w-7 grid place-items-center rounded-md',
            measuring ? 'bg-teal-50 text-teal-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')}>
          <Ruler className="h-4 w-4" />
        </button>
        <span className="h-5 w-px bg-slate-200" />
        <button onClick={() => zoomButton(1 / 1.25)} title={F.zoom.in} aria-label={F.zoom.in}
          className="h-7 w-7 grid place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900">
          <ZoomIn className="h-4 w-4" />
        </button>
        <button onClick={() => zoomButton(1.25)} title={F.zoom.out} aria-label={F.zoom.out}
          className="h-7 w-7 grid place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900">
          <ZoomOut className="h-4 w-4" />
        </button>
        <button onClick={() => setView(fitView(layout))} title={F.zoom.fit} aria-label={F.zoom.fit}
          className="h-7 w-7 grid place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900">
          <Maximize2 className="h-4 w-4" />
        </button>
        <span className="px-1.5 text-[11px] font-medium tabular-nums text-slate-400 select-none">{zoomPct}%</span>
      </div>

      {/* Ruler read-out. Separate from the plan so the figure stays legible at
          any zoom, and so it is still there when the two points are off-screen. */}
      {measuring && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2 rounded-lg border border-teal-200 bg-white/95 px-2.5 py-1.5 shadow-sm backdrop-blur">
          <Ruler className="h-3.5 w-3.5 flex-shrink-0 text-teal-700" />
          <span className="text-[11px] font-semibold tabular-nums text-teal-800">
            {measure ? lengthLabel(metres(planDistance(measure.a, measure.b))) : '—'}
          </span>
          {measure && (
            <button type="button" onClick={() => setMeasure(null)}
              className="text-[11px] text-slate-500 underline underline-offset-2 hover:text-slate-800">
              {F.measure.clear}
            </button>
          )}
        </div>
      )}

      {/* Shorter on phones so the plan and the panels below it both stay usable. */}
      <div ref={wrapRef} className="relative h-[340px] sm:h-[440px] lg:h-[560px] w-full">
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          preserveAspectRatio="xMidYMid meet"
          className={cn('h-full w-full touch-none select-none',
            measuring ? 'cursor-crosshair' : panning ? 'cursor-grabbing' : 'cursor-grab')}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          role="img"
          aria-label={`Floor plan: ${objects.length} object${objects.length === 1 ? '' : 's'} across ${layout.widthUnits} by ${layout.heightUnits} ${layout.unitLabel}`}
        >
          <defs>
            {/* 10 cm tier (RQ9). A tiled <pattern>, like the tiers above it, so a
                finer grid is one extra fill — not one DOM node per cell. */}
            <pattern id="fp-grid-fine" width={SNAP_STEP} height={SNAP_STEP} patternUnits="userSpaceOnUse">
              <path d={`M ${SNAP_STEP} 0 L 0 0 0 ${SNAP_STEP}`} fill="none" stroke="#eef2f6"
                strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
            </pattern>
            <pattern id="fp-grid-minor" width="1" height="1" patternUnits="userSpaceOnUse">
              {showFineGrid && <rect width="1" height="1" fill="url(#fp-grid-fine)" />}
              <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#e2e8f0" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
            </pattern>
            <pattern id="fp-grid-major" width={majorStep} height={majorStep} patternUnits="userSpaceOnUse">
              {showMinorGrid && <rect width={majorStep} height={majorStep} fill="url(#fp-grid-minor)" />}
              <path d={`M ${majorStep} 0 L 0 0 0 ${majorStep}`} fill="none" stroke="#cbd5e1" strokeWidth="0.9" vectorEffect="non-scaling-stroke" />
            </pattern>
          </defs>

          <rect x={0} y={0} width={layout.widthUnits} height={layout.heightUnits} fill="#fcfdfe" />
          <rect x={0} y={0} width={layout.widthUnits} height={layout.heightUnits} fill="url(#fp-grid-major)" />
          <rect x={0} y={0} width={layout.widthUnits} height={layout.heightUnits}
            fill="none" stroke="#64748b" strokeWidth={1.75} vectorEffect="non-scaling-stroke" />

          {ordered.map((obj) => (
            <LayoutObjectShape
              key={obj.id}
              obj={obj}
              selected={selectedIds.includes(obj.id)}
              pxPerUnit={pxPerUnit}
              occupancy={occupancyByObject?.get(obj.id)}
              onPointerDown={(e) => startObjectDrag(e, obj)}
              onSelect={() => onSelect([obj.id])}
            />
          ))}

          {/* RQ11 — “this holds stock right now”, rolled up for racks. Sized in
              screen pixels so it neither shrinks nor swamps the shape on zoom. */}
          {stockBadges.map(({ o, s }) => {
            const text = fmt.number(s!.items, 0);
            const h = 13 * unitPx;
            const pad = 3 * unitPx;
            const w = (12 + text.length * 6) * unitPx;
            return (
              <g key={`stock-${o.id}`} pointerEvents="none">
                <title>{t(F.stock.title, { items: fmt.number(s!.items, 0), quantity: fmt.number(s!.quantity, 0) })}</title>
                <rect x={o.x + o.width - w - pad} y={o.y + pad} width={w} height={h} rx={h / 2}
                  fill="#15803d" fillOpacity={0.9} />
                <text x={o.x + o.width - pad - w / 2} y={o.y + pad + h / 2}
                  textAnchor="middle" dominantBaseline="central"
                  fontSize={9 * unitPx} fontWeight={700} fill="#ffffff" style={{ fontFamily: 'inherit' }}>
                  {text}
                </text>
              </g>
            );
          })}

          {/* Resize handles — single selection only, to keep the gesture unambiguous */}
          {editable && soleSelected && HANDLES.map((h) => (
            <rect
              key={h.id}
              x={soleSelected.x + soleSelected.width * h.fx - handleSize / 2}
              y={soleSelected.y + soleSelected.height * h.fy - handleSize / 2}
              width={handleSize} height={handleSize}
              fill="#ffffff" stroke="#15803d" strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              style={{ cursor: h.cursor }}
              onPointerDown={(e) => startResize(e, h.id, soleSelected)}
            />
          ))}

          {marquee && (
            <rect
              x={Math.min(marquee.x0, marquee.x1)} y={Math.min(marquee.y0, marquee.y1)}
              width={Math.abs(marquee.x1 - marquee.x0)} height={Math.abs(marquee.y1 - marquee.y0)}
              fill="#15803d" fillOpacity={0.08} stroke="#15803d" strokeWidth={1}
              strokeDasharray="4 3" vectorEffect="non-scaling-stroke" pointerEvents="none"
            />
          )}

          {/* The measured line, drawn above the objects it spans. */}
          {measure && (
            <g pointerEvents="none">
              <line x1={measure.a[0]} y1={measure.a[1]} x2={measure.b[0]} y2={measure.b[1]}
                stroke="#0f766e" strokeWidth={1.75} strokeDasharray="6 3" vectorEffect="non-scaling-stroke" />
              {[measure.a, measure.b].map((p, i) => (
                <circle key={i} cx={p[0]} cy={p[1]} r={4 * unitPx}
                  fill="#ffffff" stroke="#0f766e" strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          )}

          {/* Ruler capture layer. Last child, so it is above every shape and
              handle: while the ruler is on, nothing can be drawn or dragged. */}
          {measuring && (
            <rect x={view.x} y={view.y} width={view.w} height={view.h}
              fill="transparent" style={{ cursor: 'crosshair' }}
              onPointerDown={measureDown} onPointerMove={measureMove} />
          )}
        </svg>

        {/* Scale indicator (RQ12). Recomputed from pxPerUnit on every render, so
            it stays true at any zoom. Inside the plan box, so the notice below
            the footer cannot push it over the drawing. */}
        <div className="absolute bottom-3 left-3 select-none rounded-lg border border-slate-200 bg-white/90 px-2 py-1.5 shadow-sm backdrop-blur"
          title={scaleTitle}>
          <p className="text-[10px] font-semibold tracking-wide text-slate-500">
            {t(F.scale.ratio, { ratio: fmt.number(sc.ratio, 0) })}
          </p>
          <div className="mt-1 flex items-end gap-1.5">
            <div className="relative h-2" style={{ width: `${Math.round(sc.barPx)}px` }} role="img" aria-label={F.scale.bar}>
              <div className="absolute inset-x-0 bottom-0 h-px bg-slate-400" />
              <div className="absolute bottom-0 left-0 h-2 w-px bg-slate-400" />
              <div className="absolute bottom-0 left-1/2 h-1.5 w-px bg-slate-300" />
              <div className="absolute bottom-0 right-0 h-2 w-px bg-slate-400" />
            </div>
            <span className="text-[10px] leading-none tabular-nums text-slate-500">{lengthLabel(sc.barMetres)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
        <span className={cn(measuring && 'font-medium text-teal-700')}>
          {measuring ? F.measure.banner : (editable ? F.hints.edit : F.hints.view)}
        </span>
        <span className="tabular-nums">
          {layout.widthUnits} × {layout.heightUnits} {layout.unitLabel} · {objects.length} object{objects.length === 1 ? '' : 's'}
          {stockBadges.length > 0 ? ` · ${t(F.stock.footer, { count: fmt.number(stockBadges.length, 0) })}` : ''}
          {selectedIds.length > 1 ? ` · ${selectedIds.length} selected` : ''}
        </span>
      </div>

      {/* RQ11 — dragging a full rack is allowed (decision C5: the plan is a
          drawing). What is NOT allowed is letting the user believe the goods
          followed. So: say it, and point at the screen that really moves stock. */}
      {movedStock && (
        <div className="flex items-start gap-2 border-t border-amber-200 bg-amber-50 px-4 py-2.5 text-[11px] text-amber-900">
          <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{F.moved.title}</p>
            <p className="mt-0.5 leading-relaxed">
              {t(F.moved.body, { name: movedStock.name, items: fmt.number(movedStock.items, 0) })}
            </p>
            <Link href="/relocation"
              className="mt-1 inline-block font-semibold underline underline-offset-2 hover:text-amber-950">
              {t(F.moved.cta, { screen: m.nav.items.relocation })}
            </Link>
          </div>
          <button type="button" onClick={() => setMovedStock(null)}
            title={F.moved.dismiss} aria-label={F.moved.dismiss}
            className="flex-shrink-0 rounded p-0.5 text-amber-700 hover:bg-amber-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
