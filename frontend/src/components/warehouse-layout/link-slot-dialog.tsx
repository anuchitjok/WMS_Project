'use client';

// Picks the WMS location a drawn object points at (Sprint 6).
// A BIN links to a Slot, a RACK links to a Rack — nothing else can link at all.
// The candidate list comes from the existing /warehouse tree; this dialog does
// not create, rename or move a single Slot or Rack.

import { useEffect, useMemo, useState } from 'react';
import { Search, Link2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { warehouseApi, layoutApi, type LayoutObject } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface Candidate {
  id: string;
  code: string;
  label: string;
  taken: boolean;
}

export function LinkSlotDialog({ open, object, warehouseId, takenSlotIds, onClose, onLinked }: {
  open: boolean;
  object: LayoutObject | null;
  warehouseId: string;
  takenSlotIds: Set<string>;
  onClose: () => void;
  onLinked: (updated: LayoutObject) => void;
}) {
  const kind: 'slot' | 'rack' | null =
    object?.objectType === 'BIN' ? 'slot' : object?.objectType === 'RACK' ? 'rack' : null;

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<string>('');

  useEffect(() => {
    if (!open || !kind) return;
    setSearch(''); setPicked(''); setLoading(true);
    warehouseApi.get(warehouseId)
      .then((wh: any) => {
        const racks = wh?.racks ?? [];
        setCandidates(kind === 'rack'
          ? racks.map((r: any) => ({
              id: r.id, code: r.code,
              label: [r.name, r.zone].filter(Boolean).join(' · ') || r.rackType,
              taken: false,
            }))
          : racks.flatMap((r: any) => (r.slots ?? []).map((s: any) => ({
              id: s.id, code: s.code,
              label: `${r.code} · ${s.name ?? `L${s.level} C${s.column}`}`,
              taken: takenSlotIds.has(s.id) && s.id !== object?.slotId,
            }))));
      })
      .catch(() => toast.error('Could not load WMS locations'))
      .finally(() => setLoading(false));
  }, [open, kind, warehouseId, takenSlotIds, object?.slotId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? candidates.filter((c) => c.code.toLowerCase().includes(q) || c.label.toLowerCase().includes(q))
      : candidates;
    return list.slice(0, 200); // the picker is for choosing, not browsing thousands
  }, [candidates, search]);

  async function submit() {
    if (!object || !picked || !kind) return;
    setSaving(true);
    try {
      const updated = await layoutApi.link(object.id, kind === 'slot' ? { slotId: picked } : { rackId: picked });
      toast.success('Linked to WMS location');
      onLinked(updated);
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? 'Link failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-green-600" />
            Link {object?.name ?? 'object'} to a WMS {kind === 'rack' ? 'rack' : 'location'}
          </DialogTitle>
        </DialogHeader>

        {!kind ? (
          <p className="text-sm text-slate-600">
            This object type is physical-only — areas, aisles and shelves have no WMS counterpart.
          </p>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8"
                placeholder={kind === 'rack' ? 'Search racks…' : 'Search slot code…'} />
            </div>

            <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
              {loading ? (
                <p className="flex items-center gap-2 p-4 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading locations…
                </p>
              ) : filtered.length === 0 ? (
                <p className="p-4 text-sm text-slate-400 text-center">No matching locations</p>
              ) : filtered.map((c) => (
                <button key={c.id} type="button" disabled={c.taken}
                  onClick={() => setPicked(c.id)}
                  className={cn('w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors',
                    c.taken ? 'cursor-not-allowed bg-slate-50 text-slate-300'
                      : picked === c.id ? 'bg-green-50 text-green-800' : 'hover:bg-slate-50')}>
                  <span className="font-mono font-semibold">{c.code}</span>
                  <span className="flex-1 truncate text-slate-500">{c.label}</span>
                  {c.taken && <span className="text-[10px] uppercase tracking-wide">already drawn</span>}
                </button>
              ))}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-green-600 hover:bg-green-700 text-white"
            disabled={!picked || saving || !kind} onClick={submit}>
            {saving ? 'Linking…' : 'Link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
