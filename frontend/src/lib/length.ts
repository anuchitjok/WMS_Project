// One way to convert, round and show a length (RQ1, decision C1).
//
// The database stores centimetres everywhere (`*Cm` columns on Warehouse, Rack,
// RackTypeMaster, Slot and Product) and decision C1 keeps it that way: nothing is
// migrated. What changes is the UI — a single unit the user picks for themselves,
// one conversion, one rounding rule, used by every size field.
//
// Before this, the Warehouse form took metres and converted with its own private
// `mToCm`, the setup wizard had a second copy of the same function, and the Rack,
// Rack Type and Slot forms took centimetres. Same concept, two units, adjacent
// screens. That is what this replaces.
//
// ── The rounding rule ────────────────────────────────────────────────────────
// Centimetres are the stored value and are kept to 2 decimals (0.01 cm = 0.1 mm),
// which is also what the old `Math.round(v * 100 * 100) / 100` produced for metre
// input. Each display unit then gets exactly the number of decimals needed to
// write a 2-decimal centimetre value without losing anything:
//
//     m  → 4 decimals   1234.56 cm = 12.3456 m
//     cm → 2 decimals   1234.56 cm = 1234.56 cm
//     mm → 1 decimal    1234.56 cm = 12345.6 mm
//
// So `toCm(fromCm(cm, unit), unit) === cm` for every value the app can store, in
// every unit — switching the display unit never changes the number on file.
//
// A legacy value with more than 2 decimals of a centimetre (nothing in the app
// writes one, but the column allows it) cannot survive that trip. `<LengthInput>`
// therefore only ever emits a value when the user actually types: changing the
// display unit re-reads the stored centimetres and never writes them back.

import { getT } from '@/i18n';

/** Units a length can be entered and shown in. Storage is always centimetres. */
export type LengthUnit = 'm' | 'cm' | 'mm';
export const LENGTH_UNITS: readonly LengthUnit[] = ['m', 'cm', 'mm'] as const;

/**
 * The unit a user sees until they pick another one.
 *
 * Metres: the standard the owner set for the whole WMS (RQ1). Storage stays in
 * centimetres and nothing in the database is converted — 4000 cm on file is
 * shown and edited as 40 m, the same physical warehouse as before. A user who
 * prefers cm or mm picks it once and it is remembered for every size field.
 */
export const DEFAULT_LENGTH_UNIT: LengthUnit = 'm';

/** Centimetres in one of each unit. */
const CM_PER_UNIT: Record<LengthUnit, number> = { m: 100, cm: 1, mm: 0.1 };

/** Decimals the stored centimetre value keeps (0.01 cm = 0.1 mm). */
export const CM_DECIMALS = 2;

/** Decimals each unit needs to write a 2-decimal centimetre value exactly. */
export const UNIT_DECIMALS: Record<LengthUnit, number> = { m: 4, cm: 2, mm: 1 };

export const isLengthUnit = (v: unknown): v is LengthUnit =>
  v === 'm' || v === 'cm' || v === 'mm';

/**
 * Round to `decimals`, through the exponent so binary float noise does not leak
 * in: `12.3456 * 100` is `1234.5600000000002` in IEEE 754, and `0.1 * 3` is
 * `0.30000000000000004`. Going via `1234.5600000000002e2` → `123456` → `1234.56`
 * gives the number a person would write down.
 */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return NaN;
  const up = Number(`${value}e${decimals}`);
  if (!Number.isFinite(up)) return value; // absurdly large: leave it alone
  const back = Number(`${Math.round(up)}e-${decimals}`);
  return Number.isFinite(back) ? back : value;
}

/** A number the app can work with, or undefined. Blank, NaN and ∞ are undefined. */
const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** A value typed in `unit` → centimetres to store (2 decimals). */
export function toCm(value: number | string | null | undefined, unit: LengthUnit): number | undefined {
  const n = num(value);
  if (n === undefined) return undefined;
  return roundTo(n * CM_PER_UNIT[unit], CM_DECIMALS);
}

