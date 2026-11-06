'use client';

// Right panel: details of the selected slot or rack, or a summary of what is
// in view when nothing is selected.

import type { ReactNode } from 'react';
import { Crosshair, X, Filter, MousePointerClick } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { slotMatches, statusCounts, utilPercent } from '../filter-search';
import type { DataIndex } from '../data-index';
import { useStatusColors } from '../status-colors';
import { useSmartStore } from '../store';
import { SLOT_STATUSES, type SlotNode, type SlotStatus, type SmartWarehouseData } from '../types';

function Row({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-xs text-slate-500">{label}</dt>
      <dd className={cn('min-w-0 break-all text-right text-sm text-slate-800', mono && 'font-mono text-xs')}>{children}</dd>
    </div>
  );
}

export function StatusPill({ status }: { status: SlotStatus }) {
  const { m } = useT();
  const color = useStatusColors((s) => s.colors[status]);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-700">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {m.layout3d.smart.status[status]}
    </span>
  );
}

function ActionBtn({ onClick, children, testId }: { onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId}
      className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
      {children}
    </button>
  );
}

function StatusBars({ counts }: { counts: Record<SlotStatus, number> }) {
  const { m } = useT();
  const colors = useStatusColors((s) => s.colors);
  const total = SLOT_STATUSES.reduce((s, k) => s + counts[k], 0) || 1;
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
        {SLOT_STATUSES.map((s) => counts[s] ? <span key={s} style={{ width: `${(counts[s] / total) * 100}%`, background: colors[s] }} /> : null)}
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {SLOT_STATUSES.map((s) => (
          <li key={s} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="h-2 w-2 rounded-full" style={{ background: colors[s] }} />
            <span className="flex-1">{m.layout3d.smart.status[s]}</span>
            <span className="tabular-nums text-slate-800">{counts[s]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SlotGrid({ slots, levels, bays, selectedId, onPick }: {
  slots: SlotNode[]; levels: number; bays: number; selectedId?: string; onPick: (id: string) => void;
}) {
  const { m, t } = useT();
  const colors = useStatusColors((s) => s.colors);
  const at = new Map(slots.map((s) => [`${s.level}:${s.bay}`, s]));
  return (
    <div className="space-y-1" data-testid="smart3d-slot-grid">
      {Array.from({ length: levels }, (_, i) => levels - i).map((lvl) => (
        <div key={lvl} className="flex items-center gap-1">
          <span className="w-6 shrink-0 text-[10px] font-medium text-slate-400">L{lvl}</span>
          <div className="grid flex-1 gap-1" style={{ gridTemplateColumns: `repeat(${bays}, minmax(0, 1fr))` }}>
            {Array.from({ length: bays }, (_, b) => {
              const s = at.get(`${lvl}:${b + 1}`);
              if (!s) return <span key={b} className="h-6 rounded border border-dashed border-slate-200" />;
              return (
                <button key={s.id} type="button" onClick={() => onPick(s.id)} data-testid={`smart3d-grid-${s.id}`}
                  title={t(m.layout3d.smart.details.slotCell, { id: s.id, status: m.layout3d.smart.status[s.status] })}
                  className={cn('h-6 rounded border text-[9px] font-medium text-white/90 transition-transform hover:scale-105',
                    s.id === selectedId ? 'border-slate-900 ring-2 ring-slate-900/40' : 'border-black/10')}
                  style={{ background: colors[s.status] }}>
                  {String(b + 1).padStart(2, '0')}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DetailsPanel({ data, index, onOpenRack, onOpenSlot }: {
  data: SmartWarehouseData; index: DataIndex; onOpenRack: (id: string) => void; onOpenSlot: (id: string) => void;
}) {
  const { m, t } = useT();
  const D = m.layout3d.smart.details;
  const st = useSmartStore();
  const sel = st.selection;
  const slot = sel?.kind === 'slot' ? index.slot.get(sel.id) : undefined;
  const rack = sel?.kind === 'rack' ? index.rack.get(sel.id) : slot ? index.rack.get(slot.rackId) : undefined;
  const wh = index.warehouse.get((slot ?? rack)?.warehouseId ?? st.filters.warehouseId);
  const zone = rack ? index.zone.get(rack.zoneId) : undefined;
  const aisle = rack ? index.aisle.get(rack.aisleId) : undefined;

  let body: ReactNode;
  if (slot && rack) {
    const fill = slot.capacity ? Math.round((slot.qty / slot.capacity) * 100) : 0;
    body = (
      <div data-testid="smart3d-details-slot">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{D.slotId}</p>
            <p className="break-all font-mono text-sm font-semibold text-slate-900" data-testid="smart3d-details-id">{slot.id}</p>
          </div>
          <StatusPill status={slot.status} />
        </div>
        <dl className="mt-3 divide-y divide-slate-100">
          <Row label={D.warehouse}>{wh ? `${wh.code} · ${wh.name}` : '—'}</Row>
          <Row label={D.zone}>{zone ? `${zone.code} · ${zone.name}` : '—'}</Row>
          <Row label={D.aisle}>{aisle?.code ?? '—'}</Row>
          <Row label={D.rack} mono>{rack.id}</Row>
          <Row label={D.level}>{slot.level}</Row>
          <Row label={D.bay}>{slot.bay}</Row>
          <Row label={D.status}>{m.layout3d.smart.status[slot.status]}</Row>
          <Row label={D.sku} mono>{slot.sku ?? D.empty}</Row>
          <Row label={D.product}>{slot.productName ?? D.empty}</Row>
          <Row label={D.qty}><span className="tabular-nums">{slot.qty.toLocaleString()}</span></Row>
          <Row label={D.capacity}><span className="tabular-nums">{slot.capacity.toLocaleString()}</span></Row>
        </dl>
        <div className="mt-2">
          <div className="flex justify-between text-xs text-slate-500"><span>{D.fill}</span><span className="tabular-nums">{fill}%</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-600" style={{ width: `${Math.min(100, fill)}%` }} /></div>
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          <ActionBtn onClick={() => st.requestCamera('focus')} testId="smart3d-details-focus"><Crosshair className="h-3.5 w-3.5" /> {D.focus}</ActionBtn>
          <ActionBtn onClick={() => onOpenRack(rack.id)}><MousePointerClick className="h-3.5 w-3.5" /> {D.openRack}</ActionBtn>
          <ActionBtn onClick={() => st.select(null)}><X className="h-3.5 w-3.5" /> {D.clear}</ActionBtn>
        </div>
        <div className="mt-5">
          <p className="mb-2 text-xs font-medium text-slate-500">{D.slotGrid}</p>
          <SlotGrid slots={index.slotsOfRack.get(rack.id) ?? []} levels={rack.levels} bays={rack.bays} selectedId={slot.id} onPick={onOpenSlot} />
        </div>
      </div>
    );
  } else if (rack) {
    const counts = index.counts.get(rack.id) ?? statusCounts([]);
    body = (
      <div data-testid="smart3d-details-rack">
        <p className="text-[11px] uppercase tracking-wide text-slate-400">{D.rackId}</p>
        <p className="break-all font-mono text-sm font-semibold text-slate-900" data-testid="smart3d-details-id">{rack.id}</p>
        <dl className="mt-3 divide-y divide-slate-100">
          <Row label={D.warehouse}>{wh ? `${wh.code} · ${wh.name}` : '—'}</Row>
          <Row label={D.zone}>{zone ? `${zone.code} · ${zone.name}` : '—'}</Row>
          <Row label={D.aisle}>{aisle?.code ?? '—'}</Row>
          <Row label={D.rack}>{rack.code}</Row>
          <Row label={D.size}>{t(D.sizeValue, { levels: rack.levels, bays: rack.bays })}</Row>
          <Row label={D.fill}>{utilPercent(counts)}%</Row>
        </dl>
        <div className="mt-3"><StatusBars counts={counts} /></div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          <ActionBtn onClick={() => st.requestCamera('focus')} testId="smart3d-details-focus"><Crosshair className="h-3.5 w-3.5" /> {D.focus}</ActionBtn>
          <ActionBtn onClick={() => st.setRackFilter(rack.id, { zoneId: rack.zoneId, aisleId: rack.aisleId })}><Filter className="h-3.5 w-3.5" /> {D.onlyThisRack}</ActionBtn>
          <ActionBtn onClick={() => st.select(null)}><X className="h-3.5 w-3.5" /> {D.clear}</ActionBtn>
        </div>
        <div className="mt-5">
          <p className="mb-2 text-xs font-medium text-slate-500">{D.slotGrid}</p>
          <SlotGrid slots={index.slotsOfRack.get(rack.id) ?? []} levels={rack.levels} bays={rack.bays} onPick={onOpenSlot} />
        </div>
      </div>
    );
  } else {
    const set = new Set(st.filters.statuses);
    const inView = data.slots.filter((s) => slotMatches(s, st.filters, set));
    body = (
      <div data-testid="smart3d-details-none">
        <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center">
          <MousePointerClick className="mx-auto h-5 w-5 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-700">{D.none}</p>
          <p className="mt-1 text-xs text-slate-500">{D.noneHint}</p>
        </div>
        <p className="mt-5 mb-2 text-xs font-medium text-slate-500">{D.summary} · {t(D.slotsN, { n: inView.length.toLocaleString() })}</p>
        <StatusBars counts={statusCounts(inView)} />
      </div>
    );
  }

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-slate-200 bg-white" aria-label={D.title} data-testid="smart3d-details">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{D.title}</p>
        <button type="button" aria-label={m.layout3d.smart.toolbar.toggleDetails} onClick={() => st.setRightOpen(false)}
          className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{body}</div>
    </aside>
  );
}
