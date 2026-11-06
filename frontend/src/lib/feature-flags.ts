// Which optional modules are shown in the UI.
// Hidden modules keep their data and code; they are only taken out of menus and
// their routes show a "not enabled" notice. The defaults below apply until the
// admin setting `ui.hiddenModules` (System Settings) has been read, and whenever
// it cannot be read — so a hidden module never flashes into view while loading.
//
// Public API (keep stable — other screens import these):
//   type ModuleKey
//   useModuleVisible(key): boolean
//   isModuleVisibleDefault(key): boolean
// Extra helpers: useModuleVisibilityReady(), refreshModuleVisibility(), MODULE_KEYS.

import { useEffect, useSyncExternalStore } from 'react';
import { governanceApi } from '@/lib/api-governance';

export type ModuleKey = 'floorPlan2d' | 'warranty' | 'mrp';

export const MODULE_KEYS: readonly ModuleKey[] = ['warranty', 'mrp', 'floorPlan2d'];

const DEFAULT_VISIBLE: Record<ModuleKey, boolean> = {
  floorPlan2d: false, // P1 1.8 — 2D floor plan editor hidden; 3D view stays
  warranty: false,    // P7 7.1
  mrp: false,         // P7 7.1 — Material Planning, back in a later phase
};

export function isModuleVisibleDefault(key: ModuleKey): boolean {
  return DEFAULT_VISIBLE[key];
}

// ── Shared cache: fetched once per page load, shared by every component ──────
let loaded: Record<ModuleKey, boolean> | null = null;
let settled = false; // a fetch finished (successfully or not)
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

let failedAt = 0;

function load(force = false): Promise<void> {
  if (inflight) return inflight;
  const hasSession = governanceApi.hasSession();
  if (!force) {
    if (loaded) return Promise.resolve();
    // Signed out (e.g. login page): defaults are final until a session exists.
    if (!hasSession) { if (!settled) { settled = true; emit(); } return Promise.resolve(); }
    if (settled && Date.now() - failedAt < 30_000) return Promise.resolve(); // recent failure: don't hammer the API
  }
  if (!hasSession) return Promise.resolve();
  inflight = governanceApi
    .moduleVisibility()
    .then((r) => {
      const next = { ...DEFAULT_VISIBLE };
      for (const k of MODULE_KEYS) if (typeof r?.visible?.[k] === 'boolean') next[k] = r.visible[k];
      loaded = next;
    })
    .catch(() => { failedAt = Date.now(); /* keep the defaults (or the last good value) */ })
    .finally(() => { settled = true; inflight = null; emit(); });
  return inflight;
}

/** Re-read the setting (e.g. after an admin saved it). */
export function refreshModuleVisibility(): Promise<void> {
  return load(true);
}

export function useModuleVisible(key: ModuleKey): boolean {
  const value = useSyncExternalStore(
    subscribe,
    () => (loaded ? loaded[key] : DEFAULT_VISIBLE[key]),
    () => DEFAULT_VISIBLE[key],
  );
  useEffect(() => { void load(); }, []);
  return value;
}

/** True once the setting has been read (or failed and the defaults are final). */
export function useModuleVisibilityReady(): boolean {
  const ready = useSyncExternalStore(
    subscribe,
    () => settled && (loaded !== null || failedAt > 0 || !governanceApi.hasSession()),
    () => false,
  );
  useEffect(() => { void load(); }, []);
  return ready;
}
