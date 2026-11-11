'use client';

// PR8 Phase 1 — live figures for the 3D control-tower header and KPI row.
//
// Read-only, existing APIs only (no new backend):
//   • /dashboard/kpis + /dashboard/inventory-health — the same service calls the
//     Dashboard's /dashboard/overview uses, so Stock Ready and Pending Putaway match it
//   • /fulfillment/board — counted by task status (the board's lanes mix states:
//     its "shipping" lane also holds SHIPPED / DELIVERED tasks)
//   • /health — server + database status
// Slots Used / Empty Slots come from the warehouse tree the page already has.
//
// Refresh is driven by the caller (one shared signal: realtime events, a 60 s poll
// while the tab is visible, and returning to the tab). A refresh that is asked for
// while one is still running is skipped, so there are never two at once.

import { useCallback, useEffect, useRef, useState } from 'react';
import { dashboardApi, fulfillmentApi, healthApi, inventoryApi, type HealthStatus } from '@/lib/api';

/** loading = first load; ok = has data (maybe stale); error / denied = no data. */
export type SourceState = 'loading' | 'ok' | 'error' | 'denied';
export interface Source<T> { data: T | null; state: SourceState; stale: boolean }

export interface StockFigures { available: number; reserved: number; pendingPutaway: number }
export interface TaskFigures { picking: number; allocated: number; awaitingShipment: number }
export type SystemStatus = 'ok' | 'degraded' | 'down' | null;

/** One line of a fulfilment task (as /fulfillment/board returns it). */
export interface TaskLine {
  id: string; stockItemId: string | null; qtyRequested: number; qtyPicked: number;
  binLocation: string | null; product?: { code?: string; name?: string; unit?: string } | null;
  /** PR6: the approver chose this stock location (Manual Pick). */
  selectedByApprover?: boolean;
}
/** Open fulfilment task of this warehouse (shipped / delivered ones are left out). */
export interface OpenTask {
  id: string; refNumber: string; requestRef: string; status: string; updatedAt: string;
  deliveryMethod?: 'SHIP' | 'COLLECT'; items: TaskLine[];
}
/** PR8 Phase 4 flow strip: stock steps in stock rows, order steps in tasks. */
export interface FlowFigures { receive: number; available: number }

const start = <T,>(): Source<T> => ({ data: null, state: 'loading', stale: false });

const isDenied = (e: unknown) => {
  const s = (e as { status?: number })?.status;
  return s === 403;
};

/** Apply one settled call: keep the last good figures when a refresh fails. */
function settle<T>(prev: Source<T>, r: PromiseSettledResult<T>): Source<T> {
  if (r.status === 'fulfilled') return { data: r.value, state: 'ok', stale: false };
  if (isDenied(r.reason)) return { data: null, state: 'denied', stale: false };
  return prev.data ? { ...prev, stale: true } : { data: null, state: 'error', stale: false };
}

type Task = { status: string };
type Board = Record<string, Task[] | undefined>;

const DONE = new Set(['SHIPPED', 'DELIVERED', 'CLOSED', 'CANCELLED', 'RETURNED']);
/** Every open task on the board, oldest change first (the board's own order). */
export function openTasks(board: Board): OpenTask[] {
  return Object.values(board).flatMap((v) => (Array.isArray(v) ? v : []))
    .filter((t) => !DONE.has(t.status)) as unknown as OpenTask[];
}

/** Counts by status from the board (all open tasks of the warehouse). */
export function taskFigures(board: Board): TaskFigures {
  const all = Object.values(board).flatMap((v) => (Array.isArray(v) ? v : []));
  const n = (...st: string[]) => all.filter((t) => st.includes(t.status)).length;
  return {
    picking: n('PICKING'),
    allocated: n('ALLOCATED'),
    awaitingShipment: n('PACKED', 'READY_TO_SHIP'),
  };
}

export function useTowerData(warehouseId: string) {
  const [stock, setStock] = useState<Source<StockFigures>>(start);
  const [tasks, setTasks] = useState<Source<TaskFigures>>(start);
  const [open, setOpen] = useState<Source<OpenTask[]>>(start);
  const [flow, setFlow] = useState<Source<FlowFigures>>(start);
  const [system, setSystem] = useState<SystemStatus>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const reload = useCallback(async () => {
    if (!warehouseId || busy.current) return;
    busy.current = true;
    setRefreshing(true);
    try {
      // Rows only: `total` is all that is read (limit 1).
      const rows = (status: string) => inventoryApi.list({ warehouseId, status, limit: 1 }).then((r) => r.total ?? 0);
      const [k, h, b, hl, rc, av] = await Promise.allSettled([
        dashboardApi.kpis(warehouseId),
        dashboardApi.inventoryHealth(warehouseId),
        fulfillmentApi.board(warehouseId) as Promise<Board>,
        healthApi.get(),
        rows('PENDING_RECEIVING'),
        rows('AVAILABLE'),
      ]);
      if (!alive.current) return;
      // Stock needs both calls; if either fails the card keeps its last figures.
      const both: PromiseSettledResult<StockFigures> =
        k.status === 'fulfilled' && h.status === 'fulfilled'
          ? { status: 'fulfilled', value: { available: h.value.available, reserved: h.value.reserved, pendingPutaway: k.value.pendingPutaway } }
          : { status: 'rejected', reason: k.status === 'rejected' ? k.reason : (h as PromiseRejectedResult).reason };
      setStock((p) => settle(p, both));
      setTasks((p) => settle(p, b.status === 'fulfilled' ? { status: 'fulfilled', value: taskFigures(b.value) } : b));
      setOpen((p) => settle(p, b.status === 'fulfilled' ? { status: 'fulfilled', value: openTasks(b.value) } : b));
      const fl: PromiseSettledResult<FlowFigures> = rc.status === 'fulfilled' && av.status === 'fulfilled'
        ? { status: 'fulfilled', value: { receive: rc.value, available: av.value } }
        : { status: 'rejected', reason: rc.status === 'rejected' ? rc.reason : (av as PromiseRejectedResult).reason };
      setFlow((p) => settle(p, fl));
      setSystem(hl.status === 'fulfilled' ? statusOf(hl.value) : 'down');
      // "Updated hh:mm" only moves when every figure the user may see was refreshed
      // (a 403 is fine: that card says "No access" and has nothing to refresh).
      const ok = (r: PromiseSettledResult<unknown>) => r.status === 'fulfilled' || isDenied(r.reason);
      if (ok(k) && ok(h) && ok(b) && ok(rc) && ok(av)) setUpdatedAt(new Date());
    } finally {
      busy.current = false;
      if (alive.current) setRefreshing(false);
    }
  }, [warehouseId]);

  useEffect(() => { void reload(); }, [reload]);

  // Something did not refresh (and is not just "no access").
  const failed = stock.stale || tasks.stale || flow.stale || stock.state === 'error' || tasks.state === 'error' || flow.state === 'error';
  return { stock, tasks, open, flow, system, updatedAt, refreshing, failed, reload };
}

function statusOf(h: HealthStatus): SystemStatus {
  return h.status === 'ok' && h.database === 'up' ? 'ok' : 'degraded';
}
