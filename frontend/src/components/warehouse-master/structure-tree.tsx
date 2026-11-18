'use client';

// Left panel: Warehouse → Rack tree. Slots are managed in the rack's slot grid.
// Soft-deleted records live in a collapsed section under the tree (RQ5), so the
// everyday view stays short and nothing that was deleted is lost from sight.
import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Layers, Plus, Trash2, Undo2, Warehouse as WhIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { warehouseSpaceApi, type DeletedRecord, type DeletedRecordsResponse, type WarehouseSpaceSummary } from '@/lib/api-warehouse';
import { rackCategoryOf } from './shared';

export type Selection = { type: 'warehouse'; id: string } | { type: 'rack'; id: string; warehouseId: string } | null;

const keyOf = (kind: string, id: string) => `${kind}:${id}`;

export function StructureTree({ tree, space, loading, selection, open, onToggle, onSelect, canCreate, onCreateWarehouse, onRestored }: {
  tree: any[];
  space: Map<string, WarehouseSpaceSummary>;
  loading: boolean;
  selection: Selection;
  open: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (s: Selection) => void;
  canCreate: boolean;
  onCreateWarehouse: () => void;
  /** Reload the structure after a restore. Without it the page is reloaded. */
  onRestored?: () => void | Promise<void>;
}) {
  const { m, t, fmt } = useT();
  const wm = m.warehouseMaster;
  const warehouses = tree.filter((w: any) => !w.isDeleted);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 px-2 pt-1">{wm.tree.title}</h2>
      <p className="px-2 pb-2 pt-0.5 text-xs leading-snug text-slate-500">{wm.tree.hint}</p>
      {loading ? (
        <div className="space-y-1 mt-1">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
      ) : warehouses.length === 0 ? (
        <div className="mt-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
          <WhIcon className="h-8 w-8 mx-auto text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-600">{wm.tree.empty}</p>
          <p className="mt-1 text-xs text-slate-500">{wm.tree.emptyHint}</p>
          {canCreate && (
            <Button size="sm" className="mt-3 gap-1.5 bg-green-600 hover:bg-green-700 text-white" onClick={onCreateWarehouse}>
              <Plus className="w-4 h-4" /> {wm.tree.createFirst}
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-1 space-y-0.5 max-h-[70vh] overflow-y-auto">
          {warehouses.map((w) => {
            const s = space.get(w.id);
            const isOpen = open.has(w.id);
            const racks = (w.racks ?? []).filter((r: any) => !r.isDeleted);
            return (
              <div key={w.id}>
                <Row
                  depth={0} icon={WhIcon} label={w.code} sub={w.name}
                  meta={s?.totalAreaM2 != null ? t(m.space.unit.m2, { value: fmt.number(s.totalAreaM2, 1) }) : undefined}
                  badge={w.isActive ? undefined : wm.tree.inactive}
                  hasChildren={racks.length > 0} open={isOpen} onToggle={() => onToggle(w.id)}
                  selected={selection?.type === 'warehouse' && selection.id === w.id}
                  onSelect={() => onSelect({ type: 'warehouse', id: w.id })}
                />
                {isOpen && racks.map((r: any) => (
                  <Row key={r.id}
                    depth={1} icon={Layers} label={r.code} sub={wm.category[rackCategoryOf(r)]}
                    meta={t(wm.tree.slotsCount, { count: r._count?.slots ?? r.slots?.length ?? 0 })}
                    badge={r.isActive === false ? wm.tree.inactive : undefined}
                    selected={selection?.type === 'rack' && selection.id === r.id}
                    onSelect={() => onSelect({ type: 'rack', id: r.id, warehouseId: w.id })}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
      {!loading && <DeletedSection canRestore={canCreate} onRestored={onRestored} />}
    </div>
  );
}

/**
 * Deleted, still restorable (RQ5). Read from `GET /warehouse-master/deleted`, so
 * a record stays restorable after a reload. Collapsed, and the whole section is
 * hidden while the server reports nothing deleted (and while the read is in
 * flight or has failed), so the everyday tree is untouched.
 */
function DeletedSection({ canRestore, onRestored }: { canRestore: boolean; onRestored?: () => void | Promise<void> }) {
  const { m, t, fmt } = useT();
  const wm = m.warehouseMaster;
  const [data, setData] = useState<DeletedRecordsResponse | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // A failed read leaves `data` null and the section hidden: it is a side panel,
  // and the page already reports a failed structure load.
  const refresh = useCallback(async () => {
    try { setData(await warehouseSpaceApi.deletedRecords()); }
    catch { setData(null); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  if (!data) return null;
  const rows = [...data.warehouses, ...data.racks];
  if (!rows.length) return null;

  async function restore(rec: DeletedRecord) {
    const key = keyOf(rec.kind, rec.id);
    setBusyKey(key);
    try {
      // Restore undoes the delete only: the record comes back INACTIVE, and
      // someone has to activate it before it is used again.
      if (rec.kind === 'RACK') await warehouseSpaceApi.restoreRack(rec.id);
      else await warehouseSpaceApi.restoreWarehouse(rec.id);
      toast.success(t(rec.kind === 'RACK' ? wm.tree.restoredRack : wm.tree.restoredWarehouse, { code: rec.code }));
      // Both lists: this one, and the structure the record is back in.
      await refresh();
      if (onRestored) await onRestored();
      else window.location.reload();
    } catch (err: any) {
      // 409: something still depends on it — the server says what.
      toast.error(err.message);
    } finally { setBusyKey(null); }
  }

  return (
    <details className="mt-2 border-t border-slate-100 pt-2">
      <summary className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700">
        <Trash2 className="h-3.5 w-3.5 text-slate-400" aria-hidden />
        {t(wm.tree.deletedTitle, { count: rows.length })}
      </summary>
      <p className="px-2 pt-1 text-xs leading-snug text-slate-500">{wm.tree.deletedHint}</p>
      <p className="px-2 pt-0.5 text-xs text-slate-500">{t(wm.tree.deletedRestorable, { restorable: data.totals.restorable, count: rows.length })}</p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((r) => {
          const key = keyOf(r.kind, r.id);
          const who = r.deletedBy ? (r.deletedBy.fullName || r.deletedBy.username || '') : '';
          const when = r.deletedAt ? fmt.dateTime(r.deletedAt) : '';
          const by = who && when ? t(wm.tree.deletedByOn, { who, when })
            : who ? t(wm.tree.deletedByWho, { who })
            : when ? t(wm.tree.deletedOn, { when })
            : null;
          // `blocked.message` is the server's wording; for the one code the
          // contract defines we say it in the operator's language instead.
          const blocked = !r.blocked ? null
            : r.blocked.code === 'WAREHOUSE_DELETED' ? wm.tree.deletedBlockedWarehouse
            : r.blocked.message;
          return (
            <li key={key} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-600">
                  {r.kind === 'RACK' ? wm.tree.deletedRack : wm.tree.deletedWarehouse} {r.code}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {[
                    r.warehouse ? t(wm.tree.deletedInWarehouse, { code: r.warehouse.code, name: r.warehouse.name }) : null,
                    r.zone,
                    r.name,
                    r.slotsDeleted ? t(wm.tree.deletedSlots, { count: r.slotsDeleted }) : null,
                  ].filter(Boolean).join(' · ')}
                </span>
                {by && <span className="block truncate text-xs text-slate-400">{by}</span>}
                {blocked && <span className="mt-0.5 block text-xs leading-snug text-amber-700">{blocked}</span>}
              </span>
              {canRestore && (
                <Button
                  size="sm" variant="outline" className="h-7 shrink-0 gap-1 px-2 text-xs"
                  disabled={busyKey === key || !r.canRestore}
                  title={r.canRestore ? undefined : (blocked ?? undefined)}
                  onClick={() => restore(r)}
                >
                  <Undo2 className="h-3.5 w-3.5" /> {busyKey === key ? wm.tree.restoring : wm.tree.restore}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function Row({ icon: Icon, label, sub, meta, badge, depth, hasChildren, open, onToggle, selected, onSelect }: {
  icon: React.ComponentType<{ className?: string }>; label: string; sub?: string; meta?: string; badge?: string; depth: number;
  hasChildren?: boolean; open?: boolean; onToggle?: () => void; selected: boolean; onSelect: () => void;
}) {
  return (
    <div
      role="button" tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      className={cn('flex items-center gap-1.5 rounded-lg pr-2 py-1.5 cursor-pointer transition-colors',
        selected ? 'bg-green-50 ring-1 ring-green-200' : 'hover:bg-slate-50')}
      style={{ paddingLeft: 6 + depth * 18 }}
    >
      {hasChildren ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); onToggle?.(); }} className="p-0.5 text-slate-400 hover:text-slate-600" aria-expanded={open}>
          <ChevronRight className={cn('w-4 h-4 transition-transform', open && 'rotate-90')} />
        </button>
      ) : <span className="w-5" />}
      <Icon className={cn('w-4 h-4 flex-shrink-0', selected ? 'text-green-600' : 'text-slate-400')} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800 truncate">{label}</p>
        {sub && <p className="text-xs text-slate-500 truncate">{sub}</p>}
      </div>
      {meta && <span className="text-xs text-slate-500 whitespace-nowrap tabular-nums">{meta}</span>}
      {badge && <span className="text-xs rounded-full px-2 py-0.5 bg-slate-100 text-slate-500">{badge}</span>}
    </div>
  );
}
