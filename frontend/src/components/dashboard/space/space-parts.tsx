'use client';

// Building blocks of the Warehouse Space tab (plan P6 6.1 / 6.2): KPI cards,
// simple stacked bars, per-warehouse cards and the management lists.
// Calm palette: green brand shades for used space, slate for free/neutral,
// amber only to flag "near full".
import Link from 'next/link';
import {
  AlertTriangle, Box, Boxes, Calculator, Gauge, Grid3x3, Info, LandPlot, Layers, PencilRuler, SquareDashed, type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import type { WarehouseSpaceSummary } from '@/lib/api-warehouse';
import { EmptyNote, Panel } from '@/components/dashboard/control-tower/panel';
import {
  clampThreshold, MAX_NEAR_FULL_PCT, MIN_NEAR_FULL_PCT, nearFull, offerable, share, type SpaceAggregate,
} from './space-math';

/** 0–100 value → locale percent text. */
function usePct() {
  const { fmt } = useT();
  return (v: number | null | undefined) => (v == null ? '—' : fmt.percent(v / 100, 1));
}

// ── KPI cards ─────────────────────────────────────────────────────────────────

interface Kpi { key: string; label: string; value: string; sub: string; icon: LucideIcon; bar?: number | null; warn?: boolean }

export function SpaceKpis({ agg, loading, threshold }: { agg: SpaceAggregate | null; loading: boolean; threshold: number }) {
  const { m, t, fmt } = useT();
  const S = m.dashboard.space;
  const K = S.kpi;
  const pct = usePct();
  const area = (v: number) => t(S.m2, { value: fmt.number(v, 1) });
  const sized = !!agg && agg.withSize > 0;

  const cards: Kpi[] = agg ? [
    { key: 'usable', label: K.usable, icon: LandPlot, value: sized ? area(agg.usableAreaM2) : '—', sub: sized ? t(K.usableSub, { total: area(agg.totalAreaM2) }) : K.noSize },
    { key: 'used', label: K.used, icon: Layers, value: sized ? area(agg.usedAreaM2) : '—', sub: sized ? t(K.usedSub, { pct: pct(agg.usedPct) }) : K.noSize, bar: agg.usedPct, warn: (agg.usedPct ?? 0) >= threshold },
    { key: 'free', label: K.free, icon: SquareDashed, value: sized ? area(agg.freeAreaM2) : '—', sub: sized ? K.freeSub : K.noSize },
    { key: 'volume', label: K.volume, icon: Box, value: sized && agg.volumeM3 > 0 ? t(S.m3, { value: fmt.number(agg.volumeM3, 1) }) : '—', sub: sized ? K.volumeSub : K.noSize },
    { key: 'slots', label: K.emptySlots, icon: Grid3x3, value: fmt.number(agg.slots.empty), sub: t(K.emptySlotsSub, { total: fmt.number(agg.slots.total) }) },
    {
      key: 'capacity', label: K.capacity, icon: Gauge, value: pct(agg.capacityUsedPct),
      sub: agg.capacityUsedPct == null ? K.noCapacity : t(K.capacitySub, { qty: fmt.number(agg.stockQty), cap: fmt.number(agg.slots.capacity) }),
      bar: agg.capacityUsedPct, warn: (agg.capacityUsedPct ?? 0) >= threshold,
    },
  ] : [];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {loading && !agg
        ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[118px] rounded-xl" />)
        : cards.map((c) => (
          <div key={c.key} className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-4">
            <div className="flex items-center gap-2 text-slate-500">
              <c.icon className="h-4 w-4 shrink-0 text-green-600" aria-hidden />
              <span className="truncate text-xs font-medium">{c.label}</span>
            </div>
            <p className="mt-2 truncate text-xl font-bold tabular-nums text-slate-900 sm:text-2xl">{c.value}</p>
            {c.bar !== undefined && <Meter value={c.bar} warn={c.warn} className="mt-2" />}
            <p className="mt-1.5 line-clamp-2 text-xs text-slate-500">{c.sub}</p>
          </div>
        ))}
    </div>
  );
}

