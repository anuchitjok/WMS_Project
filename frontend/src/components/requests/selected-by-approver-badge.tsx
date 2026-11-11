'use client';

// PR6: marks a pick-list line whose stock location the approver chose (Manual Pick).
// FIFO lines show nothing.

import { UserCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';

export function SelectedByApproverBadge({ className }: { className?: string }) {
  const { m } = useT();
  const L = m.shared.selectedByApprover;
  return (
    <span title={L.title}
      className={cn('inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200', className)}>
      <UserCheck className="h-3 w-3 text-green-700" aria-hidden />
      {L.label}
    </span>
  );
}
