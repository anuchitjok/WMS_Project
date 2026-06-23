'use client';

import { Box, LineChart, ShieldCheck, Truck, ClipboardCheck, PackageCheck } from 'lucide-react';
import styles from './warehouse-hero.module.css';

// ─── Palette (login-only, fixed) ──────────────────────────────────────────────
const C = {
  white: '#FFFFFF',
  surface: '#F3F4F6',
  border: '#E5E7EB',
  text: '#111827',
  muted: '#6B7280',
  green: '#22C55E',
  greenD: '#16A34A',
};

// ─── Isometric projection (2:1, 30°) ─────────────────────────────────────────
const S = 17;
const OX = 300;
const OY = 250;
const COS = Math.cos(Math.PI / 6);
const P = (x: number, y: number, z: number) => `${(OX + (x - y) * S * COS).toFixed(1)},${(OY + (x + y) * S * 0.5 - z * S).toFixed(1)}`;

interface BoxProps { x: number; y: number; z: number; w: number; d: number; h: number; top: string; left: string; right: string; }
function IsoBox({ x, y, z, w, d, h, top, left, right }: BoxProps) {
  const A = P(x, y, z + h), B = P(x + w, y, z + h), Cc = P(x + w, y + d, z + h), D = P(x, y + d, z + h);
  const E = P(x, y + d, z), F = P(x + w, y + d, z), G = P(x + w, y, z);
  return (
    <g stroke={C.border} strokeWidth="0.5" strokeLinejoin="round">
      <polygon points={`${D} ${Cc} ${F} ${E}`} fill={left} />
      <polygon points={`${Cc} ${B} ${G} ${F}`} fill={right} />
      <polygon points={`${A} ${B} ${Cc} ${D}`} fill={top} />
    </g>
  );
}

const FEATURES = [
  { icon: Box, title: 'Real-time inventory', sub: 'Live tracking and updates' },
  { icon: LineChart, title: 'Warehouse analytics', sub: 'Data-driven insights' },
  { icon: ShieldCheck, title: 'Secure & reliable', sub: 'Enterprise-grade security' },
];

const OVERVIEW = [
  { label: 'Warehouses', value: '12' },
  { label: 'Total SKUs', value: '18,560' },
  { label: 'Active orders', value: '384' },
  { label: 'Utilization', value: '92%', accent: true },
];

/**
 * Animated warehouse hero panel for the login screen (left 65%).
 * Pure presentation — no auth concerns. Reusable / self-contained.
 */
