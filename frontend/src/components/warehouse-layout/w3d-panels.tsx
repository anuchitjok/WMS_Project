'use client';

// Panels around the 3D canvas: view modes + area (used by the header in
// w3d-tower.tsx), search + filter bar, Location Details (Stock Info / History / Related) and the bottom summary.
// UI only: data arrives through props from warehouse-3d.tsx / use-w3d-data.ts.

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Box, Warehouse as WarehouseIcon, Columns3, Search, X, MapPin, Package, Loader2,
  RotateCcw, Clock, Gauge, Crosshair, ExternalLink, History, Link2, AlertTriangle,
} from 'lucide-react';
import { inventoryApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn, formatDate } from '@/lib/utils';
import { getT, labelOf, useT } from '@/i18n';
import { type WarehouseData, type RackData, type SlotData, slotItems, slotUtil } from './occupancy';
import { type SlotState3D, type EnvMode, STATE_3D, STATE_ORDER, slotState3D, NO_ZONE } from './scene-geometry';
import { NOT_IN_LOCATION, type HistoryEntry, type RelatedSlot, type LoadState } from './use-w3d-data';
import { floorAreaM2 } from './floor-geometry';

export const ALL = '__all';
const pad2 = (n: number) => String(n).padStart(2, '0');
const DAY = 86_400_000;

