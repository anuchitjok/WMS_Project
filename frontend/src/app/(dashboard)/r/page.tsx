'use client';

// Request QR page (plan P5 5.3 / Q10). The QR on the picking slip and on the
// handover screen opens /r?ref=<refNumber>. Login is required (dashboard layout);
// what the page shows depends on who scanned it:
//   - requester who owns the request → items to receive + "Confirm receipt"
//   - warehouse staff (fulfillment access, in scope) → pick list with locations
//   - anyone else → a calm "no access" message
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, ClipboardList, ExternalLink, Lock, MapPin, PackageCheck, Printer, RefreshCw, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { documentsApi } from '@/lib/api';
import { documentsRefApi, type RefView, type SlipRow, type ReceiptState } from '@/lib/api-documents';
import { getT, labelOf, useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { SelectedByApproverBadge } from '@/components/requests/selected-by-approver-badge';

export default function RequestRefPage() {
  return (
    <Suspense fallback={<div className="p-4 sm:p-6 max-w-2xl mx-auto"><Skeleton className="h-64 rounded-xl" /></div>}>
      <RequestRefContent />
    </Suspense>
  );
}

type Loaded = Exclude<RefView, { view: 'NONE' }>;

function RequestRefContent() {
  const ref = (useSearchParams().get('ref') ?? '').trim();
  const { m } = useT();
  const R = m.documents.ref;
  const [data, setData] = useState<RefView | null>(null);
  const [error, setError] = useState<{ notFound: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!ref) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      setData(await documentsRefApi.view(ref));
    } catch (e) {
      const err = e as Error & { status?: number };
      setError({ notFound: err.status === 404, message: err.message });
    } finally {
      setLoading(false);
    }
  }, [ref]);
  useEffect(() => { load(); }, [load]);

  if (!ref) return <Notice icon={ClipboardList} title={R.missingRef} />;
  if (loading && !data) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4" aria-busy="true">
        <span className="sr-only">{R.loading}</span>
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }
  if (error) {
    return error.notFound
      ? <Notice icon={ClipboardList} title={R.notFound} hint={R.notFoundHint} />
      : <Notice icon={ClipboardList} title={R.loadFailed} hint={error.message} action={<Button size="lg" className="h-12 px-6 bg-green-600 hover:bg-green-700 text-white" onClick={load}>{R.retry}</Button>} />;
  }
  if (!data) return null;
  if (data.view === 'NONE') {
    return (
      <Notice icon={Lock} title={R.noAccessTitle} hint={R.noAccessHint}
        action={<Link href="/dashboard"><Button variant="outline" size="lg" className="h-12 px-6">{R.backHome}</Button></Link>} />
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
      <Header data={data} loading={loading} onRefresh={load} />
      {data.canPick && <PickList data={data} />}
      {data.canReceive && <ReceiptPanel data={data} onChanged={load} />}
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Notice({ icon: Icon, title, hint, action }: { icon: React.ElementType; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="p-4 sm:p-6 max-w-lg mx-auto">
      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 sm:p-8 text-center shadow-sm">
        <Icon className="mx-auto h-10 w-10 text-slate-400" />
        <h1 className="mt-4 text-lg font-semibold text-slate-900">{title}</h1>
        {hint && <p className="mt-2 text-sm leading-relaxed text-slate-500">{hint}</p>}
        {action && <div className="mt-6 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

function Pill({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'green' }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
      tone === 'green' ? 'border-green-200 bg-green-50 text-green-700' : 'border-slate-200 bg-slate-50 text-slate-600',
    )}>{children}</span>
  );
}

function Header({ data, loading, onRefresh }: { data: Loaded; loading: boolean; onRefresh: () => void }) {
  const { m, t, fmt } = useT();
  const R = m.documents.ref;
  const stateTone = data.receiptState === 'READY' || data.receiptState === 'RECEIVED' ? 'green' : 'slate';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{R.heading}</p>
          <h1 className="font-mono text-xl sm:text-2xl font-semibold text-slate-900 break-all">{data.refNumber}</h1>
        </div>
        <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={onRefresh} disabled={loading} aria-label={R.refresh}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Pill tone={stateTone}>{labelOf(R.receiptState, data.receiptState)}</Pill>
        <Pill>{data.deliveryMethod === 'SHIP' ? <Truck className="h-3 w-3" /> : <PackageCheck className="h-3 w-3" />}{labelOf(R.delivery, data.deliveryMethod)}</Pill>
        <Pill>{t(R.itemCount, { count: data.items.length })}</Pill>
      </div>
      <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <Fact label={R.requester}>{data.requesterName || '—'}{data.department ? <span className="text-slate-500"> · {data.department}</span> : null}</Fact>
        <Fact label={R.created}>{fmt.date(data.createdAt)}</Fact>
        <Fact label={R.status}>{labelOf(m.status.request as Record<string, string>, data.status)}</Fact>
        {data.canPick && <Fact label={R.picker}>{data.pickerName || '—'}</Fact>}
      </dl>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 min-w-0">
      <dt className="text-slate-500 shrink-0">{label}:</dt>
      <dd className="text-slate-900 font-medium min-w-0 break-words">{children}</dd>
    </div>
  );
}

function PickList({ data }: { data: Loaded }) {
  const { m } = useT();
  const P = m.documents.pick;
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900"><ClipboardList className="h-4 w-4 text-green-600" />{P.title}</h2>
        {data.task && <span className="font-mono text-xs text-slate-500">{data.task.refNumber} · {labelOf(m.status.fulfillment as Record<string, string>, data.task.status)}</span>}
      </div>
      <p className="px-4 pt-3 text-sm text-slate-500">{data.task ? P.hint : P.notAllocated}</p>
      <ul className="divide-y divide-slate-100">
        {data.items.map((r) => <PickRow key={r.no} row={r} />)}
      </ul>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-slate-100 p-4">
        <Link href={data.task ? `/outbound/fulfillment?task=${encodeURIComponent(data.task.id)}` : '/outbound/fulfillment'}>
          <Button size="lg" className="h-12 w-full bg-green-600 hover:bg-green-700 text-white text-base"><ExternalLink className="h-4 w-4" />{P.openTask}</Button>
        </Link>
        <Button variant="outline" size="lg" className="h-12 w-full text-base"
          onClick={() => documentsApi.openWithAuth(documentsApi.pickingSlipUrl(data.requestId))}>
          <Printer className="h-4 w-4" />{P.printSlip}
        </Button>
      </div>
    </section>
  );
}

