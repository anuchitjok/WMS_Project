// Interaction state for the Smart Warehouse page: selection, filters, view and
// pick modes, panel visibility and camera requests. Hover lives inside the 3D
// scene (it changes on every mouse move and nothing else needs it).

import { create } from 'zustand';
import { allStatuses, type Filters } from './filter-search';
import type { SlotStatus } from './types';

export type Selection = { kind: 'rack' | 'slot'; id: string } | null;
export type ViewMode = 'realistic' | 'status';
export type PickMode = 'slot' | 'rack';
export type CameraView = 'reset' | 'top' | 'front' | 'iso' | 'focus' | 'zoomIn' | 'zoomOut' | 'fit';

export interface CameraRequest { view: CameraView; n: number }

interface SmartState {
  filters: Filters;
  selection: Selection;
  viewMode: ViewMode;
  pickMode: PickMode;
  leftOpen: boolean;
  rightOpen: boolean;
  /** Increments on every request so the same view can be asked for twice. */
  camera: CameraRequest;

  init: (warehouseId: string) => void;
  setWarehouse: (id: string) => void;
  setZone: (id: string | null) => void;
  setAisle: (id: string | null, zoneId?: string | null) => void;
  setRackFilter: (id: string | null, parents?: { zoneId: string; aisleId: string }) => void;
  setStatuses: (s: SlotStatus[]) => void;
  toggleStatus: (s: SlotStatus) => void;
  clearFilters: () => void;
  setFilters: (f: Filters) => void;
  select: (sel: Selection, focus?: boolean) => void;
  setViewMode: (m: ViewMode) => void;
  setPickMode: (m: PickMode) => void;
  setLeftOpen: (v: boolean) => void;
  setRightOpen: (v: boolean) => void;
  requestCamera: (view: CameraView) => void;
}

const emptyFilters = (warehouseId: string): Filters => ({ warehouseId, zoneId: null, aisleId: null, rackId: null, statuses: allStatuses() });

export const useSmartStore = create<SmartState>()((set, get) => ({
  filters: emptyFilters(''),
  selection: null,
  viewMode: 'realistic',
  pickMode: 'slot',
  leftOpen: true,
  rightOpen: true,
  camera: { view: 'reset', n: 0 },

  init: (warehouseId) => set({ filters: emptyFilters(warehouseId), selection: null, camera: { view: 'reset', n: get().camera.n + 1 } }),
  setWarehouse: (id) => {
    if (id === get().filters.warehouseId) return;
    set({ filters: emptyFilters(id), selection: null, camera: { view: 'reset', n: get().camera.n + 1 } });
  },
  setZone: (zoneId) => set((s) => ({ filters: { ...s.filters, zoneId, aisleId: null, rackId: null }, camera: { view: 'fit', n: s.camera.n + 1 } })),
  setAisle: (aisleId, zoneId) => set((s) => ({
    filters: { ...s.filters, aisleId, rackId: null, zoneId: zoneId !== undefined ? zoneId : s.filters.zoneId },
    camera: { view: 'fit', n: s.camera.n + 1 },
  })),
  setRackFilter: (rackId, parents) => set((s) => ({
    filters: { ...s.filters, rackId, ...(parents && rackId ? { zoneId: parents.zoneId, aisleId: parents.aisleId } : {}) },
    camera: { view: 'fit', n: s.camera.n + 1 },
  })),
  setStatuses: (statuses) => set((s) => ({ filters: { ...s.filters, statuses } })),
  toggleStatus: (st) => set((s) => {
    const has = s.filters.statuses.includes(st);
    // Never end up with nothing shown: removing the last one shows all again.
    const next = has ? s.filters.statuses.filter((x) => x !== st) : [...s.filters.statuses, st];
    return { filters: { ...s.filters, statuses: next.length ? next : allStatuses() } };
  }),
  clearFilters: () => set((s) => ({ filters: emptyFilters(s.filters.warehouseId), camera: { view: 'fit', n: s.camera.n + 1 } })),
  setFilters: (filters) => set({ filters }),
  select: (selection, focus = false) => set((s) => ({
    selection,
    rightOpen: selection ? true : s.rightOpen,
    camera: focus && selection ? { view: 'focus', n: s.camera.n + 1 } : s.camera,
  })),
  setViewMode: (viewMode) => set({ viewMode }),
  setPickMode: (pickMode) => set({ pickMode }),
  setLeftOpen: (leftOpen) => set({ leftOpen }),
  setRightOpen: (rightOpen) => set({ rightOpen }),
  requestCamera: (view) => set((s) => ({ camera: { view, n: s.camera.n + 1 } })),
}));
