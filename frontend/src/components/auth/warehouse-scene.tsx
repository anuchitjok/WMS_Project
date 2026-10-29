/**
 * Isometric warehouse illustration for the login showcase.
 * Pure SVG, no data, no side effects. The viewBox is 760 x 540; the
 * floating KPI cards in login-showcase.tsx are positioned against it.
 */

import { Fragment, type ReactNode } from 'react';

// ─── Isometric projection ─────────────────────────────────────────────────────
// World units: x runs down-right, y runs down-left, z is up.
const S = 13;
const CX = 0.8660254 * S;
const CY = 0.5 * S;
const OX = 345;
const OY = 122;

function pt(x: number, y: number, z: number): [number, number] {
  return [OX + (x - y) * CX, OY + (x + y) * CY - z * S];
}
function P(x: number, y: number, z: number) {
  const [a, b] = pt(x, y, z);
  return `${a.toFixed(1)},${b.toFixed(1)}`;
}
/** Rectangle on the plane y = const. */
const onY = (y: number, x1: number, x2: number, z1: number, z2: number) =>
  `${P(x1, y, z1)} ${P(x2, y, z1)} ${P(x2, y, z2)} ${P(x1, y, z2)}`;
/** Rectangle on the plane x = const. */
const onX = (x: number, y1: number, y2: number, z1: number, z2: number) =>
  `${P(x, y1, z1)} ${P(x, y2, z1)} ${P(x, y2, z2)} ${P(x, y1, z2)}`;
/** Rectangle on the plane z = const. */
const onTop = (z: number, x1: number, x2: number, y1: number, y2: number) =>
  `${P(x1, y1, z)} ${P(x2, y1, z)} ${P(x2, y2, z)} ${P(x1, y2, z)}`;

// ─── Palette (brand green #16a34a family + neutrals) ─────────────────────────
type Shade = { top: string; left: string; right: string };
const WHITE: Shade = { top: '#ffffff', left: '#f2f6f4', right: '#e2e9e5' };
const GREEN: Shade = { top: '#4ade80', left: '#22c55e', right: '#16a34a' };
const GREEN_D: Shade = { top: '#22c55e', left: '#16a34a', right: '#15803d' };
const KRAFT: Shade = { top: '#f6e1bf', left: '#ebcb98', right: '#d8b079' };
const MINT: Shade = { top: '#e3fbea', left: '#c6f3d4', right: '#99e2b2' };
const WOOD: Shade = { top: '#e6d4b0', left: '#d0b78b', right: '#bba174' };
const STEEL: Shade = { top: '#94a3b8', left: '#64748b', right: '#475569' };
const BEAM: Shade = { top: '#e8eeeb', left: '#cbd5d0', right: '#a9b6b0' };
const DOCK: Shade = { top: '#e4ebe7', left: '#d2dbd6', right: '#c2ccc7' };

const EDGE = 'rgba(15,23,42,0.07)';

function Box({
  x, y, z, w, d, h, c, edge = EDGE,
}: { x: number; y: number; z: number; w: number; d: number; h: number; c: Shade; edge?: string }) {
  return (
    <g stroke={edge} strokeWidth={0.6} strokeLinejoin="round">
      <polygon points={onY(y + d, x, x + w, z, z + h)} fill={c.left} />
      <polygon points={onX(x + w, y, y + d, z, z + h)} fill={c.right} />
      <polygon points={onTop(z + h, x, x + w, y, y + d)} fill={c.top} />
    </g>
  );
}

/** Wheel on a y = const face: a circle in the x–z plane, seen isometrically. */
function Wheel({ x, y, z = 0.3, r = 4.2 }: { x: number; y: number; z?: number; r?: number }) {
  const [cx, cy] = pt(x, y, z);
  return (
    <g>
      <ellipse cx={cx} cy={cy} rx={r * 0.9} ry={r * 1.08} transform={`rotate(-28 ${cx} ${cy})`} fill="#1f2937" />
      <ellipse cx={cx} cy={cy} rx={r * 0.38} ry={r * 0.46} transform={`rotate(-28 ${cx} ${cy})`} fill="#94a3b8" />
    </g>
  );
}