/** Stored centimetres → the number to show in `unit`. Exact for any stored value. */
export function fromCm(cm: number | string | null | undefined, unit: LengthUnit): number | undefined {
  const n = num(cm);
  if (n === undefined) return undefined;
  return roundTo(n / CM_PER_UNIT[unit], UNIT_DECIMALS[unit]);
}

/**
 * Stored centimetres → the text an input field shows. Trailing zeros are dropped
 * ("40", not "40.0000") and nothing is grouped, because this goes into a
 * `type="number"` field that only accepts a plain decimal.
 */
export function lengthInputText(cm: number | string | null | undefined, unit: LengthUnit): string {
  const v = fromCm(cm, unit);
  return v === undefined ? '' : String(v);
}

/** Unit label in the user's language, e.g. 'cm' / 'ซม.' / '厘米'. */
export function lengthUnitLabel(unit: LengthUnit): string {
  return getT().m.common.length[unit] ?? unit;
}

export interface FormatLengthOptions {
  /** false → the number only, without the unit label. Default true. */
  withUnit?: boolean;
  /** Shown when there is no value. Default '—'. */
  empty?: string;
  /** Locale-aware number formatter, normally `fmt.number` from `useT()`. */
  format?: (n: number, maxFractionDigits?: number) => string;
}

/**
 * Stored centimetres → text for the screen, in the unit asked for.
 *
 * `formatLength(4000, 'm')` → `40 m`, `formatLength(1234.56, 'm')` → `12.3456 m`,
 * `formatLength(null, 'cm')` → `—`. Pass `fmt.number` from `useT()` as `format`
 * for thousands separators in the user's language.
 */
export function formatLength(
  cm: number | string | null | undefined,
  unit: LengthUnit,
  opts: FormatLengthOptions = {},
): string {
  const v = fromCm(cm, unit);
  if (v === undefined) return opts.empty ?? '—';
  const dp = UNIT_DECIMALS[unit];
  const n = opts.format ? opts.format(v, dp) : String(v);
  if (opts.withUnit === false) return n;
  const T = getT();
  return T.t(T.m.common.length.value, { value: n, unit: lengthUnitLabel(unit) });
}

// ── The remembered unit ───────────────────────────────────────────────────────
// One choice for the whole app, kept in localStorage so it survives a reload.
// Every read and write is wrapped: in a private window, with site data blocked,
// or in an SSR pass there is no storage, and the app must still render — it just
// falls back to the default unit and keeps the choice for this session only.

const LS_KEY = 'wms.lengthUnit';
let current: LengthUnit | null = null;
const listeners = new Set<() => void>();

/** The unit in use. Reads storage once, then serves a cached value. */
export function lengthUnit(): LengthUnit {
  if (current) return current;
  let stored: string | null = null;
  try {
    stored = typeof window === 'undefined' ? null : window.localStorage.getItem(LS_KEY);
  } catch {
    stored = null; // storage blocked or unavailable — the default still works
  }
  current = isLengthUnit(stored) ? stored : DEFAULT_LENGTH_UNIT;
  return current;
}

/** What the server renders, and what the first hydration render uses. */
export const serverLengthUnit = (): LengthUnit => DEFAULT_LENGTH_UNIT;

/** Remember the unit the user picked and tell every size field on screen. */
export function setLengthUnit(unit: LengthUnit) {
  const next = isLengthUnit(unit) ? unit : DEFAULT_LENGTH_UNIT;
  if (current === next) return;
  current = next;
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(LS_KEY, next);
  } catch {
    // Not remembered past this page, but the choice still applies right now.
  }
  for (const fn of listeners) fn();
}

/** Subscribe to unit changes (for `useSyncExternalStore`). */
export function subscribeLengthUnit(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
