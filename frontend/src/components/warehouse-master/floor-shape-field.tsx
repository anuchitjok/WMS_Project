'use client';

// F2 — floor shape picker for the warehouse form: Rectangle / L / U / T with a
// few numbers each, a north-up SVG preview and the real floor area (decision D3).
// Length × width in the form stay the outer box; the API checks the shape again.

import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import {
  bbox, edgeLengths, polygonArea, templateErrors, templatePoints,
  type Corner, type FloorOutline, type Pt, type Side, type TemplateError, type TemplateInput,
} from '@/components/warehouse-layout/floor-geometry';
import { Field, selectClass } from './shared';

export type PickShape = 'RECT' | 'L' | 'U' | 'T' | 'CUSTOM';
export const PICK_SHAPES: Exclude<PickShape, 'CUSTOM'>[] = ['RECT', 'L', 'U', 'T'];
const CORNERS: Corner[] = ['NW', 'NE', 'SE', 'SW'];
const SIDES: Side[] = ['N', 'E', 'S', 'W'];

/** Form state: numbers kept as typed text (metres). */
export interface ShapeState {
  shape: PickShape;
  cutLength: string; cutWidth: string; corner: Corner;
  gap: string; depth: string; side: Side;
  barDepth: string; stemWidth: string; barSide: Side;
}

const txt = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
const third = (n: number | undefined) => (n && n > 0 ? String(Math.round((n / 3) * 10) / 10) : '');

/** Reopen the form the way the shape was made (params saved with the outline). */
export function initialShapeState(outline: Partial<FloorOutline> | null | undefined): ShapeState {
  const p = (outline?.params ?? {}) as Record<string, unknown>;
  const shape: PickShape = !outline ? 'RECT' : (['L', 'U', 'T'].includes(outline.shape as string) ? outline.shape as PickShape : 'CUSTOM');
  return {
    shape,
    cutLength: shape === 'L' ? txt(p.cutLength) : '', cutWidth: shape === 'L' ? txt(p.cutWidth) : '',
    corner: shape === 'L' && CORNERS.includes(p.corner as Corner) ? p.corner as Corner : 'SE',
    gap: shape === 'U' ? txt(p.gap) : '', depth: shape === 'U' ? txt(p.depth) : '',
    side: shape === 'U' && SIDES.includes(p.side as Side) ? p.side as Side : 'S',
    barDepth: shape === 'T' ? txt(p.barDepth) : '', stemWidth: shape === 'T' ? txt(p.stemWidth) : '',
    barSide: shape === 'T' && SIDES.includes(p.side as Side) ? p.side as Side : 'N',
  };
}

/** The template for the API helpers, or null for Rectangle / a custom shape kept as is. */
export function shapeTemplate(s: ShapeState, length: number | undefined, width: number | undefined): TemplateInput | null {
  const L = length ?? NaN, W = width ?? NaN;
  switch (s.shape) {
    case 'L': return { shape: 'L', length: L, width: W, cutLength: num(s.cutLength), cutWidth: num(s.cutWidth), corner: s.corner };
    case 'U': return { shape: 'U', length: L, width: W, gap: num(s.gap), depth: num(s.depth), side: s.side };
    case 'T': return { shape: 'T', length: L, width: W, barDepth: num(s.barDepth), stemWidth: num(s.stemWidth), side: s.barSide };
    default: return null;
  }
}

/** Points + area for the preview, or the template's errors. */
export function shapeResult(s: ShapeState, length: number | undefined, width: number | undefined):
  { points: Pt[] | null; area: number | null; errors: TemplateError[] } {
  const tpl = shapeTemplate(s, length, width);
  if (!tpl) {
    const ok = !!length && !!width && length > 0 && width > 0;
    return { points: ok ? [[0, 0], [length!, 0], [length!, width!], [0, width!]] : null, area: ok ? length! * width! : null, errors: [] };
  }
  const errors = templateErrors(tpl);
  if (errors.length) return { points: null, area: null, errors };
  const points = templatePoints(tpl);
  return { points, area: polygonArea(points), errors };
}

