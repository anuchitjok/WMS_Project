'use client';

// Product Master column layout (plan 2.2): order within each group + hidden
// columns, remembered per user in this browser. Every storage access is guarded,
// so the table works the same when storage is blocked (private mode, previews).
import { useCallback, useEffect, useMemo, useState } from 'react';

export type ColumnGroup = 'identity' | 'inventory' | 'traceability' | 'audit';
export const COLUMN_GROUPS: ColumnGroup[] = ['identity', 'inventory', 'traceability', 'audit'];

export interface ColumnMeta { id: string; group: ColumnGroup }
interface Prefs { order: string[]; hidden: string[] }

const STORAGE_PREFIX = 'wms.productMaster.columns.v1';

function read(key: string): Prefs | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return { order: Array.isArray(p?.order) ? p.order.filter((x: unknown) => typeof x === 'string') : [], hidden: Array.isArray(p?.hidden) ? p.hidden.filter((x: unknown) => typeof x === 'string') : [] };
  } catch { return null; }
}
function write(key: string, prefs: Prefs | null) {
  try {
    if (prefs) window.localStorage.setItem(key, JSON.stringify(prefs));
    else window.localStorage.removeItem(key);
  } catch { /* storage unavailable — the layout just isn't remembered */ }
}

/**
 * Saved order merged with the defaults: unknown ids are dropped, new columns keep
 * their default place, and columns never leave their group.
 */
export function mergeOrder(defaults: ColumnMeta[], saved: string[]): string[] {
  const known = new Map(defaults.map((c) => [c.id, c.group]));
  const out: string[] = [];
  for (const g of COLUMN_GROUPS) {
    const defaultIds = defaults.filter((c) => c.group === g).map((c) => c.id);
    const savedIds = saved.filter((id, i) => known.get(id) === g && saved.indexOf(id) === i);
    const missing = defaultIds.filter((id) => !savedIds.includes(id));
    // Insert each missing column after its default predecessor when possible.
    const merged = [...savedIds];
    for (const id of missing) {
      const at = defaultIds.indexOf(id);
      const prev = defaultIds.slice(0, at).reverse().find((p) => merged.includes(p));
      merged.splice(prev ? merged.indexOf(prev) + 1 : 0, 0, id);
    }
    out.push(...merged);
  }
  return out;
}

/** Move `id` to the position of `targetId` — only when both are in the same group. */
export function moveWithinGroup(order: string[], groups: Map<string, ColumnGroup>, id: string, targetId: string): string[] {
  if (id === targetId || groups.get(id) !== groups.get(targetId)) return order;
  const next = order.filter((x) => x !== id);
  const to = order.indexOf(targetId);
  const from = order.indexOf(id);
  const idx = next.indexOf(targetId);
  next.splice(from < to ? idx + 1 : idx, 0, id);
  return next;
}

export function useColumnPrefs(defaults: ColumnMeta[], userId?: string | null) {
  const key = `${STORAGE_PREFIX}.${userId || 'anonymous'}`;
  const defaultOrder = useMemo(() => defaults.map((c) => c.id), [defaults]);
  const groups = useMemo(() => new Map(defaults.map((c) => [c.id, c.group])), [defaults]);
  const [prefs, setPrefs] = useState<Prefs>({ order: defaultOrder, hidden: [] });

  // Load after mount (localStorage is not available during server rendering).
  useEffect(() => {
    const saved = read(key);
    setPrefs(saved ? { order: mergeOrder(defaults, saved.order), hidden: saved.hidden.filter((h) => groups.has(h)) } : { order: defaultOrder, hidden: [] });
  }, [key, defaults, defaultOrder, groups]);

  const update = useCallback((fn: (p: Prefs) => Prefs) => {
    setPrefs((p) => { const next = fn(p); write(key, next); return next; });
  }, [key]);

  const move = useCallback((id: string, targetId: string) => update((p) => ({ ...p, order: moveWithinGroup(p.order, groups, id, targetId) })), [update, groups]);
  /** Shift one step left (-1) or right (+1) inside the group — keyboard-friendly alternative to dragging. */
  const shift = useCallback((id: string, dir: -1 | 1) => update((p) => {
    const same = p.order.filter((x) => groups.get(x) === groups.get(id));
    const target = same[same.indexOf(id) + dir];
    return target ? { ...p, order: moveWithinGroup(p.order, groups, id, target) } : p;
  }), [update, groups]);
  const toggle = useCallback((id: string) => update((p) => ({ ...p, hidden: p.hidden.includes(id) ? p.hidden.filter((h) => h !== id) : [...p.hidden, id] })), [update]);
  const reset = useCallback(() => { write(key, null); setPrefs({ order: defaultOrder, hidden: [] }); }, [key, defaultOrder]);

  return { order: prefs.order, hidden: prefs.hidden, groups, move, shift, toggle, reset, sameGroup: (a: string, b: string) => groups.get(a) === groups.get(b) };
}
