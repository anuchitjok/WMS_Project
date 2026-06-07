'use client';

import { useEffect, useState, useCallback } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import { toast } from 'sonner';
import { settingsApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

export default function SettingsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await settingsApi.list()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(key: string) {
    try { await settingsApi.update(key, edits[key]); toast.success('Setting updated'); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="System Settings" subtitle="Workflow rules, SLA, notifications and validation controls" icon={SettingsIcon} />
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((s) => (
            <div key={s.key} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-800">{s.label}</h3>
                <Badge variant="outline" className="text-[10px]">{s.category}</Badge>
              </div>
              {s.description && <p className="text-xs text-slate-400 mb-2">{s.description}</p>}
              <div className="flex gap-2 mt-2">
                <Input className="h-8 text-sm" defaultValue={s.value} onChange={(e) => setEdits((p) => ({ ...p, [s.key]: e.target.value }))} />
                <Button size="sm" className="h-8 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => save(s.key)} disabled={edits[s.key] === undefined || edits[s.key] === s.value}>Save</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
