'use client';

import { useState, useCallback, useRef } from 'react';
import { Database, Download, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { dataioApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { getT, labelOf, useT } from '@/i18n';
import { useAuthStore } from '@/store/auth.store';

// Values are the API's import/export type keys; labels come from the dataio messages.
const IMPORT_TYPES = ['products', 'inventory', 'users', 'warehouse', 'serials'] as const;
const EXPORT_TYPES = ['inventory', 'audit', 'requests', 'reports'] as const;

interface PreviewRow { rowNumber: number; data: Record<string, any>; errors: string[]; notes?: string[]; valid: boolean }
interface Preview {
  type: string; columns: string[]; rows: PreviewRow[]; summary: { total: number; valid: number; invalid: number };
  alreadyImported?: { batch: string | null; at: string; by: string | null } | null;
}

// Product imports are limited to the roles that may edit the Product Master (plan 1.7).
const PRODUCT_WRITE_ROLES = ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER'];

export default function DataIOPage() {
  const role = useAuthStore((s) => s.user?.role);
  const importTypes = IMPORT_TYPES.filter((v) => v !== 'products' || (role && PRODUCT_WRITE_ROLES.includes(role)));
  const [tab, setTab] = useState<'import' | 'export'>('import');
  const [importType, setImportType] = useState<string>(importTypes[0]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [dragOver, setDragOver] = useState(false);
  const [reimport, setReimport] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { m, t, fmt } = useT();
  const D = m.dataio;

  const reset = () => { setFile(null); setPreview(null); setResult(null); setProgress(0); setReimport(false); };

  const handleFile = useCallback(async (f: File) => {
    if (!/\.(xlsx|csv)$/i.test(f.name)) { toast.error(getT().m.dataio.toast.fileType); return; }
    setFile(f); setResult(null); setReimport(false); setBusy(true); setProgress(30);
    try {
      const p = await dataioApi.preview(importType, f);
      setProgress(100);
      setPreview(p);
      const T = getT();
      toast.success(T.t(T.m.dataio.toast.read, { valid: p.summary.valid, total: p.summary.total }));
    } catch (e: any) {
      toast.error(e.message); setFile(null);
    } finally { setBusy(false); setTimeout(() => setProgress(0), 600); }
  }, [importType]);

  async function confirmImport() {
    if (!file) return;
    setBusy(true); setProgress(40);
    try {
      const r = await dataioApi.commit(importType, file, reimport);
      setProgress(100); setResult(r); setPreview(null); setReimport(false);
      toast.success(t(D.toast.imported, { inserted: r.inserted, batch: r.batch, skipped: r.skipped }));
    } catch (e: any) {
      toast.error(e.message);
    } finally { setBusy(false); setTimeout(() => setProgress(0), 600); }
  }

  async function downloadTemplate() {
    try { await dataioApi.downloadTemplate(importType); toast.success(D.toast.template); }
    catch (e: any) { toast.error(e.message); }
  }

  async function doExport(type: string, format: 'xlsx' | 'csv') {
    try { await dataioApi.export(type, format); toast.success(t(D.toast.exported, { file: `${type}.${format}` })); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title={D.title} subtitle={D.subtitle} icon={Database} />

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200">
        {(['import', 'export'] as const).map((k) => (
          <button
            key={k}
            onClick={() => { setTab(k); reset(); }}
            className={cn('px-4 py-2 text-sm font-medium border-b-2 -mb-px',
              tab === k ? 'border-green-600 text-green-600' : 'border-transparent text-slate-500 hover:text-slate-700')}
          >
            {D.tabs[k]}
          </button>
        ))}
      </div>

      {tab === 'import' && (
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-500">{D.dataType}</label>
              <Select value={importType} onValueChange={(v) => { setImportType(v ?? 'products'); reset(); }}>
                <SelectTrigger className="w-52"><SelectValue>{labelOf(D.importTypes, importType)}</SelectValue></SelectTrigger>
                <SelectContent>{importTypes.map((v) => <SelectItem key={v} value={v}>{D.importTypes[v]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={downloadTemplate}>
              <FileDown className="h-4 w-4 mr-2" />{D.downloadTemplate}
            </Button>
          </div>

          {/* Drag & drop */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
            onClick={() => inputRef.current?.click()}
            className={cn('rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors',
              dragOver ? 'border-green-500 bg-green-50' : 'border-slate-300 hover:border-green-400 hover:bg-slate-50')}
          >
            <input ref={inputRef} type="file" accept=".xlsx,.csv" hidden
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            <Upload className="h-9 w-9 mx-auto text-slate-400 mb-2" />
            <p className="text-sm font-medium text-slate-700">{D.drop}</p>
            <p className="text-xs text-slate-400 mt-1">{D.supports}</p>
            {file && <p className="text-xs text-green-600 mt-2 font-medium">{file.name}</p>}
          </div>

          {/* Progress */}
          {progress > 0 && (
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-green-600 transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          )}

          {/* Preview */}
          {preview && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <Badge className="bg-slate-100 text-slate-700" variant="outline">{t(D.total, { count: fmt.number(preview.summary.total) })}</Badge>
                <Badge className="bg-green-100 text-green-700" variant="outline">{t(D.valid, { count: fmt.number(preview.summary.valid) })}</Badge>
                <Badge className="bg-red-100 text-red-700" variant="outline">{t(D.issues, { count: fmt.number(preview.summary.invalid) })}</Badge>
                <div className="flex-1" />
                <Button onClick={confirmImport} disabled={busy || preview.summary.valid === 0 || (!!preview.alreadyImported && !reimport)} className="bg-green-600 hover:bg-green-700 text-white">
                  <CheckCircle2 className="h-4 w-4 mr-2" />{t(D.confirmImport, { count: fmt.number(preview.summary.valid) })}
                </Button>
              </div>
              {preview.alreadyImported && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="already-imported">
                  <p className="font-medium">
                    {D.already}
                    {preview.alreadyImported.batch ? t(D.alreadyAs, { batch: preview.alreadyImported.batch }) : ''}
                    {t(D.alreadyOn, { date: fmt.dateTime(preview.alreadyImported.at) })}
                    {preview.alreadyImported.by ? t(D.alreadyBy, { name: preview.alreadyImported.by }) : ''}.
                  </p>
                  <p className="text-xs mt-1">{D.alreadyHint}</p>
                  <label className="mt-2 flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={reimport} onChange={(e) => setReimport(e.target.checked)} id="confirm-reimport" />
                    {D.alreadyConfirm}
                  </label>
                </div>
              )}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-auto max-h-[480px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0">
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="text-left px-3 py-2 font-medium text-slate-600">#</th>
                      <th className="text-left px-3 py-2 font-medium text-slate-600">{D.col.status}</th>
                      {preview.columns.map((c) => <th key={c} className="text-left px-3 py-2 font-medium text-slate-600">{c}</th>)}
                      <th className="text-left px-3 py-2 font-medium text-slate-600">{D.col.errors}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {preview.rows.map((r) => (
                      <tr key={r.rowNumber} className={r.valid ? '' : 'bg-red-50'}>
                        <td className="px-3 py-2 text-slate-400">{r.rowNumber}</td>
                        <td className="px-3 py-2">
                          {r.valid
                            ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                            : <AlertTriangle className="h-4 w-4 text-red-600" />}
                        </td>
                        {preview.columns.map((c) => <td key={c} className="px-3 py-2 text-slate-700">{String(r.data[c] ?? '')}</td>)}
                        <td className="px-3 py-2">
                          {r.errors.length > 0 && <span className="text-red-600">{r.errors.join('; ')}</span>}
                          {r.valid && r.notes?.length ? <span className="text-slate-500">{r.notes.join('; ')}</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Result summary */}
          {result && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <h3 className="font-semibold text-green-900">{D.complete}</h3>
              </div>
              <div className="flex gap-3 text-sm">
                {result.batch && <Badge className="bg-slate-100 text-slate-700" variant="outline">{t(D.batch, { batch: result.batch })}</Badge>}
                <Badge className="bg-green-100 text-green-700" variant="outline">{t(D.imported, { count: fmt.number(result.inserted) })}</Badge>
                {result.skipped > 0 && <Badge className="bg-amber-100 text-amber-700" variant="outline">{t(D.skipped, { count: fmt.number(result.skipped) })}</Badge>}
              </div>
              {result.skippedRows?.length > 0 && (
                <div className="mt-3 text-xs text-slate-600 space-y-1">
                  {result.skippedRows.slice(0, 10).map((s: any) => (
                    <p key={s.rowNumber}>{t(D.row, { row: s.rowNumber, errors: s.errors.join('; ') })}</p>
                  ))}
                </div>
              )}
              <Button variant="outline" size="sm" className="mt-3" onClick={reset}>{D.importNew}</Button>
            </div>
          )}
        </div>
      )}

      {tab === 'export' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {EXPORT_TYPES.map((v) => (
            <div key={v} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="rounded-lg bg-green-100 p-2.5"><FileSpreadsheet className="h-5 w-5 text-green-600" /></div>
                <h3 className="font-semibold text-slate-800">{D.exportTypes[v]}</h3>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => doExport(v, 'xlsx')}>
                  <Download className="h-4 w-4 mr-1.5" />Excel
                </Button>
                <Button size="sm" variant="outline" onClick={() => doExport(v, 'csv')}>
                  <Download className="h-4 w-4 mr-1.5" />CSV
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
