'use client';

// Live WMS data for a linked bin (Sprint 6).
//
// Every figure here comes from the EXISTING inventory APIs — the rollup from
// /warehouse-layout/:id/occupancy (derived from StockItem at read time) and the
// item list from /warehouse/slots/:id/detail, the same endpoint the Control
// Center uses. Nothing about stock is stored on the layout.

import { useEffect, useState } from 'react';
import { Package, Link2Off, AlertTriangle, Loader2 } from 'lucide-react';
import { warehouseApi, type LayoutObject, type LayoutOccupancy } from '@/lib/api';
import { formatDate } from '@/lib/utils';

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <dt className="text-slate-500">{k}</dt>
      <dd className="font-semibold text-slate-800 text-right tabular-nums">{v}</dd>
    </div>
  );
}

export function LocationInventoryPanel({ object, occupancy }: {
  object: LayoutObject;
  occupancy?: LayoutOccupancy;
}) {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!object.slotId) { setDetail(null); return; }
    let cancelled = false;
    setLoading(true);
    warehouseApi.getSlotDetail(object.slotId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => { if (!cancelled) setDetail(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [object.slotId]);

  if (!object.slotId) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-2">WMS Location</h2>
        <p className="flex items-start gap-2 text-xs text-slate-400">
          <Link2Off className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          Not linked to a WMS location, so it holds no inventory of its own.
        </p>
      </div>
    );
  }

  const items = detail?.stockItems ?? [];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-3">WMS Location</h2>

      {occupancy?.orphaned && (
        <p className="flex items-start gap-2 mb-3 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          The linked slot has been deleted in Warehouse Master. Re-link this object or remove it.
        </p>
      )}

      <dl className="space-y-2">
        <Row k="Location Code" v={occupancy?.code ?? detail?.code ?? '—'} />
        <Row k="Location Name" v={occupancy?.name ?? detail?.name ?? '—'} />
        <Row k="Available" v={loading && !occupancy ? '…' : (occupancy?.available ?? 0).toLocaleString()} />
        <Row k="Committed" v={loading && !occupancy ? '…' : (occupancy?.committed ?? 0).toLocaleString()} />
        <Row k="Total Quantity" v={(occupancy?.quantity ?? 0).toLocaleString()} />
        <Row k="SKU Count" v={occupancy?.skuCount ?? 0} />
        <Row k="Capacity" v={occupancy?.capacity ?? '—'} />
        <Row k="Utilization" v={`${occupancy?.utilizationPct ?? 0}% (${occupancy?.items ?? 0}/${occupancy?.capacity ?? 0})`} />
        <Row k="Last Activity" v={occupancy?.lastActivityAt ? formatDate(occupancy.lastActivityAt) : '—'} />
      </dl>

      <div className="mt-4 pt-3 border-t border-slate-100">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Stock in location</p>
        {loading ? (
          <p className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-slate-400">Empty</p>
        ) : (
          <ul className="space-y-1.5 max-h-40 overflow-y-auto">
            {items.map((it: any) => (
              <li key={it.id} className="flex items-center gap-2 text-xs">
                <Package className="h-3.5 w-3.5 text-slate-300 flex-shrink-0" />
                <span className="font-mono font-semibold text-slate-700">{it.product?.code}</span>
                <span className="text-slate-400 truncate flex-1">{it.product?.name}</span>
                <span className="tabular-nums text-slate-600">{it.quantity}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-3 text-[11px] text-slate-400">
        Read-only. Move stock from Inventory or Stock Transfer — the floor plan never writes inventory.
      </p>
    </div>
  );
}
