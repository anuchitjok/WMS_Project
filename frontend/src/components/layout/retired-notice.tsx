'use client';

// Shown on the Step 5 pages retired in Phase 2 (Scanner actions, Transfer,
// Cycle Count, Adjustment). History stays visible; stock now changes only
// through Receiving, Requests and Returns.
import Link from 'next/link';
import { Archive } from 'lucide-react';
import { useT } from '@/i18n';

export function RetiredNotice({ feature, extra, scope }: { feature: string; extra?: React.ReactNode; scope?: string }) {
  const { m, t } = useT();
  const R = m.nav.retired;
  return (
    <div role="note" className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
      <Archive className="h-5 w-5 shrink-0 text-slate-500 mt-0.5" />
      <div className="space-y-1">
        <p className="font-medium text-slate-800">{t(R.title, { feature })} {scope ?? R.scope}</p>
        <p className="text-slate-600">
          {R.body}{' '}
          <Link href="/reports?tab=balance" className="text-green-700 underline underline-offset-2">{R.link}</Link>.
        </p>
        {extra}
      </div>
    </div>
  );
}
