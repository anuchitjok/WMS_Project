'use client';

import { useCallback, useEffect, useState } from 'react';
import { GitBranch, Plus, Trash2, ArrowUp, ArrowDown, Info } from 'lucide-react';
import { toast } from 'sonner';
import { approvalApi, rolesApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface StepDraft { roleKey: string; stepName: string; timeoutHours: string }
interface RuleDraft { id?: string; name: string; entityType: string; priority: string; isActive: boolean; steps: StepDraft[] }

const EMPTY: RuleDraft = { name: '', entityType: 'WithdrawalRequest', priority: '0', isActive: true, steps: [{ roleKey: '', stepName: '', timeoutHours: '' }] };
const ENTITY_LABEL: Record<string, string> = { WithdrawalRequest: 'Withdrawal request' };

export default function ApprovalRulesPage() {
  const [rules, setRules] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [entityTypes, setEntityTypes] = useState<string[]>(['WithdrawalRequest']);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, ro, meta] = await Promise.all([approvalApi.rules(), rolesApi.list(), approvalApi.rulesMeta().catch(() => null)]);
      setRules(r); setRoles(ro.filter((x: any) => x.isActive !== false));
      if (meta?.entityTypes?.length) setEntityTypes(meta.entityTypes);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function edit(rule?: any) {
    setErrors([]);
    setDraft(rule ? {
      id: rule.id, name: rule.name, entityType: rule.entityType, priority: String(rule.priority ?? 0), isActive: rule.isActive,
      steps: rule.steps.map((s: any) => ({ roleKey: s.roleKey, stepName: s.stepName, timeoutHours: s.timeoutHours ? String(s.timeoutHours) : '' })),
    } : { ...EMPTY, steps: [{ ...EMPTY.steps[0] }] });
  }

  const setStep = (i: number, patch: Partial<StepDraft>) =>
    setDraft((d) => d && { ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      if (!d) return d;
      const steps = [...d.steps];
      const j = i + dir;
      if (j < 0 || j >= steps.length) return d;
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...d, steps };
    });

  async function save() {
    if (!draft) return;
    const body = {
      name: draft.name,
      entityType: draft.entityType,
      priority: Number(draft.priority || 0),
      isActive: draft.isActive,
      steps: draft.steps.map((s, i) => ({ stepOrder: i + 1, roleKey: s.roleKey, stepName: s.stepName, timeoutHours: s.timeoutHours ? Number(s.timeoutHours) : null })),
    };
    setSaving(true);
    try {
      if (draft.id) await approvalApi.updateRule(draft.id, body); else await approvalApi.createRule(body);
      toast.success('Approval rule saved');
      setDraft(null);
      load();
    } catch (e: any) {
      // The server returns every validation problem; show them all in the dialog.
      setErrors(e.message.split(', '));
    } finally { setSaving(false); }
  }

  async function toggle(rule: any) {
    try { await approvalApi.setRuleActive(rule.id, !rule.isActive); toast.success(rule.isActive ? 'Rule disabled' : 'Rule enabled'); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  const roleName = (key: string) => roles.find((r) => r.key === key)?.name ?? key;

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Approval Rules"
        subtitle="Who approves, in which order"
        icon={GitBranch}
        action={<Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => edit()}><Plus className="h-4 w-4 mr-1" />New rule</Button>}
      />

      <div className="flex items-start gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
        <Info className="h-4 w-4 shrink-0 mt-px text-slate-400" />
        <span>
          Rules apply only when the server runs with <code className="font-mono">ENABLE_APPROVAL_ENGINE=true</code>; otherwise requests use single-click approval.
          The active rule with the highest priority wins. Each step must be approved by a different person holding that role, never the requester.
          Changes apply to new approvals; approvals already under way keep their steps.
        </span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr className="text-left text-xs uppercase text-slate-500">
              <th className="px-4 py-3 font-medium">Rule</th>
              <th className="px-4 py-3 font-medium">Applies to</th>
              <th className="px-4 py-3 font-medium">Steps</th>
              <th className="px-4 py-3 font-medium">Priority</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(3)].map((_, i) => <tr key={i}><td colSpan={6} className="px-4 py-3"><Skeleton className="h-6" /></td></tr>)
              : rules.length === 0 ? <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No rules — the single default approval step applies.</td></tr>
              : rules.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                  <td className="px-4 py-3 text-slate-600">{ENTITY_LABEL[r.entityType] ?? r.entityType}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {r.steps.map((s: any, i: number) => (
                      <span key={s.id}>{i > 0 && <span className="text-slate-300 mx-1">→</span>}{s.stepName} <span className="text-xs text-slate-400">({roleName(s.roleKey)})</span></span>
                    ))}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.priority}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={`rounded-full ${r.isActive ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-100 text-slate-500'}`}>{r.isActive ? 'Active' : 'Disabled'}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Button size="sm" variant="outline" className="h-7 mr-2" onClick={() => edit(r)}>Edit</Button>
                    <Button size="sm" variant="outline" className="h-7" onClick={() => toggle(r)}>{r.isActive ? 'Disable' : 'Enable'}</Button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!draft} onOpenChange={(o) => { if (!o) setDraft(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>{draft?.id ? 'Edit approval rule' : 'New approval rule'}</DialogTitle></DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1 sm:col-span-2"><Label>Name</Label><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Two-step for withdrawals" /></div>
                <div className="space-y-1"><Label>Priority</Label><Input inputMode="numeric" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} /></div>
              </div>
              <div className="space-y-1">
                <Label>Applies to</Label>
                <select className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" value={draft.entityType} onChange={(e) => setDraft({ ...draft, entityType: e.target.value })}>
                  {entityTypes.map((t) => <option key={t} value={t}>{ENTITY_LABEL[t] ?? t}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Steps (in order)</Label>
                {draft.steps.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-5 text-xs text-slate-400 text-right">{i + 1}</span>
                    <Input className="h-8 flex-1" placeholder="Step name" value={s.stepName} onChange={(e) => setStep(i, { stepName: e.target.value })} />
                    <select className="h-8 flex-1 rounded-md border border-slate-200 bg-white px-2 text-sm" value={s.roleKey} onChange={(e) => setStep(i, { roleKey: e.target.value })}>
                      <option value="">Approver role…</option>
                      {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                    </select>
                    <Input className="h-8 w-24" inputMode="numeric" placeholder="Hours" title="Timeout (hours, optional)" value={s.timeoutHours} onChange={(e) => setStep(i, { timeoutHours: e.target.value })} />
                    <button className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></button>
                    <button className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" disabled={i === draft.steps.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></button>
                    <button className="p-1 text-slate-400 hover:text-red-600 disabled:opacity-30" disabled={draft.steps.length === 1} onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })} aria-label="Remove step"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
                {draft.steps.length < 10 && (
                  <Button size="sm" variant="outline" className="h-7" onClick={() => setDraft({ ...draft, steps: [...draft.steps, { roleKey: '', stepName: '', timeoutHours: '' }] })}>
                    <Plus className="h-3.5 w-3.5 mr-1" />Add step
                  </Button>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} /> Active
              </label>
              {errors.length > 0 && (
                <ul className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 list-disc list-inside space-y-0.5">
                  {errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button className="bg-green-600 hover:bg-green-700 text-white" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save rule'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
