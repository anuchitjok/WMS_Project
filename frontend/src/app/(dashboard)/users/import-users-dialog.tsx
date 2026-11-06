'use client';

// P7 7.2: batch import of users from the Users page. Reuses the existing Import / Export
// (dataio) flow for type "users": template → preview (errors, duplicates) → commit.
import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileDown, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { governanceApi } from '@/lib/api-governance';
import { getT, useT } from '@/i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface PreviewRow { rowNumber: number; data: Record<string, any>; errors: string[]; notes?: string[]; valid: boolean }
interface Preview {
  columns: string[]; rows: PreviewRow[]; summary: { total: number; valid: number; invalid: number };
  alreadyImported?: { batch: string | null; at: string; by: string | null } | null;
}

const MAX_ROWS = 200;

export function ImportUsersDialog({ open, onOpenChange, onImported }: { open: boolean; onOpenChange: (o: boolean) => void; onImported: () => void }) {
  const { m, t, fmt } = useT();
  const U = m.users.importDialog;
  const D = m.dataio;
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [reimport, setReimport] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() { setFile(null); setPreview(null); setResult(null); setReimport(false); }
  function close(o: boolean) { if (!o) reset(); onOpenChange(o); }

  async function handleFile(f: File) {
    const T = getT();
    if (!/\.(xlsx|csv)$/i.test(f.name)) { toast.error(T.m.dataio.toast.fileType); return; }
    setFile(f); setResult(null); setReimport(false); setBusy(true);
    try {
      const p: Preview = await governanceApi.previewUsers(f);
      setPreview(p);
      toast.success(T.t(T.m.dataio.toast.read, { valid: p.summary.valid, total: p.summary.total }));
    } catch (e: any) { toast.error(e.message); setFile(null); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  }

  async function commit() {
    if (!file) return;
    setBusy(true);
    try {
      const r = await governanceApi.commitUsers(file, reimport);
      setResult(r); setPreview(null);
      const T = getT();
      toast.success(T.t(T.m.dataio.toast.imported, { inserted: r.inserted, batch: r.batch, skipped: r.skipped }));
      onImported();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function template() {
    try { await governanceApi.usersTemplate(); toast.success(getT().m.dataio.toast.template); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{U.title}</DialogTitle></DialogHeader>
        <div className="space-y-4 min-w-0">
          <div className="space-y-1 text-sm text-slate-600">
            <p>{U.intro}</p>
            <p className="text-xs text-slate-500">{U.passwordNote} {U.warehouseNote}</p>
          </div>
          <Button variant="outline" size="sm" onClick={template}><FileDown className="h-4 w-4 mr-2" />{D.downloadTemplate}</Button>

          {!result && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
              onClick={() => inputRef.current?.click()}
              className={cn('rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors',
                dragOver ? 'border-green-500 bg-green-50' : 'border-slate-300 hover:border-green-400 hover:bg-slate-50')}
            >
              <input ref={inputRef} type="file" accept=".xlsx,.csv" hidden onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
              <Upload className="h-7 w-7 mx-auto text-slate-400 mb-2" />
              <p className="text-sm font-medium text-slate-700">{D.drop}</p>
              <p className="text-xs text-slate-400 mt-1">{D.supports}</p>
              {file && <p className="text-xs text-green-700 mt-2 font-medium">{file.name}</p>}
            </div>
          )}

          {preview && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="rounded-full bg-slate-100 text-slate-700">{t(D.total, { count: fmt.number(preview.summary.total) })}</Badge>
                <Badge variant="outline" className="rounded-full bg-green-50 text-green-700">{t(D.valid, { count: fmt.number(preview.summary.valid) })}</Badge>
                <Badge variant="outline" className="rounded-full bg-red-50 text-red-700">{t(D.issues, { count: fmt.number(preview.summary.invalid) })}</Badge>
              </div>
              {preview.alreadyImported && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-medium">
                    {D.already}
                    {preview.alreadyImported.batch ? t(D.alreadyAs, { batch: preview.alreadyImported.batch }) : ''}
                    {t(D.alreadyOn, { date: fmt.dateTime(preview.alreadyImported.at) })}
                    {preview.alreadyImported.by ? t(D.alreadyBy, { name: preview.alreadyImported.by }) : ''}.
                  </p>
                  <p className="text-xs mt-1">{D.alreadyHint}</p>
                  <label className="mt-2 flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={reimport} onChange={(e) => setReimport(e.target.checked)} />
                    {D.alreadyConfirm}
                  </label>
                </div>
              )}
              <div className="rounded-xl border border-slate-200 overflow-auto max-h-[360px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                      <th className="text-left px-3 py-2 font-medium">#</th>
                      <th className="text-left px-3 py-2 font-medium">{D.col.status}</th>
                      {preview.columns.map((c) => <th key={c} className="text-left px-3 py-2 font-medium normal-case">{c}</th>)}
                      <th className="text-left px-3 py-2 font-medium">{D.col.errors}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.rows.slice(0, MAX_ROWS).map((r) => (
                      <tr key={r.rowNumber} className={r.valid ? '' : 'bg-red-50/60'}>
                        <td className="px-3 py-2 text-slate-400">{r.rowNumber}</td>
                        <td className="px-3 py-2">{r.valid ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-red-600" />}</td>
                        {preview.columns.map((c) => (
                          <td key={c} className="px-3 py-2 text-slate-700 whitespace-nowrap">{c === 'password' && r.data[c] ? '••••••' : String(r.data[c] ?? '')}</td>
                        ))}
                        <td className="px-3 py-2 text-xs">
                          {r.errors.length > 0 && <span className="text-red-600">{r.errors.join('; ')}</span>}
                          {r.valid && r.notes?.length ? <span className="text-slate-500">{r.notes.join('; ')}</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.rows.length > MAX_ROWS && <p className="text-xs text-slate-500">{t(U.moreRows, { shown: MAX_ROWS, total: preview.rows.length })}</p>}
            </div>
          )}

          {result && (
            <div className="rounded-xl border border-green-200 bg-green-50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <h3 className="font-semibold text-green-900">{D.complete}</h3>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                {result.batch && <Badge variant="outline" className="rounded-full bg-white text-slate-700">{t(D.batch, { batch: result.batch })}</Badge>}
                <Badge variant="outline" className="rounded-full bg-white text-green-700">{t(D.imported, { count: fmt.number(result.inserted) })}</Badge>
                {result.skipped > 0 && <Badge variant="outline" className="rounded-full bg-white text-amber-700">{t(D.skipped, { count: fmt.number(result.skipped) })}</Badge>}
              </div>
              {result.skippedRows?.length > 0 && (
                <div className="mt-2 text-xs text-slate-600 space-y-1">
                  {result.skippedRows.slice(0, 10).map((s: any) => <p key={s.rowNumber}>{t(D.row, { row: s.rowNumber, errors: s.errors.join('; ') })}</p>)}
                </div>
              )}
              <Button variant="outline" size="sm" className="mt-3" onClick={reset}>{D.importNew}</Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>{U.close}</Button>
          {preview && (
            <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={commit}
              disabled={busy || preview.summary.valid === 0 || (!!preview.alreadyImported && !reimport)}>
              <CheckCircle2 className="h-4 w-4 mr-2" />{t(D.confirmImport, { count: fmt.number(preview.summary.valid) })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