/** Single progress bar (0–100). Green; amber when at/over the near-full threshold. */
export function Meter({ value, warn, className }: { value: number | null | undefined; warn?: boolean; className?: string }) {
  const w = value == null ? 0 : Math.min(100, Math.max(0, value));
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-slate-100', className)} role="presentation">
      <div className={cn('h-full rounded-full', warn ? 'bg-amber-500' : 'bg-green-600')} style={{ width: `${w}%` }} />
    </div>
  );
}

// ── Stacked bar + legend ──────────────────────────────────────────────────────

interface Seg { key: string; label: string; value: number; className: string; text: string }

function StackedBar({ segments, total, ariaLabel }: { segments: Seg[]; total: number; ariaLabel: string }) {
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={ariaLabel}>
        {segments.map((s) => {
          const w = share(s.value, total);
          return w > 0 ? <div key={s.key} className={cn('h-full', s.className)} style={{ width: `${w}%` }} title={`${s.label}: ${s.text}`} /> : null;
        })}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-600">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className={cn('h-2.5 w-2.5 rounded-sm', s.className)} aria-hidden />
            {s.label} <span className="font-semibold tabular-nums text-slate-800">{s.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SpaceBreakdown({ agg, loading }: { agg: SpaceAggregate | null; loading: boolean }) {
  const { m, t, fmt } = useT();
  const S = m.dashboard.space;
  const B = S.breakdown;
  const area = (v: number) => t(S.m2, { value: fmt.number(v, 1) });

  return (
    <Panel title={B.title} subtitle={B.subtitle} icon={Layers}>
      {loading && !agg ? <Skeleton className="h-36" /> : agg && (
        <div className="space-y-6">
          <div>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium text-slate-700">{B.area}</h3>
              {agg.withSize > 0 && <span className="text-xs tabular-nums text-slate-500">{area(agg.usableAreaM2)}</span>}
            </div>
            {agg.withSize > 0 ? (
              <StackedBar
                ariaLabel={B.area}
                total={Math.max(agg.usableAreaM2, agg.usedAreaM2)}
                segments={[
                  { key: 'std', label: B.standard, value: agg.standardM2, className: 'bg-green-600', text: area(agg.standardM2) },
                  { key: 'plt', label: B.pallet, value: agg.palletM2, className: 'bg-green-300', text: area(agg.palletM2) },
                  { key: 'free', label: B.free, value: agg.freeAreaM2, className: 'bg-slate-200', text: area(agg.freeAreaM2) },
                ]}
              />
            ) : <p className="text-sm text-slate-400">{B.noArea}</p>}
            {agg.overAllocatedM2 > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {t(B.over, { value: fmt.number(agg.overAllocatedM2, 1) })}
              </p>
            )}
            <p className="mt-2 text-xs text-slate-500">{t(B.racks, { standard: fmt.number(agg.racks.standard), pallet: fmt.number(agg.racks.pallet) })}</p>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium text-slate-700">{B.slots}</h3>
              <span className="text-xs tabular-nums text-slate-500">{fmt.number(agg.slots.total)}</span>
            </div>
            {agg.slots.total > 0 ? (
              <StackedBar
                ariaLabel={B.slots}
                total={agg.slots.total}
                segments={[
                  { key: 'occ', label: B.occupied, value: agg.slots.occupied, className: 'bg-green-600', text: fmt.number(agg.slots.occupied) },
                  { key: 'res', label: B.reserved, value: agg.slots.reserved, className: 'bg-green-300', text: fmt.number(agg.slots.reserved) },
                  { key: 'blk', label: B.blocked, value: agg.slots.blocked, className: 'bg-slate-400', text: fmt.number(agg.slots.blocked) },
                  ...(agg.slots.other > 0 ? [{ key: 'oth', label: B.other, value: agg.slots.other, className: 'bg-slate-300', text: fmt.number(agg.slots.other) }] : []),
                  { key: 'emp', label: B.empty, value: agg.slots.empty, className: 'bg-slate-100 ring-1 ring-inset ring-slate-200', text: fmt.number(agg.slots.empty) },
                ]}
              />
            ) : <p className="text-sm text-slate-400">{B.noSlots}</p>}
          </div>
        </div>
      )}
    </Panel>
  );
}

/** Notes about data that is left out of the totals. */
export function SpaceCaveats({ agg }: { agg: SpaceAggregate }) {
  const { m, t } = useT();
  const C = m.dashboard.space.caveat;
  const notes = [
    agg.withoutSize.length > 0 && t(C.warehousesWithoutSize, { count: agg.withoutSize.length }),
    agg.racks.withoutSize > 0 && t(C.racksWithoutSize, { count: agg.racks.withoutSize }),
  ].filter(Boolean) as string[];
  if (!notes.length) return null;
  return (
    <div className="space-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
      {notes.map((n) => <p key={n} className="flex items-start gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> {n}</p>)}
    </div>
  );
}

// ── Per-warehouse cards ───────────────────────────────────────────────────────

export function WarehouseCards({ rows, canEditSize, threshold }: { rows: WarehouseSpaceSummary[]; canEditSize: boolean; threshold: number }) {
  const { m } = useT();
  const C = m.dashboard.space.cards;
  return (
    <Panel title={C.title} subtitle={C.subtitle} icon={Boxes}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {rows.map((w) => <WarehouseCard key={w.warehouseId} w={w} canEditSize={canEditSize} threshold={threshold} />)}
      </div>
    </Panel>
  );
}

function WarehouseCard({ w, canEditSize, threshold }: { w: WarehouseSpaceSummary; canEditSize: boolean; threshold: number }) {
  const { m, t, fmt } = useT();
  const S = m.dashboard.space;
  const C = S.cards;
  const pct = usePct();
  const n1 = (v: number | null) => fmt.number(v, 1);

  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-slate-200 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{w.code}</p>
          <p className="truncate text-xs text-slate-500">{w.name}</p>
        </div>
        {!w.isActive && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{C.inactive}</span>}
      </div>

      {w.hasSize ? (
        <div className="mt-3">
          <div className="flex items-baseline justify-between gap-2 text-xs text-slate-600">
            <span className="truncate">{t(C.usedOf, { used: n1(w.rackFootprintM2), usable: n1(w.usableAreaM2) })}</span>
            <span className={cn('font-semibold tabular-nums', (w.usedAreaPct ?? 0) >= threshold ? 'text-amber-700' : 'text-slate-800')}>{pct(w.usedAreaPct)}</span>
          </div>
          <Meter value={w.usedAreaPct} warn={(w.usedAreaPct ?? 0) >= threshold} className="mt-1.5" />
        </div>
      ) : (
        <div className="mt-3 rounded-md bg-slate-50 px-2.5 py-2 text-xs text-slate-600">
          <p className="flex items-center gap-1.5 font-medium text-slate-700"><PencilRuler className="h-3.5 w-3.5 text-slate-400" /> {C.noSize}</p>
          {canEditSize
            ? <Link href="/warehouse-master" className="mt-1 inline-block font-medium text-green-700 underline-offset-2 hover:underline">{C.enterSize}</Link>
            : <p className="mt-0.5 text-slate-500">{C.noSizeHint}</p>}
        </div>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <Fact label={C.free} value={w.freeAreaM2 == null ? '—' : t(S.m2, { value: n1(w.freeAreaM2) })} />
        <Fact label={C.volume} value={w.volumeM3 == null ? '—' : t(S.m3, { value: n1(w.volumeM3) })} />
        <Fact label={C.standard} value={t(S.m2, { value: n1(w.standardFootprintM2) })} />
        <Fact label={C.pallet} value={t(S.m2, { value: n1(w.palletFootprintM2) })} />
        <Fact label={C.emptySlots} value={`${fmt.number(w.slots.empty)} / ${fmt.number(w.slots.total)}`} />
        <Fact label={C.capacity} value={pct(w.capacityUsedPct)} warn={(w.capacityUsedPct ?? 0) >= threshold} />
      </dl>

      {w.racks.withoutSize > 0 && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="min-w-0 break-words">{t(C.racksWithoutSize, { count: w.racks.withoutSize, codes: w.racks.withoutSizeCodes.slice(0, 6).join(', ') + (w.racks.withoutSizeCodes.length > 6 ? '…' : '') })}</span>
        </p>
      )}
    </div>
  );
}

function Fact({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-slate-500">{label}</dt>
      <dd className={cn('truncate font-semibold tabular-nums', warn ? 'text-amber-700' : 'text-slate-800')}>{value}</dd>
    </div>
  );
}

// ── Management view (6.2) ─────────────────────────────────────────────────────

export function OfferableSpace({ rows, canOpenSimulator }: { rows: WarehouseSpaceSummary[]; canOpenSimulator: boolean }) {
  const { m, fmt } = useT();
  const S = m.dashboard.space;
  const M = S.mgmt;
  const pct = usePct();
  const sorted = offerable(rows);
  const totalFree = rows.reduce((a, w) => a + (w.freeAreaM2 ?? 0), 0);
  const totalEmpty = rows.reduce((a, w) => a + w.slots.empty, 0);

  return (
    <Panel
      title={M.title}
      subtitle={M.subtitle}
      icon={SquareDashed}
      actions={canOpenSimulator && (
        <Link href="/warehouse-master?tab=simulator" className={cn(buttonVariants({ size: "lg" }), "gap-1.5")}>
          <Calculator className="h-4 w-4" /> {M.openSimulator}
        </Link>
      )}
    >
      {rows.length === 0 ? <EmptyNote>{S.empty}</EmptyNote> : (
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-medium">{M.warehouse}</th>
                <th className="px-3 py-2 text-right font-medium">{M.freeArea}</th>
                <th className="px-3 py-2 text-right font-medium">{M.emptySlots}</th>
                <th className="px-3 py-2 text-right font-medium">{M.used}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((w) => (
                <tr key={w.warehouseId}>
                  <td className="max-w-[200px] px-3 py-2">
                    <p className="truncate font-medium text-slate-800">{w.code}</p>
                    <p className="truncate text-xs text-slate-500">{w.name}</p>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                    {w.freeAreaM2 == null ? <span className="text-xs text-slate-400">{M.noSize}</span> : fmt.number(w.freeAreaM2, 1)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-800">{fmt.number(w.slots.empty)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{pct(w.usedAreaPct)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 1 && (
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold text-slate-900">
                  <td className="px-3 py-2">{M.total}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt.number(totalFree, 1)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt.number(totalEmpty)}</td>
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </Panel>
  );
}

export function NearFullList({
  rows, threshold, onThreshold,
}: { rows: WarehouseSpaceSummary[]; threshold: number; onThreshold: (v: number) => void }) {
  const { m, t } = useT();
  const M = m.dashboard.space.mgmt;
  const pct = usePct();
  const list = nearFull(rows, threshold);
  // Draft text so typing "9" on the way to "90" is not clamped mid-edit.
  const [draft, setDraft] = useState(String(threshold));
  useEffect(() => { setDraft(String(threshold)); }, [threshold]);
  const commit = () => { const v = clampThreshold(draft); onThreshold(v); setDraft(String(v)); };

  return (
    <Panel
      title={M.nearFull}
      subtitle={M.nearFullSub}
      icon={AlertTriangle}
      actions={(
        <label className="flex items-center gap-2 text-xs text-slate-600" title={t(M.thresholdHint, { min: MIN_NEAR_FULL_PCT, max: MAX_NEAR_FULL_PCT })}>
          {M.threshold}
          <span className="relative">
            <input
              type="number"
              inputMode="numeric"
              min={MIN_NEAR_FULL_PCT}
              max={MAX_NEAR_FULL_PCT}
              step={5}
              value={draft}
              aria-label={M.threshold}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
              className="h-8 w-[72px] rounded-md border border-slate-200 bg-white pl-2 pr-6 text-sm tabular-nums text-slate-800 outline-none focus:ring-2 focus:ring-green-600/30"
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400">%</span>
          </span>
        </label>
      )}
    >
      {list.length === 0 ? (
        <EmptyNote className="py-8">{t(M.noneNearFull, { pct: pct(threshold) })}</EmptyNote>
      ) : (
        <ul className="divide-y divide-slate-100">
          {list.map(({ warehouse: w, pct: p, basis }) => (
            <li key={w.warehouseId} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{w.code} <span className="font-normal text-slate-500">· {w.name}</span></p>
                </div>
                <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-700">
                  {pct(p)} {basis === 'area' ? M.basisArea : M.basisCapacity}
                </span>
              </div>
              <Meter value={p} warn className="mt-1.5" />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-400">{t(M.thresholdHint, { min: MIN_NEAR_FULL_PCT, max: MAX_NEAR_FULL_PCT })}</p>
    </Panel>
  );
}
