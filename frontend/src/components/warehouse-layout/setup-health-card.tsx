'use client';

// "Warehouse data not complete / looks wrong" card. Same rules (setup-health.ts)
// on the 3D page and in Warehouse Master. Hidden when nothing is wrong.

import Link from 'next/link';
import { useMemo } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { useT } from '@/i18n';
import { SIZE_WARN } from '../warehouse-master/size-rules';
import { type HealthWarehouse, type HealthItem, setupHealth } from './setup-health';

const MAX_CODES = 6;

export function SetupHealthCard({ wh, onRack, showMasterLink = true }: {
  wh: HealthWarehouse;
  /** Click on a rack code (3D: zoom to it; Warehouse Master: open it). */
  onRack?: (rackId: string) => void;
  showMasterLink?: boolean;
}) {
  const { m, t } = useT();
  const S = m.layout3d.w3d.setup;
  const h = useMemo(() => setupHealth(wh), [wh]);
  if (h.ok) return null;

  const text = (key: string, n: number) => {
    switch (key) {
      case 'whSize': return S.whSize;
      case 'rackSize': return t(S.rackSize, { n });
      case 'rackZone': return t(S.rackZone, { n });
      case 'rackSlots': return t(S.rackSlots, { n });
      case 'rackTooBig': return t(S.rackTooBig, { n, l: SIZE_WARN.rackLengthM, d: SIZE_WARN.rackDepthM, h: SIZE_WARN.rackHeightM });
      case 'rackBiggerThanWh': return t(S.rackBiggerThanWh, { n });
      case 'slotsOverGrid': return t(S.slotsOverGrid, { n });
      default: return t(S.slotTooSmall, { n, cm: SIZE_WARN.slotMinCm });
    }
  };
  const codes = (item: HealthItem<string>) => {
    if (!item.racks.length) return null;
    const shown = item.racks.slice(0, MAX_CODES);
    return (
      <span className="ml-1 inline-flex flex-wrap items-center gap-1 align-middle">
        {shown.map((r) => onRack ? (
          <button key={r.id} type="button" onClick={() => onRack(r.id)}
            className="rounded border border-amber-300 bg-white px-1.5 py-px font-mono text-[11px] text-amber-900 hover:border-amber-500 hover:bg-amber-100">
            {r.code}
          </button>
        ) : (
          <span key={r.id} className="rounded border border-amber-200 bg-white px-1.5 py-px font-mono text-[11px] text-amber-900">{r.code}</span>
        ))}
        {item.racks.length > MAX_CODES && <span className="text-[11px] text-amber-800/70">{t(S.more, { n: item.racks.length - MAX_CODES })}</span>}
      </span>
    );
  };
  const section = (head: string, items: HealthItem<string>[]) => items.length > 0 && (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800/80">{head}</p>
      <ul className="mt-1 space-y-1 pl-4 text-xs text-amber-900">
        {items.map((g) => (
          <li key={g.key} className="list-disc break-words leading-relaxed">{text(g.key, g.racks.length)}{codes(g)}</li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-900">{t(h.missing.length ? S.title : S.titleCheck, { code: wh.code })}</p>
            <p className="text-xs text-amber-800/80">{h.missing.length ? S.hint : ''} {onRack ? (showMasterLink ? S.clickZoom : S.clickOpen) : ''}</p>
          </div>
        </div>
        {showMasterLink && (
          <Link href="/warehouse-master" className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 underline-offset-2 hover:underline">
            {S.open} <ExternalLink className="h-3 w-3" />
          </Link>
        )}
      </div>
      <div className="mt-2 grid gap-x-6 gap-y-2 pl-6 sm:grid-cols-2">
        {section(S.missingHead, h.missing)}
        {section(S.anomalyHead, h.anomalies)}
      </div>
    </div>
  );
}
