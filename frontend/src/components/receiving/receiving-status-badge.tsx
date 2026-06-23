import { cn } from '@/lib/utils';

interface StatusCfg {
  label: string;
  bg: string;
  text: string;
  dot: string;
}

// Receiving statuses are free strings from the API (lowercase): "pending_inspection", "completed".
// Covers both legacy free-string status and the ReceivingStatus enum values.
const CFG: Record<string, StatusCfg> = {
  // legacy
  pending_inspection:  { label: 'Awaiting Inspection', bg: 'bg-amber-100',  text: 'text-amber-800',  dot: 'bg-amber-500'  },
  completed:           { label: 'Completed',            bg: 'bg-green-100',  text: 'text-green-800',  dot: 'bg-green-500'  },
  // ReceivingStatus enum (lowercase key match)
  qc_pending:          { label: 'Awaiting Inspection', bg: 'bg-amber-100',  text: 'text-amber-800',  dot: 'bg-amber-500'  },
  qc_hold:             { label: 'QC Hold',             bg: 'bg-red-100',    text: 'text-red-800',    dot: 'bg-red-500'    },
  putaway_pending:     { label: 'Putaway Pending',     bg: 'bg-blue-100',   text: 'text-blue-800',   dot: 'bg-blue-500'   },
  partial:             { label: 'Partial',             bg: 'bg-orange-100', text: 'text-orange-800', dot: 'bg-orange-500' },
  rejected:            { label: 'Rejected',            bg: 'bg-red-200',    text: 'text-red-900',    dot: 'bg-red-700'    },
  cancelled:           { label: 'Cancelled',           bg: 'bg-slate-100',  text: 'text-slate-500',  dot: 'bg-slate-400'  },
};

/**
 * Reusable dot status badge for Goods Receiving records.
 * Falls back gracefully for any unmapped status string.
 */
export function ReceivingStatusBadge({ status }: { status?: string }) {
  const cfg =
    CFG[(status ?? '').toLowerCase()] ??
    { label: status || '—', bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap',
        cfg.bg,
        cfg.text,
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', cfg.dot)} />
      {cfg.label}
    </span>
  );
}

// ─── Condition chips (per-line good / damaged / doa) ──────────────────────────

const CONDITION_CFG: Record<string, { label: string; bg: string; text: string }> = {
  good: { label: 'good', bg: 'bg-green-100', text: 'text-green-800' },
  damaged: { label: 'damaged', bg: 'bg-amber-100', text: 'text-amber-800' },
  doa: { label: 'DOA', bg: 'bg-red-100', text: 'text-red-800' },
};

export function ConditionChip({ condition, count }: { condition: string; count?: number }) {
  const c = CONDITION_CFG[(condition ?? '').toLowerCase()] ?? { label: condition || '—', bg: 'bg-slate-100', text: 'text-slate-700' };
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md whitespace-nowrap', c.bg, c.text)}>
      {count != null && <span className="font-semibold">{count}</span>}
      {c.label}
    </span>
  );
}
