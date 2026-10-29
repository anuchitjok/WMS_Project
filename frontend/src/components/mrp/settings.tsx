'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { mrpApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Field, Note, SELECT, Section, isForbidden } from './shared';

// Planning settings. Every value here is a business decision; defaults are
// conservative placeholders and classification thresholds start unset.

const num = (v: any) => (v === '' || v === null || v === undefined ? null : Number(v));

export function MrpSettings() {
  const [cfg, setCfg] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = () => mrpApi.config().then((r) => { setCfg(structuredClone(r.config)); setMeta(r); }).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);

  if (!cfg) return <Skeleton className="h-96" />;
  const set = (patch: any) => setCfg({ ...cfg, ...patch });
  const setIn = (key: string, patch: any) => setCfg({ ...cfg, [key]: { ...cfg[key], ...patch } });
  const setMethod = (m: string, patch: any) => setCfg({ ...cfg, methods: { ...cfg.methods, [m]: { ...cfg.methods[m], ...patch } } });

  async function save() {
    setSaving(true);
    try {
      const body = structuredClone(cfg);
      for (const k of Object.keys(body.classification)) body.classification[k] = k === 'urgentWithinDays' ? Number(body.classification[k] || 0) : num(body.classification[k]);
      for (const m of Object.keys(body.methods)) {
        body.methods[m].window = Number(body.methods[m].window);
        if (typeof body.methods[m].weights === 'string') body.methods[m].weights = body.methods[m].weights.split(',').map((x: string) => Number(x.trim())).filter((x: number) => !Number.isNaN(x));
      }
      for (const k of ['horizonPeriods', 'historyPeriods']) body[k] = Number(body[k]);
      body.accuracy = { evalPeriods: Number(body.accuracy.evalPeriods), minPoints: Number(body.accuracy.minPoints) };
      await mrpApi.updateConfig(body);
      toast.success('Planning settings saved — they apply from the next run');
      setErrors([]); load();
    } catch (e: any) { setErrors(isForbidden(e) ? ['Only a planning administrator can change settings'] : e.message.split(', ')); }
    finally { setSaving(false); }
  }

  const input = (value: any, onChange: (v: string) => void, props: any = {}) => (
    <input className={`${SELECT} w-full`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...props} />
  );

  return (
    <div className="space-y-5 max-w-4xl">
      <Note tone="amber">
        These settings change every plan. Each one needs agreement from planning/purchasing before production use. Changes are versioned and recorded in the audit trail.
        {meta?.updatedAt && <> Last changed {new Date(meta.updatedAt).toLocaleString()} (version {meta.version}).</>}
      </Note>

      <Section title="Horizon and history">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 py-3">
          <Field label="Planning bucket"><select className={`${SELECT} w-full`} value={cfg.granularity} onChange={(e) => set({ granularity: e.target.value })}><option value="MONTH">Month</option><option value="WEEK">Week</option></select></Field>
          <Field label="Horizon (buckets)">{input(cfg.horizonPeriods, (v) => set({ horizonPeriods: v }), { inputMode: 'numeric' })}</Field>
          <Field label="History (buckets)">{input(cfg.historyPeriods, (v) => set({ historyPeriods: v }), { inputMode: 'numeric' })}</Field>
          <Field label="Usage basis" hint="Net issues = issued minus unused returns">
            <select className={`${SELECT} w-full`} value={cfg.usageBasis} onChange={(e) => set({ usageBasis: e.target.value })}><option value="NET_ISSUES">Net issues</option><option value="CONFIRMED_USAGE">Confirmed usage only</option></select>
          </Field>
        </div>
      </Section>

      <Section title="Forecasting">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 py-3">
          <Field label="Default method"><select className={`${SELECT} w-full`} value={cfg.defaultMethod} onChange={(e) => set({ defaultMethod: e.target.value })}>{Object.keys(cfg.methods).map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Pick best method automatically" hint="Lowest back-tested WAPE">
            <select className={`${SELECT} w-full`} value={String(cfg.autoSelectMethod)} onChange={(e) => set({ autoSelectMethod: e.target.value === 'true' })}><option value="false">No</option><option value="true">Yes</option></select>
          </Field>
          <Field label="Back-test periods">{input(cfg.accuracy.evalPeriods, (v) => setIn('accuracy', { evalPeriods: v }), { inputMode: 'numeric' })}</Field>
          <Field label="Min. back-test points">{input(cfg.accuracy.minPoints, (v) => setIn('accuracy', { minPoints: v }), { inputMode: 'numeric' })}</Field>
          {Object.entries(cfg.methods).map(([m, spec]: [string, any]) => (
            <Field key={m} label={`${m} window`}>{input(spec.window, (v) => setMethod(m, { window: v }), { inputMode: 'numeric' })}</Field>
          ))}
          <Field label="WMA weights (newest first)" className="col-span-2" hint="Comma-separated; normalised to sum to 1">
            {input(Array.isArray(cfg.methods.WMA.weights) ? cfg.methods.WMA.weights.join(', ') : cfg.methods.WMA.weights, (v) => setMethod('WMA', { weights: v }))}
          </Field>
          <Field label="Overrides need approval">
            <select className={`${SELECT} w-full`} value={String(cfg.overrideRequiresApproval)} onChange={(e) => set({ overrideRequiresApproval: e.target.value === 'true' })}><option value="true">Yes</option><option value="false">No</option></select>
          </Field>
        </div>
      </Section>

      <Section title="Demand and supply">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 py-3">
          <Field label="Forecast vs confirmed demand" hint="MAX avoids double counting">
            <select className={`${SELECT} w-full`} value={cfg.demandCombination} onChange={(e) => set({ demandCombination: e.target.value })}><option value="MAX">Larger of the two</option><option value="SUM">Add together</option></select>
          </Field>
          <Field label="Include unapproved requests">
            <select className={`${SELECT} w-full`} value={String(cfg.includeUnapprovedRequests)} onChange={(e) => set({ includeUnapprovedRequests: e.target.value === 'true' })}><option value="true">Yes</option><option value="false">No</option></select>
          </Field>
          <Field label="Overdue PO lines">
            <select className={`${SELECT} w-full`} value={cfg.pastDueSupply} onChange={(e) => set({ pastDueSupply: e.target.value })}><option value="FIRST_BUCKET">Expect in first bucket</option><option value="EXCLUDE">Exclude from supply</option></select>
          </Field>
          <Field label="Stock in inspection is usable">
            <select className={`${SELECT} w-full`} value={String(cfg.countInspectionAsUsable)} onChange={(e) => set({ countInspectionAsUsable: e.target.value === 'true' })}><option value="false">No</option><option value="true">Yes</option></select>
          </Field>
        </div>
      </Section>

      <Section title="Classification thresholds" subtitle="Leave blank until agreed — blank means the class is not assigned">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 py-3">
          <Field label="Fast: min usage / month">{input(cfg.classification.fastMinMonthlyUsage, (v) => setIn('classification', { fastMinMonthlyUsage: v }), { inputMode: 'decimal' })}</Field>
          <Field label="Slow: max usage / month">{input(cfg.classification.slowMaxMonthlyUsage, (v) => setIn('classification', { slowMaxMonthlyUsage: v }), { inputMode: 'decimal' })}</Field>
          <Field label="Non-moving after (days)">{input(cfg.classification.nonMovingDays, (v) => setIn('classification', { nonMovingDays: v }), { inputMode: 'numeric' })}</Field>
          <Field label="High variability CV">{input(cfg.classification.highVariabilityCv, (v) => setIn('classification', { highVariabilityCv: v }), { inputMode: 'decimal' })}</Field>
          <Field label="Excess above (months of supply)">{input(cfg.classification.excessMonthsOfSupply, (v) => setIn('classification', { excessMonthsOfSupply: v }), { inputMode: 'decimal' })}</Field>
          <Field label="High value stock above" hint="Same currency as the cost only">{input(cfg.classification.highValueThreshold, (v) => setIn('classification', { highValueThreshold: v }), { inputMode: 'decimal' })}</Field>
          <Field label="MOQ excess share" hint="e.g. 0.5 = flag when MOQ adds over 50%">{input(cfg.classification.moqExcessShare, (v) => setIn('classification', { moqExcessShare: v }), { inputMode: 'decimal' })}</Field>
          <Field label="Order now within (days)">{input(cfg.classification.urgentWithinDays, (v) => setIn('classification', { urgentWithinDays: v }), { inputMode: 'numeric' })}</Field>
        </div>
        <label className="flex items-center gap-2 px-4 pb-3 text-sm text-slate-700">
          <input type="checkbox" checked={!!cfg.thresholdsApproved} onChange={(e) => set({ thresholdsApproved: e.target.checked })} /> These thresholds have been approved by the business
        </label>
      </Section>

      {errors.length > 0 && <ul className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 list-disc list-inside space-y-0.5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={load}>Discard changes</Button>
        <Button className="bg-green-600 hover:bg-green-700 text-white" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save settings'}</Button>
      </div>
    </div>
  );
}
