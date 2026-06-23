'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConditionChip } from '@/components/receiving/receiving-status-badge';
import { formatDate, cn } from '@/lib/utils';

const CONDITION_ORDER = ['good', 'damaged', 'doa'];

/** Sum line quantities grouped by condition, e.g. { good: 40, doa: 2 }. */
function conditionTotals(items: any[]): Record<string, number> {
  return items.reduce((acc, it) => {
    const key = (it.condition ?? 'good').toLowerCase();
    acc[key] = (acc[key] ?? 0) + Number(it.quantity ?? 0);
    return acc;
  }, {} as Record<string, number>);
}

interface ReceivingCardProps {
  gr: any;
  warehouseName?: string;
  onVerify: (id: string) => void;
  defaultExpanded?: boolean;
}

/**
 * A single Goods Receiving record rendered as an actionable queue card:
 * source + line summary + condition chips, expandable to inspect lines before verifying.
 */
export function ReceivingCard({ gr, warehouseName, onVerify, defaultExpanded = false }: ReceivingCardProps) {
  const [open, setOpen] = useState(defaultExpanded);
  const items: any[] = gr.items ?? [];
  const lines = items.length;
  const units = items.reduce((s, it) => s + Number(it.quantity ?? 0), 0);
  const totals = conditionTotals(items);
  const hasFlag = (totals.damaged ?? 0) > 0 || (totals.doa ?? 0) > 0;
  const completed = gr.status === 'completed';

  return (
    <div className={cn('rounded-xl border bg-white shadow-sm overflow-hidden', hasFlag ? 'border-red-200' : 'border-slate-200')}>
      <div className="flex gap-3 items-start p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-green-700">{gr.refNumber}</span>
            <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">{gr.sourceType}</span>
            <span className="text-xs text-slate-400">
              {formatDate(gr.receivedDate)}{warehouseName ? ` · ${warehouseName}` : ''}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-slate-500">{lines} line{lines === 1 ? '' : 's'} · {units.toLocaleString()} units</p>
          <div className="mt-2 flex gap-1.5 flex-wrap">
            {CONDITION_ORDER.filter((c) => (totals[c] ?? 0) > 0).map((c) => (
              <ConditionChip key={c} condition={c} count={totals[c]} />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <Button size="sm" variant="outline" className="h-7" onClick={() => setOpen((v) => !v)}>
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {open ? 'Hide lines' : 'View lines'}
          </Button>
          {completed
            ? <span className="inline-flex items-center justify-center gap-1 text-xs text-green-600 font-medium h-7"><CheckCircle2 className="h-3.5 w-3.5" /> Verified</span>
            : <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white" onClick={() => onVerify(gr.id)}><CheckCircle2 className="h-3.5 w-3.5" /> Verify</Button>}
        </div>
      </div>

      {open && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
          {lines === 0 ? (
            <p className="text-xs text-slate-400 flex items-center gap-1.5"><Package className="h-3.5 w-3.5" /> No line items</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-400">
                  <th className="text-left font-normal py-1.5">Product</th>
                  <th className="text-right font-normal py-1.5">Qty</th>
                  <th className="text-right font-normal py-1.5">Serial</th>
                  <th className="text-right font-normal py-1.5">Condition</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-t border-slate-100">
                    <td className="py-2 text-slate-700">
                      <span className="font-mono text-xs text-slate-500">{it.product?.code}</span>
                      {it.product?.name ? <span className="text-slate-700"> — {it.product.name}</span> : null}
                    </td>
                    <td className="py-2 text-right text-slate-600">{Number(it.quantity ?? 0).toLocaleString()}</td>
                    <td className="py-2 text-right font-mono text-xs text-slate-500">{it.serialNumber || '—'}</td>
                    <td className="py-2 text-right"><ConditionChip condition={it.condition} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
