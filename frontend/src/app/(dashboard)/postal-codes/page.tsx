'use client';

// The Thai Post address book (migration 43). Type a postal code or a place
// name, in Thai or English, and the tambon, district and province come back.
// Reference data: nothing on this screen writes anything.

import { useCallback, useEffect, useState } from 'react';
import { Loader2, MapPin, Search } from 'lucide-react';
import { toast } from 'sonner';
import { thaiAddressApi, type ThaiTambon } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

export default function PostalCodesPage() {
  const { m, t } = useT();
  const P = m.postalCodes;
  const [q, setQ] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [res, setRes] = useState<{ total: number; rows: ThaiTambon[]; mode: string }>({
    total: 0, rows: [], mode: 'empty',
  });

  // One call per thought, not per keystroke; the search runs on the server.
  useEffect(() => {
    const text = q.trim();
    if (!text) { setState('idle'); setRes({ total: 0, rows: [], mode: 'empty' }); return; }
    let live = true;
    setState('loading');
    const id = setTimeout(() => {
      thaiAddressApi.search(text)
        .then((r) => { if (live) { setRes(r); setState('ready'); } })
        .catch((e) => { if (live) { setState('error'); toast.error(e.message); } });
    }, 250);
    return () => { live = false; clearTimeout(id); };
  }, [q]);

  const copy = useCallback(async (row: ThaiTambon) => {
    const line = [row.nameTh, row.district.nameTh, row.district.province.nameTh, row.postCode].join(' ');
    // navigator.clipboard needs a secure context AND permission, and refuses in
    // some embedded browsers; the old textarea trick still works where it does
    // not, so the button is never a dead end.
    const legacy = () => {
      const el = document.createElement('textarea');
      el.value = line;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    };
    try {
      await navigator.clipboard.writeText(line);
      toast.success(t(P.copied, { address: line }));
    } catch {
      if (legacy()) toast.success(t(P.copied, { address: line }));
      else toast.error(P.copyFailed);
    }
  }, [P, t]);

  return (
    <div className="p-6 space-y-5">
      <PageHeader title={P.title} subtitle={P.subtitle} icon={MapPin} />

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="pc-q">
          {P.search}
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input id="pc-q" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={P.placeholder} className="h-10 pl-9 text-sm" autoFocus />
          {state === 'loading' && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400">{P.hint}</p>
      </div>

      {state === 'idle' ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">
          {P.startTyping}
        </p>
      ) : state === 'loading' && res.rows.length === 0 ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : state === 'error' ? (
        <p className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">{P.loadError}</p>
      ) : res.rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
          {t(P.noResults, { q: q.trim() })}
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-500">
            {t(P.found, { shown: res.rows.length, total: res.total })}
            {res.total > res.rows.length && ` · ${P.narrow}`}
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">{P.col.postCode}</th>
                  <th className="px-4 py-3">{P.col.tambon}</th>
                  <th className="px-4 py-3">{P.col.district}</th>
                  <th className="px-4 py-3">{P.col.province}</th>
                  <th className="px-4 py-3">{P.col.region}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {res.rows.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono font-semibold text-green-700 whitespace-nowrap">
                      {r.postCode}
                      {r.postCodes && r.postCodes !== r.postCode && (
                        <span className="mt-0.5 block font-sans text-[11px] font-normal text-amber-700">
                          {t(P.alsoUses, { codes: r.postCodes.split('/').filter((c) => c !== r.postCode).join(', ') })}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-800">{r.nameTh}</span>
                      <span className="block text-xs text-slate-400">{r.nameEn}</span>
                      {r.postCodeRemark && (
                        <span className="mt-1 block rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                          {r.postCodeRemark}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-slate-700">{r.district.nameTh}</span>
                      <span className="block text-xs text-slate-400">{r.district.nameEn}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-slate-700">{r.district.province.nameTh}</span>
                      <span className="block text-xs text-slate-400">{r.district.province.nameEn}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {r.district.province.regionOfficial ?? '—'}
                      {r.district.province.metroGroup && (
                        <span className="block text-slate-400">{r.district.province.metroGroup}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={() => copy(r)}
                        className={cn('rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600',
                          'hover:border-green-300 hover:bg-green-50 hover:text-green-700')}>
                        {P.copy}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
