'use client';

// Data hooks for the 3D view. Read-only; every call is an existing API that the
// rest of the WMS already uses:
//   • layout objects   GET /warehouse-layout/:warehouseId   (rack positions, operational areas)
//   • stock age        GET /warehouse/:id/slot-stock-age    (oldest receivedDate per slot)
//   • slot contents    GET /warehouse/slots/:id/detail      (latest 10 stock rows in the slot)
//   • stock history    GET /inventory/:id/detail-full       (audit log of one stock row)
//   • related stock    GET /inventory?search=<sku>          (other locations holding the SKU)

import { useCallback, useEffect, useRef, useState } from 'react';
import { inventoryApi, layoutApi, warehouseApi, type LayoutObject, type SlotStockAge } from '@/lib/api';

export type LoadState = 'idle' | 'loading' | 'error' | 'ready';

/** Stock rows that no longer occupy a location (backend common/stock-presence.ts). */
export const NOT_IN_LOCATION = new Set(['SHIPPED', 'CLOSED', 'CANCELLED', 'CONSUMED']);

/** Layout objects of the warehouse's 2D plan; [] when there is no plan or it fails. null while loading. */
export function useLayoutObjects(warehouseId: string) {
  const [objects, setObjects] = useState<LayoutObject[] | null>(null);
  useEffect(() => {
    if (!warehouseId) return;
    let cancelled = false;
    setObjects(null);
    layoutApi.get(warehouseId)
      .then((r) => { if (!cancelled) setObjects(r.objects ?? []); })
      .catch(() => { if (!cancelled) setObjects([]); });
    return () => { cancelled = true; };
  }, [warehouseId]);
  return objects;
}

export interface ReservedSlot { rows: number; qty: number }
export type ReservedState = 'loading' | 'ready' | 'error' | 'denied';

const RESERVED_PAGE = 500;
const RESERVED_MAX_PAGES = 20; // 10,000 reserved rows; more is reported as partial

/**
 * PR8 Phase 3: stock reserved for orders, per slot. Read-only, existing API
 * (GET /inventory?status=RESERVED&warehouseId=…), paged. A failed refresh keeps
 * the last figures; 403 = "denied" (the view then shows no Reserved colour).
 */
type ReservedGot = {
  whId: string; state: ReservedState; bySlot: Map<string, ReservedSlot> | null;
  /** Reserved stock row id → the slot it sits in now (PR8 Phase 4: where to pick). */
  slotOfStock: Map<string, string> | null;
  partial: boolean; stale: boolean;
};

export function useReservedStock(warehouseId: string) {
  // Figures are kept with the warehouse they belong to, so a switch never shows another warehouse's.
  const [got, setGot] = useState<ReservedGot>({ whId: warehouseId, state: 'loading', bySlot: null, slotOfStock: null, partial: false, stale: false });
  const req = useRef(0);
  const load = useCallback(async () => {
    if (!warehouseId) return;
    const n = ++req.current;
    try {
      const bySlot = new Map<string, ReservedSlot>();
      const slotOfStock = new Map<string, string>();
      let page = 1, pages = 1;
      do {
        const res = await inventoryApi.list({ warehouseId, status: 'RESERVED', limit: RESERVED_PAGE, page });
        for (const it of res.data ?? []) {
          if (!it.slotId || it.status !== 'RESERVED') continue;
          const a = bySlot.get(it.slotId) ?? { rows: 0, qty: 0 };
          a.rows += 1;
          a.qty += Number(it.quantity) || 0;
          bySlot.set(it.slotId, a);
          slotOfStock.set(it.id, it.slotId);
        }
        pages = res.totalPages ?? Math.ceil((res.total ?? 0) / RESERVED_PAGE);
        page += 1;
      } while (page <= pages && page <= RESERVED_MAX_PAGES);
      if (n === req.current) setGot({ whId: warehouseId, state: 'ready', bySlot, slotOfStock, partial: pages > RESERVED_MAX_PAGES, stale: false });
    } catch (e) {
      if (n !== req.current) return;
      const denied = (e as { status?: number })?.status === 403;
      setGot((g) => {
        if (denied) return { whId: warehouseId, state: 'denied', bySlot: null, slotOfStock: null, partial: false, stale: false };
        // A failed refresh keeps this warehouse's last figures and says they are stale.
        const keep = g.whId === warehouseId && g.bySlot;
        return keep ? { ...g, stale: true } : { whId: warehouseId, state: 'error', bySlot: null, slotOfStock: null, partial: false, stale: false };
      });
    }
  }, [warehouseId]);
  useEffect(() => { void load(); }, [load]);
  const mine = got.whId === warehouseId;
  return {
    state: mine ? got.state : ('loading' as ReservedState),
    bySlot: mine ? got.bySlot : null,
    slotOfStock: mine ? got.slotOfStock : null,
    partial: mine && got.partial,
    stale: mine && got.stale,
    reload: load,
  };
}

