'use client';

// Left panel: Warehouse → Rack tree. Slots are managed in the rack's slot grid.
import { ChevronRight, Layers, Plus, Warehouse as WhIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import type { WarehouseSpaceSummary } from '@/lib/api-warehouse';
import { rackCategoryOf } from './shared';

export type Selection = { type: 'warehouse'; id: string } | { type: 'rack'; id: string; warehouseId: string } | null;

export function StructureTree({ tree, space, loading, selection, open, onToggle, onSelect, canCreate, onCreateWarehouse }: {
  tree: any[];
  space: Map<string, WarehouseSpaceSummary>;
  loading: boolean;
  selection: Selection;
  open: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (s: Selection) => void;
  canCreate: boolean;
  onCreateWarehouse: () => void;
}) {
  const { m, t, fmt } = useT();
  const wm = m.warehouseMaster;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 px-2 pt-1">{wm.tree.title}</h2>
      <p className="px-2 pb-2 pt-0.5 text-xs leading-snug text-slate-500">{wm.tree.hint}</p>
      {loading ? (
        <div className="space-y-1 mt-1">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
      ) : tree.length === 0 ? (
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
          {tree.map((w) => {
            const s = space.get(w.id);
            const isOpen = open.has(w.id);
            return (
              <div key={w.id}>
                <Row
                  depth={0} icon={WhIcon} label={w.code} sub={w.name}
                  meta={s?.totalAreaM2 != null ? t(m.space.unit.m2, { value: fmt.number(s.totalAreaM2, 1) }) : undefined}
                  badge={w.isActive ? undefined : wm.tree.inactive}
                  hasChildren={(w.racks?.length ?? 0) > 0} open={isOpen} onToggle={() => onToggle(w.id)}
                  selected={selection?.type === 'warehouse' && selection.id === w.id}
                  onSelect={() => onSelect({ type: 'warehouse', id: w.id })}
                />
                {isOpen && (w.racks ?? []).map((r: any) => (
                  <Row key={r.id}
                    depth={1} icon={Layers} label={r.code} sub={wm.category[rackCategoryOf(r)]}
                    meta={t(wm.tree.slotsCount, { count: r._count?.slots ?? r.slots?.length ?? 0 })}
                    selected={selection?.type === 'rack' && selection.id === r.id}
                    onSelect={() => onSelect({ type: 'rack', id: r.id, warehouseId: w.id })}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
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
