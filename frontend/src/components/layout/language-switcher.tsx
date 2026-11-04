'use client';

// Language selector (English | ไทย | 简体中文).
// Switching only re-renders text: no navigation, no reload, no data refetch,
// so open forms and in-progress transactions keep their state.
import { Check, Globe } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { LOCALES, LOCALE_LABELS, LOCALE_SHORT, useLocaleStore, useT, type Locale } from '@/i18n';
import { useAuthStore } from '@/store/auth.store';

export function LanguageSwitcher({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { m, locale } = useT();
  const setLocale = useLocaleStore((s) => s.setLocale);
  const userId = useAuthStore((s) => (s.isAuthenticated ? s.user?.id : null));

  const choose = (l: Locale) => { if (l !== locale) setLocale(l, userId); };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${m.nav.changeLanguage}: ${LOCALE_LABELS[locale]}`}
        title={m.nav.changeLanguage}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-slate-600 transition-colors',
          'hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400',
          'data-[popup-open]:bg-slate-100',
          className,
        )}
      >
        <Globe className="h-4 w-4 text-slate-500" aria-hidden="true" />
        <span className="whitespace-nowrap">{compact ? LOCALE_SHORT[locale] : LOCALE_LABELS[locale]}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {LOCALES.map((l) => (
          <DropdownMenuItem
            key={l}
            onClick={() => choose(l)}
            lang={l}
            className={cn('flex items-center justify-between gap-3', l === locale && 'font-semibold text-green-700')}
          >
            <span>{LOCALE_LABELS[l]}</span>
            {l === locale && <Check className="h-4 w-4 text-green-600" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
