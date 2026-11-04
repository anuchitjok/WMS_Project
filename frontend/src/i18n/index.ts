'use client';

// Centralized i18n for the WMS web app.
//
//   const { m, t, fmt } = useT();
//   <h1>{m.receiving.title}</h1>
//   toast.success(t(m.receiving.toast.created, { code: gr.grNumber }));
//   fmt.date(row.createdAt) · fmt.number(qty) · fmt.currency(amount)
//
// Messages live in ./messages/<locale>/<module>.ts. English is the source of truth
// for the key structure; Thai and Chinese files are typed against it, so a missing
// or extra key fails `tsc`. Any empty string falls back to English at runtime.
//
// Only display text is translated. Codes, SKUs, serials, enum values sent to the
// API and database values are never passed through `t()`.

import { useMemo } from 'react';
import { DEFAULT_CURRENCY, DEFAULT_LOCALE, INTL_LOCALE, type Locale } from './config';
import { currentLocale, useLocaleStore } from './store';
import { en, type Messages } from './messages/en';
import { th } from './messages/th';
import { zhCN } from './messages/zh-CN';

export * from './config';
export { useLocaleStore, currentLocale } from './store';
export type { Messages } from './messages/en';

const RAW: Record<Locale, Messages> = { en, th, 'zh-CN': zhCN };

type Tree = { [k: string]: string | Tree };

/** Fill blanks/missing entries in `lang` from `base` (English). */
function withFallback(base: Tree, lang: Tree | undefined): Tree {
  const out: Tree = {};
  for (const [k, v] of Object.entries(base)) {
    const lv = lang?.[k];
    if (typeof v === 'string') out[k] = typeof lv === 'string' && lv.trim() !== '' ? lv : v;
    else out[k] = withFallback(v, typeof lv === 'object' ? lv : undefined);
  }
  return out;
}

const RESOLVED: Partial<Record<Locale, Messages>> = {};
export function getMessages(locale: Locale = currentLocale()): Messages {
  if (!RESOLVED[locale]) {
    RESOLVED[locale] = locale === DEFAULT_LOCALE
      ? en
      : (withFallback(en as unknown as Tree, RAW[locale] as unknown as Tree) as unknown as Messages);
  }
  return RESOLVED[locale]!;
}

export type Params = Record<string, string | number | null | undefined>;

/** Replace `{name}` placeholders. Unknown placeholders are left as-is. */
export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = params[key];
    return v === undefined || v === null ? whole : String(v);
  });
}

/** Look up a label by a dynamic key (e.g. an enum value). Falls back to a readable form of the key. */
export function labelOf(dict: Record<string, string> | undefined, key: string | null | undefined): string {
  if (!key) return '';
  const v = dict?.[key];
  return v ?? humanize(key);
}

/** `PENDING_INSPECTION` → `Pending Inspection` (used only when no translation exists). */
export function humanize(key: string): string {
  return key
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Resolve a dotted path like `status.stock.AVAILABLE`; English fallback, then the path itself. */
export function translatePath(path: string, params?: Params, locale: Locale = currentLocale()): string {
  const read = (root: unknown) =>
    path.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Tree)[part] : undefined), root);
  const hit = read(getMessages(locale)) ?? read(en);
  return typeof hit === 'string' ? interpolate(hit, params) : path;
}

// ─── Formatting ────────────────────────────────────────────────────────────────

type DateIn = string | number | Date | null | undefined;
const EMPTY = '—';

function toDate(d: DateIn): Date | null {
  if (d === null || d === undefined || d === '') return null;
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? null : x;
}

const fmtCache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat>();
function dtf(locale: Locale, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = `d|${locale}|${JSON.stringify(opts)}`;
  if (!fmtCache.has(k)) fmtCache.set(k, new Intl.DateTimeFormat(INTL_LOCALE[locale], opts));
  return fmtCache.get(k) as Intl.DateTimeFormat;
}
function nf(locale: Locale, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const k = `n|${locale}|${JSON.stringify(opts)}`;
  if (!fmtCache.has(k)) fmtCache.set(k, new Intl.NumberFormat(INTL_LOCALE[locale], opts));
  return fmtCache.get(k) as Intl.NumberFormat;
}

export function makeFormatters(locale: Locale) {
  return {
    /** 04 Nov 2026, 14:05 */
    dateTime: (d: DateIn) => { const x = toDate(d); return x ? dtf(locale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(x) : EMPTY; },
    /** 04 Nov 2026 */
    date: (d: DateIn) => { const x = toDate(d); return x ? dtf(locale, { day: '2-digit', month: 'short', year: 'numeric' }).format(x) : EMPTY; },
    /** Wednesday, 4 November 2026 */
    dateLong: (d: DateIn) => { const x = toDate(d); return x ? dtf(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(x) : EMPTY; },
    /** 14:05 */
    time: (d: DateIn) => { const x = toDate(d); return x ? dtf(locale, { hour: '2-digit', minute: '2-digit' }).format(x) : EMPTY; },
    /** 1,234 (or 1,234.5 with decimals) */
    number: (n: number | null | undefined, maxFractionDigits = 2) =>
      n === null || n === undefined || Number.isNaN(n) ? EMPTY : nf(locale, { maximumFractionDigits: maxFractionDigits }).format(n),
    /** ฿1,234.00 / THB 1,234.00 depending on locale */
    currency: (n: number | null | undefined, currency = DEFAULT_CURRENCY) =>
      n === null || n === undefined || Number.isNaN(n) ? EMPTY : nf(locale, { style: 'currency', currency }).format(n),
    /** 85% */
    percent: (fraction: number | null | undefined, maxFractionDigits = 0) =>
      fraction === null || fraction === undefined || Number.isNaN(fraction) ? EMPTY : nf(locale, { style: 'percent', maximumFractionDigits: maxFractionDigits }).format(fraction),
    /** "3 minutes ago" */
    relative: (d: DateIn, now: number = Date.now()) => {
      const x = toDate(d);
      if (!x) return EMPTY;
      const sec = Math.round((x.getTime() - now) / 1000);
      const abs = Math.abs(sec);
      const rtf = new Intl.RelativeTimeFormat(INTL_LOCALE[locale], { numeric: 'auto' });
      if (abs < 60) return rtf.format(sec, 'second');
      if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
      if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour');
      return rtf.format(Math.round(sec / 86400), 'day');
    },
  };
}
export type Formatters = ReturnType<typeof makeFormatters>;

/** Non-React access (event handlers outside components, api client). */
export function getT(locale: Locale = currentLocale()) {
  return { m: getMessages(locale), t: interpolate, fmt: makeFormatters(locale), locale };
}

/** React hook — re-renders the component when the language changes (no page reload). */
export function useT() {
  const locale = useLocaleStore((s) => s.locale);
  return useMemo(() => getT(locale), [locale]);
}
