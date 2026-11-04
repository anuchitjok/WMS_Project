'use client';

// Lightweight SVG charts for the Operations Control Tower (no chart library).
// Colours: categorical slots validated for colour-vision deficiency (dataviz
// validator, light surface). Identity is never colour-only: every chart has a
// legend, hover tooltips, and a table view where the values aren't printed.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Flow series — fixed order, never cycled: receiving, putaway, fulfillment, shipment. */
export const FLOW_COLORS = {
  receiving: '#2a78d6',
  putaway: '#eb6834',
  fulfillment: '#1baf7a',
  shipment: '#eda100',
} as const;

/** Inventory status slots (validated as a set in this order). */
export const STOCK_COLORS = {
  available: '#1baf7a',
  reserved: '#2a78d6',
  picked: '#e87ba4',
  qcHold: '#eda100',
  rtvPending: '#e34948',
} as const;

const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Tracks an element's content width so SVG text stays crisp at any size. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useIso(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** 0, then 3–5 round steps covering `max`. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1000) / 1000);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/** Bar with 4px rounded data-end, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export interface Series { key: string; label: string; color: string }

export function Legend({ series, className }: { series: Series[]; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1', className)}>
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5 text-xs text-slate-600">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

export function ChartTooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  // Flip to the left of the cursor near the right edge.
  const left = x > width - 180 ? x - 12 : x + 12;
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-[150px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
      style={{ left, top: Math.max(0, y), transform: x > width - 180 ? 'translateX(-100%)' : undefined }}
    >
      {children}
    </div>
  );
}

export interface GroupedBarDatum { key: string; label: string; tooltipLabel?: string; values: Record<string, number> }

/**
 * Grouped vertical bars — one group per period/category, one bar per series.
 * Hovering a group shows every series' value; clicking a bar calls `onSelect`.
 */
export function GroupedBarChart({
  data, series, height = 260, onSelect, formatValue = (n) => String(n), labelEvery,
}: {
  data: GroupedBarDatum[];
  series: Series[];
  height?: number;
  onSelect?: (datum: GroupedBarDatum, seriesKey: string) => void;
  formatValue?: (n: number) => string;
  labelEvery?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const pad = { top: 8, right: 4, bottom: 26, left: 36 };
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(0, ...data.flatMap((d) => series.map((s) => d.values[s.key] ?? 0)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const groupW = data.length ? innerW / data.length : 0;
  // Narrow groups (e.g. 30 daily buckets) get tighter gaps so bars stay readable.
  const gap = groupW < 28 ? 1 : 2;
  const barW = Math.max(2, Math.min(18, (groupW * 0.84 - gap * (series.length - 1)) / series.length));
  const clusterW = barW * series.length + gap * (series.length - 1);
  const every = labelEvery ?? Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(innerW / 64))));
  const y = (v: number) => pad.top + innerH - (v / top) * innerH;

  return (
    <div ref={ref} className="relative w-full" style={{ height }} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg
          width={width} height={height} role="img" className="block overflow-visible"
          onMouseMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - box.left;
            const i = Math.floor((px - pad.left) / (groupW || 1));
            setHover(i >= 0 && i < data.length ? { i, x: px, y: e.clientY - box.top - 20 } : null);
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeDasharray={t === 0 ? undefined : '3 3'} />
              <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-slate-400 text-[11px] tabular-nums">
                {formatValue(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const gx = pad.left + i * groupW;
            const cx = gx + (groupW - clusterW) / 2;
            return (
              <g key={d.key}>
                {hover?.i === i && <rect x={gx} y={pad.top} width={groupW} height={innerH} fill="#f1f5f9" />}
                {series.map((s, si) => {
                  const v = d.values[s.key] ?? 0;
                  const h = (v / top) * innerH;
                  return (
                    <path
                      key={s.key}
                      d={barPath(cx + si * (barW + gap), pad.top + innerH - h, barW, h)}
                      fill={s.color}
                      className={onSelect ? 'cursor-pointer' : undefined}
                      onClick={onSelect ? () => onSelect(d, s.key) : undefined}
                    />
                  );
                })}
                {i % every === 0 && (
                  <text x={gx + groupW / 2} y={height - 8} textAnchor="middle" className="fill-slate-500 text-[11px]">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover && data[hover.i] && (
        <ChartTooltip x={hover.x} y={hover.y} width={width}>
          <p className="mb-1 font-semibold text-slate-900">{data[hover.i].tooltipLabel ?? data[hover.i].label}</p>
          {series.map((s) => (
            <p key={s.key} className="flex items-center justify-between gap-4 text-slate-600">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.label}</span>
              <span className="font-semibold tabular-nums text-slate-900">{formatValue(data[hover.i].values[s.key] ?? 0)}</span>
            </p>
          ))}
        </ChartTooltip>
      )}
    </div>
  );
}

/** Small trend line for KPI cards (no axes — the card carries the number). */
export function Sparkline({ values, color, height = 32 }: { values: number[]; color: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 3 - (v / max) * (height - 6)).toFixed(1)}`);
  return (
    <div ref={ref} className="w-full" style={{ height }} aria-hidden>
      {width > 0 && values.length > 1 && (
        <svg width={width} height={height} className="block overflow-visible">
          <polygon points={`0,${height} ${pts.join(' ')} ${width},${height}`} fill={color} opacity={0.1} />
          <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}

export interface DonutSlice { key: string; label: string; value: number; color: string }

/** Donut with a 2px surface gap between segments; segments are clickable. */
export function Donut({
  slices, size = 168, thickness = 22, center, onSelect, active, onHover,
}: {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  center?: ReactNode;
  onSelect?: (key: string) => void;
  active?: string | null;
  onHover?: (key: string | null) => void;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = size / 2 - thickness / 2 - 2;
  const c = 2 * Math.PI * r;
  const visible = slices.filter((s) => s.value > 0);
  const gapLen = visible.length > 1 ? 2 : 0;
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={thickness} />
        {total > 0 && visible.map((s) => {
          const len = (s.value / total) * c;
          const dash = Math.max(0.5, len - gapLen);
          const el = (
            <circle
              key={s.key}
              cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={s.color}
              strokeWidth={active === s.key ? thickness + 4 : thickness}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
              className={cn('transition-[stroke-width]', onSelect && 'cursor-pointer')}
              onClick={onSelect ? () => onSelect(s.key) : undefined}
              onMouseEnter={() => onHover?.(s.key)}
              onMouseLeave={() => onHover?.(null)}
            >
              <title>{`${s.label}: ${s.value}`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">{center}</div>
    </div>
  );
}
