'use client';

// Controls drawn on top of the 3D canvas: camera presets and buttons, minimap,
// colour legend. UI only — they talk to the scene through SceneApi.

import { useRef, type ReactNode } from 'react';
import {
  Box, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Plus, Minus, RotateCcw, Maximize, Minimize,
  Maximize2, Minimize2, Crosshair, Columns3, Grid2x2, PanelTop, Loader2, Activity, BarChart3, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import {
  type Scene3D, type ViewMode, type Band, type SlotState3D,
  rackCorners, STATE_3D, STATE_ORDER, FILL_BANDS, AGE_BANDS, NO_AGE_COLOR, PALLET_COLOR,
} from './scene-geometry';
import type { SceneApi, CameraInfo, CameraPreset } from './scene-3d';

const card = 'rounded-xl border border-white bg-white/95 shadow-md ring-1 ring-slate-200';
const iconBtn = 'grid place-items-center text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-600';

// ─── Camera presets (top-left) ────────────────────────────────────────────────

const PRESETS: { id: CameraPreset; icon: React.ElementType }[] = [
  { id: 'iso', icon: Box },
  { id: 'top', icon: Grid2x2 },
  { id: 'front', icon: PanelTop },
];

export function CameraPresets({ active, onPick, top = 12, children }: {
  active: CameraPreset | null; onPick: (p: CameraPreset) => void;
  /** Distance from the top of the stage (px): below the floating filter bar when it is in the scene. */
  top?: number;
  children?: ReactNode;
}) {
  const { m } = useT();
  const C = m.layout3d.w3d.camera;
  return (
    <div className="absolute left-3 z-40 flex flex-col items-start gap-2" style={{ top }}>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" onClick={() => onPick(p.id)} aria-pressed={active === p.id}
            className={cn('inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium shadow-md ring-1 transition-colors',
              active === p.id ? 'bg-emerald-700 text-white ring-emerald-700' : 'bg-white/95 text-slate-700 ring-slate-200 hover:bg-white')}>
            <p.icon className="h-4 w-4" /> {C[p.id]}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}

// ─── Camera buttons (top-right) ───────────────────────────────────────────────

export function ViewControls({ api, onReset, hasSelection, fullscreen, onFullscreen, top = 12 }: {
  api: React.RefObject<SceneApi | null>;
  /** Start view; also leaves any rack / zone focus. */
  onReset: () => void;
  hasSelection: boolean;
  fullscreen: boolean;
  onFullscreen: () => void;
  /** Distance from the top of the stage (px). */
  top?: number;
}) {
  const { m } = useT();
  const C = m.layout3d.controls, W = m.layout3d.w3d.camera;
  const STEP = Math.PI / 12;
  const b = (label: string, onClick: () => void, icon: ReactNode, disabled = false) => (
    <button type="button" className={cn(iconBtn, 'h-9 w-9')} onClick={onClick} aria-label={label} title={label} disabled={disabled}>{icon}</button>
  );
  return (
    <div className="absolute right-3 z-40 flex flex-col items-center gap-2" style={{ top }}>
      <div className={cn('relative h-[76px] w-[76px] !rounded-full', card)} role="group" aria-label={C.rotateView}>
        <button type="button" className={cn(iconBtn, 'absolute left-1/2 top-1 h-6 w-6 -translate-x-1/2 rounded-full')} onClick={() => api.current?.rotate(0, -STEP)} aria-label={C.tiltUp} title={C.tiltUp}><ChevronUp className="h-4 w-4" /></button>
        <button type="button" className={cn(iconBtn, 'absolute bottom-1 left-1/2 h-6 w-6 -translate-x-1/2 rounded-full')} onClick={() => api.current?.rotate(0, STEP)} aria-label={C.tiltDown} title={C.tiltDown}><ChevronDown className="h-4 w-4" /></button>
        <button type="button" className={cn(iconBtn, 'absolute left-1 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full')} onClick={() => api.current?.rotate(-STEP, 0)} aria-label={C.rotateLeft} title={C.rotateLeft}><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" className={cn(iconBtn, 'absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full')} onClick={() => api.current?.rotate(STEP, 0)} aria-label={C.rotateRight} title={C.rotateRight}><ChevronRight className="h-4 w-4" /></button>
        <span className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-300" />
      </div>
      <div className={cn('flex flex-col overflow-hidden', card)}>
        {b(C.zoomIn, () => api.current?.zoom(0.75), <Plus className="h-4 w-4" />)}
        <span className="h-px bg-slate-200" />
        {b(C.zoomOut, () => api.current?.zoom(1.33), <Minus className="h-4 w-4" />)}
      </div>
      <div className={cn('flex flex-col overflow-hidden', card)}>
        {b(W.focusRack, () => api.current?.focusSelectedRack(), <Columns3 className="h-4 w-4" />, !hasSelection)}
        <span className="h-px bg-slate-200" />
        {b(W.focusSlot, () => api.current?.focusSelectedSlot(), <Crosshair className="h-4 w-4" />, !hasSelection)}
        <span className="h-px bg-slate-200" />
        {b(W.reset, onReset, <RotateCcw className="h-4 w-4" />)}
        <span className="h-px bg-slate-200" />
        {b(fullscreen ? W.exitFullscreen : W.fullscreen, onFullscreen, fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />)}
      </div>
    </div>
  );
}

// ─── Minimap (bottom-left) ────────────────────────────────────────────────────

export function Minimap({ scene, active, camera, selected, expanded, onToggle, onPick }: {
  scene: Scene3D; active: Set<string> | null; camera: CameraInfo | null;
  selected: [number, number] | null;
  expanded: boolean; onToggle: () => void; onPick: (x: number, z: number) => void;
}) {
  const { m: msg } = useT();
  const C = msg.layout3d.controls;
  const svgRef = useRef<SVGSVGElement>(null);
  const b = scene.bounds;
  const mg = 2.5;
  const minX = Math.min(b.minX, ...scene.areas.map((a) => a.minX)), maxX = Math.max(b.maxX, ...scene.areas.map((a) => a.maxX));
  const minZ = Math.min(b.minZ, ...scene.areas.map((a) => a.minZ)), maxZ = Math.max(b.maxZ, ...scene.areas.map((a) => a.maxZ));
  const vb = { x: minX - mg, y: minZ - mg, w: maxX - minX + mg * 2, h: maxZ - minZ + mg * 2 };
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
    <div className={cn('absolute bottom-3 left-3 z-40 hidden p-1.5 sm:block', card)}>
      <svg ref={svgRef} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet"
        className={cn('block cursor-crosshair rounded-lg bg-slate-50 transition-[width,height]', expanded ? 'h-44 w-60 sm:h-56 sm:w-80' : 'h-24 w-32 sm:h-28 sm:w-40')}
        onClick={click} role="img" aria-label={C.minimapAria}>
        {scene.areas.map((a) => (
          <rect key={a.id} x={a.minX} y={a.minZ} width={a.maxX - a.minX} height={a.maxZ - a.minZ}
            fill="#fefce8" stroke="#eab308" strokeWidth={unit * 0.25} strokeDasharray={`${unit} ${unit * 0.7}`} />
        ))}
        {scene.zones.map((z) => (
          <rect key={z.zone} x={z.minX} y={z.minZ} width={z.maxX - z.minX} height={z.maxZ - z.minZ}
            fill="#f1f5f9" stroke="#94a3b8" strokeWidth={unit * 0.25} strokeDasharray={`${unit} ${unit * 0.7}`} />
        ))}
        {scene.racks.map((p) => {
          const on = !active || active.has(p.rack.id);
          return (
            <polygon key={p.rack.id} points={rackCorners(p).map(([x, z]) => `${x},${z}`).join(' ')}
              fill={!on ? '#e2e8f0' : p.kind === 'floor' ? '#fef08a' : '#bfdbfe'} stroke={!on ? '#cbd5e1' : p.kind === 'floor' ? '#ca8a04' : '#1d4ed8'} strokeWidth={unit * 0.3} />
          );
        })}
        {selected && <circle cx={selected[0]} cy={selected[1]} r={unit * 1.4} fill="#22d3ee" stroke="#fff" strokeWidth={unit * 0.5} pointerEvents="none" />}
        {cam}
      </svg>
      <button type="button" onClick={onToggle} aria-label={expanded ? C.shrinkMinimap : C.expandMinimap}
        className="absolute bottom-2.5 right-2.5 grid h-6 w-6 place-items-center rounded-md bg-white/95 text-slate-500 shadow-sm ring-1 ring-slate-200 hover:text-emerald-700">
        {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// ─── Legend + colour-by switch (bottom-right) ─────────────────────────────────

const MODES: { id: ViewMode; icon: React.ElementType }[] = [
  { id: 'status', icon: Activity },
  { id: 'fill', icon: BarChart3 },
  { id: 'age', icon: Clock },
];

function Swatch({ color, label, count }: { color: string; label: string; count?: number }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-600">
      <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full ring-1 ring-black/10" style={{ background: color }} />{label}
      {count != null && <span className="tabular-nums text-slate-400">{count.toLocaleString()}</span>}
    </span>
  );
}

export function Legend({ mode, onMode, counts, ageState, onRetryAge, hideBoxes, onHideBoxes }: {
  mode: ViewMode; onMode: (m: ViewMode) => void;
  counts: Record<SlotState3D, number>;
  ageState: 'idle' | 'loading' | 'error' | 'ready';
  onRetryAge: () => void;
  /** Status mode: hide pallets / cartons so the status colours read on their own. */
  hideBoxes?: boolean;
  onHideBoxes?: (v: boolean) => void;
}) {
  const { m } = useT();
  const L = m.layout3d.legend, W = m.layout3d.w3d;
  const B = m.layout3d.bands as Record<string, string>;
  let body: ReactNode;
  if (mode === 'status') {
    body = (
      <>
        {STATE_ORDER.map((k) => <Swatch key={k} color={STATE_3D[k].color} label={W.status[k]} count={counts[k]} />)}
        {onHideBoxes && (
          <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs text-slate-600">
            <input type="checkbox" checked={!!hideBoxes} onChange={(e) => onHideBoxes(e.target.checked)} className="h-3.5 w-3.5 accent-emerald-700" />
            {L.hideBoxes}
          </label>
        )}
      </>
    );
  } else if (mode === 'age' && ageState === 'loading') {
    body = <span className="flex items-center gap-1.5 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {L.loadingAge}</span>;
  } else if (mode === 'age' && ageState === 'error') {
    body = <span className="flex items-center gap-2 text-xs text-red-600">{L.ageError}<button type="button" onClick={onRetryAge} className="font-medium underline">{L.retry}</button></span>;
  } else {
    const bands: Band[] = mode === 'fill' ? FILL_BANDS : [...AGE_BANDS, { key: 'noDate', label: L.noDate, color: NO_AGE_COLOR }];
    body = [{ key: 'empty', label: L.empty, color: PALLET_COLOR }, ...bands, { key: 'blocked', label: W.status.blocked, color: STATE_3D.blocked.color }]
      .map((b) => <Swatch key={b.key} color={b.color} label={B[b.key] ?? b.label} />);
  }
  return (
    <div className={cn('absolute bottom-3 right-3 z-40 max-w-[calc(100%-1.5rem)] px-3 py-2 sm:max-w-[calc(100%-13rem)]', card)}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-xs text-slate-500">{W.colorBy}</span>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="radiogroup" aria-label={m.layout3d.modes.aria}>
          {MODES.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={mode === x.id} onClick={() => onMode(x.id)}
              className={cn('flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors',
                mode === x.id ? 'bg-white font-medium text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
              <x.icon className="h-3.5 w-3.5" /> {m.layout3d.modes[x.id]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">{body}</div>
    </div>
  );
}
