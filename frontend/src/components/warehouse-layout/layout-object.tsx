'use client';

// One layout object rendered as an SVG group. Read-only in Sprint 4 — no drag,
// no resize handles. Geometry is in grid units; the canvas viewBox does the
// scaling, and strokes use non-scaling-stroke so borders stay crisp at any zoom.

import type { LayoutObject, LayoutObjectType, LayoutOccupancy } from '@/lib/api';
import { heatFill } from './occupancy';

// Object types are grouped by FUNCTION, not given twelve separate hues: storage
// is neutral, and only the functional areas carry a low-saturation tint so a
// dock reads differently from a QC bench at a glance.
type Style = { fill: string; stroke: string; text: string; dashed?: boolean };

const STYLES: Record<LayoutObjectType, Style> = {
  // Structure — neutral, dashed: these are containers, not surfaces
  ZONE:           { fill: 'transparent',      stroke: '#94a3b8', text: '#475569', dashed: true },
  AISLE:          { fill: '#f8fafc',          stroke: '#e2e8f0', text: '#94a3b8', dashed: true },
  // RQ8 — a door is an opening in a wall, not a region: solid dark outline on
  // white, like a wall break on an architect's plan, plus the swing arc below.
  DOOR:           { fill: '#ffffff',          stroke: '#475569', text: '#334155' },
  CUSTOM_AREA:    { fill: '#f8fafc',          stroke: '#cbd5e1', text: '#64748b', dashed: true },
  // Storage — neutral slate
  STORAGE_AREA:   { fill: '#f1f5f9',          stroke: '#cbd5e1', text: '#475569' },
  RACK:           { fill: '#e2e8f0',          stroke: '#94a3b8', text: '#334155' },
  SHELF:          { fill: '#eef2f6',          stroke: '#cbd5e1', text: '#475569' },
  BIN:            { fill: '#ffffff',          stroke: '#94a3b8', text: '#334155' },
  // Inbound / outbound / handling / quality — low-saturation tints
  RECEIVING_AREA: { fill: '#ecfdf5',          stroke: '#6ee7b7', text: '#047857' },
  SHIPPING_AREA:  { fill: '#eff6ff',          stroke: '#93c5fd', text: '#1d4ed8' },
  STAGING_AREA:   { fill: '#fffbeb',          stroke: '#fcd34d', text: '#b45309' },
  WORK_AREA:      { fill: '#fffbeb',          stroke: '#fcd34d', text: '#b45309' },
  QC_AREA:        { fill: '#faf5ff',          stroke: '#d8b4fe', text: '#7e22ce' },
};

export const OBJECT_STYLES = STYLES;

// Objects taking up less than this many pixels on screen don't get a label.
const LABEL_MIN_PX = 34;

/**
 * RQ8 — the architect's door symbol: the leaf standing open, and the dashed arc
 * it sweeps. Drawn so a door reads as a door and not as one more coloured box.
 *
 * The hinge sits on the first corner of the LONG side (the opening's width) and
 * the leaf swings out perpendicular to it, which is why the arc reaches past the
 * object's own rectangle. Purely decorative: `pointerEvents` is off, so it never
 * widens the hit area or interferes with dragging the door itself.
 *
 * Geometry is in grid units and the group above already applies `rotation`, so
 * turning a door turns its swing with it.
 */
function DoorSwing({ obj, stroke }: { obj: LayoutObject; stroke: string }) {
  const horizontal = obj.width >= obj.height;
  const r = horizontal ? obj.width : obj.height;
  if (!(r > 0)) return null;
  // Hinge, leaf tip (open), and where the leaf would meet the wall (closed).
  // SVG y points down, so the sweep flag differs between the two orientations.
  const hinge: [number, number] = horizontal
    ? [obj.x, obj.y + obj.height]
    : [obj.x + obj.width, obj.y];
  const tip: [number, number] = horizontal
    ? [hinge[0], hinge[1] + r]
    : [hinge[0] + r, hinge[1]];
  const closed: [number, number] = horizontal
    ? [hinge[0] + r, hinge[1]]
    : [hinge[0], hinge[1] + r];
  const sweep = horizontal ? 0 : 1;
  return (
    <g pointerEvents="none" opacity={0.85}>
      <line x1={hinge[0]} y1={hinge[1]} x2={tip[0]} y2={tip[1]}
        stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <path d={`M ${tip[0]} ${tip[1]} A ${r} ${r} 0 0 ${sweep} ${closed[0]} ${closed[1]}`}
        fill="none" stroke={stroke} strokeWidth={1} strokeDasharray="3 2"
        vectorEffect="non-scaling-stroke" />
    </g>
  );
}

