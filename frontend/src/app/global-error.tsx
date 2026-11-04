'use client';

import { getT, HTML_LANG } from '@/i18n';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { m, locale } = getT();
  const E = m.nav.errorBoundary;
  return (
    <html lang={HTML_LANG[locale]}>
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#0f172a', color: '#fff', padding: 24 }}>
          <h1 style={{ fontSize: 24, margin: 0 }}>{E.criticalTitle}</h1>
          <p style={{ color: '#94a3b8', maxWidth: 480, textAlign: 'center' }}>
            {E.criticalBody}
          </p>
          <button onClick={reset} style={{ background: '#2563eb', color: '#fff', border: 0, borderRadius: 8, padding: '10px 20px', fontWeight: 600, cursor: 'pointer' }}>
            {m.common.actions.retry}
          </button>
        </div>
      </body>
    </html>
  );
}