export function WarehouseHero() {
  return (
    <div className="relative h-full w-full overflow-hidden px-10 py-9"
      style={{ background: `linear-gradient(135deg, ${C.white} 0%, ${C.surface} 58%, rgba(34,197,94,0.10) 100%)` }}>
      <div className={styles.grid} />

      {/* Headline + features */}
      <div className="relative z-10 max-w-sm">
        <h2 className="text-3xl font-bold leading-tight" style={{ color: C.text }}>Smart Warehouse</h2>
        <h2 className="text-3xl font-bold leading-tight" style={{ color: C.green }}>Smart Operations</h2>
        <p className="mt-3 text-sm leading-relaxed" style={{ color: C.muted }}>
          Real-time inventory visibility and intelligent warehouse management
        </p>
        <div className="mt-7 space-y-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex items-center gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
                style={{ background: 'rgba(34,197,94,0.12)', color: C.greenD }}>
                <f.icon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold" style={{ color: C.text }}>{f.title}</p>
                <p className="text-xs" style={{ color: C.muted }}>{f.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Isometric scene */}
      <svg viewBox="0 0 600 430" className="pointer-events-none absolute right-0 top-24 h-auto w-[64%] max-w-[640px]" aria-hidden="true">
        {/* ground connection lines + nodes */}
        <g fill="none" stroke="rgba(34,197,94,0.5)" strokeWidth="1.4" className={styles.dash}>
          <polyline points={`${P(-7, -1, 0)} ${P(2, 2, 0)} ${P(8, -1, 0)}`} />
          <polyline points={`${P(-4, 7, 0)} ${P(2, 2, 0)} ${P(3, 9, 0)}`} />
        </g>
        {[[-7, -1], [8, -1], [-4, 7], [3, 9], [2, 2]].map(([x, y], i) => (
          <circle key={i} className={styles.node} style={{ animationDelay: `${i * 0.4}s` }}
            cx={Number(P(x, y, 0).split(',')[0])} cy={Number(P(x, y, 0).split(',')[1])} r="3.6" fill={C.green} />
        ))}

        {/* back pallet stack */}
        <IsoBox x={-6.5} y={-1.5} z={0} w={1.6} d={1.6} h={0.4} top={C.border} left={C.muted} right={C.text} />
        <IsoBox x={-6.4} y={-1.4} z={0.4} w={1.4} d={1.4} h={1.1} top={C.white} left={C.surface} right={C.border} />

        {/* warehouse building */}
        <IsoBox x={-1.5} y={-1.5} z={0} w={7} d={7} h={5.4} top={C.white} left={C.surface} right={C.border} />
        {/* gable on the front-left face */}
        <polygon points={`${P(-1.5, 5.5, 5.4)} ${P(2, 5.5, 6.7)} ${P(5.5, 5.5, 5.4)}`} fill={C.white} stroke={C.border} strokeWidth="0.5" />
        {/* roll-up door */}
        <IsoBox x={1.1} y={5.4} z={0} w={2.6} d={0.2} h={3.2} top={C.greenD} left={C.green} right={C.greenD} />
        {/* green roof trim */}
        <IsoBox x={-1.5} y={-1.5} z={5.4} w={7} d={7} h={0.25} top={C.green} left={C.greenD} right={C.greenD} />

        {/* truck pulling out of the bay */}
        <IsoBox x={1.3} y={6.2} z={0} w={2.2} d={2.6} h={1.9} top={C.white} left={C.surface} right={C.border} />
        <IsoBox x={1.3} y={8.8} z={0} w={2.2} d={1.3} h={1.4} top={C.white} left={C.surface} right={C.border} />
        {/* green lower stripe */}
        <IsoBox x={1.3} y={6.2} z={0} w={2.2} d={3.9} h={0.4} top={C.green} left={C.green} right={C.greenD} />
        {/* wheels */}
        <circle cx={Number(P(1.5, 7, 0).split(',')[0])} cy={Number(P(1.5, 7, 0).split(',')[1])} r="3.2" fill={C.text} />
        <circle cx={Number(P(3.3, 9, 0).split(',')[0])} cy={Number(P(3.3, 9, 0).split(',')[1])} r="3.2" fill={C.text} />

        {/* forklift (front-left) */}
        <IsoBox x={-3.4} y={5} z={0} w={1.3} d={1.6} h={1.5} top={C.green} left={C.green} right={C.greenD} />
        <IsoBox x={-3.4} y={6.6} z={0} w={0.2} d={0.2} h={2} top={C.muted} left={C.muted} right={C.text} />

        {/* storage rack (right) — green uprights + cartons */}
        {[[6, -1], [9, -1], [6, 1.6], [9, 1.6]].map(([x, y], i) => (
          <IsoBox key={i} x={x} y={y} z={0} w={0.3} d={0.3} h={5} top={C.green} left={C.green} right={C.greenD} />
        ))}
        <IsoBox x={6} y={-1} z={1.6} w={3.3} d={2.9} h={0.25} top={C.border} left={C.muted} right={C.muted} />
        <IsoBox x={6} y={-1} z={3.4} w={3.3} d={2.9} h={0.25} top={C.border} left={C.muted} right={C.muted} />
        <IsoBox x={6.3} y={-0.6} z={1.85} w={1.1} d={1.1} h={1.2} top={C.white} left={C.surface} right={C.border} />
        <IsoBox x={7.8} y={0.4} z={1.85} w={1.1} d={1.1} h={1.2} top={C.white} left={C.surface} right={C.border} />
        <IsoBox x={6.3} y={-0.6} z={3.65} w={1.1} d={1.1} h={1.2} top={C.white} left={C.surface} right={C.border} />

        {/* front pallet */}
        <IsoBox x={-5} y={4.4} z={0} w={1.6} d={1.6} h={0.4} top={C.border} left={C.muted} right={C.text} />
        <IsoBox x={-4.9} y={4.5} z={0.4} w={1.4} d={1.4} h={1.1} top={C.white} left={C.surface} right={C.border} />
      </svg>

      {/* Floating stat cards */}
      <FloatCard className="left-[42%] top-[18%]" icon={Box} label="Total inventory" value="24,560" filled />
      <FloatCard className="right-[6%] top-[30%] [animation-delay:1.1s]" icon={Truck} label="Inbound" value="128" />
      <FloatCard className="left-[34%] bottom-[24%] [animation-delay:0.7s]" icon={ClipboardCheck} label="Outbound" value="256" />
      <FloatCard className="left-[10%] bottom-[30%] [animation-delay:1.5s]" icon={PackageCheck} label="Stock accuracy" value="99.8%" />

      {/* Live overview bar */}
      <div className="absolute inset-x-8 bottom-6 z-10 flex justify-between gap-3 rounded-2xl border p-4"
        style={{ background: C.white, borderColor: C.border }}>
        {OVERVIEW.map((o) => (
          <div key={o.label}>
            <p className="text-[11px]" style={{ color: C.muted }}>{o.label}</p>
            <p className="text-lg font-bold" style={{ color: o.accent ? C.green : C.text }}>{o.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function FloatCard({ className, icon: Icon, label, value, filled }: {
  className?: string; icon: typeof Box; label: string; value: string; filled?: boolean;
}) {
  return (
    <div className={`${styles.float} absolute z-10 flex items-center gap-2.5 rounded-xl border px-3 py-2 ${className ?? ''}`}
      style={{ background: C.white, borderColor: C.border }}>
      <span className="flex h-7 w-7 items-center justify-center rounded-lg"
        style={filled ? { background: C.green, color: C.white } : { background: 'rgba(34,197,94,0.12)', color: C.greenD }}>
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="text-[11px]" style={{ color: C.muted }}>{label}</p>
        <p className="text-sm font-semibold" style={{ color: C.text }}>{value}</p>
      </div>
    </div>
  );
}
