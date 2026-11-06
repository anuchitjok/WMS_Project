'use client';

// P7 7.1: System Settings → Modules. Writes the `ui.hiddenModules` setting through the
// existing settings API; the backend accepts only known module keys.
import { useEffect, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';
import { settingsApi } from '@/lib/api';
import { MODULE_KEYS, refreshModuleVisibility, type ModuleKey } from '@/lib/feature-flags';
import { getT, useT } from '@/i18n';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const HIDDEN_MODULES_KEY = 'ui.hiddenModules';
const DEFAULT_HIDDEN: ModuleKey[] = ['warranty', 'mrp', 'floorPlan2d'];

/** Hidden modules in force for a settings row (default while missing/invalid). */
function hiddenFrom(row: any): ModuleKey[] {
  if (!row || row.state !== 'configured') return DEFAULT_HIDDEN;
  return String(row.value ?? '').split(',').map((s) => s.trim()).filter((s): s is ModuleKey => (MODULE_KEYS as readonly string[]).includes(s));
}

export function ModuleSettingsCard({ row, onSaved }: { row: any; onSaved: () => void }) {
  const { m } = useT();
  const M = m.nav.modules;
  const current = hiddenFrom(row);
  const [hidden, setHidden] = useState<ModuleKey[]>(current);
  const [saving, setSaving] = useState(false);
  const currentKey = current.join(',');
  useEffect(() => { setHidden(currentKey ? (currentKey.split(',') as ModuleKey[]) : []); }, [currentKey]);

  const ordered = MODULE_KEYS.filter((k) => hidden.includes(k));
  const dirty = ordered.join(',') !== currentKey || row?.state !== 'configured';

  async function save() {
    setSaving(true);
    try {
      await settingsApi.update(HIDDEN_MODULES_KEY, ordered.join(','));
      toast.success(getT().m.nav.modules.saved);
      await refreshModuleVisibility();
      onSaved();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-start gap-3">
        <LayoutGrid className="h-5 w-5 text-slate-400 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-800">{M.settingsTitle}</h3>
          <p className="text-xs text-slate-500 mt-0.5 max-w-2xl leading-relaxed">{M.settingsBody}</p>
          {row?.state !== 'configured' && <p className="text-xs text-slate-400 mt-1">{M.defaultNote}</p>}
          {row?.problem && <p className="text-xs text-red-600 mt-1">{row.problem}</p>}
        </div>
      </div>
      <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {MODULE_KEYS.map((k) => {
          const on = !hidden.includes(k);
          return (
            <div key={k} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="text-sm text-slate-700">{M.names[k]}</span>
              <div className="inline-flex rounded-full border border-slate-200 p-0.5 text-xs" role="radiogroup" aria-label={M.names[k]}>
                {([true, false] as const).map((val) => (
                  <button
                    key={String(val)}
                    type="button"
                    role="radio"
                    aria-checked={on === val}
                    onClick={() => setHidden((h) => (val ? h.filter((x) => x !== k) : h.includes(k) ? h : [...h, k]))}
                    className={cn('rounded-full px-3 py-1 font-medium transition-colors',
                      on === val ? (val ? 'bg-green-600 text-white' : 'bg-slate-600 text-white') : 'text-slate-500 hover:text-slate-800')}
                  >
                    {val ? M.on : M.off}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" disabled={!dirty || saving} onClick={save}>{M.save}</Button>
      </div>
    </div>
  );
}
