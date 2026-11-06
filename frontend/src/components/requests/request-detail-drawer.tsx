'use client';

// P4 4.3 — read-only request detail in a side drawer, used by the Approval
// Workspace. Loads GET /requests/:id (the same detail API the request page uses),
// which also returns live AVAILABLE units per line so short items stand out.
import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { requestsApi } from '@/lib/api';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { REQUEST_STATUS_COLORS } from '@/lib/utils';
import type { RequestStatus } from '@/types';
import { getT, labelOf, useT } from '@/i18n';
import { DeliveryMethodBadge } from './delivery-method-badge';

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <div className="text-sm text-slate-800 break-words">{children}</div>
    </div>
  );
}

export function RequestDetailDrawer({
  requestId,
  onClose,
  footer,
}: {
  requestId: string | null;
  onClose: () => void;
  /** Optional actions (e.g. Approve / Reject) rendered at the bottom. */
  footer?: (req: any) => ReactNode;
}) {
  const { m, t, fmt } = useT();
  const A = m.approvals;
  const D = A.detail;
  const [req, setReq] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!requestId) return;
    let alive = true;
    setReq(null);
    setError(null);
    requestsApi.get(requestId)
      .then((r) => { if (alive) setReq(r); })
      .catch((e: any) => { if (alive) setError(e?.message || getT().m.approvals.detail.loadFailed); });
    return () => { alive = false; };
  }, [requestId]);

  const items: any[] = req?.items ?? [];

  return (
    <Sheet open={!!requestId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl data-[side=right]:sm:max-w-xl gap-0 p-0 bg-white">
        <SheetHeader className="border-b border-slate-200 px-5 py-4 pr-12">
          <SheetTitle className="font-mono text-green-700 font-semibold">
            {t(D.title, { ref: req?.refNumber ?? '' })}
          </SheetTitle>
          {req && (
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <Badge variant="outline" className={REQUEST_STATUS_COLORS[req.status as RequestStatus]}>
                {labelOf(m.status.request, req.status)}
              </Badge>
              <DeliveryMethodBadge value={req.deliveryMethod} />
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : !req ? (
            <div className="space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label={D.requester}>
                  {req.requester?.fullName ?? '—'}
                  {req.requester?.email && <span className="block text-xs text-slate-500">{req.requester.email}</span>}
                </Field>
                <Field label={D.department}>{req.department || req.requester?.department || '—'}</Field>
                <Field label={D.rma}><span className="font-mono">{req.rmaCaseNumber ?? '—'}</span></Field>
                <Field label={D.created}>{fmt.dateTime(req.createdAt)}</Field>
                <Field label={D.delivery}><DeliveryMethodBadge value={req.deliveryMethod} /></Field>
                {req.purpose && <Field label={D.purpose} wide>{req.purpose}</Field>}
                {req.notes && <Field label={D.remarks} wide>{req.notes}</Field>}
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{t(D.items, { count: items.length })}</p>
                <div className="rounded-lg border border-slate-200 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">{D.sku}</th>
                        <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">{D.description}</th>
                        <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">{D.brand}</th>
                        <th className="text-right px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">{D.qty}</th>
                        <th className="text-right px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">{D.available}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map((it) => {
                        const avail = Number(it.availableQty ?? 0);
                        const need = Number(it.quantityRequested ?? 0);
                        const short = Math.max(0, need - avail);
                        return (
                          <tr key={it.id}>
                            <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-700 whitespace-nowrap">{it.product?.code ?? '—'}</td>
                            <td className="px-3 py-2 text-slate-600">{it.product?.description || it.product?.name || '—'}</td>
                            <td className="px-3 py-2 text-slate-600">{it.product?.brand?.name ?? '—'}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt.number(need)}</td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              <span className="tabular-nums text-slate-700">{fmt.number(avail)}</span>
                              {short > 0 ? (
                                <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                                  <AlertTriangle className="h-3 w-3" />{t(D.short, { n: fmt.number(short) })}
                                </span>
                              ) : (
                                <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-700">
                                  <CheckCircle2 className="h-3 w-3" />{D.enough}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {req && footer && (
          <SheetFooter className="border-t border-slate-200 px-5 py-3 flex-row justify-end gap-2">
            {footer(req)}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
