'use client';

// F6: toolbar over the 3D view while racks are being arranged, and the
// "back to auto layout" confirmation. Drawings on the Floor Plan only: nothing
// here changes a rack, slot or stock row.

import { Loader2, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';

export function ArrangeBar({ top, snap, selected, zoneMode, onZoneMode, onRotate, outside, overlap, hasFloor, saving, canReset, onSave, onCancel, onReset }: {
  /** Distance from the top of the stage (px). */
  top: number;
  snap: number;
  selected: number;
  zoneMode: boolean;
  onZoneMode: (zone: boolean) => void;
  onRotate: () => void;
  outside: number;
  overlap: number;
  /** The warehouse size is known (racks are checked against the floor). */
  hasFloor: boolean;
  saving: boolean;
  /** There are rack drawings made by 3D to remove. */
  canReset: boolean;
  onSave: () => void;
  onCancel: () => void;
  onReset: () => void;
}) {
  const { m, t } = useT();
  const A = m.layout3d.w3d.arrange;
  const problems = outside + overlap;
  const seg = (on: boolean) => cn('px-2.5 py-1 text-xs font-medium transition-colors',
    on ? 'bg-emerald-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50');
  return (
    <div style={{ top }} role="region" aria-label={A.title}
      className="absolute inset-x-3 z-40 mx-auto w-auto max-w-2xl rounded-xl bg-white/95 p-3 text-sm text-slate-700 shadow-md ring-1 ring-slate-200 sm:w-fit">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="font-semibold text-slate-900">{A.title}</p>
        <p className="text-xs text-slate-500">{t(A.hint, { step: snap })}</p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">{A.moveLabel}</span>
        <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-slate-200">
          <button type="button" className={seg(!zoneMode)} aria-pressed={!zoneMode} onClick={() => onZoneMode(false)}>{A.moveRack}</button>
          <button type="button" className={seg(zoneMode)} aria-pressed={zoneMode} onClick={() => onZoneMode(true)}>{A.moveZone}</button>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRotate} disabled={!selected || saving}>
          <RotateCw className="h-3.5 w-3.5" /> {A.rotate}
        </Button>
        <span className="text-xs text-slate-500">{selected ? t(A.selected, { n: selected }) : A.noneSelected}</span>
      </div>

      <p className={cn('mt-2 text-xs', problems ? 'font-medium text-red-700' : 'text-emerald-700')} role="status">
        {problems
          ? [outside ? t(A.outside, { n: outside }) : '', overlap ? t(A.overlap, { n: overlap }) : ''].filter(Boolean).join(' · ')
          : A.ok}
        {!hasFloor && <span className="ml-2 font-normal text-slate-500">· {A.noFloor}</span>}
      </p>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
        <button type="button" onClick={onReset} disabled={!canReset || saving}
          className="text-xs font-medium text-slate-600 underline disabled:text-slate-300 disabled:no-underline">
          {A.reset}
        </button>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>{A.cancel}</Button>
          <Button type="button" size="sm" onClick={onSave} disabled={saving || problems > 0}
            className="bg-emerald-700 text-white hover:bg-emerald-800">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {saving ? A.saving : A.save}
          </Button>
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">{A.note}</p>
    </div>
  );
}

export function ResetLayoutDialog({ open, busy, onCancel, onConfirm }: { open: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const { m } = useT();
  const A = m.layout3d.w3d.arrange;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{A.resetTitle}</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-600">{A.resetBody}</p>
        <p className="text-xs text-slate-500">{A.note}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>{A.cancel}</Button>
          <Button onClick={onConfirm} disabled={busy} className="bg-emerald-700 text-white hover:bg-emerald-800">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {A.reset}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
