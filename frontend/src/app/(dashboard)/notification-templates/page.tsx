'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellRing, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { notificationTemplatesApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const typeLabel = (t: string) => t.split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ');

interface Draft { type: string; variables: string[]; title: string; body: string; emailSubject: string; emailBody: string; isActive: boolean }

export default function NotificationTemplatesPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, s] = await Promise.all([notificationTemplatesApi.list(), notificationTemplatesApi.deliveryStatus().catch(() => null)]);
      setRows(t); setStatus(s);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function edit(row: any) {
    const src = row.custom ?? row.default;
    setErrors([]);
    setDraft({
      type: row.type, variables: row.variables, title: src.title, body: src.body,
      emailSubject: src.emailSubject ?? '', emailBody: row.custom?.emailBody ?? '', isActive: row.custom?.isActive ?? true,
    });
  }

  async function save() {
    if (!draft) return;
    try {
      await notificationTemplatesApi.save(draft.type, {
        title: draft.title, body: draft.body, emailSubject: draft.emailSubject || null, emailBody: draft.emailBody || null, isActive: draft.isActive,
      });
      toast.success('Template saved');
      setDraft(null);
      load();
    } catch (e: any) { setErrors(e.message.split(', ')); }
  }

  async function reset(type: string) {
    if (!window.confirm(`Restore the built-in wording for ${typeLabel(type)}?`)) return;
    try { await notificationTemplatesApi.reset(type); toast.success('Back to default'); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  const email = status?.email;

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Notification Templates" subtitle="Wording of in-app and email notifications" icon={BellRing} />

      {email && (
        email.configured ? (
          <div className="flex items-center gap-2 text-xs text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
            <CheckCircle2 className="h-4 w-4" /> Email delivery is configured (sender: {email.from}).
          </div>
        ) : (
          <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
            <span>{email.hint ?? 'Email delivery is not configured.'} In-app notifications still work.</span>
          </div>
        )
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr className="text-left text-xs uppercase text-slate-500">
              <th className="px-4 py-3 font-medium">Notification</th>
              <th className="px-4 py-3 font-medium">Title</th>
              <th className="px-4 py-3 font-medium">Wording</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(5)].map((_, i) => <tr key={i}><td colSpan={4} className="px-4 py-3"><Skeleton className="h-6" /></td></tr>)
              : rows.map((r) => (
                <tr key={r.type}>
                  <td className="px-4 py-3 font-medium text-slate-800">{typeLabel(r.type)}</td>
                  <td className="px-4 py-3 text-slate-600">{(r.custom ?? r.default).title}</td>
                  <td className="px-4 py-3">
                    {r.custom
                      ? <Badge variant="outline" className={`rounded-full ${r.custom.isActive ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-100 text-slate-500'}`}>{r.custom.isActive ? 'Custom' : 'Custom (off)'}</Badge>
                      : <Badge variant="outline" className="rounded-full bg-slate-50 text-slate-500">Default</Badge>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Button size="sm" variant="outline" className="h-7 mr-2" onClick={() => edit(r)}>Edit</Button>
                    {r.custom && <Button size="sm" variant="outline" className="h-7" onClick={() => reset(r.type)}>Reset</Button>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!draft} onOpenChange={(o) => { if (!o) setDraft(null); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>{draft ? typeLabel(draft.type) : ''}</DialogTitle></DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="text-xs text-slate-500">
                Variables:{' '}
                {draft.variables.map((v) => <code key={v} className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">{`{{${v}}}`}</code>)}
              </div>
              <div className="space-y-1"><Label>Title</Label><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div>
              <div className="space-y-1"><Label>Message</Label><Textarea rows={3} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></div>
              <div className="space-y-1"><Label>Email subject <span className="text-slate-400 font-normal">(optional)</span></Label><Input value={draft.emailSubject} onChange={(e) => setDraft({ ...draft, emailSubject: e.target.value })} /></div>
              <div className="space-y-1"><Label>Email body <span className="text-slate-400 font-normal">(optional — plain text)</span></Label><Textarea rows={4} value={draft.emailBody} onChange={(e) => setDraft({ ...draft, emailBody: e.target.value })} /></div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} /> Use this wording (off = built-in default)
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
            <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={save}>Save template</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
