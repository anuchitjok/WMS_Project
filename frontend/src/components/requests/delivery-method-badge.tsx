'use client';

// P4 4.7 — small Collect / Ship pill shown on request lists, approval detail and
// fulfillment cards. Null / unknown values (older requests) read as Collect.
import { Truck, Hand } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { deliveryMethodOf } from '@/lib/api-requests';

export function DeliveryMethodBadge({ value, className }: { value: unknown; className?: string }) {
  const { m } = useT();
  const method = deliveryMethodOf(value);
  const Icon = method === 'SHIP' ? Truck : Hand;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        method === 'SHIP' ? 'border-green-200 bg-green-50 text-green-700' : 'border-slate-200 bg-slate-50 text-slate-600',
        className,
      )}
      title={m.requests.deliveryHint[method]}
    >
      <Icon className="h-3 w-3" />
      {m.requests.delivery[method]}
    </span>
  );
}