export function useStockAge(warehouseId: string) {
  const [state, setState] = useState<{ state: LoadState; data: SlotStockAge | null }>({ state: 'idle', data: null });
  const req = useRef(0);
  const load = useCallback(() => {
    if (!warehouseId) return;
    const n = ++req.current; // an older reload that answers late must not win
    setState((a) => ({ state: 'loading', data: a.data }));
    warehouseApi.slotStockAge(warehouseId)
      .then((d) => { if (n === req.current) setState({ state: 'ready', data: d }); })
      .catch(() => { if (n === req.current) setState((a) => ({ state: 'error', data: a.data })); });
  }, [warehouseId]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

/**
 * Contents of one slot. `stamp` changes when a realtime refresh changes the
 * slot's placement count, so the panel re-reads it.
 */
export function useSlotDetail(slotId: string | null, stamp: string) {
  // The detail is stored with the slot it belongs to, so a switch never pairs slot B with A's contents.
  const [got, setGot] = useState<{ slotId: string | null; detail: any }>({ slotId: null, detail: null });
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const req = useRef(0);
  const load = useCallback(() => {
    const n = ++req.current;
    if (!slotId) { setGot({ slotId: null, detail: null }); setState('idle'); return; }
    setGot({ slotId, detail: null });
    setState('loading');
    warehouseApi.getSlotDetail(slotId)
      .then((d) => { if (n === req.current) { setGot({ slotId, detail: d }); setState('idle'); } })
      .catch(() => { if (n === req.current) { setGot({ slotId, detail: null }); setState('error'); } });
  }, [slotId]);
  useEffect(() => { load(); }, [load, stamp]);
  const fresh = got.slotId === slotId;
  return { detail: fresh ? got.detail : null, state: fresh ? state : (slotId ? 'loading' as const : 'idle' as const), reload: load };
}

export interface HistoryEntry { id: string; action: string; at: string; by: string | null }

/** Audit log of one stock row; loaded only while `enabled` (History tab open). */
export function useStockHistory(stockItemId: string | null, enabled: boolean) {
  const [data, setData] = useState<{ id: string | null; state: LoadState; rows: HistoryEntry[] }>({ id: null, state: 'idle', rows: [] });
  useEffect(() => {
    if (!enabled || !stockItemId || (data.id === stockItemId && data.state !== 'error')) return;
    let cancelled = false;
    setData({ id: stockItemId, state: 'loading', rows: [] });
    inventoryApi.detailFull(stockItemId)
      .then((d) => {
        if (cancelled) return;
        const rows: HistoryEntry[] = (d?.auditLogs ?? []).map((a: any) => ({
          id: String(a.id), action: String(a.action ?? ''), at: String(a.createdAt ?? ''), by: a.user?.fullName ?? null,
        }));
        setData({ id: stockItemId, state: 'ready', rows });
      })
      .catch(() => { if (!cancelled) setData({ id: stockItemId, state: 'error', rows: [] }); });
    // Interrupted before it finished: forget it so the next open loads again.
    return () => { cancelled = true; setData((d) => (d.id === stockItemId && d.state === 'loading' ? { id: null, state: 'idle', rows: [] } : d)); };
  }, [stockItemId, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return data.id === stockItemId ? data : { id: stockItemId, state: 'idle' as LoadState, rows: [] };
}

export interface RelatedSlot { slotId: string; qty: number; unit: string | null; rows: number }

/**
 * Other slots in this warehouse that hold the same product code. Uses the
 * existing stock search and keeps only exact product-code matches.
 */
export function useRelatedStock(warehouseId: string, sku: string | null, excludeSlotId: string | null, enabled: boolean,
  knownSlot: (slotId: string) => boolean) {
  const [data, setData] = useState<{ key: string; state: LoadState; slots: RelatedSlot[]; partial?: boolean }>({ key: '', state: 'idle', slots: [] });
  const key = `${warehouseId}|${sku ?? ''}|${excludeSlotId ?? ''}`;
  const known = useRef(knownSlot);
  known.current = knownSlot;
  useEffect(() => {
    if (!enabled || !sku || (data.key === key && data.state !== 'error')) return;
    let cancelled = false;
    setData({ key, state: 'loading', slots: [] });
    inventoryApi.list({ search: sku, warehouseId, limit: 200 })
      .then((res) => {
        if (cancelled) return;
        const by = new Map<string, RelatedSlot>();
        for (const it of res.data ?? []) {
          if (it.product?.code !== sku || !it.slotId || it.slotId === excludeSlotId) continue;
          if (NOT_IN_LOCATION.has(String(it.status)) || !known.current(it.slotId)) continue;
          const r = by.get(it.slotId) ?? { slotId: it.slotId, qty: 0, unit: it.product?.unit ?? null, rows: 0 };
          r.qty += Number(it.quantity) || 0;
          r.rows += 1;
          by.set(it.slotId, r);
        }
        // The search matches text, so more rows than one page means the list may be incomplete.
        setData({ key, state: 'ready', slots: [...by.values()].sort((a, b) => b.qty - a.qty), partial: (res.total ?? 0) > (res.data?.length ?? 0) });
      })
      .catch(() => { if (!cancelled) setData({ key, state: 'error', slots: [] }); });
    return () => { cancelled = true; setData((d) => (d.key === key && d.state === 'loading' ? { key: '', state: 'idle', slots: [] } : d)); };
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return data.key === key ? data : { key, state: 'idle' as LoadState, slots: [] };
}