export function StatusPill({ state, className }: { state: SlotState3D; className?: string }) {
  const { m } = useT();
  return (
    <span className={cn('inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', STATE_3D[state].pill, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', STATE_3D[state].dot)} />{m.layout3d.w3d.status[state]}
    </span>
  );
}

function Meter({ value, tone = 'green' }: { value: number; tone?: 'green' | 'orange' }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-200">
      <div className={cn('h-1.5 rounded-full transition-[width]', tone === 'orange' ? 'bg-amber-500' : 'bg-emerald-600')} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

// ─── Warehouse area card (real size from Warehouse Master) ─────────────────────

/**
 * Floor area from Warehouse Master (same formula as its form): the real floor shape
 * when one is saved (D3), otherwise L × W; usable = area × usable %.
 */
export function warehouseArea(wh: Pick<WarehouseData, 'lengthCm' | 'widthCm' | 'usableAreaPct' | 'floorOutline'>) {
  const l = wh.lengthCm, w = wh.widthCm;
  if (!(typeof l === 'number' && l > 0 && typeof w === 'number' && w > 0)) return null;
  const pct = typeof wh.usableAreaPct === 'number' && wh.usableAreaPct > 0 ? Math.min(100, wh.usableAreaPct) : 100;
  const area = floorAreaM2(wh) ?? (l * w) / 10_000;
  return { lengthM: l / 100, widthM: w / 100, areaM2: area, usableM2: (area * pct) / 100, pct };
}

// ─── View modes (header switch) ───────────────────────────────────────────────

export const ENV_MODES: { id: EnvMode; icon: React.ElementType }[] = [
  { id: 'open', icon: Box },
  { id: 'full', icon: WarehouseIcon },
  { id: 'rack', icon: Columns3 },
];


// ─── Search: location code (local), SKU / serial (existing /inventory search) ──

type SearchHit = { key: string; title: string; sub: string } & (
  | { kind: 'location' | 'stock'; slotId: string }
  | { kind: 'rack'; rackId: string }
);

function SlotSearch({ warehouseId, slots, racks, onPick, onPickRack }: {
  warehouseId: string;
  slots: Map<string, { slot: SlotData; rack: RackData }>;
  racks: RackData[];
  onPick: (slotId: string) => void;
  onPickRack: (rackId: string) => void;
}) {
  const { m, t } = useT();
  const S = m.layout3d.search, V = m.layout3d.view, W = m.layout3d.w3d;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [stock, setStock] = useState<SearchHit[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const boxRef = useRef<HTMLDivElement>(null);
  const term = q.trim();

  // Rack codes first (PR8 Phase 2): an exact code on top, then codes that contain the term.
  const rackHits = useMemo<SearchHit[]>(() => {
    if (!term) return [];
    const needle = term.toLowerCase();
    return racks
      .filter((r) => r.code.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.code.toLowerCase() === needle) - Number(a.code.toLowerCase() === needle)
        || a.code.localeCompare(b.code, undefined, { numeric: true }))
      .slice(0, 5)
      .map((r) => ({ key: `r:${r.id}`, rackId: r.id, kind: 'rack' as const, title: r.code,
        sub: [S.rackHit, r.zone ? t(V.zoneN, { zone: r.zone }) : '', t(S.rackSlots, { n: (r.slots ?? []).length })].filter(Boolean).join(' · ') }));
  }, [term, racks, t, S, V]);

  const locations = useMemo<SearchHit[]>(() => {
    if (!term) return [];
    const needle = term.toLowerCase();
    const out: SearchHit[] = [];
    for (const { slot, rack } of slots.values()) {
      if (slot.code.toLowerCase().includes(needle)) {
        out.push({ key: `l:${slot.id}`, slotId: slot.id, kind: 'location', title: slot.code,
          sub: [t(V.rackN, { rack: rack.code }), rack.zone ? t(V.zoneN, { zone: rack.zone }) : '', W.status[slotState3D(slot)]].filter(Boolean).join(' · ') });
        if (out.length >= 5) break;
      }
    }
    return out;
  }, [term, slots, t, V, W]);

  // SKU / serial / batch / product name through the existing inventory search.
  useEffect(() => {
    if (term.length < 2) { setStock([]); setState('idle'); return; }
    let cancelled = false;
    setState('loading');
    const timer = setTimeout(() => {
      inventoryApi.list({ search: term, warehouseId, limit: 50 })
        .then((res) => {
          if (cancelled) return;
          const { m: gm, t: gt } = getT();
          const hits: SearchHit[] = [];
          const seen = new Set<string>();
          for (const it of res.data ?? []) {
            if (!it.slotId || !slots.has(it.slotId) || NOT_IN_LOCATION.has(String(it.status))) continue;
            const key = `s:${it.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const loc = slots.get(it.slotId)!;
            hits.push({ key, slotId: it.slotId, kind: 'stock',
              title: `${it.product?.code ?? gm.layout3d.search.item}${it.serialNumber ? ` · ${it.serialNumber}` : ''}`,
              sub: gt(gm.layout3d.search.inSlot, { slot: loc.slot.code, qty: it.quantity }) });
            if (hits.length >= 6) break;
          }
          setStock(hits); setState('idle');
        })
        .catch(() => { if (!cancelled) { setStock([]); setState('error'); } });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [term, warehouseId, slots]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const hits = [...rackHits, ...locations, ...stock];
  const pick = (h: SearchHit) => {
    if (h.kind === 'rack') onPickRack(h.rackId); else onPick(h.slotId);
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative min-w-0 flex-[1.6_1_16rem]">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits[0]) { e.preventDefault(); pick(hits[0]); }
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder={S.placeholder}
        aria-label={S.aria}
        className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-9 text-sm text-slate-800 shadow-sm outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      />
      {q && (
        <button type="button" onClick={() => { setQ(''); setStock([]); }} aria-label={S.clear}
          className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {open && term && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
          {hits.map((h) => (
            <button key={h.key} type="button" onClick={() => pick(h)}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-emerald-50">
              {h.kind === 'rack'
                ? <Columns3 className="mt-0.5 h-4 w-4 flex-shrink-0 text-cyan-600" />
                : h.kind === 'location'
                ? <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                : <Package className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />}
              <span className="min-w-0">
                <span className="block truncate font-mono text-sm font-semibold text-slate-800">{h.title}</span>
                <span className="block truncate text-xs text-slate-500">{h.sub}</span>
              </span>
            </button>
          ))}
          {state === 'loading' && (
            <p className="flex items-center gap-2 px-2.5 py-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {S.searching}</p>
          )}
          {state === 'error' && <p className="px-2.5 py-2 text-xs text-red-600">{S.error}</p>}
          {state === 'idle' && hits.length === 0 && (
            <p className="px-2.5 py-2 text-xs text-slate-500">{t(S.noMatch, { term })}</p>
          )}
          {term.length === 1 && <p className="px-2.5 pb-1 text-xs text-slate-400">{S.typeMore}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

export interface Filters { zone: string; rackId: string; status: string; fill: string }
export const NO_FILTERS: Filters = { zone: ALL, rackId: ALL, status: ALL, fill: ALL };

/** Where filter dropdowns open. The stage passes itself while fullscreen, since body is not shown then. */
export const PopupContainer = createContext<HTMLElement | null>(null);

function FilterSelect({ label, value, onChange, options, render, width = 'flex-[1_1_8.5rem]' }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; render: (v: string) => string; width?: string;
}) {
  const container = useContext(PopupContainer);
  return (
    <div className={cn('min-w-0 rounded-xl border border-slate-200 bg-white px-3 pt-1.5 shadow-sm', width)}>
      <p className="text-[11px] leading-none text-slate-500">{label}</p>
      <Select value={value} onValueChange={(v) => onChange((v as string) ?? ALL)}>
        <SelectTrigger aria-label={label} className="h-8 w-full border-0 bg-transparent px-0 text-sm font-medium shadow-none focus-visible:ring-0">
          <SelectValue>{(v: string) => render(v)}</SelectValue>
        </SelectTrigger>
        <SelectContent container={container ?? undefined}>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export function FilterBar({ warehouses, wh, onWarehouse, slots, racks, zones, zoneRacks, filters, onFilters, onPickSlot, onPickRack, onReset }: {
  warehouses: WarehouseData[]; wh: WarehouseData; onWarehouse: (id: string) => void;
  slots: Map<string, { slot: SlotData; rack: RackData }>;
  zones: string[]; zoneRacks: RackData[];
  filters: Filters; onFilters: (f: Filters) => void;
  onPickSlot: (slotId: string) => void; onReset: () => void;
  /** Every rack of the warehouse, for rack-code search. */
  racks: RackData[];
  onPickRack: (rackId: string) => void;
}) {
  const { m, t } = useT();
  const F = m.layout3d.w3d.filters, V = m.layout3d.view, W = m.layout3d.w3d;
  const zoneLabel = (v: string) => (v === ALL ? V.allZones : v === NO_ZONE ? V.noZone : t(V.zoneN, { zone: v }));
  const rackLabel = (v: string) => (v === ALL ? V.allRacks : zoneRacks.find((r) => r.id === v)?.code ?? v);
  const statusLabel = (v: string) => (v === ALL ? F.allStatus : W.status[v as SlotState3D] ?? v);
  const whLabel = (v: string) => warehouses.find((w) => w.id === v)?.code ?? v;

  return (
    <div className="flex flex-wrap items-stretch gap-2">
      <SlotSearch warehouseId={wh.id} slots={slots} racks={racks} onPick={onPickSlot} onPickRack={onPickRack} />
      <FilterSelect label={F.warehouse} value={wh.id} onChange={(v) => v !== ALL && onWarehouse(v)} render={whLabel}
        options={warehouses.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} width="flex-[1_1_10rem]" />
      <FilterSelect label={F.zone} value={filters.zone} render={zoneLabel}
        onChange={(v) => onFilters({ ...filters, zone: v, rackId: ALL })}
        options={[{ value: ALL, label: V.allZones }, ...zones.map((z) => ({ value: z, label: zoneLabel(z) }))]} />
      <FilterSelect label={F.rack} value={filters.rackId} render={rackLabel}
        onChange={(v) => onFilters({ ...filters, rackId: v })}
        options={[{ value: ALL, label: V.allRacks }, ...zoneRacks.map((r) => ({ value: r.id, label: r.code }))]} />
      <FilterSelect label={F.status} value={filters.status} render={statusLabel}
        onChange={(v) => onFilters({ ...filters, status: v })}
        options={[{ value: ALL, label: F.allStatus }, ...STATE_ORDER.map((s) => ({ value: s, label: W.status[s] }))]} />
      <Button variant="outline" className="h-auto min-h-12 gap-1.5 rounded-xl bg-white px-4" onClick={onReset}>
        <RotateCcw className="h-4 w-4" /> {F.reset}
      </Button>
    </div>
  );
}

// ─── Location details ─────────────────────────────────────────────────────────

function DRow({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 text-sm">
      <dt className="text-slate-500">{k}</dt>
      <dd className="min-w-0 break-words font-medium text-slate-800">{v}</dd>
    </div>
  );
}

export type DetailTab = 'stock' | 'history' | 'related';

export interface SlotStock {
  /** Sum of quantity over the rows returned (latest 10). */
  qty: number;
  /** Distinct product codes among the rows returned. */
  skus: string[];
  first: any | null;
  items: any[];
  lastMove: string | null;
}

export function summarizeSlot(slot: SlotData, detail: any): SlotStock {
  const items: any[] = detail?.stockItems ?? [];
  const skus = [...new Set(items.map((it) => it.product?.code).filter(Boolean))] as string[];
  const first = items[0] ?? null;
  return { qty: items.reduce((a, it) => a + (Number(it.quantity) || 0), 0), skus, first, items, lastMove: first?.updatedAt ?? null };
}

export function LocationDetails({ wh, rack, slot, detail, detailState, age, ageState, tab, onTab, history, related, slotCode,
  onRetry, onClose, onFocusSlot, onFocusRack, onViewStock, onGoSlot, onOpenRack }: {
  wh: WarehouseData; rack: RackData | null; slot: SlotData | null;
  detail: any; detailState: 'idle' | 'loading' | 'error';
  age: { days: number; oldest: string } | null; ageState: LoadState;
  tab: DetailTab; onTab: (t: DetailTab) => void;
  history: { state: LoadState; rows: HistoryEntry[] };
  related: { state: LoadState; slots: RelatedSlot[]; partial?: boolean };
  slotCode: (slotId: string) => string | null;
  onRetry: () => void; onClose: () => void; onFocusSlot: () => void; onFocusRack: () => void;
  onViewStock: (slotId: string) => void; onGoSlot: (slotId: string) => void;
  /** Back to the rack panel of this slot's rack. */
  onOpenRack?: () => void;
}) {
  const { m, t } = useT();
  const D = m.layout3d.w3d.details;

  if (!slot) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-base font-semibold text-slate-900">{D.title}</h2></div>
        <div className="p-8 text-center">
          <MapPin className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm text-slate-500">{D.emptyHint}</p>
        </div>
      </div>
    );
  }

  const st = slotState3D(slot);
  const rows = slotItems(slot);
  const util = slotUtil(slot);
  const loading = detailState === 'loading' && !detail;
  const s = summarizeSlot(slot, detail);
  const dash = loading ? '…' : '—';
  const more = rows > s.items.length && !loading;

  const tabs: { id: DetailTab; label: string; icon: React.ElementType }[] = [
    { id: 'stock', label: D.tabStock, icon: Package },
    { id: 'history', label: D.tabHistory, icon: History },
    { id: 'related', label: D.tabRelated, icon: Link2 },
  ];

  let tabBody: ReactNode;
  if (loading) {
    tabBody = <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> {D.loading}</p>;
  } else if (!s.items.length) {
    tabBody = <p className="text-sm text-slate-500">{tab === 'history' ? D.historyNoStock : rows ? D.loadError : D.noStock}</p>;
  } else if (tab === 'stock') {
    tabBody = (
      <>
        <ul className="space-y-1.5">
          {s.items.map((it) => (
            <li key={it.id} className="flex items-start gap-2.5 rounded-lg border border-slate-100 px-2.5 py-2">
              <span className="mt-0.5 grid h-8 w-8 flex-shrink-0 place-items-center rounded-md bg-amber-50 text-amber-700"><Package className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs font-semibold text-slate-800">{it.serialNumber || <span className="font-sans font-normal text-slate-400">{D.noSerial}</span>}</span>
                  <span className="flex-shrink-0 text-xs tabular-nums text-slate-600">{it.quantity} {it.product?.unit ?? D.pcs}</span>
                </div>
                <p className="truncate text-xs text-slate-500">
                  <span className="font-mono">{it.product?.code}</span>
                  {it.batchNumber && <> · {t(D.batchN, { batch: it.batchNumber })}</>}
                </p>
                {it.receivedDate && <p className="text-xs text-slate-400">{t(D.receivedOn, { date: formatDate(it.receivedDate) })}</p>}
              </div>
            </li>
          ))}
        </ul>
        {more && <p className="mt-2 text-xs text-slate-400">{t(D.latestOf, { n: s.items.length, total: rows })}</p>}
      </>
    );
  } else if (tab === 'history') {
    tabBody = history.state === 'loading' || history.state === 'idle'
      ? <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> {D.loading}</p>
      : history.state === 'error'
        ? <p className="flex items-start gap-2 text-sm text-slate-500"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" /> {D.historyError}</p>
        : (
          <>
            <p className="mb-2 text-xs text-slate-400">{D.historyOf}{s.first?.serialNumber ? ` (${s.first.serialNumber})` : ''}</p>
            {history.rows.length === 0 ? <p className="text-sm text-slate-500">{D.historyEmpty}</p> : (
              <ol className="space-y-2 border-l border-slate-200 pl-3">
                {history.rows.map((h) => (
                  <li key={h.id} className="relative">
                    <span className="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full bg-blue-500 ring-2 ring-white" />
                    <p className="text-sm font-medium text-slate-800">{labelOf(m.status.action, h.action)}</p>
                    <p className="text-xs text-slate-500">{formatDate(h.at)}{h.by ? ` · ${h.by}` : ''}</p>
                  </li>
                ))}
              </ol>
            )}
          </>
        );
  } else {
    const sku = s.skus[0] ?? '';
    tabBody = related.state === 'loading' || related.state === 'idle'
      ? <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> {D.loading}</p>
      : related.state === 'error'
        ? <p className="text-sm text-red-600">{D.relatedError}</p>
        : related.slots.length === 0
          ? <p className="text-sm text-slate-500">{t(D.relatedEmpty, { sku })}</p>
          : (
            <>
              <p className="mb-2 text-xs text-slate-400">{t(D.relatedOf, { sku })}</p>
              <ul className="space-y-1">
                {related.slots.map((r) => (
                  <li key={r.slotId}>
                    <button type="button" onClick={() => onGoSlot(r.slotId)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-emerald-50">
                      <span className="flex min-w-0 items-center gap-2"><MapPin className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
                        <span className="truncate font-mono text-sm font-medium text-blue-700">{slotCode(r.slotId) ?? r.slotId}</span></span>
                      <span className="flex-shrink-0 text-xs tabular-nums text-slate-600">{t(D.relatedQty, { qty: r.qty.toLocaleString(), unit: r.unit ?? D.pcs })}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {related.partial && <p className="mt-2 text-xs text-slate-400">{D.relatedPartial}</p>}
            </>
          );
  }

  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-3">
        <h2 className="text-base font-semibold text-slate-900">{D.title}</h2>
        <div className="flex items-center gap-1">
          <StatusPill state={st} />
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label={D.close}>
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <p className="truncate border-b border-slate-100 px-4 pb-3 font-mono text-lg font-semibold text-slate-900" title={slot.code}>{slot.code}</p>

      <dl className="space-y-1.5 px-4 py-3">
        <DRow k={D.warehouse} v={wh.code} />
        <DRow k={D.zone} v={rack?.zone || '—'} />
        <DRow k={D.rack} v={rack && onOpenRack ? (
          <button type="button" onClick={onOpenRack} title={m.layout3d.w3d.rackPanel.open}
            className="font-mono text-blue-700 underline-offset-2 hover:underline">{rack.code}</button>
        ) : rack?.code ?? '—'} />
        <DRow k={D.level} v={pad2(slot.level)} />
        <DRow k={D.slot} v={pad2(slot.column)} />
      </dl>

      <dl className="mx-4 space-y-1.5 border-t border-slate-100 py-3">
        {detailState === 'error' ? (
          <div className="flex items-center justify-between gap-2 text-xs text-red-600">
            {D.loadError}
            <Button size="sm" variant="outline" className="h-7 bg-white text-xs" onClick={onRetry}>{D.retry}</Button>
          </div>
        ) : !rows ? (
          <p className="flex items-start gap-2 text-sm text-slate-500">
            {st === 'blocked' ? <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" /> : <Box className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-300" />}
            {st === 'blocked' ? D.blockedNote : D.noStock}
          </p>
        ) : (
          <>
            <DRow k={D.sku} v={s.skus.length ? <span className="font-mono">{s.skus[0]}{s.skus.length > 1 && <span className="ml-1 font-sans text-xs font-normal text-slate-400">{t(D.moreSkus, { n: s.skus.length - 1 })}</span>}</span> : dash} />
            <DRow k={D.product} v={s.first?.product?.name ?? dash} />
            <DRow k={D.stockQty} v={loading ? '…' : `${s.qty.toLocaleString()}${more ? '+' : ''} ${s.first?.product?.unit ?? D.pcs}`} />
            <DRow k={D.capacity} v={t(D.capacityValue, { rows, capacity: slot.capacity })} />
            {(slot.reservedRows ?? 0) > 0 && (
              <DRow k={D.reserved} v={<span className="text-violet-700">{t(D.reservedValue, { rows: slot.reservedRows ?? 0, qty: (slot.reservedQty ?? 0).toLocaleString() })}</span>} />
            )}
            <DRow k={D.occupancy} v={<span className="block"><span className="tabular-nums">{util}%</span><span className="mt-1 block"><Meter value={util} tone={util >= 90 ? 'orange' : 'green'} /></span></span>} />
            <DRow k={D.stockAge} v={age ? t(D.ageDays, { days: age.days }) : ageState === 'loading' ? D.ageLoading : '—'} />
            <DRow k={D.lastMove} v={s.lastMove ? formatDate(s.lastMove) : dash} />
          </>
        )}
      </dl>

      <div className="mx-3 mt-1 flex rounded-lg bg-slate-100 p-0.5" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => onTab(x.id)}
            className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors',
              tab === x.id ? 'bg-white font-semibold text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
            <x.icon className="h-3.5 w-3.5" /> {x.label}
          </button>
        ))}
      </div>
      <div className="max-h-60 overflow-y-auto px-4 py-3" role="tabpanel">{tabBody}</div>

      <div className="grid grid-cols-2 gap-2 border-t border-slate-100 px-4 py-3">
        <Button variant="outline" className="h-9 gap-1.5 bg-white text-xs" onClick={onFocusSlot}><Crosshair className="h-4 w-4" /> {D.focusSlot}</Button>
        <Button variant="outline" className="h-9 gap-1.5 bg-white text-xs" onClick={onFocusRack}><Columns3 className="h-4 w-4" /> {D.focusRack}</Button>
        <Button className="col-span-2 h-10 gap-2 bg-emerald-700 text-white hover:bg-emerald-800" onClick={() => onViewStock(slot.id)}>
          <ExternalLink className="h-4 w-4" /> {D.viewStock}
        </Button>
      </div>
    </div>
  );
}

// ─── Bottom summary ───────────────────────────────────────────────────────────

export function BottomSummary({ rack, slot, detail, detailLoading }: {
  rack: RackData | null; slot: SlotData | null; detail: any; detailLoading: boolean;
}) {
  const { m, t } = useT();
  const B = m.layout3d.w3d.bottom;
  const icon = (n: ReactNode) => <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">{n}</span>;
  const cell = 'flex min-w-0 items-center gap-3';
  const sep = 'xl:border-l xl:border-slate-100 xl:pl-5';

  if (!slot) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        {icon(<MapPin className="h-5 w-5" />)}
        <div><p className="text-xs text-slate-500">{B.selected}</p><p className="text-sm font-medium text-slate-500">{B.none}</p></div>
      </div>
    );
  }
  const s = summarizeSlot(slot, detail);
  const rows = slotItems(slot), util = slotUtil(slot);
  const more = rows > s.items.length && !detailLoading;
  const last = s.lastMove ? Date.parse(s.lastMove) : NaN;
  const ago = Number.isFinite(last) ? Math.max(0, Math.floor((Date.now() - last) / DAY)) : null;

  return (
    <div className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm sm:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr]">
      <div className={cell}>
        {icon(<MapPin className="h-5 w-5" />)}
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{B.selected}</p>
          <p className="flex flex-wrap items-center gap-2"><span className="truncate font-mono text-base font-semibold text-slate-900">{slot.code}</span><StatusPill state={slotState3D(slot)} /></p>
          <p className="truncate text-xs text-slate-500">{t(B.path, { zone: rack?.zone || '—', rack: rack?.code ?? '—', level: pad2(slot.level), slot: pad2(slot.column) })}</p>
        </div>
      </div>
      <div className={cn(cell, sep)}>
        {icon(<Package className="h-5 w-5" />)}
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{B.stockSummary}</p>
          <p className="text-base font-semibold tabular-nums text-slate-900">
            {detailLoading ? '…' : `${t(m.layout3d.w3d.details.relatedQty, { qty: `${s.qty.toLocaleString()}${more ? '+' : ''}`, unit: s.first?.product?.unit ?? m.layout3d.w3d.details.pcs })}`}
            {s.skus[0] && <span className="ml-2 font-mono text-xs font-normal text-slate-500">{s.skus[0]}</span>}
          </p>
          <p className="text-xs tabular-nums text-slate-500">{t(B.rowsOf, { rows, capacity: slot.capacity })}</p>
        </div>
      </div>
      <div className={cn(cell, sep)}>
        {icon(<Gauge className="h-5 w-5" />)}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-500">{B.utilization}</p>
          <p className="text-base font-semibold tabular-nums text-slate-900">{util}%</p>
          <Meter value={util} tone={util >= 90 ? 'orange' : 'green'} />
        </div>
      </div>
      <div className={cn(cell, sep)}>
        {icon(<Clock className="h-5 w-5" />)}
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{B.lastMovement}</p>
          <p className="text-base font-semibold tabular-nums text-slate-900">{s.lastMove ? formatDate(s.lastMove) : '—'}</p>
          <p className="text-xs text-slate-500">{ago == null ? B.noMovement : ago === 0 ? B.today : t(B.daysAgo, { n: ago })}</p>
        </div>
      </div>
    </div>
  );
}
