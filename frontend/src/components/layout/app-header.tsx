'use client';

// Shared sticky top navigation for the dashboard shell.
// White enterprise bar: search field, notification bell, user profile.
// Presentational only — introduces no new workflow, route, or API call.

import { Search } from 'lucide-react';
import { NotificationBell } from './notification-bell';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuthStore } from '@/store/auth.store';

export function AppHeader() {
  const user = useAuthStore((s) => s.user);

  return (
    <header className="sticky top-0 z-30 hidden lg:flex h-16 flex-shrink-0 items-center gap-4 border-b border-slate-200 bg-white/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      {/* Search */}
      <div className="relative w-full max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          placeholder="Search…"
          aria-label="Search"
          className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 transition-colors outline-none focus:border-green-500 focus:bg-white focus:ring-2 focus:ring-green-500/20"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <NotificationBell />

        <div className="mx-1 h-8 w-px bg-slate-200" aria-hidden="true" />

        {/* User profile */}
        <div className="flex items-center gap-3 rounded-xl px-2 py-1.5">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-semibold leading-tight text-slate-900">{user?.fullName}</p>
            <p className="text-xs leading-tight text-slate-400">{user?.role?.replace(/_/g, ' ')}</p>
          </div>
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-green-600 text-xs font-bold text-white">
              {user?.fullName?.slice(0, 2).toUpperCase() ?? 'WM'}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  );
}
