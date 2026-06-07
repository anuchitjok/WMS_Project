import { create } from 'zustand';
import type { ScanContext } from '../types';

interface ScanResult {
  barcode: string;
  type: string;
  timestamp: number;
}

interface ScannerState {
  isScanning: boolean;
  lastScan: ScanResult | null;
  scanContext: ScanContext | null;
  scanHistory: ScanResult[];
  setScanning: (scanning: boolean) => void;
  setScanResult: (result: ScanResult) => void;
  setScanContext: (context: ScanContext | null) => void;
  clearScan: () => void;
}

export const useScannerStore = create<ScannerState>((set, get) => ({
  isScanning: false,
  lastScan: null,
  scanContext: null,
  scanHistory: [],
  setScanning: (isScanning) => set({ isScanning }),
  setScanResult: (result) => set((s) => ({
    lastScan: result,
    scanHistory: [result, ...s.scanHistory.slice(0, 49)],
  })),
  setScanContext: (scanContext) => set({ scanContext }),
  clearScan: () => set({ lastScan: null }),
}));
