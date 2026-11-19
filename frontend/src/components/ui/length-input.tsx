'use client';

// One size field for the whole app (RQ1, decision C1).
//
//   <LengthInput value={form.lengthCm} onChange={(cm) => set({ lengthCm: cm })} />
//
// Value in and value out are **always centimetres**, whatever the user sees. The
// unit (m / cm / mm) is the user's own choice, made once with <LengthUnitPicker>
// and remembered for every size field on every screen. See `@/lib/length` for the
// conversion and rounding rule.
import { useState, useSyncExternalStore } from 'react';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import {
  LENGTH_UNITS, type LengthUnit,
  fromCm, lengthInputText, lengthUnit, lengthUnitLabel, serverLengthUnit, setLengthUnit, subscribeLengthUnit, toCm,
} from '@/lib/length';

/**
 * The unit the user picked, re-rendering every size field when it changes.
 * The server (and the first hydration render) sees the default unit, so the
 * markup matches and React swaps in the remembered one straight afterwards.
 */
export function useLengthUnit(): LengthUnit {
  return useSyncExternalStore(subscribeLengthUnit, lengthUnit, serverLengthUnit);
}

export interface LengthInputProps {
  /** Centimetres, as stored. undefined = blank. */
  value: number | undefined;
  /** Centimetres, as stored. undefined when the field is blank or not a number. */
  onChange: (cm: number | undefined) => void;
  /** Show and edit in this unit instead of the user's choice (rare). */
  unit?: LengthUnit;
  /** Placeholder in **centimetres**, converted like the value. */
  placeholderCm?: number;
  disabled?: boolean;
  title?: string;
  id?: string;
  className?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  autoFocus?: boolean;
}

/**
 * A number field whose value is centimetres and whose display unit is the user's.
 *
 * Typing emits centimetres; switching the unit only re-reads what is already
 * stored, so a stored value is never rewritten by looking at it in another unit.
 */
export function LengthInput({
  value, onChange, unit: unitProp, placeholderCm, disabled, title, id, className, autoFocus,
  'aria-label': ariaLabel, 'aria-invalid': ariaInvalid,
}: LengthInputProps) {
  const chosen = useLengthUnit();
  const unit = unitProp ?? chosen;

  // What the user sees, kept as text so a half-typed "12." survives a keystroke.
  const [text, setText] = useState(() => lengthInputText(value, unit));
  // The (value, unit) the text was last derived from. When either changes from
  // outside — a reset, a rack type filling the form, the unit picker — the text
  // is re-derived from the stored centimetres.
  const [shown, setShown] = useState<{ cm: number | undefined; unit: LengthUnit }>({ cm: value, unit });
  if (shown.cm !== value || shown.unit !== unit) {
    setShown({ cm: value, unit });
    setText(lengthInputText(value, unit));
  }

  function type(raw: string) {
    const cm = toCm(raw, unit);
    setText(raw);
    setShown({ cm, unit });
    onChange(cm);
  }

  const ph = placeholderCm === undefined ? undefined : fromCm(placeholderCm, unit);
  return (
    <div className={cn('relative', className)}>
      <Input
        id={id}
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        autoFocus={autoFocus}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        placeholder={ph === undefined ? undefined : String(ph)}
        value={text}
        onChange={(e) => type(e.target.value)}
        className="pr-11 tabular-nums"
      />
      {/* The unit is shown, not typed: one picker per size section changes it. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-slate-400"
      >
        {lengthUnitLabel(unit)}
      </span>
    </div>
  );
}

/**
 * The m / cm / mm choice, placed once beside a size section. It changes every
 * size field in the app at once and is remembered for next time.
 */
export function LengthUnitPicker({ className }: { className?: string }) {
  const { m } = useT();
  const unit = useLengthUnit();
  const L = m.common.length;
  return (
    <div className={cn('inline-flex items-center gap-1.5', className)}>
      <span className="text-xs text-slate-500">{L.showIn}</span>
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label={L.unitLabel}>
        {LENGTH_UNITS.map((u) => (
          <button
            key={u}
            type="button"
            aria-pressed={unit === u}
            onClick={() => setLengthUnit(u)}
            className={cn(
              'rounded-md px-2 py-0.5 text-xs transition-colors',
              unit === u ? 'bg-white font-medium text-green-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {L[u]}
          </button>
        ))}
      </div>
    </div>
  );
}
