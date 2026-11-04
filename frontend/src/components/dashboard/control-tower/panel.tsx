'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** White section card used by every Control Tower section. */
export function Panel({
  title, subtitle, icon: Icon, actions, children, className, tone,
}: {
  title: string;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'alert';
}) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col rounded-xl border bg-white p-4 shadow-sm sm:p-5',
        tone === 'alert' ? 'border-red-200 bg-gradient-to-b from-red-50/70 to-white' : 'border-slate-200',
        className,
      )}
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon && (
            <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', tone === 'alert' ? 'bg-red-100 text-red-600' : 'bg-green-50 text-green-600')}>
              <Icon className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold leading-tight text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

/** Pill toggle group (Daily / Weekly / Monthly, chart/table…). */
export function Segmented<T extends string>({
  value, options, onChange, size = 'sm', ariaLabel,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'xs';
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
            size === 'sm' ? 'px-3 py-1 text-xs' : 'px-2.5 py-0.5 text-[11px]',
            value === o.value ? 'bg-green-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Centered empty / unavailable message inside a panel. */
export function EmptyNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('grid flex-1 place-items-center py-10 text-center text-sm text-slate-400', className)}>{children}</p>;
}
