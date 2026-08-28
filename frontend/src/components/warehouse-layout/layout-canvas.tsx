'use client';

// Read-only 2D floor-plan canvas (Sprint 4): pan, zoom, grid, select.
// No editing — dragging, resizing and creating objects arrive in Sprint 5.
//
// SVG rather than <canvas>: pan/zoom come free from the viewBox, and every
// object stays a real DOM node, so focus, keyboard access and hit-testing work
// without a picking layer. A floor plan is hundreds of rects, not thousands.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import type { LayoutObject, WarehouseLayout } from '@/lib/api';
import { LayoutObjectShape } from './layout-object';
import { cn } from '@/lib/utils';

interface View { x: number; y: number; w: number; h: number }

const PAD = 2;          // grid units of breathing room around the floor
const MIN_SPAN = 4;     // furthest zoom in
const MAX_SPAN_MULT = 3; // furthest zoom out, relative to floor width

function fitView(layout: WarehouseLayout): View {
  return {
    x: -PAD, y: -PAD,
    w: layout.widthUnits + PAD * 2,
    h: layout.heightUnits + PAD * 2,
  };
}

export function LayoutCanvas({ layout, objects, selectedId, onSelect }: {
  layout: WarehouseLayout;
  objects: LayoutObject[];
  selectedId: string | null;
  onSelect: (obj: LayoutObject | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(() => fitView(layout));
  const [size, setSize] = useState({ w: 800, h: 520 });
  const panRef = useRef<{ x: number; y: number; view: View } | null>(null);
  const [panning, setPanning] = useState(false);

  // Track the rendered box so we can report px-per-unit to children.
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

  // Re-fit when the canvas extent itself changes.
  useEffect(() => { setView(fitView(layout)); }, [layout.id, layout.widthUnits, layout.heightUnits]); // eslint-disable-line

  // preserveAspectRatio="meet" letterboxes, so the effective scale is the
  // smaller of the two axes.
  const pxPerUnit = Math.min(size.w / view.w, size.h / view.h);

  // Exact screen → user-space conversion; honours preserveAspectRatio for us.
  const toUser = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, []);

  const zoomAround = useCallback((ux: number, uy: number, k: number) => {
    setView((v) => {
      const maxSpan = layout.widthUnits * MAX_SPAN_MULT;
      const nextW = Math.min(Math.max(v.w * k, MIN_SPAN), maxSpan);
      const actual = nextW / v.w; // k after clamping
      return {
        w: nextW,
        h: v.h * actual,
        x: ux - (ux - v.x) * actual,
        y: uy - (uy - v.y) * actual,
      };
    });
  }, [layout.widthUnits]);

  function onWheel(e: React.WheelEvent) {
    const p = toUser(e.clientX, e.clientY);
    if (!p) return;
    zoomAround(p.x, p.y, e.deltaY > 0 ? 1.12 : 1 / 1.12);
  }

  const zoomButton = (k: number) => zoomAround(view.x + view.w / 2, view.y + view.h / 2, k);

  // Pan on background drag only; objects stop propagation so a click selects.
  function onPointerDown(e: React.PointerEvent) {
    onSelect(null);
    panRef.current = { x: e.clientX, y: e.clientY, view };
    setPanning(true);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const start = panRef.current;
    if (!start) return;
    const dx = (e.clientX - start.x) / pxPerUnit;
    const dy = (e.clientY - start.y) / pxPerUnit;
    setView({ ...start.view, x: start.view.x - dx, y: start.view.y - dy });
  }
  function endPan(e: React.PointerEvent) {
    panRef.current = null;
    setPanning(false);
    if ((e.currentTarget as Element).hasPointerCapture?.(e.pointerId)) {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onSelect(null); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSelect]);

  // Minor grid lines vanish when they'd be denser than the eye can use.
  const showMinorGrid = pxPerUnit >= 7;
  const majorStep = 5;
  const zoomPct = Math.round((pxPerUnit / (size.w / (layout.widthUnits + PAD * 2))) * 100);

  // Paint parents before children so containers sit behind their contents.
  const ordered = [...objects].sort((a, b) => (a.zIndex - b.zIndex) || (a.displayOrder - b.displayOrder));

  return (
    <div className="relative bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      {/* Canvas toolbar — view controls only; no editing tools in Sprint 4 */}
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

      <div ref={wrapRef} className="h-[560px] w-full">
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          preserveAspectRatio="xMidYMid meet"
          className={cn('h-full w-full touch-none select-none', panning ? 'cursor-grabbing' : 'cursor-grab')}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
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

          {/* Floor footprint */}
          <rect x={0} y={0} width={layout.widthUnits} height={layout.heightUnits} fill="#fcfdfe" />
          <rect x={0} y={0} width={layout.widthUnits} height={layout.heightUnits} fill="url(#fp-grid-major)" />
          <rect
            x={0} y={0} width={layout.widthUnits} height={layout.heightUnits}
            fill="none" stroke="#64748b" strokeWidth={1.75} vectorEffect="non-scaling-stroke"
          />

          {ordered.map((obj) => (
            <LayoutObjectShape
              key={obj.id}
              obj={obj}
              selected={obj.id === selectedId}
              pxPerUnit={pxPerUnit}
              onSelect={onSelect}
            />
          ))}
        </svg>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
        <span>Drag to pan · scroll to zoom · click an object to inspect it</span>
        <span className="tabular-nums">
          {layout.widthUnits} × {layout.heightUnits} {layout.unitLabel} · {objects.length} object{objects.length === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}
