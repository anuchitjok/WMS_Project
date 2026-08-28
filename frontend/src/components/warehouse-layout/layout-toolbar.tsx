'use client';

// Floor Plan editing toolbar (Sprint 5): object palette, snap toggle,
// undo/redo, duplicate, delete, and the explicit Save.

import { Undo2, Redo2, Copy, Trash2, Grid3x3, Save, RotateCcw } from 'lucide-react';
import type { LayoutObjectType } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { OBJECT_STYLES } from './layout-object';

// Ordered by how often a floor plan actually needs them.
const PALETTE: { type: LayoutObjectType; label: string }[] = [
  { type: 'ZONE', label: 'Zone' },
  { type: 'RACK', label: 'Rack' },
  { type: 'SHELF', label: 'Shelf' },
  { type: 'BIN', label: 'Bin' },
  { type: 'AISLE', label: 'Aisle' },
  { type: 'STORAGE_AREA', label: 'Storage' },
  { type: 'RECEIVING_AREA', label: 'Receiving' },
  { type: 'SHIPPING_AREA', label: 'Shipping' },
  { type: 'STAGING_AREA', label: 'Staging' },
  { type: 'QC_AREA', label: 'QC' },
  { type: 'WORK_AREA', label: 'Work' },
  { type: 'CUSTOM_AREA', label: 'Custom' },
];

function ToolButton({ onClick, disabled, title, children }: {
  onClick: () => void; disabled?: boolean; title: string; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label={title}
      className={cn('h-8 w-8 grid place-items-center rounded-md border transition-colors',
        disabled
          ? 'border-slate-100 text-slate-300 cursor-not-allowed'
          : 'border-slate-200 text-slate-600 hover:border-green-300 hover:bg-green-50 hover:text-green-700')}>
      {children}
    </button>
  );
}

export function LayoutToolbar({
  onAdd, onUndo, onRedo, onDuplicate, onDelete, onSave, onDiscard,
  canUndo, canRedo, hasSelection, isDirty, saving, snapEnabled, onToggleSnap, unitLabel,
}: {
  onAdd: (type: LayoutObjectType) => void;
  onUndo: () => void; onRedo: () => void;
  onDuplicate: () => void; onDelete: () => void;
  onSave: () => void; onDiscard: () => void;
  canUndo: boolean; canRedo: boolean; hasSelection: boolean;
  isDirty: boolean; saving: boolean;
  snapEnabled: boolean; onToggleSnap: () => void;
  unitLabel: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <ToolButton onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)"><Undo2 className="h-4 w-4" /></ToolButton>
          <ToolButton onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)"><Redo2 className="h-4 w-4" /></ToolButton>
        </div>
        <span className="h-5 w-px bg-slate-200" />
        <div className="flex items-center gap-1">
          <ToolButton onClick={onDuplicate} disabled={!hasSelection} title="Duplicate (Ctrl+D)"><Copy className="h-4 w-4" /></ToolButton>
          <ToolButton onClick={onDelete} disabled={!hasSelection} title="Delete (Del)"><Trash2 className="h-4 w-4" /></ToolButton>
        </div>
        <span className="h-5 w-px bg-slate-200" />
        <button type="button" onClick={onToggleSnap}
          title={`Snap to 1 ${unitLabel} grid`}
          className={cn('flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-xs font-medium transition-colors',
            snapEnabled
              ? 'border-green-300 bg-green-50 text-green-700'
              : 'border-slate-200 text-slate-500 hover:bg-slate-50')}>
          <Grid3x3 className="h-3.5 w-3.5" /> Snap
        </button>

        <div className="ml-auto flex items-center gap-2">
          {isDirty && !saving && (
            <span className="text-[11px] font-medium text-amber-600">Unsaved changes</span>
          )}
          {isDirty && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-white text-xs" onClick={onDiscard} disabled={saving}>
              <RotateCcw className="w-3.5 h-3.5" /> Discard
            </Button>
          )}
          <Button size="sm" className="h-8 gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs"
            onClick={onSave} disabled={!isDirty || saving}>
            <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Add object</p>
        <div className="flex flex-wrap gap-1.5">
          {PALETTE.map((p) => {
            const s = OBJECT_STYLES[p.type];
            return (
              <button key={p.type} type="button" onClick={() => onAdd(p.type)}
                title={`Add ${p.label}`}
                className="flex items-center gap-1.5 h-7 pl-1.5 pr-2.5 rounded-md border border-slate-200 text-[11px] font-medium text-slate-600 hover:border-green-300 hover:bg-green-50 hover:text-green-700 transition-colors">
                <span className="h-3 w-3 rounded-sm border flex-shrink-0"
                  style={{ background: s.fill === 'transparent' ? '#fff' : s.fill, borderColor: s.stroke,
                           borderStyle: s.dashed ? 'dashed' : 'solid' }} />
                {p.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
