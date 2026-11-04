'use client';

// Keeps <html lang> in step with the chosen language. The browser uses it to pick
// the right fonts (Thai shaping, Simplified-Chinese glyphs) and screen readers use
// it for pronunciation. Renders nothing.
import { useEffect } from 'react';
import { HTML_LANG, useLocaleStore } from '@/i18n';

export function HtmlLangSync() {
  const locale = useLocaleStore((s) => s.locale);
  useEffect(() => {
    document.documentElement.lang = HTML_LANG[locale];
  }, [locale]);
  return null;
}
