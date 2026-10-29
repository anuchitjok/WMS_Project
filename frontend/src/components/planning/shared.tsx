'use client';

import { cn } from '@/lib/utils';

export const PLAN_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Draft', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  IN_REVIEW: { label: 'In planning review', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  PLAN_APPROVED: { label: 'Plan approved (planning only)', cls: 'bg-green-50 text-green-700 border-green-200' },
  PLAN_REJECTED: { label: 'Plan rejected', cls: 'bg-red-50 text-red-700 border-red-200' },
  ARCHIVED: { label: 'Archived', cls: 'bg-slate-50 text-slate-400 border-slate-200' },
};

export const RUN_STATUS: Record<string, { label: string; dot: string }> = {
  READY_FOR_PLANNING_REVIEW: { label: 'Ready for Planning Review', dot: 'bg-green-500' },
  NOT_READY: { label: 'Not ready', dot: 'bg-amber-500' },
  INSUFFICIENT_DATA: { label: 'Insufficient Data', dot: 'bg-slate-400' },
};

export const FLAG: Record<string, string> = {
  MANPOWER_SHORTAGE: 'Manpower Shortage',
  MATERIAL_SHORTAGE: 'Material Shortage',
  WAREHOUSE_CAPACITY_RISK: 'Warehouse Capacity Risk',
  SCHEDULE_AT_RISK: 'Schedule at Risk',
  COST_ESTIMATE_INCOMPLETE: 'Cost Estimate Incomplete',
  INSUFFICIENT_DATA: 'Insufficient Data',
};

export const PROJECT_TYPES: Record<string, string> = {
  REPAIR: 'Repair', REFURBISHMENT: 'Refurbishment / rework', INBOUND: 'Inbound (receive → putaway)', OUTBOUND: 'Outbound (pick → ship)', CUSTOM: 'Custom',
};

export function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', className)}>{children}</span>;
}

export function PlanStatusPill({ status }: { status: string }) {
  const s = PLAN_STATUS[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  return <Pill className={s.cls}>{s.label}</Pill>;
}

/** A sales simulation has no approval status — only active or archived. */
export function SalesPill({ status }: { status?: string }) {
  return <Pill className="bg-slate-100 text-slate-700 border-slate-300">Sales simulation{status === 'ARCHIVED' ? ' · archived' : ''}</Pill>;
}

export function RunStatusPill({ status }: { status: string }) {
  const s = RUN_STATUS[status] ?? { label: status, dot: 'bg-slate-400' };
  return (
    <Pill className="bg-white text-slate-700 border-slate-200">
      <span className={cn('h-2 w-2 rounded-full', s.dot)} />
      {s.label}
    </Pill>
  );
}

export function FlagPills({ flags }: { flags: string[] }) {
  if (!flags?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {flags.map((f) => (
        <Pill key={f} className={f === 'INSUFFICIENT_DATA' || f === 'COST_ESTIMATE_INCOMPLETE' ? 'bg-slate-50 text-slate-600 border-slate-200' : 'bg-amber-50 text-amber-800 border-amber-200'}>
          {FLAG[f] ?? f}
        </Pill>
      ))}
    </div>
  );
}

export function Section({ title, hint, children, action, className }: { title: string; hint?: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <section className={cn('bg-white rounded-xl border border-slate-200 shadow-sm', className)}>
      <header className="flex items-start justify-between gap-3 px-4 pt-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
        </div>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

const inputCls = 'h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500 disabled:bg-slate-50 disabled:text-slate-500';

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-400 mt-1">{hint}</span>}
    </label>
  );
}

/** Numeric input that keeps `null` for "not entered" — never silently 0. */
export function NumInput({ value, onChange, disabled, placeholder, step, className, ariaLabel }: {
  value: number | null | undefined; onChange: (v: number | null) => void; disabled?: boolean; placeholder?: string; step?: string; className?: string; ariaLabel?: string;
}) {
  return (
    <input
      type="number"
      aria-label={ariaLabel}
      className={cn(inputCls, value === null || value === undefined ? 'border-dashed' : '', className)}
      value={value === null || value === undefined ? '' : value}
      placeholder={placeholder ?? 'not entered'}
      step={step ?? 'any'}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputCls, props.className)} />;
}

export function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(inputCls, props.className)} />;
}

export function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" className="h-4 w-4 accent-green-600" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export const fmt = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: digits });

export const money = (n: number | null | undefined, cur: string) => (n === null || n === undefined ? '—' : `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`);

export function Stat({ label, value, sub, tone = 'neutral' }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const bar = { neutral: 'bg-slate-200', good: 'bg-green-500', warn: 'bg-amber-500', bad: 'bg-red-500' }[tone];
  return (
    <div className="relative bg-white rounded-xl border border-slate-200 shadow-sm p-4 overflow-hidden">
      <span className={cn('absolute left-0 top-0 bottom-0 w-1', bar)} />
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="text-xl font-semibold text-slate-900 mt-1 leading-tight">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

export function Explain({ formula, detail }: { formula: string; detail: string }) {
  return (
    <div className="text-[11px] leading-relaxed">
      <p className="font-mono text-slate-500">{formula}</p>
      <p className="font-mono text-slate-700">{detail}</p>
    </div>
  );
}
