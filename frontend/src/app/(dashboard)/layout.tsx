'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Menu, X, Warehouse } from 'lucide-react';
import { NotificationBell } from '@/components/layout/notification-bell';
import { useAuthStore } from '@/store/auth.store';
import { Sidebar } from '@/components/layout/sidebar';
import { AppHeader } from '@/components/layout/app-header';
import { cn } from '@/lib/utils';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Wait for React's hydration before enforcing the auth guard.
  //
  // The pages are prerendered (output: "export"), so during the hydration render
  // useSyncExternalStore returns the SERVER snapshot to stay consistent with the
  // prerendered HTML — `isAuthenticated` reads false on the first pass even
  // though the store was already rehydrated from localStorage. Redirecting on
  // that stale value is what used to bounce a signed-in user to /login on every
  // refresh and every deep link.
  //
  // Note this is React's hydration, not the store's: zustand's
  // persist.hasHydrated() already returns true on that first render, so gating
  // on it looks correct and does not work. One commit is what we actually need.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);

  useEffect(() => {
    if (hydrated && !isAuthenticated) router.replace('/login');
  }, [hydrated, isAuthenticated, router]);

  // Close the mobile drawer whenever the route changes
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  if (!hydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-green-600" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }
  if (!isAuthenticated) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Desktop sidebar */}
      <div className="hidden lg:block flex-shrink-0">
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      <div className={cn('fixed inset-0 z-50 lg:hidden', mobileOpen ? '' : 'pointer-events-none')}>
        <div
          className={cn('absolute inset-0 bg-black/50 transition-opacity', mobileOpen ? 'opacity-100' : 'opacity-0')}
          onClick={() => setMobileOpen(false)}
        />
        <div className={cn('absolute left-0 top-0 h-full transition-transform duration-200', mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
          <Sidebar />
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center gap-3 px-4 h-14 bg-white text-slate-900 border-b border-slate-200 flex-shrink-0">
          <button onClick={() => setMobileOpen((v) => !v)} aria-label="Toggle menu" className="p-1 text-slate-600">
            {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-green-600">
            <Warehouse className="h-4 w-4 text-white" />
          </div>
          <span className="flex-1 font-bold">HSNT WMS</span>
          <NotificationBell />
        </header>

        {/* Desktop sticky header */}
        <AppHeader />

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
