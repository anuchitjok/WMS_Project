'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, GitCompare, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { mrpApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Note, Pill, SELECT, Section, TD, TH, THEAD, THEAD_ROW, fmtDate, fmtQty } from './shared';

// Run history, side-by-side comparison of two runs, and reproducibility check.

export function MrpRuns({ onOpenRun }: { onOpenRun: (id: string) => void }) {
  const [runs, setRuns] = useState<any[]>([]);
  const [base, setBase] = useState('');
  const [target, setTarget] = useState('');
  const [cmp, setCmp] = useState<any>(null);
  const [verify, setVerify] = useState<Record<string, any>>({});

  useEffect(() => {
    mrpApi.runs().then((r) => {
      setRuns(r);
      if (r.length >= 2) { setTarget(r[0].id); setBase(r[1].id); }
    }).catch((e) => toast.error(e.message));
  }, []);

  async function compare() {
    if (!base || !target || base === target) { toast.error('Pick two different runs'); return; }
    try { setCmp(await mrpApi.compare(base, target)); } catch (e: any) { toast.error(e.message); }
  }
  async function check(id: string) {
    try { const v = await mrpApi.verify(id); setVerify((m) => ({ ...m, [id]: v })); } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="space-y-5">
      <Section title="Run history" subtitle="Each run stores its inputs, configuration and results, so it can be recalculated and compared later">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={THEAD}><tr className={THEAD_ROW}><th className={TH}>Run</th><th className={TH}>As of</th><th className={TH}>Scope</th><th className={`${TH} text-right`}>Lines</th><th className={`${TH} text-right`}>Order now</th><th className={`${TH} text-right`}>Planned</th><th className={TH}>Started by</th><th className={TH}>Reproducible</th><th className={TH} /></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {runs.length === 0 ? <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">No runs yet</td></tr> : runs.map((r) => {
                const v = verify[r.id];
                return (
                  <tr key={r.id}>
                    <td className={TD}><span className="font-mono">{r.runNumber}</span>{r.note && <div className="text-xs text-slate-400">{r.note}</div>}</td>
                    <td className={TD}>{fmtDate(r.asOf)}</td>
                    <td className={TD}>{r.warehouseId ? 'One warehouse' : 'Network'}</td>
                    <td className={`${TD} text-right`}>{r.lineCount}</td>
                    <td className={`${TD} text-right`}>{r.summary?.orderNow ?? '—'}</td>
                    <td className={`${TD} text-right`}>{r.summary?.plannedLater ?? '—'}</td>
                    <td className={TD}>{r.startedBy ?? '—'}<div className="text-xs text-slate-400">{new Date(r.startedAt).toLocaleString()} · {r.durationMs ?? '—'} ms</div></td>
                    <td className={TD}>
                      {!v ? <button className="text-xs text-green-700 hover:underline" onClick={() => check(r.id)}>Check</button>
                        : v.reproducible && v.inputHashMatches ? <span className="inline-flex items-center gap-1 text-xs text-green-700"><CheckCircle2 className="h-3.5 w-3.5" />Yes</span>
                        : <span className="inline-flex items-center gap-1 text-xs text-red-600" title={JSON.stringify(v.mismatches.slice(0, 5))}><XCircle className="h-3.5 w-3.5" />{v.mismatches.length} difference(s)</span>}
                    </td>
                    <td className={`${TD} text-right`}><Button size="sm" variant="outline" className="h-7" onClick={() => onOpenRun(r.id)}>Open</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Compare two runs" subtitle="What changed between a base run and a later one, line by line">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <select className={SELECT} value={base} onChange={(e) => setBase(e.target.value)}>
            <option value="">Base run…</option>
            {runs.map((r) => <option key={r.id} value={r.id}>{r.runNumber} · {fmtDate(r.asOf)}</option>)}
          </select>
          <span className="text-slate-400">→</span>
          <select className={SELECT} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Compare with…</option>
            {runs.map((r) => <option key={r.id} value={r.id}>{r.runNumber} · {fmtDate(r.asOf)}</option>)}
          </select>
          <Button variant="outline" onClick={compare}><GitCompare className="h-4 w-4 mr-1" />Compare</Button>
        </div>
        {cmp && (
          <>
            <div className="px-4 pb-3">
              <Note>
                {cmp.scopeChanged && <>The runs cover different warehouses (one is a network run), so quantities differ by scope as well as by data.{' '}</>}
                {cmp.sameInputs ? 'Both runs had identical inputs.' : 'Inputs differ (stock, usage, supply or parameters changed).'}{' '}
                {cmp.configChanged ? 'The planning configuration also changed between the runs.' : 'Configuration was the same.'}{' '}
                {cmp.changes.length} line(s) changed.
              </Note>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className={THEAD}><tr className={THEAD_ROW}><th className={TH}>SKU</th><th className={TH}>Change</th><th className={TH}>Fields</th><th className={`${TH} text-right`}>Suggested (base → new)</th><th className={TH}>Exceptions added / cleared</th></tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {cmp.changes.length === 0 ? <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No differences</td></tr> : cmp.changes.map((c: any, i: number) => (
                    <tr key={i}>
                      <td className={TD}><span className="font-mono">{c.sku}</span><div className="text-xs text-slate-500">{c.description}</div></td>
                      <td className={TD}><Pill tone={c.change === 'CHANGED' ? 'amber' : 'slate'}>{c.change.toLowerCase()}</Pill></td>
                      <td className={`${TD} text-xs text-slate-600`}>{c.fields?.join(', ') ?? '—'}</td>
                      <td className={`${TD} text-right`}>{fmtQty(c.base?.suggestedQty)} → {fmtQty(c.target?.suggestedQty)}</td>
                      <td className={`${TD} text-xs`}>
                        {c.exceptionsAdded?.length ? <span className="text-amber-700">+ {c.exceptionsAdded.join(', ')} </span> : null}
                        {c.exceptionsCleared?.length ? <span className="text-green-700">− {c.exceptionsCleared.join(', ')}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
