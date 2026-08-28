'use client';

// 2D floor-plan canvas. Read-only by default (Sprint 4); when `editable` is set
// it also supports drag, resize, marquee multi-select and snap-to-grid (Sprint 5).
//
// SVG rather than <canvas>: pan/zoom come free from the viewBox, and every
// object stays a real DOM node, so focus, keyboard access and hit-testing work
// without a picking layer. A floor plan is hundreds of rects, not thousands.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import type { LayoutObject, WarehouseLayout, LayoutOccupancy } from '@/lib/api';
import { LayoutObjectShape } from './layout-object';
import { cn } from '@/lib/utils';

interface View { x: number; y: number; w: number; h: number }
type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const PAD = 2;
const MIN_SPAN = 4;
const MAX_SPAN_MULT = 3;
const MIN_SIZE = 0.5; // smallest object, in grid units

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
  editable = false, snapEnabled = true, onCheckpoint, onPatch, occupancyByObject,
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
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(() => fitView(layout));
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [panning, setPanning] = useState(false);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const panRef = useRef<{ x: number; y: number; view: View } | null>(null);
  const dragRef = useRef<{ ox: number; oy: number; start: Record<string, LayoutObject> } | null>(null);
  const resizeRef = useRef<{ handle: HandleId; ox: number; oy: number; start: LayoutObject } | null>(null);
  // The marquee lives in a ref as well as state: state drives the rendering,
  // but pointerup must read the ref — on a fast drag, pointerup can land before
  // React has re-rendered, and reading state there would drop the selection.
  const marqueeRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const panMovedRef = useRef(false);

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

  const pxPerUnit = Math.min(size.w / view.w, size.h / view.h);

  const toUser = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, []);

  const snapVal = useCallback((n: number) => (snapEnabled ? Math.round(n) : Math.round(n * 100) / 100), [snapEnabled]);

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
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
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

  const showMinorGrid = pxPerUnit >= 7;
  const majorStep = 5;
  const zoomPct = Math.round((pxPerUnit / (size.w / (layout.widthUnits + PAD * 2))) * 100);
  const ordered = [...objects].sort((a, b) => (a.zIndex - b.zIndex) || (a.displayOrder - b.displayOrder));
  const soleSelected = selectedIds.length === 1 ? objects.find((o) => o.id === selectedIds[0]) : null;
  const handleSize = 8 / Math.max(pxPerUnit, 0.001); // constant on-screen size

  return (
    <div className="relative bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur">
        <button onClick={() => zoomButton(1 / 1.25)} title="Zoom in"
          className="h-7 w-7 grid place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900">
          <ZoomIn className="h-4 w-4" />
        </button>
        <button onClick={() => zoomButton(1.25)} title="Zoom out"
          className="h-7 w-7 grid place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900">
          <ZoomOut className="h-4 w-4" />
        </button>
        <button onClick={() => setView(fitView(layout))} title="Fit to floor"
          className="h-7 w-7 grid place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900">
          <Maximize2 className="h-4 w-4" />
        </button>
        <span className="px-1.5 text-[11px] font-medium tabular-nums text-slate-400 select-none">{zoomPct}%</span>
      </div>

      {/* Shorter on phones so the plan and the panels below it both stay usable. */}
      <div ref={wrapRef} className="h-[340px] sm:h-[440px] lg:h-[560px] w-full">
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          preserveAspectRatio="xMidYMid meet"
          className={cn('h-full w-full touch-none select-none', panning ? 'cursor-grabbing' : 'cursor-grab')}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          role="img"
          aria-label={`Floor plan: ${objects.length} object${objects.length === 1 ? '' : 's'} across ${layout.widthUnits} by ${layout.heightUnits} ${layout.unitLabel}`}
        >
          <defs>
            <pattern id="fp-grid-minor" width="1" height="1" patternUnits="userSpaceOnUse">
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
        </svg>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
        <span>
          {editable
            ? 'Drag to move · shift-drag empty space to marquee-select · shift-click to add to selection'
            : 'Drag to pan · scroll to zoom · click an object to inspect it'}
        </span>
        <span className="tabular-nums">
          {layout.widthUnits} × {layout.heightUnits} {layout.unitLabel} · {objects.length} object{objects.length === 1 ? '' : 's'}
          {selectedIds.length > 1 ? ` · ${selectedIds.length} selected` : ''}
        </span>
      </div>
    </div>
  );
}
