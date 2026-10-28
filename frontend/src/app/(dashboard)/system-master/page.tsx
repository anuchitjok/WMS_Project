'use client';

import { useCallback, useEffect, useState } from 'react';
import { ListChecks, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { masterDataApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

type Tab = 'reasons' | 'departments' | 'uoms';
const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: 'reasons', label: 'Reason Codes', hint: 'Reasons for stock adjustments, DOA declarations and scrap. Once a category has an active code, choosing one becomes mandatory.' },
  { key: 'departments', label: 'Departments', hint: 'Departments for users and withdrawal requests. New or changed values must match an active department.' },
  { key: 'uoms', label: 'Units of Measure', hint: 'Units for Product Master. No conversions are applied between units.' },
];
const CATEGORIES = ['ADJUSTMENT', 'DOA', 'SCRAP'] as const;

export default function SystemMasterPage() {
  const [tab, setTab] = useState<Tab>('reasons');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ category: 'ADJUSTMENT', code: '', name: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(tab === 'reasons' ? await masterDataApi.reasonCodes(undefined, true)
        : tab === 'departments' ? await masterDataApi.departments(true)
        : await masterDataApi.uoms(true));
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    try {
      if (tab === 'reasons') await masterDataApi.createReasonCode({ category: form.category, code: form.code, description: form.name });
      else if (tab === 'departments') await masterDataApi.createDepartment({ code: form.code, name: form.name || form.code });
      else await masterDataApi.createUom({ code: form.code, name: form.name || form.code });
      toast.success('Added');
      setForm((f) => ({ ...f, code: '', name: '' }));
      load();
    } catch (e: any) { toast.error(e.message); }
  }

  async function toggle(row: any) {
    const dto = { isActive: !row.isActive };
    try {
      if (tab === 'reasons') await masterDataApi.updateReasonCode(row.id, dto);
      else if (tab === 'departments') await masterDataApi.updateDepartment(row.id, dto);
      else await masterDataApi.updateUom(row.id, dto);
      load();
    } catch (e: any) { toast.error(e.message); }
  }

  async function rename(row: any, value: string) {
    const text = value.trim();
    const currentText = tab === 'reasons' ? row.description : row.name;
    if (!text || text === currentText) return;
    try {
      if (tab === 'reasons') await masterDataApi.updateReasonCode(row.id, { description: text });
      else if (tab === 'departments') await masterDataApi.updateDepartment(row.id, { name: text });
      else await masterDataApi.updateUom(row.id, { name: text });
      toast.success('Saved');
      load();
    } catch (e: any) { toast.error(e.message); }
  }

  const current = TABS.find((t) => t.key === tab)!;

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Lists & Codes" subtitle="Reason codes, departments and units of measure" icon={ListChecks} />

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm -mb-px border-b-2 ${tab === t.key ? 'border-green-600 text-green-700 font-medium' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">{current.hint} Codes cannot be renamed or deleted — deactivate instead, so existing records keep their meaning.</p>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-end gap-2">
        {tab === 'reasons' && (
          <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <Input className="h-9 w-40" placeholder="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        <Input className="h-9 flex-1 min-w-[200px]" placeholder={tab === 'reasons' ? 'Description' : 'Name'} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Button className="h-9 bg-green-600 hover:bg-green-700 text-white" disabled={!form.code.trim() || (tab === 'reasons' && !form.name.trim())} onClick={add}>
          <Plus className="h-4 w-4 mr-1" />Add
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr className="text-left text-xs uppercase text-slate-500">
              {tab === 'reasons' && <th className="px-4 py-3 font-medium">Category</th>}
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">{tab === 'reasons' ? 'Description' : 'Name'}</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(4)].map((_, i) => <tr key={i}><td colSpan={5} className="px-4 py-3"><Skeleton className="h-6" /></td></tr>)
              : rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">Nothing defined yet — free text is accepted until the first entry is added.</td></tr>
              : rows.map((r) => (
                <tr key={r.id} className={r.isActive ? '' : 'text-slate-400'}>
                  {tab === 'reasons' && <td className="px-4 py-3 text-xs">{r.category}</td>}
                  <td className="px-4 py-3 font-mono text-xs">{r.code}{r.isSystem && <span className="ml-1.5 text-[11px] text-slate-400">system</span>}</td>
                  <td className="px-4 py-2">
                    <Input className="h-8 border-transparent hover:border-slate-200 focus:border-slate-300" defaultValue={tab === 'reasons' ? r.description : r.name} onBlur={(e) => rename(r, e.target.value)} />
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={`rounded-full ${r.isActive ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-100 text-slate-500'}`}>{r.isActive ? 'Active' : 'Inactive'}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!r.isSystem && <Button size="sm" variant="outline" className="h-7" onClick={() => toggle(r)}>{r.isActive ? 'Deactivate' : 'Activate'}</Button>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
