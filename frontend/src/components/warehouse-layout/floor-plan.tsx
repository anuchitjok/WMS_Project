'use client';

// Warehouse Operations — Floor Plan tab.
// Sprint 4 shipped the read-only view; Sprint 5 adds the editor behind a mode
// toggle that only SYSTEM_ADMIN / WAREHOUSE_MANAGER can reach (the API enforces
// the same roles — this only avoids offering a control that would 403).
//
// Editing is local and flushed in ONE batch request per save. The app is behind
// a global 100 req/min throttle, so a request per drag is not an option.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// `Map` is aliased: the bare name would shadow the global Map constructor,
// which this file uses for the occupancy lookup.
import { Map as MapIcon, AlertTriangle, RefreshCw, Link2Off, Info, Pencil, Eye, Plus, Link2, Unlink, Rows3, Printer } from 'lucide-react';
import { toast } from 'sonner';
import {
  layoutApi, type LayoutResponse, type LayoutObject, type LayoutObjectType, type LayoutOccupancy,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/store/auth.store';
import { useDiscardGuard } from '@/hooks/use-discard-guard';
import { DiscardChangesDialog } from '@/components/ui/discard-changes-dialog';
import type { UserRole } from '@/types';
import { cn } from '@/lib/utils';
import { LayoutCanvas } from './layout-canvas';
import { OBJECT_STYLES } from './layout-object';
import { LayoutToolbar } from './layout-toolbar';
import { PropertyPanel } from './property-panel';
import { useLayoutEditor } from './use-layout-editor';
import { LinkSlotDialog } from './link-slot-dialog';
import { LocationInventoryPanel } from './location-inventory-panel';
import { printFloorPlan } from './print-floor-plan';

const EDIT_ROLES: UserRole[] = ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER'];
const TYPE_LABEL = (t: string) => t.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

// Sensible starting footprints, in grid units, per object type.
const DEFAULT_SIZE: Partial<Record<LayoutObjectType, [number, number]>> = {
  ZONE: [20, 14], RACK: [12, 4], SHELF: [6, 2], BIN: [2, 2], AISLE: [16, 2.5],
  STORAGE_AREA: [16, 10], RECEIVING_AREA: [12, 5], SHIPPING_AREA: [12, 5],
  STAGING_AREA: [10, 6], QC_AREA: [8, 5], WORK_AREA: [8, 5], CUSTOM_AREA: [8, 5],
};

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <dt className="text-slate-500">{k}</dt>
      <dd className="font-semibold text-slate-800 text-right tabular-nums">{v}</dd>
    </div>
  );
}

function ObjectInspector({ obj, unitLabel }: { obj: LayoutObject | null; unitLabel: string }) {
  if (!obj) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm text-center">
        <MapIcon className="h-8 w-8 mx-auto text-slate-300" />
        <p className="mt-2 text-sm font-medium text-slate-600">Object Details</p>
        <p className="text-xs text-slate-400">Select an object on the floor plan to inspect it</p>
      </div>
    );
  }
  const style = OBJECT_STYLES[obj.objectType];
  const linked = obj.slotId ?? obj.rackId;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="h-3.5 w-3.5 rounded-sm border" style={{ background: obj.color ?? style.fill, borderColor: style.stroke }} />
        <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Object Details</h2>
      </div>
      <dl className="space-y-2">
        <Row k="Name" v={obj.name} />
        <Row k="Code" v={obj.code || '—'} />
        <Row k="Type" v={TYPE_LABEL(obj.objectType)} />
        <Row k="Status" v={obj.status === 'ACTIVE' ? 'Active' : TYPE_LABEL(obj.status)} />
        <Row k="Position" v={`${obj.x}, ${obj.y} ${unitLabel}`} />
        <Row k="Size" v={`${obj.width} × ${obj.height} ${unitLabel}`} />
        {obj.rotation > 0 && <Row k="Rotation" v={`${obj.rotation}°`} />}
        {obj.capacity != null && <Row k="Capacity" v={obj.capacity} />}
      </dl>
      <div className="mt-4 pt-3 border-t border-slate-100">
        {linked ? (
          <p className="text-xs text-slate-500">Linked to a WMS location — live stock is shown below.</p>
        ) : (
          <p className="flex items-start gap-2 text-xs text-slate-400">
            <Link2Off className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            Not linked to a WMS location. Physical-only objects — areas, aisles, shelves — never link.
          </p>
        )}
      </div>
    </div>
  );
}

