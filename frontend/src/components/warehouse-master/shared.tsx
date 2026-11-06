'use client';

// Small building blocks shared by the Warehouse Master screens.
import { X } from 'lucide-react';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/types';
import type { RackCategory } from '@/lib/api-warehouse';

export const VIEW_ROLES: UserRole[] = ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR', 'WAREHOUSE_STAFF'];

/**
 * Mirrors the backend role matrix (plan P1 1.7):
 *  - isAdmin: warehouse create/edit/activate/deactivate and Rack Type Master (SYSTEM_ADMIN).
 *  - canEditLayout: rack and slot create/edit/delete/generate (SYSTEM_ADMIN, WAREHOUSE_MANAGER).
 */
export function useWarehouseMasterPerms() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  return {
    user,
    canView: !!role && VIEW_ROLES.includes(role),
    isAdmin: role === 'SYSTEM_ADMIN',
    canEditLayout: role === 'SYSTEM_ADMIN' || role === 'WAREHOUSE_MANAGER',
  };
}

/** Category shown for a rack (older racks without a template: PALLET → Pallet on Floor). */
export function rackCategoryOf(rack: { category?: RackCategory; rackType?: string; rackTypeMaster?: { category?: string } | null }): RackCategory {
  if (rack.category) return rack.category;
  const c = rack.rackTypeMaster?.category;
  if (c === 'PALLET_ON_FLOOR' || c === 'STANDARD_RACK') return c;
  return rack.rackType === 'PALLET' ? 'PALLET_ON_FLOOR' : 'STANDARD_RACK';
}

/** Parse an optional positive number field: '' → undefined, invalid → NaN. */
export function optNum(v: string | number | null | undefined): number | undefined {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return n;
}
export const isPos = (n: number | undefined) => n === undefined || (Number.isFinite(n) && n > 0);

export function ModalWrap({ title, onClose, children, widthClass = 'max-w-md' }: { title: string; onClose: () => void; children: React.ReactNode; widthClass?: string }) {
  const { m } = useT();
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className={cn('bg-white rounded-2xl shadow-2xl w-full max-h-[92vh] flex flex-col overflow-hidden', widthClass)}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label={m.common.actions.close}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="text-xs font-medium text-slate-600 block mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export function Pill({ tone = 'slate', children }: { tone?: 'green' | 'slate' | 'amber'; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
      tone === 'green' ? 'bg-green-50 text-green-700 ring-1 ring-green-200'
        : tone === 'amber' ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
          : 'bg-slate-100 text-slate-600')}>
      {children}
    </span>
  );
}

export const selectClass = 'w-full h-9 border border-slate-200 rounded-lg px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500/30';

/** Label + value row used in detail panels. */
export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-800 break-words">{children}</dd>
    </div>
  );
}

/** Calm status colours for slots (one accent + neutrals). */
export const SLOT_STATUS_STYLE: Record<string, string> = {
  EMPTY: 'bg-white border-slate-200 text-slate-600',
  OCCUPIED: 'bg-green-100 border-green-300 text-green-800',
  RESERVED: 'bg-green-50 border-green-200 border-dashed text-green-700',
  BLOCKED: 'bg-slate-200 border-slate-300 text-slate-500',
  QUARANTINE: 'bg-amber-50 border-amber-200 text-amber-700',
  RTV: 'bg-amber-50 border-amber-200 text-amber-700',
};

export const SLOT_TYPES = ['STANDARD', 'PALLET', 'BULK', 'COLD', 'HAZMAT', 'OVERSIZE'] as const;
export const SLOT_STATUSES = ['EMPTY', 'OCCUPIED', 'RESERVED', 'BLOCKED', 'QUARANTINE', 'RTV'] as const;
