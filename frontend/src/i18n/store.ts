import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_LOCALE, isLocale, type Locale } from './config';

// Language preference, stored in the browser (localStorage key `wms_locale`).
// - `locale` is the language currently shown. It survives logout, so the login
//   screen opens in the last language used on this device.
// - `byUser` remembers each user's own choice, so it is restored on their next
//   login even if someone else used another language on the same device.
// Changing the language only re-renders text; it never reloads the page, so an
// open form or an in-progress transaction keeps its state.

interface LocaleState {
  locale: Locale;
  byUser: Record<string, Locale>;
  /** True when the user picked a language on the login screen during this visit. */
  pickedBeforeLogin: boolean;
  setLocale: (locale: Locale, userId?: string | null) => void;
  /** Call right after a successful login. */
  applyForUser: (userId: string) => void;
}

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set, get) => ({
      locale: DEFAULT_LOCALE,
      byUser: {},
      pickedBeforeLogin: false,
      setLocale: (locale, userId) => {
        if (!isLocale(locale)) return;
        set((s) => ({
          locale,
          byUser: userId ? { ...s.byUser, [userId]: locale } : s.byUser,
          pickedBeforeLogin: userId ? s.pickedBeforeLogin : true,
        }));
      },
      applyForUser: (userId) => {
        const { byUser, locale, pickedBeforeLogin } = get();
        const saved = byUser[userId];
        // An explicit choice on the login screen wins and becomes the saved preference.
        const next = pickedBeforeLogin || !isLocale(saved) ? locale : saved;
        set({ locale: next, byUser: { ...byUser, [userId]: next }, pickedBeforeLogin: false });
      },
    }),
    {
      name: 'wms_locale',
      partialize: (s) => ({ locale: s.locale, byUser: s.byUser }),
      // Ignore anything unexpected in storage (old/corrupt values) and fall back to English.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LocaleState>;
        const byUser: Record<string, Locale> = {};
        for (const [k, v] of Object.entries(p.byUser ?? {})) if (isLocale(v)) byUser[k] = v;
        return { ...current, locale: isLocale(p.locale) ? p.locale : DEFAULT_LOCALE, byUser };
      },
    },
  ),
);

/** Current locale outside React (api client, utils). */
export function currentLocale(): Locale {
  return useLocaleStore.getState().locale;
}