export function LayoutObjectShape({ obj, selected, pxPerUnit, onSelect, onPointerDown, occupancy }: {
  obj: LayoutObject;
  selected: boolean;
  pxPerUnit: number;
  onSelect: (obj: LayoutObject) => void;
  // Supplied by the canvas in edit mode so a press can begin a drag; the canvas
  // also handles selection there, so this replaces the plain select-on-press.
  onPointerDown?: (e: React.PointerEvent) => void;
  // Live rollup for a linked bin. Absent for unlinked and physical-only objects.
  occupancy?: LayoutOccupancy;
}) {
  const style = STYLES[obj.objectType] ?? STYLES.CUSTOM_AREA;
  // A linked bin is coloured by what is ACTUALLY in it, on the same scale the
  // Control Center heatmap uses. An explicit colour override still wins.
  const heat = occupancy && !occupancy.orphaned
    ? heatFill(occupancy.utilizationPct, occupancy.items > 0)
    : null;
  const fill = obj.color ?? heat?.fill ?? style.fill;
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;

  const widthPx = obj.width * pxPerUnit;
  const heightPx = obj.height * pxPerUnit;
  const showLabel = widthPx >= LABEL_MIN_PX && heightPx >= 18;
  const showCode = showLabel && !!obj.code && heightPx >= 34;

  // Label size in grid units, clamped so it stays readable but never overflows.
  const labelUnits = Math.min(obj.height * 0.3, obj.width / Math.max(obj.name.length * 0.55, 1), 1.6);

  const dimmed = obj.status === 'INACTIVE' || obj.status === 'PLANNED';
  const blocked = obj.status === 'BLOCKED';

  return (
    <g
      transform={obj.rotation ? `rotate(${obj.rotation} ${cx} ${cy})` : undefined}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (onPointerDown) onPointerDown(e);
        else onSelect(obj);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(obj); } }}
      tabIndex={0}
      role="button"
      aria-label={`${obj.objectType.replace(/_/g, ' ')} ${obj.name}${obj.code ? ` (${obj.code})` : ''}`}
      className="cursor-pointer focus:outline-none"
      opacity={dimmed ? 0.45 : 1}
    >
      <rect
        x={obj.x} y={obj.y} width={obj.width} height={obj.height}
        rx={Math.min(0.3, obj.width / 12, obj.height / 12)}
        fill={blocked ? '#fef2f2' : fill}
        stroke={blocked ? '#ef4444' : (heat?.stroke ?? style.stroke)}
        strokeWidth={selected ? 2.5 : 1.25}
        strokeDasharray={style.dashed ? '4 3' : undefined}
        vectorEffect="non-scaling-stroke"
      />
      {obj.objectType === 'DOOR' && (
        <DoorSwing obj={obj} stroke={blocked ? '#ef4444' : style.stroke} />
      )}
      {/* Orphan marker: the linked slot was deleted out from under the drawing. */}
      {occupancy?.orphaned && (
        <>
          <rect
            x={obj.x} y={obj.y} width={obj.width} height={obj.height}
            rx={Math.min(0.3, obj.width / 12, obj.height / 12)}
            fill="none" stroke="#b45309" strokeWidth={2} strokeDasharray="3 2"
            vectorEffect="non-scaling-stroke" pointerEvents="none"
          />
          <line
            x1={obj.x} y1={obj.y} x2={obj.x + obj.width} y2={obj.y + obj.height}
            stroke="#b45309" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none"
          />
        </>
      )}
      {selected && (
        <rect
          x={obj.x} y={obj.y} width={obj.width} height={obj.height}
          rx={Math.min(0.3, obj.width / 12, obj.height / 12)}
          fill="none" stroke="#15803d" strokeWidth={3.5}
          vectorEffect="non-scaling-stroke" pointerEvents="none"
        />
      )}
      {showLabel && (
        <text
          x={cx} y={showCode ? cy - labelUnits * 0.15 : cy}
          textAnchor="middle" dominantBaseline="middle"
          fontSize={labelUnits} fill={blocked ? '#b91c1c' : style.text}
          fontWeight={600} pointerEvents="none"
          style={{ fontFamily: 'inherit' }}
        >
          {obj.name}
        </text>
      )}
      {showCode && (
        <text
          x={cx} y={cy + labelUnits}
          textAnchor="middle" dominantBaseline="middle"
          fontSize={labelUnits * 0.8} fill={style.text} opacity={0.75}
          pointerEvents="none" style={{ fontFamily: 'ui-monospace, monospace' }}
        >
          {obj.code}
        </text>
      )}
    </g>
  );
}
