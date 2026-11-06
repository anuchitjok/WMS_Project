'use client';

// P7 7.1: shows a calm notice instead of a module's page while the module is switched
// off (System Settings → Modules). Data and code are untouched.
import Link from 'next/link';
import { PowerOff } from 'lucide-react';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth.store';
import { Skeleton } from '@/components/ui/skeleton';
import { useModuleVisible, useModuleVisibilityReady, type ModuleKey } from '@/lib/feature-flags';

export function ModuleOffNotice({ module }: { module: ModuleKey }) {
  const { m, t } = useT();
  const M = m.nav.modules;
  const isAdmin = useAuthStore((s) => s.user?.role === 'SYSTEM_ADMIN');
  return (
    <div className="p-6">
      <div role="note" className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-slate-100">
          <PowerOff className="h-6 w-6 text-slate-400" />
        </div>
        <h1 className="text-base font-semibold text-slate-800">{t(M.offTitle, { module: M.names[module] })}</h1>
        <p className="mt-1.5 text-sm text-slate-500">{M.offBody}</p>
        <p className="mt-1 text-sm text-slate-500">{M.offAdmin}</p>
        {isAdmin && (
          <Link href="/settings" className="mt-4 inline-flex items-center rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50">
            {M.openSettings}
          </Link>
        )}
      </div>
    </div>
  );
}

export function ModuleGate({ module, children }: { module: ModuleKey; children: React.ReactNode }) {
  const visible = useModuleVisible(module);
  const ready = useModuleVisibilityReady();
  const { m } = useT();
  if (visible) return <>{children}</>;
  if (!ready) {
    return (
      <div className="p-6 space-y-3" aria-busy="true" aria-label={m.nav.modules.checking}>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }
  return <ModuleOffNotice module={module} />;
}
