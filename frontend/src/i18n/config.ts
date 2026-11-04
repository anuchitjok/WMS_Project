// Central i18n configuration. English is the default and the fallback language.

export const LOCALES = ['en', 'th', 'zh-CN'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Label shown in the language selector — always written in the language itself. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  th: 'ไทย',
  'zh-CN': '简体中文',
};

/** Short code for compact selectors (mobile header). */
export const LOCALE_SHORT: Record<Locale, string> = {
  en: 'EN',
  th: 'TH',
  'zh-CN': '中文',
};

/**
 * BCP-47 tag used by Intl for dates, times and numbers.
 * Thai uses the Gregorian calendar on purpose: dates must line up with
 * transaction codes, exports and other systems that use the Gregorian year.
 * Switch to 'th-TH' (Buddhist calendar, year 2569) if the business asks for it.
 */
export const INTL_LOCALE: Record<Locale, string> = {
  en: 'en-GB',
  th: 'th-TH-u-ca-gregory',
  'zh-CN': 'zh-CN',
};

/** Value for <html lang>. Drives font fallback (CJK glyph choice) and screen readers. */
export const HTML_LANG: Record<Locale, string> = {
  en: 'en',
  th: 'th',
  'zh-CN': 'zh-CN',
};

/** Currency used for money values across the WMS. */
export const DEFAULT_CURRENCY = 'THB';

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}
