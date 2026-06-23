'use client';

import { useEffect, useState } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Settings2, GripVertical, RotateCcw, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ColumnDef {
  key: string;
  label: string;
  group: string;
  locked?: boolean;
}

const STORAGE_PREFIX = 'wms.columns.';

interface StoredPrefs {
  columnOrder: string[];
  hiddenColumns: string[];
}

function loadPrefs(storageKey: string): StoredPrefs | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePrefs(storageKey: string, prefs: StoredPrefs) {
  try { window.localStorage.setItem(storageKey, JSON.stringify(prefs)); } catch { /* ignore quota/availability errors */ }
}

// Persists column order + visibility per user in localStorage (no backend call).
// New columns added later are not present in a saved hiddenColumns list, so they default to visible.
export function useColumnPrefs(defs: ColumnDef[], moduleKey: string) {
  const storageKey = `${STORAGE_PREFIX}${moduleKey}`;
  const defaultOrder = defs.map((d) => d.key);
  const [order, setOrder] = useState<string[]>(defaultOrder);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = loadPrefs(storageKey);
    if (saved) {
      const savedOrderValid = (saved.columnOrder ?? []).filter((k) => defaultOrder.includes(k));
      const missing = defaultOrder.filter((k) => !savedOrderValid.includes(k));
      setOrder([...savedOrderValid, ...missing]);
      const lockedKeys = new Set(defs.filter((d) => d.locked).map((d) => d.key));
      setHidden(new Set((saved.hiddenColumns ?? []).filter((k) => defaultOrder.includes(k) && !lockedKeys.has(k))));
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!ready) return;
    savePrefs(storageKey, { columnOrder: order, hiddenColumns: [...hidden] });
  }, [order, hidden, ready, storageKey]);

  function toggle(key: string) {
    const def = defs.find((d) => d.key === key);
    if (def?.locked) return;
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function moveByDrag(activeKey: string, overKey: string) {
    setOrder((prev) => {
      const from = prev.indexOf(activeKey);
      const to = prev.indexOf(overKey);
      if (from === -1 || to === -1 || from === to) return prev;
      return arrayMove(prev, from, to);
    });
  }

  function reset() {
    setOrder(defaultOrder);
    setHidden(new Set());
  }

  const orderedDefs = order.map((k) => defs.find((d) => d.key === k)).filter((d): d is ColumnDef => !!d);
  const visibleColumns = orderedDefs.filter((d) => !hidden.has(d.key));

  return { orderedDefs, visibleColumns, hidden, toggle, moveByDrag, reset, ready };
}

function SortableRow({ col, hidden, onToggle }: { col: ColumnDef; hidden: boolean; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.key });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs', isDragging ? 'bg-green-50 shadow-sm' : 'hover:bg-slate-50')}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing flex-shrink-0"
        title="Drag to reorder"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>
      <label className={cn('flex items-center gap-2 flex-1 select-none', col.locked ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer text-slate-700')}>
        <input
          type="checkbox"
          checked={!hidden}
          disabled={col.locked}
          onChange={onToggle}
          className="accent-green-600 disabled:opacity-50"
        />
        {col.label}
      </label>
      {col.locked && <span title="Always visible"><Lock className="w-3 h-3 text-slate-300 flex-shrink-0" /></span>}
    </div>
  );
}

export function ColumnManagerButton({
  defs, moduleKey, prefs,
}: {
  defs: ColumnDef[]; moduleKey: string;
  prefs: ReturnType<typeof useColumnPrefs>;
}) {
  const [open, setOpen] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (over && active.id !== over.id) prefs.moveByDrag(String(active.id), String(over.id));
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-8 inline-flex items-center gap-1.5 text-xs font-medium border border-slate-200 rounded-md px-3 bg-white hover:bg-slate-50 text-slate-600"
      >
        <Settings2 className="w-3.5 h-3.5" /> Columns
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-64 bg-white border border-slate-200 rounded-xl shadow-lg p-2">
            <div className="flex items-center justify-between px-2 py-1 mb-1">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Show / Reorder Columns</p>
              <button type="button" onClick={prefs.reset} className="text-[10px] text-slate-400 hover:text-green-600 inline-flex items-center gap-1">
                <RotateCcw className="w-3 h-3" /> Reset
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={prefs.orderedDefs.map((d) => d.key)} strategy={verticalListSortingStrategy}>
                  {prefs.orderedDefs.map((col) => (
                    <SortableRow key={col.key} col={col} hidden={prefs.hidden.has(col.key)} onToggle={() => prefs.toggle(col.key)} />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
