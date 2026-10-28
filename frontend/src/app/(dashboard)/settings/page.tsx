'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Settings as SettingsIcon, Archive, Info } from 'lucide-react';
import { toast } from 'sonner';
import { settingsApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/utils';

// What is actually in force, so nobody mistakes a stored value for an active rule.
const STATE_LABEL: Record<string, { text: string; cls: string }> = {
  configured: { text: 'In force', cls: 'bg-green-50 text-green-700 border-green-200' },
  disabled: { text: 'Off', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  missing: { text: 'Not set — built-in behaviour', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
  invalid: { text: 'Invalid — ignored', cls: 'bg-red-50 text-red-700 border-red-200' },
};

const LINKS: Record<string, { href: string; label: string }> = {
  'approval.workflow': { href: '/approval-rules', label: 'Approval Rules' },
  'notification.template': { href: '/notification-templates', label: 'Notification Templates' },
};

export default function SettingsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<any>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  const loadPreview = useCallback(async () => {
    try { setPreview(await settingsApi.retentionPreview()); setPreviewError(null); }
    catch (e: any) { setPreview(null); setPreviewError(e.message); }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await settingsApi.list()); setEdits({}); } finally { setLoading(false); }
    loadPreview();
  }, [loadPreview]);
  useEffect(() => { load(); }, [load]);

  async function save(key: string, value: string) {
    try { await settingsApi.update(key, value); toast.success('Setting updated'); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  async function archive() {
    if (!preview?.eligible) return;
    if (!window.confirm(`Move ${preview.eligible} operational audit entries older than ${preview.retentionDays} days to the archive? Security entries are kept.`)) return;
    setArchiving(true);
    try {
      const r = await settingsApi.retentionArchive();
      toast.success(`${r.moved} entries archived${r.moreRemaining ? ' — more remain, run again' : ''}`);
      loadPreview();
    } catch (e: any) { toast.error(e.message); }
    finally { setArchiving(false); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="System Settings" subtitle="Rules the system applies — each card shows whether it is in force" icon={SettingsIcon} />
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((s) => {
            const st = STATE_LABEL[s.state] ?? STATE_LABEL.missing;
            const draft = edits[s.key];
            const current = s.state === 'disabled' ? 'disabled' : s.value;
            return (
              <div key={s.key} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <h3 className="text-sm font-semibold text-slate-800">{s.label}</h3>
                  {s.effect === 'enforced'
                    ? <Badge variant="outline" className={`text-[11px] rounded-full ${st.cls}`}>{st.text}</Badge>
                    : <Badge variant="outline" className="text-[11px] rounded-full bg-slate-50 text-slate-500">Info only</Badge>}
                </div>
                {s.description && <p className="text-xs text-slate-500 mb-2 leading-relaxed">{s.description}</p>}
                {s.problem && <p className="text-xs text-red-600 mb-2">Stored value “{s.value}”: {s.problem}</p>}
                <div className="mt-auto">
                  {s.editable ? (
                    <>
                      <div className="flex gap-2">
                        {s.options ? (
                          <select
                            className="h-8 flex-1 rounded-md border border-slate-200 bg-white px-2 text-sm"
                            value={draft ?? current ?? ''}
                            onChange={(e) => setEdits((p) => ({ ...p, [s.key]: e.target.value }))}
                          >
                            {!current && <option value="">Choose…</option>}
                            {s.options.map((o: string) => <option key={o} value={o}>{o}</option>)}
                            {s.canDisable && <option value="disabled">disabled</option>}
                          </select>
                        ) : (
                          <Input
                            className="h-8 text-sm"
                            inputMode="numeric"
                            value={draft ?? (s.state === 'disabled' ? '' : s.value ?? '')}
                            placeholder={s.state === 'disabled' ? 'Off' : `${s.min ?? ''}–${s.max ?? ''}`}
                            onChange={(e) => setEdits((p) => ({ ...p, [s.key]: e.target.value }))}
                          />
                        )}
                        <Button size="sm" className="h-8 bg-green-600 hover:bg-green-700 text-white" disabled={draft === undefined || draft === current} onClick={() => save(s.key, draft!)}>Save</Button>
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <p className="text-[11px] text-slate-400">{s.accepts}</p>
                        {s.canDisable && !s.options && s.state !== 'disabled' && (
                          <button className="text-[11px] text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline" onClick={() => save(s.key, 'disabled')}>Turn off</button>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex items-start gap-1.5 text-xs text-slate-500 bg-slate-50 rounded-md px-2.5 py-2">
                      <Info className="h-3.5 w-3.5 mt-px shrink-0" />
                      <span>
                        {s.value && <b className="text-slate-700">{s.value}</b>}{s.value ? ' · ' : ''}{s.accepts}
                        {LINKS[s.key] && <> · <Link className="text-green-700 hover:underline" href={LINKS[s.key].href}>{LINKS[s.key].label}</Link></>}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <Archive className="h-5 w-5 text-slate-400 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Audit log retention</h3>
              <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
                Moves old operational entries to the audit archive. Nothing runs automatically, nothing is deleted, and security entries (logins, users, roles, settings, approvals) always stay in the live log.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" disabled={!preview?.eligible || archiving} onClick={archive}>
            {archiving ? 'Archiving…' : 'Archive eligible entries'}
          </Button>
        </div>
        <div className="mt-3 text-sm">
          {previewError ? (
            <p className="text-xs text-slate-500">{previewError}</p>
          ) : preview ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><p className="text-[11px] uppercase text-slate-400">Keep</p><p className="font-medium text-slate-900">{preview.retentionDays} days</p></div>
              <div><p className="text-[11px] uppercase text-slate-400">Eligible now</p><p className="font-medium text-slate-900">{preview.eligible.toLocaleString()}{preview.oldestEligible ? <span className="text-xs text-slate-400"> since {formatDate(preview.oldestEligible)}</span> : null}</p></div>
              <div><p className="text-[11px] uppercase text-slate-400">Protected (kept)</p><p className="font-medium text-slate-900">{preview.protectedOlderThanCutoff.toLocaleString()}</p></div>
              <div><p className="text-[11px] uppercase text-slate-400">In archive</p><p className="font-medium text-slate-900">{preview.alreadyArchived.toLocaleString()}</p></div>
            </div>
          ) : <Skeleton className="h-10" />}
        </div>
      </div>
    </div>
  );
}