export function FloorShapeField({ value, onChange, length, width, customPoints }: {
  value: ShapeState;
  onChange: (next: ShapeState) => void;
  /** Outer box in metres (the form's length × width). */
  length: number | undefined;
  width: number | undefined;
  /** Saved points when the shape is CUSTOM (kept as is, shown only). */
  customPoints?: Pt[] | null;
}) {
  const { m, t, fmt } = useT();
  const f = m.warehouseMaster.floorShape;
  const set = (patch: Partial<ShapeState>) => onChange({ ...value, ...patch });
  const res = value.shape === 'CUSTOM'
    ? { points: customPoints ?? null, area: customPoints ? polygonArea(customPoints) : null, errors: [] as TemplateError[] }
    : shapeResult(value, length, width);

  // Picking a shape fills sensible starting numbers (a third of the box) when empty.
  function pick(shape: Exclude<PickShape, 'CUSTOM'>) {
    const next: ShapeState = { ...value, shape };
    if (shape === 'L') { next.cutLength ||= third(length); next.cutWidth ||= third(width); }
    if (shape === 'U') { next.gap ||= third(length); next.depth ||= third(width); }
    if (shape === 'T') { next.stemWidth ||= third(length); next.barDepth ||= third(width); }
    onChange(next);
  }

  const numField = (k: 'cutLength' | 'cutWidth' | 'gap' | 'depth' | 'barDepth' | 'stemWidth') => (
    <Field label={f[k]}>
      <Input type="number" min={0} step="any" inputMode="decimal" value={value[k]} onChange={(e) => set({ [k]: e.target.value } as Partial<ShapeState>)} />
    </Field>
  );
  const sideSelect = (k: 'side' | 'barSide', label: string) => (
    <Field label={label}>
      <select className={selectClass} value={value[k]} onChange={(e) => set({ [k]: e.target.value as Side } as Partial<ShapeState>)}>
        {SIDES.map((s) => <option key={s} value={s}>{f[s]}</option>)}
      </select>
    </Field>
  );

  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{f.label}</p>
      <p className="mb-2 text-xs text-slate-400">{f.hint}</p>
      <div role="radiogroup" aria-label={f.label} className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-white p-0.5">
        {PICK_SHAPES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={value.shape === s} onClick={() => pick(s)}
            className={cn('px-3 py-1.5 text-sm rounded-md transition-colors',
              value.shape === s ? 'bg-green-600 text-white' : 'text-slate-600 hover:bg-slate-50')}>
            {f[s]}
          </button>
        ))}
      </div>

      {value.shape === 'CUSTOM' && <p className="mt-2 text-xs text-slate-500">{f.custom}</p>}
      {value.shape === 'L' && (
        <div className="mt-3 grid grid-cols-3 gap-3">
          {numField('cutLength')}{numField('cutWidth')}
          <Field label={f.corner}>
            <select className={selectClass} value={value.corner} onChange={(e) => set({ corner: e.target.value as Corner })}>
              {CORNERS.map((c) => <option key={c} value={c}>{f[c]}</option>)}
            </select>
          </Field>
        </div>
      )}
      {value.shape === 'U' && <div className="mt-3 grid grid-cols-3 gap-3">{numField('gap')}{numField('depth')}{sideSelect('side', f.side)}</div>}
      {value.shape === 'T' && <div className="mt-3 grid grid-cols-3 gap-3">{numField('stemWidth')}{numField('barDepth')}{sideSelect('barSide', f.barSide)}</div>}

      <div className="mt-3 flex items-start gap-3">
        <ShapePreview points={res.points} label={f.previewLabel} north={f.north} />
        <div className="min-w-0 flex-1 text-sm">
          {res.errors.length > 0 ? (
            <ul className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 list-disc pl-6" role="status">
              {[...new Set(res.errors)].map((e) => <li key={e}>{f.err[e]}</li>)}
            </ul>
          ) : res.area != null && length && width ? (
            <p className="text-slate-600">{t(f.area, { area: fmt.number(res.area), box: fmt.number(length * width) })}</p>
          ) : res.area != null ? (
            <p className="text-slate-600">{t(f.area, { area: fmt.number(res.area), box: '—' })}</p>
          ) : (
            <p className="text-slate-400">{f.needSize}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Small north-up drawing of the floor with the length of each side. */
export function ShapePreview({ points, label, north, size = 132 }: { points: Pt[] | null; label: string; north: string; size?: number }) {
  if (!points) {
    return <div className="shrink-0 rounded-lg border border-dashed border-slate-200 bg-slate-50" style={{ width: size, height: size }} aria-hidden />;
  }
  const b = bbox(points);
  const pad = 18;
  const scale = (size - pad * 2) / Math.max(b.length, b.width, 1e-6);
  const ox = pad + ((size - pad * 2) - b.length * scale) / 2, oz = pad + ((size - pad * 2) - b.width * scale) / 2;
  const P = ([x, z]: Pt) => [ox + (x - b.minX) * scale, oz + (z - b.minZ) * scale] as const;
  const lens = edgeLengths(points);
  const cx = points.reduce((a, p) => a + p[0], 0) / points.length, cz = points.reduce((a, p) => a + p[1], 0) / points.length;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="shrink-0 rounded-lg border border-slate-200 bg-white">
      <polygon points={points.map((p) => P(p).join(',')).join(' ')} fill="#f0fdf4" stroke="#16a34a" strokeWidth={1.5} strokeLinejoin="round" />
      {points.map((p, i) => {
        const q = points[(i + 1) % points.length];
        const len = lens[i];
        if (len * scale < 16) return null; // too short to label
        const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
        // push the label away from the middle of the shape
        const dx = mx - cx, dz = mz - cz, d = Math.hypot(dx, dz) || 1;
        const [sx, sz] = P([mx, mz]);
        return (
          <text key={i} x={sx + (dx / d) * 8} y={sz + (dz / d) * 8 + 3} textAnchor="middle" fontSize={9} fill="#475569">
            {Math.round(len * 10) / 10}
          </text>
        );
      })}
      <text x={size - 8} y={11} textAnchor="end" fontSize={9} fontWeight={600} fill="#94a3b8">↑ {north}</text>
    </svg>
  );
}
