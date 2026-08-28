'use client';

// Property panel for the selected layout object (Sprint 5).
// Edits are local; they reach the server on the next batch save.
// slotId / rackId are deliberately absent — linking is Sprint 6.

import { Layers } from 'lucide-react';
import type { LayoutObject, LayoutObjectType, LayoutObjectStatus } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { OBJECT_STYLES } from './layout-object';

const TYPES: LayoutObjectType[] = [
  'ZONE', 'RACK', 'SHELF', 'BIN', 'AISLE', 'STORAGE_AREA',
  'RECEIVING_AREA', 'SHIPPING_AREA', 'STAGING_AREA', 'QC_AREA', 'WORK_AREA', 'CUSTOM_AREA',
];
const STATUSES: LayoutObjectStatus[] = ['ACTIVE', 'INACTIVE', 'BLOCKED', 'PLANNED'];
const label = (t: string) => t.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

function Field({ label: l, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-medium text-slate-500 block mb-1">{l}</label>
      {children}
    </div>
  );
}

const selectCls = 'w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm bg-white';

// <input type="color"> needs a concrete hex; the type default may be
// "transparent", which it silently rejects.
function swatch(color: string | null, typeFill: string) {
  if (color) return color;
  return typeFill === 'transparent' ? '#ffffff' : typeFill;
}

export function PropertyPanel({ objects, unitLabel, onPatch }: {
  objects: LayoutObject[];
  unitLabel: string;
  onPatch: (ids: string[], patch: Partial<LayoutObject>) => void;
}) {
  if (objects.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm text-center">
        <Layers className="h-8 w-8 mx-auto text-slate-300" />
        <p className="mt-2 text-sm font-medium text-slate-600">Properties</p>
        <p className="text-xs text-slate-400">Select an object to edit it, or add one from the toolbar</p>
      </div>
    );
  }

  const ids = objects.map((o) => o.id);

  // Multi-select: only offer the fields that make sense applied to everything.
  if (objects.length > 1) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-1">Properties</h2>
        <p className="text-xs text-slate-400 mb-3">{objects.length} objects selected</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className={selectCls} defaultValue="" onChange={(e) => e.target.value && onPatch(ids, { objectType: e.target.value as LayoutObjectType })}>
              <option value="">Mixed — keep</option>
              {TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={selectCls} defaultValue="" onChange={(e) => e.target.value && onPatch(ids, { status: e.target.value as LayoutObjectStatus })}>
              <option value="">Mixed — keep</option>
              {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </Field>
        </div>
      </div>
    );
  }

  const obj = objects[0];
  const style = OBJECT_STYLES[obj.objectType];
  const num = (v: string, fallback: number) => (v === '' || Number.isNaN(Number(v)) ? fallback : Number(v));

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="h-3.5 w-3.5 rounded-sm border flex-shrink-0"
          style={{ background: obj.color ?? style.fill, borderColor: style.stroke }} />
        <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Properties</h2>
      </div>

      <div className="space-y-3">
        <Field label="Name">
          <Input value={obj.name} onChange={(e) => onPatch(ids, { name: e.target.value })} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Code">
            <Input value={obj.code ?? ''} placeholder="A-01-01"
              onChange={(e) => onPatch(ids, { code: e.target.value || null })} />
          </Field>
          <Field label="Type">
            <select className={selectCls} value={obj.objectType}
              onChange={(e) => onPatch(ids, { objectType: e.target.value as LayoutObjectType })}>
              {TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={`X (${unitLabel})`}>
            <Input type="number" step="0.5" min={0} value={obj.x}
              onChange={(e) => onPatch(ids, { x: Math.max(0, num(e.target.value, obj.x)) })} />
          </Field>
          <Field label={`Y (${unitLabel})`}>
            <Input type="number" step="0.5" min={0} value={obj.y}
              onChange={(e) => onPatch(ids, { y: Math.max(0, num(e.target.value, obj.y)) })} />
          </Field>
          <Field label={`Width (${unitLabel})`}>
            <Input type="number" step="0.5" min={0.5} value={obj.width}
              onChange={(e) => onPatch(ids, { width: Math.max(0.5, num(e.target.value, obj.width)) })} />
          </Field>
          <Field label={`Height (${unitLabel})`}>
            <Input type="number" step="0.5" min={0.5} value={obj.height}
              onChange={(e) => onPatch(ids, { height: Math.max(0.5, num(e.target.value, obj.height)) })} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <select className={selectCls} value={obj.status}
              onChange={(e) => onPatch(ids, { status: e.target.value as LayoutObjectStatus })}>
              {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </Field>
          <Field label="Capacity">
            <Input type="number" min={0} value={obj.capacity ?? ''} placeholder="—"
              onChange={(e) => onPatch(ids, { capacity: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })} />
          </Field>
        </div>

        <Field label="Colour">
          <div className="flex items-center gap-2">
            {/* NB: parenthesised deliberately — `a ?? b === c ? x : y` binds as
                `(a ?? (b === c)) ? x : y`, which makes every set colour render white. */}
            <input type="color" value={swatch(obj.color, style.fill)}
              onChange={(e) => onPatch(ids, { color: e.target.value })}
              className="h-9 w-12 rounded-lg border border-slate-200 bg-white p-1" />
            <button type="button" onClick={() => onPatch(ids, { color: null })}
              className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2">
              Use type default
            </button>
          </div>
        </Field>
      </div>

      <p className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-400">
        Linking this object to a WMS location arrives in the next sprint.
      </p>
    </div>
  );
}