function Legend() {
  const groups: [string, string[]][] = [
    ['Storage', ['STORAGE_AREA', 'RACK', 'SHELF', 'BIN']],
    ['Inbound', ['RECEIVING_AREA']],
    ['Outbound', ['SHIPPING_AREA']],
    ['Handling', ['STAGING_AREA', 'WORK_AREA']],
    ['Quality', ['QC_AREA']],
    ['Structure', ['ZONE', 'AISLE', 'CUSTOM_AREA']],
  ];
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-3">Legend</h2>
      <div className="space-y-2">
        {groups.map(([label, types]) => (
          <div key={label} className="flex items-center gap-2">
            <span className="flex gap-1">
              {types.map((t) => {
                const s = OBJECT_STYLES[t as keyof typeof OBJECT_STYLES];
                return (
                  <span key={t} title={TYPE_LABEL(t)} className="h-3 w-3 rounded-sm border"
                    style={{ background: s.fill === 'transparent' ? '#fff' : s.fill, borderColor: s.stroke,
                             borderStyle: s.dashed ? 'dashed' : 'solid' }} />
                );
              })}
            </span>
            <span className="text-xs text-slate-500">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FloorPlan({ warehouseId }: { warehouseId: string }) {
  const user = useAuthStore((s) => s.user);
  const canEdit = !!user && EDIT_ROLES.includes(user.role);

  const [data, setData] = useState<LayoutResponse | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [creating, setCreating] = useState(false);
  const [occupancy, setOccupancy] = useState<LayoutOccupancy[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const planRef = useRef<HTMLDivElement>(null);

  const ed = useLayoutEditor();

  const load = useCallback(async () => {
    if (!warehouseId) return;
    setLoading(true); setError(null);
    try {
      const res = await layoutApi.get(warehouseId);
      setData(res);
      setVersion(res.layout?.version ?? 0);
      ed.reset(res.objects);
      // Live rollup is a separate read so a slow inventory query never blocks
      // the drawing from appearing.
      layoutApi.occupancy(warehouseId).then(setOccupancy).catch(() => setOccupancy([]));
    } catch (e: any) {
      setData(null);
      setError(e?.message ?? 'Failed to load the floor plan');
    } finally {
      setLoading(false);
    }
  }, [warehouseId]); // eslint-disable-line

  useEffect(() => { setEditing(false); load(); }, [load]);

  // ── Save / discard ─────────────────────────────────────────────────────────

  const save = useCallback(async () => {
    if (!data?.layout || !ed.isDirty) return;
    setSaving(true);
    try {
      const res = await layoutApi.batchSave(data.layout.id, ed.buildPayload(version));
      setVersion(res.version);
      ed.saved(res.objects);
      setData((d) => (d && d.layout ? { ...d, layout: { ...d.layout, version: res.version }, objects: res.objects } : d));
      toast.success('Floor plan saved');
    } catch (e: any) {
      // A version clash means someone else saved while we were editing. Never
      // overwrite silently — tell the user and let them reload.
      toast.error(e?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [data, ed, version]);

  const discardAll = useCallback(() => {
    ed.reset(data?.objects ?? []);
    toast.info('Changes discarded');
  }, [data, ed]);

  const guard = useDiscardGuard(ed.isDirty, () => { discardAll(); setEditing(false); });

  const exitEditing = useCallback(() => {
    if (ed.isDirty) guard.requestClose();
    else setEditing(false);
  }, [ed.isDirty, guard]);

  // ── Editing actions ────────────────────────────────────────────────────────

  const addObject = useCallback((type: LayoutObjectType) => {
    const [w, h] = DEFAULT_SIZE[type] ?? [6, 4];
    // Drop new objects at a free-ish spot near the origin rather than on top of
    // whatever is already selected.
    const n = ed.objects.length;
    ed.add({
      objectType: type,
      name: TYPE_LABEL(type),
      x: Math.min(2 + (n % 5) * 3, Math.max(0, (data?.layout?.widthUnits ?? 60) - w)),
      y: Math.min(2 + Math.floor(n / 5) * 3, Math.max(0, (data?.layout?.heightUnits ?? 36) - h)),
      width: w, height: h,
    });
  }, [ed, data]);

  const deleteSelected = useCallback(() => {
    if (!ed.state.selection.length) return;
    ed.remove(ed.state.selection);
  }, [ed]);

  const duplicateSelected = useCallback(() => {
    if (!ed.state.selection.length) return;
    ed.duplicate(ed.state.selection);
  }, [ed]);

  // Keyboard shortcuts, active only while editing and not typing in a field.
  useEffect(() => {
    if (!editing) return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? ed.redo() : ed.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); ed.redo(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
      if (e.key === 'Escape') ed.select([]);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, ed, duplicateSelected, deleteSelected, save]);

  // Native beforeunload as a last line of defence for a browser-level close.
  useEffect(() => {
    if (!ed.isDirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [ed.isDirty]);

  const createLayout = useCallback(async () => {
    setCreating(true);
    try {
      await layoutApi.create(warehouseId, {});
      toast.success('Floor plan created');
      await load();
      setEditing(true);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not create the floor plan');
    } finally {
      setCreating(false);
    }
  }, [warehouseId, load]);

  const printPlan = useCallback(() => {
    if (!data?.layout) return;
    const ok = printFloorPlan({
      svg: planRef.current?.querySelector('svg') ?? null,
      layout: data.layout,
      warehouseName: data.warehouse.name,
      objects: ed.objects,
      occupancy,
    });
    if (!ok) toast.error('Pop-up blocked — allow pop-ups to print the floor plan');
  }, [data, ed.objects, occupancy]);

  const soleSelected = useMemo(
    () => (ed.selectedObjects.length === 1 ? ed.selectedObjects[0] : null),
    [ed.selectedObjects],
  );

  const occByObject = useMemo(() => new Map(occupancy.map((o) => [o.objectId, o])), [occupancy]);
  const takenSlotIds = useMemo(
    () => new Set(ed.objects.map((o) => o.slotId).filter(Boolean) as string[]),
    [ed.objects],
  );
  const orphanCount = useMemo(() => occupancy.filter((o) => o.orphaned).length, [occupancy]);

  // ── Linking ────────────────────────────────────────────────────────────────

  const applyLinked = useCallback((updated: LayoutObject) => {
    // The link endpoint writes immediately, so reflect it locally WITHOUT
    // marking the object dirty — it is already persisted.
    ed.reset(ed.objects.map((o) => (o.id === updated.id ? { ...o, slotId: updated.slotId, rackId: updated.rackId } : o)));
    ed.select([updated.id]);
    layoutApi.occupancy(warehouseId).then(setOccupancy).catch(() => {});
  }, [ed, warehouseId]);

  const unlink = useCallback(async () => {
    if (!soleSelected) return;
    try {
      const updated = await layoutApi.unlink(soleSelected.id);
      toast.success('Unlinked. The WMS location itself is unchanged.');
      applyLinked(updated);
    } catch (e: any) { toast.error(e?.message ?? 'Unlink failed'); }
  }, [soleSelected, applyLinked]);

  const generateBins = useCallback(async () => {
    if (!soleSelected) return;
    try {
      const res = await layoutApi.generateBins(soleSelected.id);
      toast.success(`Drew ${res.created} bin${res.created === 1 ? '' : 's'}${res.skipped ? `, skipped ${res.skipped} already drawn` : ''}`);
      await load();
    } catch (e: any) { toast.error(e?.message ?? 'Could not generate bins'); }
  }, [soleSelected, load]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <Skeleton className="xl:col-span-2 h-[600px] rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center shadow-sm">
        <AlertTriangle className="h-10 w-10 mx-auto text-amber-400" />
        <p className="mt-2 text-sm font-medium text-slate-700">Floor plan unavailable</p>
        <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">{error}</p>
        <Button variant="outline" size="sm" className="mt-4 gap-1.5 bg-white" onClick={load}>
          <RefreshCw className="w-4 h-4" /> Try again
        </Button>
      </div>
    );
  }

  if (!data?.layout) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center shadow-sm">
        <MapIcon className="h-10 w-10 mx-auto text-slate-300" />
        <p className="mt-2 text-sm font-medium text-slate-600">No floor plan for this warehouse yet</p>
        <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
          The physical layout is separate from the Warehouse → Rack → Slot structure.
        </p>
        {canEdit && (
          <Button size="sm" className="mt-4 gap-1.5 bg-green-600 hover:bg-green-700 text-white"
            onClick={createLayout} disabled={creating}>
            <Plus className="w-4 h-4" /> {creating ? 'Creating…' : 'Create floor plan'}
          </Button>
        )}
      </div>
    );
  }

  const { layout } = data;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
      <div className="xl:col-span-2 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
            {data.warehouse.name} · Floor Plan
          </h2>
          <div className="flex items-center gap-2">
            {!editing && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-500">Read-only</span>
            )}
            <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-white text-xs" onClick={printPlan}
              title="Print or save the whole floor plan as PDF">
              <Printer className="w-3.5 h-3.5" /> Print
            </Button>
            {/* Editing is hidden below lg: dragging a floor plan on a phone is
                not a usable gesture, so mobile is deliberately read-only. */}
            {canEdit && (
              editing ? (
                <Button variant="outline" size="sm" className="hidden lg:inline-flex h-8 gap-1.5 bg-white text-xs" onClick={exitEditing}>
                  <Eye className="w-3.5 h-3.5" /> Done editing
                </Button>
              ) : (
                <Button size="sm" className="hidden lg:inline-flex h-8 gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs"
                  onClick={() => setEditing(true)}>
                  <Pencil className="w-3.5 h-3.5" /> Edit layout
                </Button>
              )
            )}
            <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-white text-xs"
              onClick={load} disabled={ed.isDirty}
              title={ed.isDirty ? 'Save or discard your changes first' : 'Reload'}>
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
          </div>
        </div>

        {orphanCount > 0 && (
          <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4 mt-px flex-shrink-0" />
            <span>
              {orphanCount === 1
                ? 'A drawn bin points at a WMS slot that has been deleted in Warehouse Master. It is struck through on the plan — re-link it or remove it.'
                : `${orphanCount} drawn bins point at WMS slots that have been deleted in Warehouse Master. They are struck through on the plan — re-link or remove them.`}
            </span>
          </p>
        )}

        {editing && (
          <LayoutToolbar
            onAdd={addObject}
            onUndo={ed.undo} onRedo={ed.redo}
            onDuplicate={duplicateSelected} onDelete={deleteSelected}
            onSave={save} onDiscard={discardAll}
            canUndo={ed.canUndo} canRedo={ed.canRedo}
            hasSelection={ed.state.selection.length > 0}
            isDirty={ed.isDirty} saving={saving}
            snapEnabled={snapEnabled} onToggleSnap={() => setSnapEnabled((v) => !v)}
            unitLabel={layout.unitLabel}
          />
        )}

        {ed.objects.length === 0 && !editing ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center shadow-sm">
            <MapIcon className="h-10 w-10 mx-auto text-slate-300" />
            <p className="mt-2 text-sm font-medium text-slate-600">This floor plan is empty</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {layout.widthUnits} × {layout.heightUnits} {layout.unitLabel} canvas · no objects drawn yet
            </p>
          </div>
        ) : (
          <div ref={planRef}>
            <LayoutCanvas
              layout={layout}
              objects={ed.objects}
              selectedIds={ed.state.selection}
              onSelect={ed.select}
              editable={editing}
              snapEnabled={snapEnabled}
              onCheckpoint={ed.checkpoint}
              onPatch={ed.patch}
              occupancyByObject={occByObject}
            />
          </div>
        )}
      </div>

      <div className="space-y-4 xl:sticky xl:top-4">
        {editing ? (
          <>
            <PropertyPanel objects={ed.selectedObjects} unitLabel={layout.unitLabel} onPatch={ed.patch} />
            {soleSelected && (
              <LinkControls
                object={soleSelected}
                onLink={() => setLinkOpen(true)}
                onUnlink={unlink}
                onGenerateBins={generateBins}
              />
            )}
          </>
        ) : (
          <>
            <ObjectInspector obj={soleSelected} unitLabel={layout.unitLabel} />
            {soleSelected?.slotId && (
              <LocationInventoryPanel object={soleSelected} occupancy={occByObject.get(soleSelected.id)} />
            )}
          </>
        )}
        <Legend />
        <p className={cn('flex items-start gap-2 px-1 text-[11px] leading-relaxed text-slate-400')}>
          <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          The floor plan shows where things physically sit. Stock quantities always come from the WMS location on the Control Center tab.
        </p>
      </div>

      <DiscardChangesDialog
        open={guard.confirming}
        onKeepEditing={guard.keepEditing}
        onDiscard={guard.confirmDiscard}
      />

      <LinkSlotDialog
        open={linkOpen}
        object={soleSelected}
        warehouseId={warehouseId}
        takenSlotIds={takenSlotIds}
        onClose={() => setLinkOpen(false)}
        onLinked={applyLinked}
      />
    </div>
  );
}

// Link controls for the selected object. Linking writes immediately through its
// own endpoint rather than riding the batch save, because it is validated
// server-side against the live WMS and must not be undoable into a stale state.
function LinkControls({ object, onLink, onUnlink, onGenerateBins }: {
  object: LayoutObject;
  onLink: () => void;
  onUnlink: () => void;
  onGenerateBins: () => void;
}) {
  const linkable = object.objectType === 'BIN' || object.objectType === 'RACK';
  const linked = !!(object.slotId ?? object.rackId);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-3">WMS Link</h2>

      {!linkable ? (
        <p className="flex items-start gap-2 text-xs text-slate-400">
          <Link2Off className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          {TYPE_LABEL(object.objectType)} is physical-only. Only bins and racks link to a WMS location.
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-500 mb-3">
            {linked
              ? `Linked to a WMS ${object.slotId ? 'slot' : 'rack'}. Unlinking removes the reference only — the location itself is untouched.`
              : `Not linked. A ${object.objectType === 'BIN' ? 'bin links to a slot' : 'rack links to a rack'} in the same warehouse.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-white text-xs" onClick={onLink}>
              <Link2 className="w-3.5 h-3.5" /> {linked ? 'Change link' : 'Link location'}
            </Button>
            {linked && (
              <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-white text-xs" onClick={onUnlink}>
                <Unlink className="w-3.5 h-3.5" /> Unlink
              </Button>
            )}
            {object.objectType === 'RACK' && object.rackId && (
              <Button size="sm" className="h-8 gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs" onClick={onGenerateBins}>
                <Rows3 className="w-3.5 h-3.5" /> Draw bins from slots
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