function PickRow({ row }: { row: SlipRow }) {
  const { m } = useT();
  const P = m.documents.pick;
  const loc = row.location;
  const hasLoc = !!loc && loc.bin !== '—';
  return (
    <li className="flex gap-3 px-4 py-3">
      <div className="w-28 sm:w-32 shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
        <p className="text-xs text-slate-500 flex items-center gap-1"><MapPin className="h-3 w-3" />{hasLoc ? loc!.warehouse : P.location}</p>
        <p className={cn('font-mono font-semibold break-all', hasLoc ? 'text-base text-slate-900' : 'text-sm text-slate-400')}>{hasLoc ? loc!.bin : P.noLocation}</p>
        {hasLoc && row.selectedByApprover && <SelectedByApproverBadge className="mt-1" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-sm font-semibold text-slate-900 break-all">{row.sku}</p>
        <p className="text-sm text-slate-700 break-words">{row.description}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {P.serial}: <span className="font-mono text-slate-700">{row.serial}</span> · {labelOf(m.documents.ref.condition, row.condition)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs text-slate-500">{P.qty}</p>
        <p className="text-xl font-semibold text-slate-900">{row.qty}</p>
      </div>
    </li>
  );
}

function ReceiptPanel({ data, onChanged }: { data: Loaded; onChanged: () => void }) {
  const { m, t } = useT();
  const C = m.documents.receive;
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const state: ReceiptState = data.receiptState;
  const message = state === 'READY' ? C.ready : state === 'RECEIVED' ? C.received : state === 'CANCELLED' ? C.cancelled : C.notReady;

  async function confirm() {
    setBusy(true);
    try {
      const res = await documentsRefApi.confirmReceipt(data.refNumber, data.task?.version);
      const { m: mm } = getT();
      toast.success(res.alreadyConfirmed ? mm.documents.receive.already : mm.documents.receive.done);
      setAsking(false);
    } catch (e) {
      toast.error((e as Error).message);
      setAsking(false);
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900"><PackageCheck className="h-4 w-4 text-green-600" />{C.title}</h2>
      </div>
      {/* Warehouse users already see the full list above. */}
      {!data.canPick && (
        <ul className="divide-y divide-slate-100">
          {data.items.map((r) => (
            <li key={r.no} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-base text-slate-900 break-words">{r.description}</p>
                <p className="font-mono text-xs text-slate-500 break-all">{r.sku}</p>
                {r.serial !== '—' && <p className="mt-0.5 text-xs text-slate-500">{C.serial}: <span className="font-mono text-slate-700">{r.serial}</span></p>}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs text-slate-500">{C.qty}</p>
                <p className="text-xl font-semibold text-slate-900">{r.qty}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-slate-100 p-4 space-y-3">
        <p className={cn('flex items-start gap-2 text-sm', state === 'RECEIVED' ? 'text-green-700' : 'text-slate-600')}>
          {state === 'RECEIVED' && <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />}{message}
        </p>
        {state !== 'RECEIVED' && state !== 'CANCELLED' && (
          asking ? (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-3">
              <p className="text-sm font-medium text-slate-900">{t(C.confirmQuestion, { count: data.items.length })}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Button variant="outline" size="lg" className="h-12 text-base" onClick={() => setAsking(false)} disabled={busy}>{m.common.actions.cancel}</Button>
                <Button size="lg" className="h-12 text-base bg-green-600 hover:bg-green-700 text-white" onClick={confirm} disabled={busy} aria-busy={busy}>
                  {busy ? C.confirming : C.confirmYes}
                </Button>
              </div>
            </div>
          ) : (
            <Button size="lg" className="h-14 w-full text-lg bg-green-600 hover:bg-green-700 text-white"
              disabled={state !== 'READY'} onClick={() => setAsking(true)}>
              <CheckCircle2 className="h-5 w-5" />{C.confirm}
            </Button>
          )
        )}
      </div>
    </section>
  );
}
