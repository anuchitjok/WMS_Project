'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ClipboardCheck, ArrowRight, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { settingsApi, type SetupStep, type SetupStepStatus } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Phase 6 — System Setup Checklist. Read-only: every status is worked out from
 * the data on each load, never from "the page was opened". Steps are in the
 * recommended order; each one links to the screen where it is fixed.
 */
const STATUS: Record<SetupStepStatus, { label: string; cls: string }> = {
  READY: { label: 'Ready', cls: 'bg-green-50 text-green-700 ring-green-200' },
  IN_PROGRESS: { label: 'In progress', cls: 'bg-slate-100 text-slate-700 ring-slate-200' },
  NOT_STARTED: { label: 'Not started', cls: 'bg-white text-slate-500 ring-slate-200' },
  NEEDS_FIX: { label: 'Needs fix', cls: 'bg-red-50 text-red-700 ring-red-200' },
  REVIEW: { label: 'Review', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
};

export default function SetupChecklistPage() {
  const [data, setData] = useState<{ steps: SetupStep[]; ready: boolean; counts: Record<SetupStepStatus, number> } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await settingsApi.setupChecklist()); }
    catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <PageHeader
        title="Setup Checklist"
        subtitle="What is set up, what is missing, and where to fix it — checked from the data each time"
        icon={ClipboardCheck}
        action={
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Check again
          </Button>
        }
      />

      {data && (
        <div className={cn('rounded-xl border p-4 text-sm', data.ready ? 'border-green-200 bg-green-50 text-green-900' : 'border-slate-200 bg-white text-slate-700')}>
          <p className="font-medium">
            {data.ready ? 'Setup is complete.' : `${data.counts.READY} of ${data.steps.length} steps ready.`}
          </p>
          <p className="text-xs mt-1 text-slate-500">
            {(['NEEDS_FIX', 'REVIEW', 'IN_PROGRESS', 'NOT_STARTED'] as SetupStepStatus[])
              .filter((s) => data.counts[s] > 0)
              .map((s) => `${data.counts[s]} ${STATUS[s].label.toLowerCase()}`)
              .join(' · ') || 'Nothing left to do.'}
          </p>
        </div>
      )}

      <ol className="space-y-3">
        {loading && !data
          ? [...Array(8)].map((_, i) => <li key={i}><Skeleton className="h-20 rounded-xl" /></li>)
          : data?.steps.map((s) => (
            <li key={s.key} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4" data-step={s.key}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{s.order}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{s.title}</h3>
                    <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-medium ring-1', STATUS[s.status].cls)} data-status={s.status}>
                      {STATUS[s.status].label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{s.summary}</p>
                  {s.issues.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-slate-700 list-disc pl-4">
                      {s.issues.map((i) => <li key={i}>{i}</li>)}
                    </ul>
                  )}
                </div>
                <Link href={s.href} className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:underline">
                  Open <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </li>
          ))}
      </ol>
    </div>
  );
}
