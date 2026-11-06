// Slot status colours. Defaults follow the warehouse convention
// (Available green, Occupied blue, Reserved yellow, Blocked red, Inactive grey)
// and each one can be changed from the legend. The choice is kept in this
// browser only (localStorage); if storage is blocked the defaults are used.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { SLOT_STATUSES, type SlotStatus } from './types';

export type StatusColors = Record<SlotStatus, string>;

export const DEFAULT_STATUS_COLORS: StatusColors = {
  available: '#22c55e',
  occupied: '#3b82f6',
  reserved: '#eab308',
  blocked: '#ef4444',
  inactive: '#9ca3af',
};

const HEX = /^#[0-9a-f]{6}$/i;

interface StatusColorState {
  colors: StatusColors;
  setColor: (s: SlotStatus, hex: string) => void;
  reset: () => void;
}

const safeStorage = createJSONStorage(() => {
  try {
    const k = '__sw3d_probe';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v); }, removeItem: (k) => { mem.delete(k); } };
  }
});

export const useStatusColors = create<StatusColorState>()(
  persist(
    (set) => ({
      colors: DEFAULT_STATUS_COLORS,
      setColor: (s, hex) => {
        if (!HEX.test(hex)) return;
        set((st) => ({ colors: { ...st.colors, [s]: hex.toLowerCase() } }));
      },
      reset: () => set({ colors: DEFAULT_STATUS_COLORS }),
    }),
    {
      name: 'wms.smart3d.statusColors',
      storage: safeStorage,
      // Ignore anything stored that isn't a valid colour for a known status.
      merge: (stored, current) => {
        const s = (stored as Partial<StatusColorState> | undefined)?.colors ?? {};
        const colors = { ...DEFAULT_STATUS_COLORS };
        for (const k of SLOT_STATUSES) {
          const v = (s as Partial<StatusColors>)[k];
          if (typeof v === 'string' && HEX.test(v)) colors[k] = v;
        }
        return { ...current, colors };
      },
    },
  ),
);
