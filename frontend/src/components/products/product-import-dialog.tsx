'use client';

// Plan 2.4: product upload from the Product Master page, through the shared
// Data I/O pipeline (preview → confirm). Brand + SKU duplicates against the
// database are skipped; duplicates inside the file are errors.
import { useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { getT, useT } from '@/i18n';
import { productImportApi, type ProductImportPreview, type ProductImportResult, type ProductImportRow } from '@/lib/api-products';

const MAX_ROWS_SHOWN = 500;

type RowResult = 'ready' | 'skipped' | 'duplicate' | 'error';
function rowResult(r: ProductImportRow): RowResult {
  if (r.valid) return 'ready';
  if (r.duplicate?.kind === 'db') return 'skipped';
  if (r.duplicate?.kind === 'file') return 'duplicate';
  return 'error';
}
const RESULT_PILL: Record<RowResult, string> = {
  ready: 'bg-green-100 text-green-700',
  skipped: 'bg-amber-100 text-amber-800',
  duplicate: 'bg-red-100 text-red-700',
  error: 'bg-red-100 text-red-700',
};

export function ProductImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const { m, t, fmt } = useT();
  const D = m.products.importDlg;
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [createBrands, setCreateBrands] = useState(false);
  const [preview, setPreview] = useState<ProductImportPreview | null>(null);
  const [reimport, setReimport] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [result, setResult] = useState<ProductImportResult | null>(null);

  function resetAll() {
    setFile(null); setPreview(null); setResult(null); setReimport(false); setBusy(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function runPreview(f: File, create: boolean) {
    setBusy('preview');
    try { setPreview(await productImportApi.preview(f, { createMissingBrands: create })); setReimport(false); }
    catch (e: any) { toast.error(e.message); setPreview(null); }
    finally { setBusy(null); }
  }

  function pick(f: File | undefined) {
    if (!f) return;
    if (!/\.(xlsx|csv)$/i.test(f.name)) { toast.error(getT().m.products.importDlg.fileType); return; }
    setFile(f); setResult(null);
    runPreview(f, createBrands);
  }

  async function commit() {
    if (!file) return;
    setBusy('commit');
    try {
      const r = await productImportApi.commit(file, { createMissingBrands: createBrands, allowReimport: reimport });
      setResult(r); setPreview(null);
      onImported();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }

  const s = preview?.summary;
  const rows = preview?.rows ?? [];
  const errorsOnly = s ? s.invalid - (s.duplicatesDb ?? 0) - (s.duplicatesFile ?? 0) : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { resetAll(); onClose(); } }}>
      <DialogContent className="w-full sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="shrink-0 px-6 pt-5 pb-4 border-b">
          <DialogTitle>{D.title}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
          {result ? (
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-2">
              <p className="flex items-center gap-2 font-semibold text-green-800"><CheckCircle2 className="w-5 h-5" /> {D.doneTitle}</p>
              <p className="text-sm text-slate-700">{t(D.done, { inserted: fmt.number(result.inserted), batch: result.batch, skipped: fmt.number(result.skipped) })}</p>
              {!!result.brandsCreated?.length && <p className="text-sm text-slate-700">{t(D.brandsCreated, { list: result.brandsCreated.join(', ') })}</p>}
              <Button variant="outline" size="sm" onClick={resetAll}>{D.another}</Button>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-600">{D.intro}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => productImportApi.template().catch((e) => toast.error(e.message))}>
                  <FileSpreadsheet className="w-4 h-4" /> {D.template}
                </Button>
                <Button size="sm" className="gap-1.5 bg-green-600 hover:bg-green-700 text-white" onClick={() => fileRef.current?.click()} disabled={!!busy}>
                  <Upload className="w-4 h-4" /> {D.chooseFile}
                </Button>
                <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
                <span className="text-sm text-slate-500 truncate max-w-full">{file?.name ?? D.noFile}</span>
              </div>
              <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" className="mt-0.5 accent-green-600" checked={createBrands}
                  onChange={(e) => { setCreateBrands(e.target.checked); if (file) runPreview(file, e.target.checked); }} />
                <span>
                  {D.createBrands}
                  <span className="block text-xs text-slate-500">{D.createBrandsHint}</span>
                </span>
              </label>
              <p className="text-xs text-slate-500">{D.dupRule}</p>

              {busy === 'preview' && <p className="text-sm text-green-700 animate-pulse">{D.checking}</p>}

              {preview && s && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2 text-xs font-medium">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">{t(D.total, { count: fmt.number(s.total) })}</span>
                    <span className="rounded-full bg-green-100 px-2.5 py-1 text-green-700">{t(D.ready, { count: fmt.number(s.valid) })}</span>
                    {!!s.duplicatesDb && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800">{t(D.skippedDb, { count: fmt.number(s.duplicatesDb) })}</span>}
                    {!!s.duplicatesFile && <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-700">{t(D.dupFile, { count: fmt.number(s.duplicatesFile) })}</span>}
                    {errorsOnly > 0 && <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-700">{t(D.errors, { count: fmt.number(errorsOnly) })}</span>}
                  </div>
                  {!!s.newBrands?.length && <p className="text-sm text-slate-700">{t(D.newBrands, { list: s.newBrands.join(', ') })}</p>}
                  {preview.alreadyImported && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-1">
                      <p>{t(D.already, { date: fmt.dateTime(preview.alreadyImported.at), by: preview.alreadyImported.by ? t(D.alreadyBy, { name: preview.alreadyImported.by }) : '' })}</p>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" className="accent-green-600" checked={reimport} onChange={(e) => setReimport(e.target.checked)} />
                        {D.alreadyConfirm}
                      </label>
                    </div>
                  )}
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                          {[D.col.row, D.col.sku, D.col.brand, D.col.description, D.col.result, D.col.messages].map((h) => (
                            <th key={h} className="text-left font-semibold px-3 py-2 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.slice(0, MAX_ROWS_SHOWN).map((r) => {
                          const res = rowResult(r);
                          return (
                            <tr key={r.rowNumber} className={res === 'ready' ? '' : res === 'skipped' ? 'bg-amber-50/50' : 'bg-red-50/50'}>
                              <td className="px-3 py-2 tabular-nums text-slate-500">{r.rowNumber}</td>
                              <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{String(r.data.partNumber || r.data.code || '—')}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{String(r.data.brandCode || '—')}</td>
                              <td className="px-3 py-2 max-w-[220px] truncate">{String(r.data.description || r.data.name || '—')}</td>
                              <td className="px-3 py-2 whitespace-nowrap">
                                <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', RESULT_PILL[res])}>{D.result[res]}</span>
                              </td>
                              <td className="px-3 py-2 text-xs">
                                {r.errors.length > 0 && <span className={res === 'skipped' ? 'text-amber-800' : 'text-red-700'}>{r.errors.join('; ')}</span>}
                                {r.valid && r.notes?.length ? <span className="text-slate-500">{r.notes.join('; ')}</span> : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {rows.length > MAX_ROWS_SHOWN && <p className="text-xs text-slate-500">{t(D.more, { shown: MAX_ROWS_SHOWN, total: fmt.number(rows.length) })}</p>}
                </div>
              )}
            </>
          )}
        </div>
        {!result && (
          <div className="shrink-0 flex flex-col-reverse gap-2 border-t bg-muted/50 px-6 py-4 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => { resetAll(); onClose(); }}>{m.common.actions.cancel}</Button>
            <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={commit}
              disabled={!preview || !s?.valid || busy !== null || (!!preview.alreadyImported && !reimport)}>
              {busy === 'commit' ? D.importing : t(D.confirm, { count: fmt.number(s?.valid ?? 0) })}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
