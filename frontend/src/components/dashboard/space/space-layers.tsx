'use client';

// Warehouse Space — the two layers executives read first:
//   Layer 1 "Warehouse Floor Space": rack footprint vs the FULL warehouse area (100%).
//   Layer 2 "Rack Storage Space": rack area split by slot status share (an estimate).
// Plus a warehouse summary table that drills down into one row per rack.
// The two layers are never mixed, numbers are never clamped, and anything that
// cannot be known shows "Data Unavailable" instead of a guessed value.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ChevronRight, Info, LandPlot, Layers, SquareDashed, Gauge, Grid3x3, Archive, PackageCheck, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { warehouseSpaceApi, type RackSpaceResponse, type StorageBucket, type WarehouseSpaceSummary } from '@/lib/api-warehouse';
import { Panel } from '@/components/dashboard/control-tower/panel';
import { Meter } from './space-parts';
import { floorTotals, storageTotals, STORAGE_BUCKETS, share } from './space-math';

// Calm palette: green shades = in use, slate = free, a darker slate = blocked/other.
const BUCKET_STYLE: Record<StorageBucket, string> = {
  occupied: 'bg-green-700',
  reserved: 'bg-green-300',
  available: 'bg-slate-200',
  blockedOther: 'bg-slate-500',
};

function useFormat() {
  const { m, t, fmt } = useT();
  const L = m.dashboard.space.layers;
  return {
    L,
    t,
    area: (v: number | null | undefined) => (v == null ? L.unavailable : t(m.dashboard.space.m2, { value: fmt.number(v, 2) })),
    pct: (v: number | null | undefined) => (v == null ? L.unavailable : fmt.percent(v / 100, 1)),
    num: (v: number) => fmt.number(v),
  };
}

// ── KPI groups ────────────────────────────────────────────────────────────────

interface Card { key: string; label: string; value: string; sub?: string; icon: LucideIcon; bar?: number | null; warn?: boolean; muted?: boolean }

function CardGrid({ cards }: { cards: Card[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.key} className="flex min-w-0 flex-col rounded-lg border border-slate-200 bg-white p-3.5">
          <div className="flex items-center gap-2 text-slate-500">
            <c.icon className="h-4 w-4 shrink-0 text-green-600" aria-hidden />
            <span className="truncate text-xs font-medium">{c.label}</span>
          </div>
          <p className={cn('mt-2 truncate text-xl font-bold tabular-nums sm:text-2xl', c.muted ? 'text-slate-400' : c.warn ? 'text-amber-700' : 'text-slate-900')}>{c.value}</p>
          {c.bar !== undefined && <Meter value={c.bar} warn={c.warn} className="mt-2" />}
          {c.sub && <p className="mt-1.5 line-clamp-2 text-xs text-slate-500">{c.sub}</p>}
        </div>
      ))}
    </div>
  );
}

