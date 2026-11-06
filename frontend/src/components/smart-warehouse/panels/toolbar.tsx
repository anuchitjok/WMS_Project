'use client';

// Top toolbar: warehouse, search, filters, view and pick modes, camera.

import type { ReactNode } from 'react';
import {
  Box, Crosshair, ArrowDownToLine, RectangleHorizontal, RotateCcw, ZoomIn, ZoomOut, FilterX,
  PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { hasActiveFilter, allStatuses, type SearchHit, type SearchIndex } from '../filter-search';
import { useSmartStore, type CameraView } from '../store';
import { SLOT_STATUSES, type SlotStatus, type SmartWarehouseData } from '../types';
import { SearchBox } from './search-box';

const selectCls = 'h-8 max-w-[11rem] rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/20 disabled:opacity-50';
const ALL = '';
const SOME = '__some';

function IconBtn({ label, onClick, children, disabled, active, testId }: {
  label: string; onClick: () => void; children: ReactNode; disabled?: boolean; active?: boolean; testId?: string;
}) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} data-testid={testId}
      className={cn('grid h-8 w-8 place-items-center rounded-md text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-40',
        active && 'bg-slate-100 text-slate-900')}>
      {children}
    </button>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="hidden text-xs text-slate-500 xl:inline">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
            className={cn('rounded px-2 py-1 text-xs font-medium transition-colors',
              value === o.value ? 'bg-white text-green-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800')}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Toolbar({ data, searchIndex, onSearchPick, disabled }: {
  data: SmartWarehouseData | null; searchIndex: SearchIndex | null; onSearchPick: (h: SearchHit) => void; disabled?: boolean;
}) {
  const { m, t } = useT();
  const T = m.layout3d.smart.toolbar;
  const S = m.layout3d.smart.status;
  const st = useSmartStore();
  const f = st.filters;

  const zones = data?.zones.filter((z) => z.warehouseId === f.warehouseId) ?? [];
  const aisles = data?.aisles.filter((a) => a.warehouseId === f.warehouseId && (!f.zoneId || a.zoneId === f.zoneId)) ?? [];
  const racks = data?.racks.filter((r) => r.warehouseId === f.warehouseId && (!f.zoneId || r.zoneId === f.zoneId) && (!f.aisleId || r.aisleId === f.aisleId)) ?? [];
  const statusValue = f.statuses.length === SLOT_STATUSES.length ? ALL : f.statuses.length === 1 ? f.statuses[0] : SOME;
  const cam = (v: CameraView) => () => st.requestCamera(v);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-3 py-2" data-testid="smart3d-toolbar">
      <div className="flex items-center gap-1">
        <IconBtn label={T.toggleNav} onClick={() => st.setLeftOpen(!st.leftOpen)} active={st.leftOpen}>
          {st.leftOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </IconBtn>
        <select aria-label={T.warehouse} className={cn(selectCls, 'font-medium')} value={f.warehouseId} disabled={disabled || !data}
          onChange={(e) => st.setWarehouse(e.target.value)} data-testid="smart3d-warehouse">
          {data?.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
        </select>
      </div>

      <SearchBox index={searchIndex} warehouseId={f.warehouseId} onPick={onSearchPick} />

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={T.filters}>
        <select aria-label={T.zone} className={selectCls} value={f.zoneId ?? ALL} disabled={disabled} data-testid="smart3d-filter-zone"
          onChange={(e) => st.setZone(e.target.value || null)}>
          <option value={ALL}>{T.allZones}</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.code} · {z.name}</option>)}
        </select>
        <select aria-label={T.aisle} className={selectCls} value={f.aisleId ?? ALL} disabled={disabled} data-testid="smart3d-filter-aisle"
          onChange={(e) => {
            const a = data?.aisles.find((x) => x.id === e.target.value);
            st.setAisle(e.target.value || null, a ? a.zoneId : undefined);
          }}>
          <option value={ALL}>{T.allAisles}</option>
          {aisles.map((a) => <option key={a.id} value={a.id}>{a.code}</option>)}
        </select>
        <select aria-label={T.rack} className={selectCls} value={f.rackId ?? ALL} disabled={disabled} data-testid="smart3d-filter-rack"
          onChange={(e) => {
            const r = data?.racks.find((x) => x.id === e.target.value);
            st.setRackFilter(e.target.value || null, r ? { zoneId: r.zoneId, aisleId: r.aisleId } : undefined);
          }}>
          <option value={ALL}>{T.allRacks}</option>
          {racks.map((r) => <option key={r.id} value={r.id}>{data?.aisles.find((a) => a.id === r.aisleId)?.code}-{r.code}</option>)}
        </select>
        <select aria-label={T.status} className={selectCls} value={statusValue} disabled={disabled} data-testid="smart3d-filter-status"
          onChange={(e) => {
            const v = e.target.value;
            if (v === ALL) st.setStatuses(allStatuses());
            else if (v !== SOME) st.setStatuses([v as SlotStatus]);
          }}>
          <option value={ALL}>{T.allStatuses}</option>
          {statusValue === SOME && <option value={SOME} disabled>{t(T.someStatuses, { n: f.statuses.length })}</option>}
          {SLOT_STATUSES.map((s) => <option key={s} value={s}>{S[s]}</option>)}
        </select>
        {hasActiveFilter(f) && (
          <button type="button" onClick={st.clearFilters} data-testid="smart3d-clear-filters"
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-100">
            <FilterX className="h-3.5 w-3.5" /> {T.clearFilters}
          </button>
        )}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-3">
        <Segmented label={T.view} value={st.viewMode} onChange={st.setViewMode}
          options={[{ value: 'realistic', label: T.realistic }, { value: 'status', label: T.statusView }]} />
        <Segmented label={T.pick} value={st.pickMode} onChange={st.setPickMode}
          options={[{ value: 'slot', label: T.pickSlot }, { value: 'rack', label: T.pickRack }]} />
        <div className="flex items-center rounded-md border border-slate-200 bg-white" role="group" aria-label={T.camera}>
          <IconBtn label={T.reset} onClick={cam('reset')} disabled={disabled} testId="smart3d-cam-reset"><RotateCcw className="h-4 w-4" /></IconBtn>
          <IconBtn label={T.top} onClick={cam('top')} disabled={disabled} testId="smart3d-cam-top"><ArrowDownToLine className="h-4 w-4" /></IconBtn>
          <IconBtn label={T.front} onClick={cam('front')} disabled={disabled} testId="smart3d-cam-front"><RectangleHorizontal className="h-4 w-4" /></IconBtn>
          <IconBtn label={T.iso} onClick={cam('iso')} disabled={disabled} testId="smart3d-cam-iso"><Box className="h-4 w-4" /></IconBtn>
          <IconBtn label={T.focus} onClick={cam('focus')} disabled={disabled || !st.selection} testId="smart3d-cam-focus"><Crosshair className="h-4 w-4" /></IconBtn>
          <IconBtn label={T.zoomIn} onClick={cam('zoomIn')} disabled={disabled}><ZoomIn className="h-4 w-4" /></IconBtn>
          <IconBtn label={T.zoomOut} onClick={cam('zoomOut')} disabled={disabled}><ZoomOut className="h-4 w-4" /></IconBtn>
        </div>
        <IconBtn label={T.toggleDetails} onClick={() => st.setRightOpen(!st.rightOpen)} active={st.rightOpen}>
          {st.rightOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </IconBtn>
      </div>
    </div>
  );
}