// ─── Scene pieces ─────────────────────────────────────────────────────────────

function Tree({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  const [bx, by] = pt(x, y, 0);
  const [cx, cy] = pt(x, y, 1.9 * s);
  const r = 12 * s;
  return (
    <g>
      <ellipse cx={bx} cy={by} rx={r * 0.9} ry={r * 0.45} fill="rgba(22,101,52,0.10)" />
      <line x1={bx} y1={by} x2={cx} y2={cy + r * 0.4} stroke="#a3865f" strokeWidth={2.4} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={r} fill="url(#wsTree)" />
      <circle cx={cx - r * 0.35} cy={cy - r * 0.55} r={r * 0.62} fill="url(#wsTree)" />
    </g>
  );
}

function Worker({ x, y }: { x: number; y: number }) {
  const [sx, sy] = pt(x, y, 0);
  return (
    <g>
      <ellipse cx={sx} cy={sy} rx={4.5} ry={2} fill="rgba(15,23,42,0.12)" />
      <rect x={sx - 2.6} y={sy - 6} width={5.2} height={6} rx={1.4} fill="#334155" />
      <rect x={sx - 3.2} y={sy - 14} width={6.4} height={8.6} rx={2.2} fill="#16a34a" />
      <circle cx={sx} cy={sy - 17} r={2.9} fill="#f1c7a1" />
      <path d={`M${sx - 3.2},${sy - 17.6} a3.2,3.2 0 0 1 6.4,0 z`} fill="#ffffff" stroke="#cbd5d0" strokeWidth={0.5} />
    </g>
  );
}

/** Pallet with a 2 x 2 grid of cartons, `levels` high. */
function Pallet({ x, y, levels, c = KRAFT }: { x: number; y: number; levels: number; c?: Shade }) {
  const cells: [number, number][] = [[0, 0], [0.9, 0], [0, 0.9], [0.9, 0.9]];
  return (
    <g>
      <Box x={x} y={y} z={0} w={1.8} d={1.8} h={0.25} c={WOOD} />
      {Array.from({ length: levels }).map((_, l) =>
        cells.map(([i, j]) => (
          <Box key={`${l}-${i}-${j}`} x={x + i + 0.03} y={y + j + 0.03} z={0.25 + l * 0.82} w={0.84} d={0.84} h={0.82} c={c} />
        )),
      )}
    </g>
  );
}

/** Stretch-wrapped pallet load. */
function WrappedPallet({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <Box x={x} y={y} z={0} w={1.8} d={1.8} h={0.25} c={WOOD} />
      <Box x={x + 0.05} y={y + 0.05} z={0.25} w={1.7} d={1.7} h={1.55} c={MINT} />
      <polygon points={onY(y + 1.75, x + 0.05, x + 1.75, 0.95, 1.1)} fill="#16a34a" opacity={0.55} />
      <polygon points={onX(x + 1.75, y + 0.05, y + 1.75, 0.95, 1.1)} fill="#15803d" opacity={0.55} />
    </g>
  );
}

const RACK_LEVELS = [0.25, 1.6, 2.95];
const RACK_FILL = ['1101101', '0111011', '1011110'];
const RACK_COLORS = [KRAFT, KRAFT, MINT, KRAFT, WHITE, KRAFT, MINT];

/** Open steel rack row running along x. */
function Rack({ x, y, len = 7.6, row }: { x: number; y: number; len?: number; row: number }) {
  const d = 1.2;
  const posts = [x, x + len / 2, x + len - 0.14];
  const post = (px: number, py: number) => (
    <Box key={`${px}-${py}`} x={px} y={py} z={0} w={0.14} d={0.14} h={4.25} c={GREEN_D} edge="none" />
  );
  return (
    <g>
      {posts.map((px) => post(px, y))}
      {RACK_LEVELS.map((z, li) => {
        const pattern = RACK_FILL[(li + row) % RACK_FILL.length];
        return (
          <Fragment key={z}>
            <Box x={x} y={y} z={z} w={len} d={d} h={0.12} c={BEAM} />
            {pattern.split('').map((on, k) =>
              on === '1' ? (
                <Box
                  key={k}
                  x={x + 0.12 + k * 1.06}
                  y={y + 0.12}
                  z={z + 0.12}
                  w={0.94}
                  d={0.96}
                  h={k % 3 === 1 ? 0.95 : 1.12}
                  c={RACK_COLORS[(k + li + row) % RACK_COLORS.length]}
                />
              ) : null,
            )}
          </Fragment>
        );
      })}
      <Box x={x} y={y} z={4.1} w={len} d={d} h={0.12} c={BEAM} />
      {posts.map((px) => post(px, y + d - 0.14))}
    </g>
  );
}

function Truck({ y, cab }: { y: number; cab: Shade }) {
  return (
    <g>
      <Box x={24.6} y={y + 0.15} z={0.28} w={6.2} d={1.4} h={0.28} c={STEEL} />
      <Box x={24.4} y={y} z={0.56} w={5} d={1.7} h={2.6} c={WHITE} />
      <polygon points={onY(y + 1.7, 24.7, 29.1, 1.25, 1.55)} fill="#22c55e" />
      <polygon points={onY(y + 1.7, 24.7, 29.1, 1.62, 1.72)} fill="#86efac" />
      <Box x={29.5} y={y + 0.05} z={0.42} w={1.6} d={1.6} h={2.05} c={cab} />
      <polygon points={onX(31.1, y + 0.25, y + 1.45, 1.45, 2.22)} fill="#1e3a2f" opacity={0.88} />
      <polygon points={onY(y + 1.65, 30.15, 30.9, 1.45, 2.2)} fill="#1e3a2f" opacity={0.88} />
      <Wheel x={25.3} y={y + 1.62} />
      <Wheel x={26.5} y={y + 1.62} />
      <Wheel x={30.5} y={y + 1.66} />
    </g>
  );
}

function Forklift({ x, y, load }: { x: number; y: number; load: Shade }) {
  return (
    <g>
      {/* carried load on the forks */}
      <Box x={x - 1.75} y={y + 0.08} z={0.32} w={1.5} d={1.1} h={0.18} c={WOOD} />
      <Box x={x - 1.65} y={y + 0.13} z={0.5} w={1.3} d={1.0} h={0.95} c={load} />
      {/* mast */}
      <Box x={x - 0.22} y={y + 0.08} z={0} w={0.16} d={0.18} h={2.5} c={STEEL} edge="none" />
      <Box x={x - 0.22} y={y + 0.94} z={0} w={0.16} d={0.18} h={2.5} c={STEEL} edge="none" />
      {/* body and counterweight */}
      <Box x={x} y={y} z={0.25} w={1.45} d={1.2} h={0.95} c={GREEN} />
      <Box x={x + 1.45} y={y} z={0.25} w={0.38} d={1.2} h={1.2} c={GREEN_D} />
      {/* overhead guard */}
      <Box x={x + 0.12} y={y + 0.08} z={1.2} w={0.08} d={0.08} h={1.35} c={STEEL} edge="none" />
      <Box x={x + 1.25} y={y + 0.08} z={1.2} w={0.08} d={0.08} h={1.35} c={STEEL} edge="none" />
      <Box x={x + 0.62} y={y + 0.32} z={1.2} w={0.5} d={0.55} h={0.38} c={STEEL} />
      <Box x={x + 0.12} y={y + 1.04} z={1.2} w={0.08} d={0.08} h={1.35} c={STEEL} edge="none" />
      <Box x={x + 1.25} y={y + 1.04} z={1.2} w={0.08} d={0.08} h={1.35} c={STEEL} edge="none" />
      <Box x={x + 0.06} y={y + 0.02} z={2.55} w={1.34} d={1.16} h={0.1} c={{ top: '#475569', left: '#334155', right: '#1e293b' }} />
      <Wheel x={x + 0.32} y={y + 1.2} z={0.28} r={3.4} />
      <Wheel x={x + 1.35} y={y + 1.2} z={0.28} r={3.4} />
    </g>
  );
}

// ─── Scene ────────────────────────────────────────────────────────────────────

const TRACK = [
  [23.6, 14.3], [16.6, 14.3], [16.6, 15.6],
] as const;
const TRACK_2 = [
  [16.6, 14.3], [10.6, 14.3], [10.6, 18.3],
] as const;
const toPath = (pts: readonly (readonly [number, number])[]) =>
  pts.map(([x, y], i) => `${i ? 'L' : 'M'}${P(x, y, 0)}`).join(' ');

/** Card anchor → scene target, in viewBox coordinates. */
export const SCENE_CONNECTORS: { from: [number, number]; to: [number, number] }[] = [
  { from: [350, 98], to: pt(13.5, 5.5, 7) },
  { from: [612, 118], to: pt(23, 2.6, 4.75) },
  { from: [150, 400], to: pt(13.5, 23.3, 1.1) },
];

export function WarehouseScene({ className, showConnectors = true }: { className?: string; showConnectors?: boolean }) {
  const shadow = pt(16, 13, -1);
  const roofText = pt(10.4, 12.25, 7);

  const children: ReactNode = (
    <>
      <defs>
        <radialGradient id="wsTree" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#86efac" />
          <stop offset="60%" stopColor="#22c55e" />
          <stop offset="100%" stopColor="#15803d" />
        </radialGradient>
        <radialGradient id="wsShadow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(22,163,74,0.16)" />
          <stop offset="100%" stopColor="rgba(22,163,74,0)" />
        </radialGradient>
        <linearGradient id="wsGlass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ecfdf3" />
          <stop offset="100%" stopColor="#bbf7d0" />
        </linearGradient>
      </defs>

      {/* ground glow */}
      <ellipse cx={shadow[0]} cy={shadow[1] + 18} rx={390} ry={150} fill="url(#wsShadow)" />

      {/* ── platform + floor markings ── */}
      <Box x={0} y={0} z={-0.9} w={32} d={26} h={0.9} c={{ top: '#fcfdfc', left: '#e7efea', right: '#d7e3dc' }} edge="rgba(22,101,52,0.10)" />
      <g stroke="rgba(22,163,74,0.075)" strokeWidth={0.8}>
        {Array.from({ length: 15 }, (_, i) => (i + 1) * 2).map((v) => (
          <line key={`gx${v}`} x1={pt(v, 0, 0)[0]} y1={pt(v, 0, 0)[1]} x2={pt(v, 26, 0)[0]} y2={pt(v, 26, 0)[1]} />
        ))}
        {Array.from({ length: 12 }, (_, i) => (i + 1) * 2).map((v) => (
          <line key={`gy${v}`} x1={pt(0, v, 0)[0]} y1={pt(0, v, 0)[1]} x2={pt(32, v, 0)[0]} y2={pt(32, v, 0)[1]} />
        ))}
      </g>
      {/* truck apron + bay lines */}
      <polygon points={onTop(0, 23.9, 31.8, 1.6, 13.4)} fill="#eef3f0" />
      <g stroke="#ffffff" strokeWidth={1.6} strokeDasharray="5 4">
        {[2.6, 5.95, 9.35, 12.7].map((y) => (
          <line key={y} x1={pt(24.2, y, 0)[0]} y1={pt(24.2, y, 0)[1]} x2={pt(31.6, y, 0)[0]} y2={pt(31.6, y, 0)[1]} />
        ))}
      </g>
      {/* storage + staging zones */}
      <polygon points={onTop(0, 1.4, 10.2, 15.3, 25.2)} fill="rgba(15,23,42,0.022)" />
      <polygon points={onTop(0, 12.1, 21.4, 15.6, 24.9)} fill="rgba(22,163,74,0.05)" stroke="rgba(22,163,74,0.38)" strokeWidth={1} strokeDasharray="4 3" />
      {/* tracking route */}
      <path d={toPath(TRACK)} className="ws-track" fill="none" stroke="#16a34a" strokeWidth={1.6} strokeDasharray="5 5" strokeLinecap="round" opacity={0.6} />
      <path d={toPath(TRACK_2)} className="ws-track" fill="none" stroke="#16a34a" strokeWidth={1.6} strokeDasharray="5 5" strokeLinecap="round" opacity={0.6} />

      {/* ── back trees ── */}
      <Tree x={2} y={1.8} s={1.05} />
      <Tree x={4.8} y={0.9} s={0.85} />
      <Tree x={1.1} y={5} s={0.9} />
      <Tree x={27} y={0.9} s={0.9} />
      <Tree x={30.2} y={1.3} s={1.05} />

      {/* ── office annex ── */}
      <Box x={4} y={7} z={0} w={4} d={6} h={4.2} c={WHITE} />
      <polygon points={onY(13, 4.5, 7.6, 1.5, 3.5)} fill="url(#wsGlass)" stroke="#86efac" strokeWidth={0.8} />
      {[5.5, 6.55].map((x) => (
        <line key={x} x1={pt(x, 13, 1.5)[0]} y1={pt(x, 13, 1.5)[1]} x2={pt(x, 13, 3.5)[0]} y2={pt(x, 13, 3.5)[1]} stroke="#86efac" strokeWidth={0.8} />
      ))}
      <Box x={4} y={7} z={4.2} w={4} d={6} h={0.3} c={GREEN_D} />

      {/* ── main warehouse ── */}
      <Box x={8} y={2} z={0} w={15} d={11} h={7} c={WHITE} />
      {/* cladding seams on the dock face */}
      <g stroke="rgba(15,23,42,0.05)" strokeWidth={0.8}>
        {Array.from({ length: 11 }, (_, i) => 2.5 + i).map((y) => (
          <line key={y} x1={pt(23, y, 4.6)[0]} y1={pt(23, y, 4.6)[1]} x2={pt(23, y, 7)[0]} y2={pt(23, y, 7)[1]} />
        ))}
      </g>
      {/* green base band + corner column */}
      <polygon points={onY(13, 8, 23, 0, 1.1)} fill="#16a34a" />
      <polygon points={onX(23, 2, 13, 0, 1.1)} fill="#15803d" />
      <polygon points={onY(13, 21.5, 23, 0, 7)} fill="#22c55e" />
      <polygon points={onX(23, 11.7, 13, 0, 7)} fill="#16a34a" />
      {/* ribbon window */}
      <polygon points={onY(13, 9, 20.8, 4.3, 5.6)} fill="url(#wsGlass)" stroke="#86efac" strokeWidth={0.8} />
      {Array.from({ length: 7 }, (_, i) => 10.5 + i * 1.5).map((x) => (
        <line key={x} x1={pt(x, 13, 4.3)[0]} y1={pt(x, 13, 4.3)[1]} x2={pt(x, 13, 5.6)[0]} y2={pt(x, 13, 5.6)[1]} stroke="#86efac" strokeWidth={0.8} />
      ))}
      {/* personnel door */}
      <polygon points={onY(13, 10.2, 11.4, 1.1, 3.2)} fill="#e6ece9" stroke="#c8d3cd" strokeWidth={0.8} />
      {/* dock doors */}
      {[3, 6.4, 9.8].map((y0, i) => (
        <g key={y0}>
          <polygon points={onX(23, y0 - 0.22, y0 + 1.82, 1.1, 4.05)} fill="#15803d" />
          <polygon points={onX(23, y0, y0 + 1.6, 1.1, 3.82)} fill={i === 1 ? '#e8eeeb' : '#173b2a'} />
          {i === 1 &&
            [1.45, 1.8, 2.15, 2.5, 2.85, 3.2, 3.55].map((z) => (
              <line key={z} x1={pt(23, y0, z)[0]} y1={pt(23, y0, z)[1]} x2={pt(23, y0 + 1.6, z)[0]} y2={pt(23, y0 + 1.6, z)[1]} stroke="#cdd7d2" strokeWidth={0.7} />
            ))}
        </g>
      ))}
      {/* roof: parapet inset, skylights, plant, sign */}
      <polygon points={onTop(7, 8.35, 22.65, 2.35, 12.65)} fill="#f4f8f6" stroke="#e1e9e4" strokeWidth={0.8} />
      {[10, 12.4, 14.8, 17.2].map((x) => (
        <polygon key={x} points={onTop(7.02, x, x + 1.05, 3.2, 9.6)} fill="#e4ece8" stroke="#d2ddd7" strokeWidth={0.7} />
      ))}
      <Box x={19.6} y={3.2} z={7} w={1.5} d={1.5} h={0.75} c={WHITE} />
      <Box x={19.8} y={5.6} z={7} w={1.1} d={1.1} h={0.55} c={WHITE} />
      <text
        transform={`matrix(0.866 0.5 -0.866 0.5 ${roofText[0].toFixed(1)} ${roofText[1].toFixed(1)})`}
        fontSize={25}
        fontWeight={800}
        letterSpacing={1}
        fill="#16a34a"
        style={{ fontFamily: 'inherit' }}
      >
        HSNT<tspan fill="#15803d" fontWeight={700}> WMS</tspan>
      </text>

      {/* dock leveller + bumpers */}
      <Box x={23} y={2} z={0} w={0.9} d={11} h={1.1} c={DOCK} />
      {[3, 6.4, 9.8].map((y0) => (
        <polygon key={y0} points={onX(23.9, y0 + 0.15, y0 + 0.45, 0.3, 0.9)} fill="#334155" />
      ))}

      {/* ── trucks + canopy ── */}
      <Truck y={3.05} cab={GREEN} />
      <Truck y={9.85} cab={WHITE} />
      <Box x={23} y={2.4} z={4.45} w={1.7} d={10.3} h={0.22} c={WHITE} />
      <polygon points={onX(24.7, 2.4, 12.7, 4.45, 4.67)} fill="#16a34a" />

      {/* ── left trees ── */}
      <Tree x={1.2} y={12.6} s={0.95} />

      {/* ── racks ── */}
      <Rack x={2} y={16} row={0} />
      <Rack x={2} y={19.6} row={1} />
      <Rack x={2} y={23.2} row={2} />

      {/* ── staging pallets, forklifts, people (back to front) ── */}
      <Pallet x={12.6} y={16.2} levels={2} />
      <Forklift x={25.2} y={14.6} load={MINT} />
      <Pallet x={15.3} y={16.2} levels={1} c={MINT} />
      <Pallet x={18.4} y={16.4} levels={2} />
      <WrappedPallet x={12.6} y={19.2} />
      <Worker x={11.2} y={14.8} />
      <Pallet x={15.3} y={19.2} levels={2} />
      <Worker x={21.6} y={15.6} />
      <Worker x={14.7} y={22.4} />
      <Pallet x={12.6} y={22.4} levels={1} />
      <Forklift x={18.6} y={22.6} load={KRAFT} />
      <Worker x={23.2} y={19.4} />

      {/* ── work bench ── */}
      <Box x={24.2} y={21.2} z={0} w={3.6} d={1.2} h={0.9} c={WHITE} />
      <Box x={24.5} y={21.4} z={0.9} w={0.8} d={0.7} h={0.55} c={KRAFT} />
      <Box x={25.8} y={21.45} z={0.9} w={0.7} d={0.6} h={0.4} c={MINT} />

      {/* ── front trees ── */}
      <Tree x={30.6} y={17.8} s={0.9} />
      <Tree x={30.4} y={23.4} s={1.05} />
      <Tree x={27.6} y={25.1} s={0.85} />

      {/* moving inventory markers along the route */}
      <g className="ws-movers">
        <circle r={3.6} fill="#16a34a">
          <animateMotion dur="7s" repeatCount="indefinite" path={toPath(TRACK)} />
        </circle>
        <circle r={3.6} fill="#16a34a">
          <animateMotion dur="6s" repeatCount="indefinite" path={toPath(TRACK_2)} />
        </circle>
      </g>

      {/* connectors from the KPI cards */}
      {showConnectors && (
        <g className="ws-connectors">
          {SCENE_CONNECTORS.map(({ from, to }, i) => (
            <g key={i}>
              <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke="#16a34a" strokeWidth={1.2} strokeDasharray="4 4" opacity={0.45} />
              <circle cx={to[0]} cy={to[1]} r={7} fill="#16a34a" opacity={0.14} />
              <circle cx={to[0]} cy={to[1]} r={3.4} fill="#16a34a" />
            </g>
          ))}
        </g>
      )}
    </>
  );

  return (
    <svg
      className={className}
      viewBox="0 0 760 540"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Illustration of a warehouse with racks, pallets, forklifts and delivery trucks"
    >
      {children}
    </svg>
  );
}
