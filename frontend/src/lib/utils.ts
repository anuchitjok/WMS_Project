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

export const STOCK_STATUS_COLORS: Record<StockStatus, string> = {
  AVAILABLE: 'bg-green-100 text-green-800',
  RESERVED: 'bg-blue-100 text-blue-800',
  PICKING: 'bg-yellow-100 text-yellow-800',
  PICKED: 'bg-yellow-200 text-yellow-900',
  PACKED: 'bg-orange-100 text-orange-800',
  READY_FOR_PICKUP: 'bg-purple-100 text-purple-800',
  SHIPPED: 'bg-indigo-100 text-indigo-800',
  PENDING_RECEIVING: 'bg-gray-100 text-gray-800',
  PENDING_INSPECTION: 'bg-gray-200 text-gray-800',
  ISSUED_TO_RMA: 'bg-pink-100 text-pink-800',
  CONSUMED: 'bg-slate-100 text-slate-800',
  RETURNED_UNUSED: 'bg-teal-100 text-teal-800',
  QUARANTINE: 'bg-red-100 text-red-800',
  DAMAGED: 'bg-red-200 text-red-900',
  DOA: 'bg-red-300 text-red-900',
  RTV_PENDING: 'bg-orange-200 text-orange-900',
  RTV_SHIPPED: 'bg-orange-300 text-orange-900',
  CLOSED: 'bg-gray-300 text-gray-800',
  CANCELLED: 'bg-gray-400 text-gray-800',
};

export const REQUEST_STATUS_COLORS: Record<RequestStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SUBMITTED: 'bg-blue-100 text-blue-700',
  PENDING_APPROVAL: 'bg-yellow-100 text-yellow-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  PICKING: 'bg-yellow-200 text-yellow-800',
  PICKED: 'bg-orange-100 text-orange-800',
  PACKED: 'bg-orange-200 text-orange-900',
  READY_FOR_PICKUP: 'bg-purple-100 text-purple-800',
  SHIPPED: 'bg-indigo-100 text-indigo-800',
  ISSUED_TO_RMA: 'bg-pink-100 text-pink-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-gray-300 text-gray-700',
};