function StatusBar({ values, total, slots, label }: { values: Record<StorageBucket, number>; total: number; slots: Record<StorageBucket, number>; label: string }) {
  const { L, t, area, num } = useFormat();
  const names: Record<StorageBucket, string> = { occupied: L.status.occupied, reserved: L.status.reserved, available: L.status.available, blockedOther: L.status.blockedOther };
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={label}>
        {STORAGE_BUCKETS.map((k) => {
          const w = share(values[k], total);
          return w > 0 ? <div key={k} className={cn('h-full', BUCKET_STYLE[k])} style={{ width: `${w}%` }} title={`${names[k]}: ${area(values[k])}`} /> : null;
        })}
      </div>
      <ul className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-600 sm:flex sm:flex-wrap">
        {STORAGE_BUCKETS.map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', BUCKET_STYLE[k])} aria-hidden />
            {names[k]}
            <span className="font-semibold tabular-nums text-slate-800">{area(values[k])}</span>
            <span className="tabular-nums text-slate-400">· {t(L.slotsCount, { n: num(slots[k]) })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SpaceLayers({ rows, loading }: { rows: WarehouseSpaceSummary[]; loading: boolean }) {
  const { L, t, area, pct } = useFormat();
  if (loading) {
    return <div className="grid grid-cols-1 gap-4 xl:grid-cols-2"><Skeleton className="h-64 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>;
  }
  const f = floorTotals(rows);
  const s = storageTotals(rows);
  const noFloor = f.totalAreaM2 == null;
  const noStorage = s.racksCounted === 0;
  const over = f.overCapacity.length > 0;

  const floorCards: Card[] = [
    { key: 'total', label: L.floor.total, icon: LandPlot, value: area(f.totalAreaM2), muted: noFloor },
    { key: 'fp', label: L.floor.footprint, icon: Layers, value: noFloor ? L.unavailable : area(f.rackFootprintM2), muted: noFloor, warn: over },
    { key: 'avail', label: L.floor.available, icon: SquareDashed, value: area(f.availableM2), muted: noFloor, warn: over },
    { key: 'util', label: L.floor.util, icon: Gauge, value: pct(f.utilPct), bar: noFloor ? undefined : f.utilPct, warn: over, muted: noFloor },
  ];
  const storageCards: Card[] = [
    { key: 'total', label: L.storage.total, icon: Grid3x3, value: noStorage ? L.unavailable : area(s.totalRackAreaM2), muted: noStorage },
    {
      key: 'occ', label: L.storage.occupied, icon: PackageCheck, value: noStorage ? L.unavailable : area(s.areaM2.occupied), muted: noStorage,
      sub: noStorage ? undefined : t(L.storage.reservedSub, { value: area(s.areaM2.reserved) }),
    },
    { key: 'avail', label: L.storage.available, icon: Archive, value: noStorage ? L.unavailable : area(s.areaM2.available), muted: noStorage },
    { key: 'util', label: L.storage.util, icon: Gauge, value: pct(noStorage ? null : s.utilPct), bar: noStorage ? undefined : s.utilPct, muted: noStorage, sub: L.storage.utilSub },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel title={L.floor.title} subtitle={L.floor.subtitle} icon={LandPlot} tone={over ? 'alert' : 'default'}>
        <div className="space-y-3">
          {over && (
            <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {t(L.floor.overWarning, { list: f.overCapacity.map((w) => w.code).join(', ') })}
            </p>
          )}
          <CardGrid cards={floorCards} />
          <Gaps items={[
            f.withoutSize.length ? t(L.gaps.warehouseNoSize, { n: f.withoutSize.length, list: f.withoutSize.map((w) => w.code).join(', ') }) : null,
            f.racksWithoutSizeCodes.length ? t(L.gaps.rackNoSize, { n: f.racksWithoutSizeCodes.length, list: short(f.racksWithoutSizeCodes) }) : null,
          ]} />
        </div>
      </Panel>
      <Panel title={L.storage.title} subtitle={L.storage.subtitle} icon={Grid3x3}>
        <div className="space-y-3">
          <CardGrid cards={storageCards} />
          {!noStorage && <StatusBar values={s.areaM2} total={s.totalRackAreaM2} slots={s.slots} label={L.storage.title} />}
          <Gaps items={[
            f.racksWithoutSizeCodes.length ? t(L.gaps.rackLeftOut, { n: f.racksWithoutSizeCodes.length }) : null,
            s.racksWithoutSlotsCodes.length ? t(L.gaps.rackNoSlots, { n: s.racksWithoutSlotsCodes.length, list: short(s.racksWithoutSlotsCodes) }) : null,
          ]} />
        </div>
      </Panel>
    </div>
  );
}

const short = (codes: string[], max = 6) => (codes.length > max ? `${codes.slice(0, max).join(', ')} …` : codes.join(', '));

function Gaps({ items }: { items: (string | null)[] }) {
  const list = items.filter(Boolean) as string[];
  if (!list.length) return null;
  return (
    <ul className="space-y-1 text-xs text-slate-500">
      {list.map((x) => <li key={x} className="flex items-start gap-1.5"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />{x}</li>)}
    </ul>
  );
}

// ── Warehouse summary (master) → rack details (detail) ────────────────────────

const th = 'whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-slate-500';
const thR = cn(th, 'text-right');
const td = 'whitespace-nowrap px-3 py-2 text-sm text-slate-700';
const tdR = cn(td, 'text-right tabular-nums');

export function SpaceDrillDown({ rows, loading }: { rows: WarehouseSpaceSummary[]; loading: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // A warehouse that leaves the selection closes its detail.
  useEffect(() => { if (openId && !rows.some((w) => w.warehouseId === openId)) setOpenId(null); }, [rows, openId]);
  if (loading) return <Skeleton className="h-56 rounded-xl" />;
  const open = openId ? rows.find((w) => w.warehouseId === openId) : undefined;
  return open ? <RackDetails warehouse={open} onBack={() => setOpenId(null)} /> : <WarehouseSummaryTable rows={rows} onOpen={setOpenId} />;
}

function WarehouseSummaryTable({ rows, onOpen }: { rows: WarehouseSpaceSummary[]; onOpen: (id: string) => void }) {
  const { L, area, pct } = useFormat();
  const T = L.table;
  return (
    <Panel title={T.title} subtitle={T.hint} icon={Layers}>
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="w-full min-w-[880px] border-collapse">
          <thead className="bg-slate-50">
            <tr>
              <th className={th}>{T.warehouse}</th>
              <th className={thR}>{T.totalArea}</th>
              <th className={thR}>{T.footprint}</th>
              <th className={thR}>{T.availableFloor}</th>
              <th className={cn(thR, 'border-r border-slate-200')}>{T.floorUtil}</th>
              <th className={thR}>{T.occupied}</th>
              <th className={thR}>{T.available}</th>
              <th className={thR}>{T.storageUtil}</th>
              <th className="w-8" aria-hidden />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((w) => {
              const f = w.floor;
              const s = w.storage;
              const noFloor = f.totalAreaM2 == null;
              const noStorage = s.racksCounted === 0;
              const na = <span className="text-slate-400">{L.unavailable}</span>;
              return (
                <tr
                  key={w.warehouseId}
                  tabIndex={0}
                  onClick={() => onOpen(w.warehouseId)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(w.warehouseId); } }}
                  className="cursor-pointer hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
                >
                  <td className={td}>
                    <span className="font-medium text-slate-900">{w.code}</span>
                    <span className="ml-1.5 text-slate-500">{w.name}</span>
                    {f.overCapacity && <AlertTriangle className="ml-1.5 inline h-3.5 w-3.5 text-amber-600" aria-label={L.floor.overShort} />}
                  </td>
                  <td className={tdR}>{noFloor ? na : area(f.totalAreaM2)}</td>
                  <td className={tdR}>{noFloor ? na : area(f.rackFootprintM2)}</td>
                  <td className={cn(tdR, f.overCapacity && 'text-amber-700')}>{noFloor ? na : area(f.availableM2)}</td>
                  <td className={cn(tdR, 'border-r border-slate-200', f.overCapacity && 'text-amber-700')}>{noFloor ? na : pct(f.utilPct)}</td>
                  <td className={tdR}>{noStorage ? na : area(s.areaM2.occupied)}</td>
                  <td className={tdR}>{noStorage ? na : area(s.areaM2.available)}</td>
                  <td className={tdR}>{noStorage ? na : pct(s.utilPct)}</td>
                  <td className="px-2 text-slate-400"><ChevronRight className="h-4 w-4" aria-hidden /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">{L.table.note}</p>
    </Panel>
  );
}

function RackDetails({ warehouse, onBack }: { warehouse: WarehouseSpaceSummary; onBack: () => void }) {
  const { L, t, area, pct, num } = useFormat();
  const R = L.racks;
  const [data, setData] = useState<RackSpaceResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setState('loading');
    try {
      const res = await warehouseSpaceApi.rackSpace(warehouse.warehouseId);
      if (id !== seq.current) return;
      setData(res);
      setState('ok');
    } catch {
      if (id === seq.current) setState('error');
    }
    // A new summary object (dashboard refresh) reloads the racks too, so both stay in step.
  }, [warehouse]);
  useEffect(() => { load(); }, [load]);

  const back = (
    <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-white" onClick={onBack}>
      <ArrowLeft className="h-4 w-4" aria-hidden /> {R.back}
    </Button>
  );
  const racks = data?.warehouse.warehouseId === warehouse.warehouseId ? data.racks : [];

  return (
    <Panel title={t(R.title, { code: warehouse.code })} subtitle={warehouse.name} icon={Grid3x3} actions={back}>
      {state === 'loading' && !racks.length ? <Skeleton className="h-40 rounded-lg" /> : state === 'error' ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-slate-600">{R.loadError}</p>
          <Button size="sm" onClick={load}>{L.retry}</Button>
        </div>
      ) : racks.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">{R.empty}</p>
      ) : (
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[1040px] border-collapse">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>{R.rackCode}</th>
                <th className={thR}>{R.rackSize}</th>
                <th className={thR}>{R.occupied}</th>
                <th className={thR}>{R.reserved}</th>
                <th className={thR}>{R.available}</th>
                <th className={thR}>{R.blockedOther}</th>
                <th className={cn(thR, 'border-r border-slate-200')}>{R.util}</th>
                <th className={thR}>{R.totalSlots}</th>
                <th className={thR}>{R.occupiedSlots}</th>
                <th className={thR}>{R.reservedSlots}</th>
                <th className={thR}>{R.availableSlots}</th>
                <th className={thR}>{R.blockedSlots}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {racks.map((r) => {
                const a = r.areaM2;
                const na = <span className="text-slate-400">{L.unavailable}</span>;
                const reason = !r.hasSize ? R.noSize : !r.counted ? R.noSlots : null;
                return (
                  <tr key={r.rackId} className={cn(!r.isActive && 'text-slate-400')}>
                    <td className={td}>
                      <span className="font-medium text-slate-900">{r.rackCode}</span>
                      {r.zone && <span className="ml-1.5 text-xs text-slate-400">{r.zone}</span>}
                      {reason && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{reason}</span>}
                    </td>
                    <td className={tdR}>{r.rackSizeM2 == null ? na : area(r.rackSizeM2)}</td>
                    <td className={tdR}>{a ? area(a.occupied) : na}</td>
                    <td className={tdR}>{a ? area(a.reserved) : na}</td>
                    <td className={tdR}>{a ? area(a.available) : na}</td>
                    <td className={tdR}>{a ? area(a.blockedOther) : na}</td>
                    <td className={cn(tdR, 'border-r border-slate-200')}>{r.utilPct == null ? na : pct(r.utilPct)}</td>
                    <td className={tdR}>{num(r.slots.total)}</td>
                    <td className={tdR}>{num(r.slots.occupied)}</td>
                    <td className={tdR}>{num(r.slots.reserved)}</td>
                    <td className={tdR}>{num(r.slots.available)}</td>
                    <td className={tdR}>{num(r.slots.blockedOther)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">{L.storage.subtitle}</p>
    </Panel>
  );
}
