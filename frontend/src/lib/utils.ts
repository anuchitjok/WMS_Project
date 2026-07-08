import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { StockStatus, RequestStatus } from '@/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date | undefined) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(date));
}

export function formatDateShort(date: string | Date | undefined) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));
}

// Shallow-safe dirty check for plain form objects (strings/numbers/booleans).
// Field order is stable in all our forms (spread-then-mutate), so JSON comparison is reliable here.
export function hasUnsavedChanges(current: unknown, baseline: unknown): boolean {
  return JSON.stringify(current) !== JSON.stringify(baseline);
}

// Calm, restrained palette — neutral slate for normal pipeline stages,
// green for good outcomes, amber for "needs attention", red for problems.
// Colour carries real meaning here rather than decorating every distinct status.
export const STOCK_STATUS_COLORS: Record<StockStatus, string> = {
  AVAILABLE: 'bg-green-100 text-green-800',
  RESERVED: 'bg-slate-100 text-slate-700',
  PICKING: 'bg-slate-100 text-slate-700',
  PICKED: 'bg-slate-100 text-slate-700',
  PACKED: 'bg-slate-100 text-slate-700',
  READY_FOR_PICKUP: 'bg-slate-100 text-slate-700',
  SHIPPED: 'bg-slate-100 text-slate-700',
  PENDING_RECEIVING: 'bg-slate-100 text-slate-700',
  PENDING_INSPECTION: 'bg-amber-100 text-amber-800',
  ISSUED_TO_RMA: 'bg-slate-100 text-slate-700',
  CONSUMED: 'bg-slate-100 text-slate-600',
  RETURNED_UNUSED: 'bg-slate-100 text-slate-700',
  QUARANTINE: 'bg-red-100 text-red-800',
  DAMAGED: 'bg-red-100 text-red-800',
  DOA: 'bg-red-100 text-red-800',
  RTV_PENDING: 'bg-amber-100 text-amber-800',
  RTV_SHIPPED: 'bg-amber-100 text-amber-800',
  CLOSED: 'bg-slate-100 text-slate-600',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

export const REQUEST_STATUS_COLORS: Record<RequestStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  SUBMITTED: 'bg-slate-100 text-slate-700',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  PICKING: 'bg-slate-100 text-slate-700',
  PICKED: 'bg-slate-100 text-slate-700',
  PACKED: 'bg-slate-100 text-slate-700',
  READY_FOR_PICKUP: 'bg-slate-100 text-slate-700',
  SHIPPED: 'bg-slate-100 text-slate-700',
  ISSUED_TO_RMA: 'bg-slate-100 text-slate-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};
