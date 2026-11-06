'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  PackagePlus, PackageCheck, Clock, AlertTriangle, ClipboardList,
  Search, Truck, Package, MapPin, ShieldCheck, CheckCircle2,
  Info, ChevronDown, ChevronUp, ArrowRight, CircleDot,
  TriangleAlert, FileX, Upload, FileDown, Undo2,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import type { UserRole } from '@/types';
import { toast } from 'sonner';
import { receivingApi, warehouseApi, type ReceivingImportPreview } from '@/lib/api';
import { StatTile } from '@/components/ui/stat-tile';
import { ReceivingStatusBadge } from '@/components/receiving/receiving-status-badge';
import { InspectionWorkspace } from '@/components/receiving/inspection-workspace';
import { EmptyState } from '@/components/layout/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { labelOf, useT } from '@/i18n';

// ─── Types & constants ────────────────────────────────────────────────────────

type Tab = 'queue' | 'all';

/** Same roles the API allows to reverse a receipt (permission inventory.adjust for DB roles). */
const REVERSE_ROLES: UserRole[] = ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR'];
/** Units still at the dock / in QC — the only state a receipt can be reversed from (the API re-checks). */
const REVERSIBLE_UNIT = ['PENDING_RECEIVING', 'PENDING_INSPECTION', 'QUARANTINE', 'RTV_PENDING'];
const canBeReversed = (gr: any) =>
  gr.statusEnum !== 'CANCELLED' && gr.status !== 'cancelled' &&
  (gr.items ?? []).every((it: any) => !it.stockItem || REVERSIBLE_UNIT.includes(it.stockItem.status));

/** Receiving source types — stored values. 'RTV Replacement' is shown as "RTV Return" (label only). */
const SOURCE_TYPES = ['Brand Owner', 'Vendor', 'Customer Return', 'RTV Replacement'];
/** New / Refurbish chosen at receipt (GoodsReceivingItem.itemCondition). */
const ITEM_CONDITIONS = ['NEW', 'REFURBISH'] as const;
type ItemCondition = (typeof ITEM_CONDITIONS)[number];

const BLANK_FORM = {
  sourceType: 'Brand Owner',
  brandId: '',
  vendorId: '',
  productId: '',
  quantity: 1,
  condition: 'good',
  itemCondition: 'NEW' as ItemCondition,
  warehouseId: '',
  serialNumber: '',
  batchNumber: '',
  poNumber: '',
  awbNumber: '',
  invoiceNumber: '',
  rmaReference: '',
  notes: '',
};

const needsInspection = (gr: any) =>
  gr.statusEnum === 'QC_PENDING' ||
  (gr.status === 'pending_inspection' && gr.statusEnum !== 'PUTAWAY_PENDING' && gr.statusEnum !== 'COMPLETED' && gr.statusEnum !== 'PARTIAL' && gr.statusEnum !== 'REJECTED');

const isFinished = (gr: any) =>
  gr.status === 'completed' ||
  ['COMPLETED', 'PUTAWAY_PENDING', 'PARTIAL', 'REJECTED'].includes(gr.statusEnum);

const isToday = (d: any) => { try { return new Date(d).toDateString() === new Date().toDateString(); } catch { return false; } };

// Source type matches by its stored value and by the label shown (old and new names both find it).
const matchesQuery = (gr: any, q: string, sourceLabel: (v: string) => string) =>
  !q || (gr.refNumber ?? '').toLowerCase().includes(q) ||
  (gr.sourceType ?? '').toLowerCase().includes(q) ||
  (gr.sourceType ? sourceLabel(gr.sourceType).toLowerCase().includes(q) : false) ||
  (gr.poNumber ?? '').toLowerCase().includes(q);

// ─── Process flow indicator ───────────────────────────────────────────────────

const STAGES = [
  { key: 'receive',   icon: Truck },
  { key: 'inspect',   icon: ClipboardList },
  { key: 'verify',    icon: ShieldCheck },
  { key: 'inventory', icon: PackageCheck },
] as const;

function ProcessFlow({ activeStage }: { activeStage: 'receive' | 'inspect' | 'verify' | 'inventory' }) {
  const S = useT().m.receiving.stages;
  const idx = STAGES.findIndex((s) => s.key === activeStage);
  const active = STAGES[idx];
  return (
    <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
      {STAGES.map((stage, i) => {
        const Icon = stage.icon;
        const done    = i < idx;
        const current = i === idx;
        return (
          <div key={stage.key} className="flex items-center gap-1 min-w-0">
            <div className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              current ? 'bg-blue-600 text-white' : done ? 'bg-green-100 text-green-700' : 'text-slate-400',
            )}>
              <Icon className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="hidden sm:inline whitespace-nowrap">{S[stage.key]}</span>
            </div>
            {i < STAGES.length - 1 && (
              <ArrowRight className={cn('h-3.5 w-3.5 flex-shrink-0', i < idx ? 'text-green-400' : 'text-slate-300')} />
            )}
          </div>
        );
      })}
      <div className="ml-auto pl-3 border-l border-slate-200 hidden md:block">
        <p className="text-xs text-slate-500">
          <span className="font-medium text-blue-600">{active ? S[active.key] : ''}</span>
          {' — '}{active ? S[`${active.key}Desc`] : ''}
        </p>
      </div>
    </div>
  );
}

// ─── Expandable GR row ────────────────────────────────────────────────────────

interface GrRowProps {
  gr: any;
  onInspectSubmit: (id: string, dto: any) => Promise<void>;
  inspectBusy: boolean;
}

function GrRow({ gr, onInspectSubmit, inspectBusy }: GrRowProps) {
  const { m, t, fmt } = useT();
  const R = m.receiving.row;
  const [open, setOpen] = useState(false);
  const items: any[] = gr.items ?? [];
  const units = items.reduce((s: number, it: any) => s + Number(it.quantity ?? 0), 0);
  const finished = isFinished(gr);
  const hasDiscrepancy = (gr.discrepancies?.length ?? 0) > 0;

  // Outcome summary after inspection
  const outcomes = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((it: any) => {
      if (it.inspectionOutcome) map[it.inspectionOutcome] = (map[it.inspectionOutcome] ?? 0) + 1;
    });
    return map;
  }, [items]);

  return (
    <div className={cn(
      'rounded-xl border bg-white shadow-sm overflow-hidden transition-shadow',
      open ? 'shadow-md border-blue-200' : 'border-slate-200',
    )}>
      {/* Row header */}
      <button
        type="button"
        className="w-full text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex gap-3 items-center p-4">
          {/* Status stripe */}
          <div className={cn(
            'w-1 self-stretch rounded-full flex-shrink-0',
            finished && !hasDiscrepancy ? 'bg-green-400' :
            hasDiscrepancy              ? 'bg-orange-400' :
            'bg-amber-400',
          )} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-bold text-green-700">{gr.refNumber}</span>
              <ReceivingStatusBadge status={gr.statusEnum?.toLowerCase() ?? gr.status} />
              {hasDiscrepancy && (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-orange-100 text-orange-700 border border-orange-300 rounded-full font-semibold">
                  <TriangleAlert className="h-2.5 w-2.5" />
                  {t(R.discrepancy, { count: gr.discrepancies.length })}
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
              <span>{labelOf(m.receiving.sourceType, gr.sourceType)}</span>
              {gr.poNumber && <span className="font-mono">{t(R.po, { po: gr.poNumber })}</span>}
              <span>{t(R.itemsUnits, { items: items.length, units: fmt.number(units) })}</span>
              <span>{fmt.dateTime(gr.receivedDate)}</span>
            </div>

            {/* Outcome chips after inspection */}
            {Object.keys(outcomes).length > 0 && (
              <div className="mt-2 flex gap-1.5 flex-wrap">
                {Object.entries(outcomes).map(([outcome, count]) => (
                  <OutcomeChip key={outcome} outcome={outcome} count={count as number} />
                ))}
              </div>
            )}
          </div>

          <div className="flex-shrink-0 flex items-center gap-2">
            {finished ? (
              <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" /> {R.inspected}
              </span>
            ) : (
              <span className="text-xs text-amber-600 font-medium flex items-center gap-1">
                <CircleDot className="h-3.5 w-3.5" /> {R.awaiting}
              </span>
            )}
            {open
              ? <ChevronUp className="h-4 w-4 text-slate-400" />
              : <ChevronDown className="h-4 w-4 text-slate-400" />}
          </div>
        </div>
      </button>

      {/* Expanded: inspection workspace or read-only summary */}
      {open && (
        finished
          ? <InspectionSummary gr={gr} onClose={() => setOpen(false)} />
          : <InspectionWorkspace
              gr={gr}
              onSubmit={(dto) => onInspectSubmit(gr.id, dto)}
              onClose={() => setOpen(false)}
              busy={inspectBusy}
            />
      )}
    </div>
  );
}

// ─── Read-only inspection summary (post-inspection) ──────────────────────────

function InspectionSummary({ gr, onClose }: { gr: any; onClose: () => void }) {
  const { m, t, fmt } = useT();
  const S = m.receiving.summary;
  const items: any[] = gr.items ?? [];
  return (
    <div className="border-t border-slate-200 bg-slate-50/40">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 bg-white">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <span className="text-sm font-semibold text-slate-800">{S.complete}</span>
        {gr.discrepancies?.length > 0 && (
          <span className="ml-2 text-xs text-orange-600 font-medium">{t(S.discrepanciesFiled, { count: gr.discrepancies.length })}</span>
        )}
        <button onClick={onClose} className="ml-auto text-xs text-slate-400 hover:text-slate-600">{S.close}</button>
      </div>
      <div className="px-5 py-4 space-y-2">
        {items.map((it: any) => (
          <div key={it.id} className="flex items-center gap-3 bg-white rounded-lg border border-slate-200 px-3 py-2.5">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 truncate">
                <span className="font-mono text-xs text-slate-500 mr-1">{it.product?.code}</span>
                {it.product?.name}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {t(S.received, { qty: fmt.number(Number(it.quantity)) })}
                {it.inspectedQty != null && ` · ${t(S.inspected, { qty: fmt.number(Number(it.inspectedQty)) })}`}
                {it.serialNumber && ` · ${t(S.sn, { sn: it.serialNumber })}`}
              </p>
              {it.inspectorNotes && <p className="text-xs text-slate-500 italic mt-0.5">"{it.inspectorNotes}"</p>}
            </div>
            {it.inspectionOutcome && <OutcomeChip outcome={it.inspectionOutcome} />}
            {!it.inspectionOutcome && it.condition && <OutcomeChip outcome={it.condition} />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Outcome chip ─────────────────────────────────────────────────────────────

const OUTCOME_STYLE: Record<string, string> = {
  good:                 'bg-green-100 text-green-700 border-green-300',
  doa:                  'bg-red-100 text-red-700 border-red-300',
  damaged:              'bg-amber-100 text-amber-700 border-amber-300',
  short_qty:            'bg-blue-100 text-blue-700 border-blue-300',
  wrong_item:           'bg-purple-100 text-purple-700 border-purple-300',
  missing_accessories:  'bg-orange-100 text-orange-700 border-orange-300',
};
function OutcomeChip({ outcome, count }: { outcome: string; count?: number }) {
  const { m } = useT();
  const style = OUTCOME_STYLE[outcome] ?? 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border', style)}>
      {count != null && <span>{count}×</span>}
      {labelOf(m.receiving.outcome, outcome)}
    </span>
  );
}

// ─── Import from file dialog (one file = one goods receipt) ───────────────────

const BLANK_IMPORT_HEADER = {
  sourceType: 'Brand Owner', sourceRef: '', poNumber: '', awbNumber: '', invoiceNumber: '', warehouseId: '', notes: '',
};

function ImportReceivingDialog({ warehouses, onCreated }: { warehouses: any[]; onCreated: () => void }) {
  const { m, t, fmt } = useT();
  const I = m.receiving.import;
  const F = m.receiving.form;
  const [open, setOpen] = useState(false);
  const [header, setHeader] = useState({ ...BLANK_IMPORT_HEADER });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ReceivingImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [reimport, setReimport] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedWarehouse = warehouses.find((w) => w.id === header.warehouseId);

  function handleOpen(v: boolean) {
    setOpen(v);
    if (!v) { setFile(null); setPreview(null); setReimport(false); setHeader({ ...BLANK_IMPORT_HEADER }); }
  }

  async function onFile(f: File) {
    if (!/\.(xlsx|csv)$/i.test(f.name)) { toast.error(I.onlyXlsx); return; }
    setFile(f); setReimport(false); setBusy(true);
    try {
      const p = await receivingApi.importPreview(f);
      setPreview(p);
      toast.success(t(I.fileRead, { valid: p.summary.valid, total: p.summary.total }));
    } catch (e: any) {
      toast.error(e.message); setFile(null); setPreview(null);
    } finally { setBusy(false); }
  }

  async function downloadTemplate() {
    try { await receivingApi.importTemplate(); toast.success(I.templateDownloaded); }
    catch (e: any) { toast.error(e.message); }
  }

  async function confirm() {
    if (!file || !preview) return;
    if (!header.sourceType.trim()) { toast.error(I.sourceRequired); return; }
    setBusy(true);
    try {
      const r = await receivingApi.importCommit({ ...header, ...(reimport ? { allowReimport: 'true' } : {}) }, file);
      toast.success(t(I.created, { ref: r.refNumber, inserted: r.inserted, skipped: r.skipped }));
      handleOpen(false);
      onCreated();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger render={<Button variant="outline" className="gap-1.5" />}>
        <Upload className="h-4 w-4" /> {I.button}
      </DialogTrigger>
      <DialogContent className="w-full max-w-3xl sm:max-w-3xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>{I.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {/* Receipt header — applies to the whole file. Order: Source → Reference → Warehouse → Notes */}
          <FormSection icon={Truck} title={I.headerSection}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1 min-w-0">
                <Label>{F.sourceType} <span className="text-red-500">*</span></Label>
                <Select value={header.sourceType} onValueChange={(v) => setHeader((h) => ({ ...h, sourceType: v ?? 'Brand Owner' }))}>
                  <SelectTrigger className="w-full min-w-0">
                    <span className="flex flex-1 text-left truncate text-sm">{header.sourceType ? labelOf(m.receiving.sourceType, header.sourceType) : F.select}</span>
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {SOURCE_TYPES.map((s) => (
                      <SelectItem key={s} value={s}>{labelOf(m.receiving.sourceType, s)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </FormSection>

          <FormSection icon={ClipboardList} title={F.sections.references}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1 min-w-0">
                <Label>{F.poRef} <span className="text-slate-400 font-normal">{F.optional}</span></Label>
                <Input value={header.poNumber} onChange={(e) => setHeader((h) => ({ ...h, poNumber: e.target.value }))} placeholder="PO-2026-001" />
              </div>
              <div className="space-y-1 min-w-0">
                <Label>{F.awb} <span className="text-slate-400 font-normal">{F.optional}</span></Label>
                <Input value={header.awbNumber} onChange={(e) => setHeader((h) => ({ ...h, awbNumber: e.target.value }))} placeholder="AWB-123456789" />
              </div>
              <div className="space-y-1 min-w-0">
                <Label>{F.invoiceNo} <span className="text-slate-400 font-normal">{F.optional}</span></Label>
                <Input value={header.invoiceNumber} onChange={(e) => setHeader((h) => ({ ...h, invoiceNumber: e.target.value }))} placeholder="INV-2026-0001" />
              </div>
              <div className="space-y-1 min-w-0">
                <Label>{F.rmaRef} <span className="text-slate-400 font-normal">{F.optional}</span></Label>
                <Input value={header.sourceRef} onChange={(e) => setHeader((h) => ({ ...h, sourceRef: e.target.value }))} placeholder={F.rmaPlaceholder} />
              </div>
            </div>
          </FormSection>

          <FormSection icon={MapPin} title={F.sections.warehouse}>
            <div className="space-y-1 min-w-0">
              <Label>{I.defaultWarehouse} <span className="text-slate-400 font-normal">{I.defaultWarehouseHint}</span></Label>
              <Select value={header.warehouseId} onValueChange={(v) => setHeader((h) => ({ ...h, warehouseId: v ?? '' }))}>
                <SelectTrigger className="w-full min-w-0">
                  <span className={cn('flex flex-1 text-left truncate text-sm', !selectedWarehouse && 'text-muted-foreground')}>
                    {selectedWarehouse ? selectedWarehouse.name : m.receiving.form.selectWarehouse}
                  </span>
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </FormSection>

          <FormSection icon={Info} title={F.sections.notes}>
            <div className="space-y-1 min-w-0">
              <Label htmlFor="import-notes">{F.notes} <span className="text-slate-400 font-normal">{F.optional}</span></Label>
              <Textarea id="import-notes" rows={5} value={header.notes} onChange={(e) => setHeader((h) => ({ ...h, notes: e.target.value }))} placeholder={F.notesPlaceholder} className="field-sizing-fixed resize-y" />
            </div>
          </FormSection>

          {/* File */}
          <FormSection icon={Package} title={I.fileSection}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-xs text-slate-500">{I.columns}</p>
              <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-1.5 shrink-0">
                <FileDown className="h-4 w-4" /> {I.template}
              </Button>
            </div>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }}
              onClick={() => inputRef.current?.click()}
              className={cn('rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors',
                dragOver ? 'border-green-500 bg-green-50' : 'border-slate-300 hover:border-green-400 hover:bg-slate-50')}
            >
              <input ref={inputRef} type="file" accept=".xlsx,.csv" hidden
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              <Upload className="h-8 w-8 mx-auto text-slate-400 mb-2" />
              <p className="text-sm font-medium text-slate-700">{I.drop}</p>
              <p className="text-xs text-slate-400 mt-1">{I.fileTypes}</p>
              {file && <p className="text-xs text-green-600 mt-2 font-medium">{file.name}</p>}
            </div>
          </FormSection>

          {/* Preview */}
          {preview && (
            <FormSection icon={CheckCircle2} title={I.review}>
              <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
                <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium">{t(I.total, { count: preview.summary.total })}</span>
                <span className="px-2 py-0.5 rounded-md bg-green-100 text-green-700 font-medium">{t(I.valid, { count: preview.summary.valid })}</span>
                <span className="px-2 py-0.5 rounded-md bg-red-100 text-red-700 font-medium">{t(I.issues, { count: preview.summary.invalid })}</span>
              </div>
              {preview.alreadyImported && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="already-received">
                  <p className="font-medium">
                    {t(I.alreadyReceived, {
                      ref: preview.alreadyImported.refNumber ? t(I.alreadyRef, { ref: preview.alreadyImported.refNumber }) : '',
                      date: fmt.dateTime(preview.alreadyImported.at),
                      by: preview.alreadyImported.by ? t(I.alreadyBy, { name: preview.alreadyImported.by }) : '',
                    })}
                  </p>
                  <p className="text-xs mt-1">{I.alreadyWarn}</p>
                  <label className="mt-2 flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={reimport} onChange={(e) => setReimport(e.target.checked)} id="confirm-rereceive" />
                    {I.newDelivery}
                  </label>
                </div>
              )}
              <div className="rounded-lg border border-slate-200 overflow-auto max-h-[320px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0">
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="text-left px-2 py-1.5 font-medium text-slate-600">#</th>
                      <th className="text-left px-2 py-1.5 font-medium text-slate-600">{I.colStatus}</th>
                      {preview.columns.map((c) => <th key={c} className="text-left px-2 py-1.5 font-medium text-slate-600">{c}</th>)}
                      <th className="text-left px-2 py-1.5 font-medium text-slate-600">{I.colErrors}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {preview.rows.map((r) => (
                      <tr key={r.rowNumber} className={r.valid ? '' : 'bg-red-50'}>
                        <td className="px-2 py-1.5 text-slate-400">{r.rowNumber}</td>
                        <td className="px-2 py-1.5">
                          {r.valid ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-red-600" />}
                        </td>
                        {preview.columns.map((c) => <td key={c} className="px-2 py-1.5 text-slate-700">{String(r.data[c] ?? '')}</td>)}
                        <td className="px-2 py-1.5 text-red-600">{r.errors.join('; ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </FormSection>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={confirm}
            disabled={busy || !preview || preview.summary.valid === 0 || (!!preview.alreadyImported && !reimport)}
            className="bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4 mr-1.5" />
            {busy ? I.working : t(I.confirm, { count: preview?.summary.valid ?? 0 })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Reverse a mistaken receipt (Phase 6) ──────────────────────────────────────

function ReverseReceiptDialog({ gr, onDone }: { gr: any; onDone: () => void }) {
  const { m, t } = useT();
  const V = m.receiving.reverse;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = reason.trim().length >= 5;

  async function submit() {
    setBusy(true);
    try {
      const r = await receivingApi.reverse(gr.id, reason.trim());
      toast.success(t(V.done, { ref: r.refNumber, count: r.reversedUnits }));
      setOpen(false); setReason('');
      onDone();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setReason(''); }}>
      <DialogTrigger render={<Button variant="outline" size="sm" className="gap-1 h-7 text-xs" />}>
        <Undo2 className="h-3.5 w-3.5" /> {V.button}
      </DialogTrigger>
      <DialogContent className="w-full max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(V.title, { ref: gr.refNumber })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">{t(V.body, { count: gr.items?.length ?? 0 })}</p>
          <p className="text-xs text-slate-500">{V.rule}</p>
          <div className="space-y-1">
            <Label htmlFor="reverse-reason">{V.reason} <span className="text-red-500">*</span></Label>
            <Input id="reverse-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder={V.reasonPlaceholder} />
            {!ok && reason.length > 0 && <p className="text-xs text-slate-500">{V.minChars}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{V.keep}</Button>
          <Button onClick={submit} disabled={!ok || busy} className="bg-red-600 hover:bg-red-700 text-white">
            {busy ? V.working : V.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Receive Goods dialog (unchanged UX, updated form) ────────────────────────

function ReceiveDialog({ products, warehouses, brands, vendors, onCreated }: {
  products: any[];
  warehouses: any[];
  brands: any[];
  vendors: any[];
  onCreated: () => void;
}) {
  const { m, t } = useT();
  const F = m.receiving.form;
  const T = m.receiving.toast;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);
  const [busy, setBusy] = useState(false);

  // Source Type breakdown: Brand Owner → narrow Product list to that brand; Vendor → reference only (no Product-Vendor link in schema).
  const filteredProducts = useMemo(
    () => (form.sourceType === 'Brand Owner' && form.brandId)
      ? products.filter((p) => p.brandId === form.brandId)
      : products,
    [products, form.sourceType, form.brandId],
  );
  // Type-to-search: SKU, description/name, part number and model (same brand + Active list as before).
  const productOptions = useMemo(
    () => filteredProducts.map((p) => ({
      value: p.id,
      label: `${p.partNumber || p.code} — ${p.description || p.name}`,
      sublabel: [p.model, p.partNumber && p.partNumber !== p.code ? p.code : null, p.brand?.name].filter(Boolean).join(' · ') || undefined,
      keywords: [p.code, p.name, p.partNumber, p.vendorPartNumber, p.model, p.description].filter(Boolean).join(' '),
    })),
    [filteredProducts],
  );
  const selectedProduct = useMemo(
    () => filteredProducts.find((p) => p.id === form.productId) ?? null,
    [filteredProducts, form.productId],
  );
  const selectedWarehouse = useMemo(
    () => warehouses.find((w) => w.id === form.warehouseId) ?? null,
    [warehouses, form.warehouseId],
  );
  const selectedVendor = useMemo(
    () => vendors.find((v) => v.id === form.vendorId) ?? null,
    [vendors, form.vendorId],
  );

  function handleSourceTypeChange(sourceType: string) {
    setForm((f) => ({ ...f, sourceType, brandId: '', vendorId: '', productId: '', serialNumber: '', batchNumber: '' }));
  }

  function handleBrandChange(brandId: string | null) {
    setForm((f) => ({ ...f, brandId: brandId ?? '', productId: '', serialNumber: '', batchNumber: '' }));
  }

  function handleProductChange(productId: string | null) {
    setForm((f) => ({ ...f, productId: productId ?? '', serialNumber: '', batchNumber: '' }));
  }

  function handleOpen(v: boolean) {
    setOpen(v);
    if (!v) setForm((f) => ({ ...BLANK_FORM, warehouseId: f.warehouseId }));
  }

  // Phase 4: what still blocks Receive Goods (the API refuses the same cases).
  const serialEntered = !!form.serialNumber.trim();
  const missingForReceive = [
    !form.productId && F.need.product,
    form.sourceType === 'Vendor' && !form.vendorId && F.need.vendor,
    !(Number(form.quantity) >= 1) && F.need.quantity,
    !ITEM_CONDITIONS.includes(form.itemCondition) && F.need.condition,
    !!selectedProduct?.serialControlled && !serialEntered && F.need.serial,
    !!selectedProduct?.batchControlled && !form.batchNumber.trim() && F.need.batch,
    serialEntered && Number(form.quantity) !== 1 && F.need.serialQtyOne,
  ].filter(Boolean) as string[];

  async function submit() {
    if (missingForReceive.length) { toast.error(t(F.stillNeeded, { list: missingForReceive.join(', ') })); return; }
    if (!form.productId) { toast.error(T.selectProduct); return; }
    if (selectedProduct?.serialControlled && !form.serialNumber.trim()) {
      toast.error(t(T.serialRequired, { code: selectedProduct.code })); return;
    }
    if (selectedProduct?.batchControlled && !form.batchNumber.trim()) {
      toast.error(t(T.batchRequired, { code: selectedProduct.code })); return;
    }
    setBusy(true);
    try {
      const vendorNote = form.sourceType === 'Vendor' && selectedVendor ? `Vendor: ${selectedVendor.name}` : '';
      const combinedNotes = [vendorNote, form.notes].filter(Boolean).join(' — ');
      await receivingApi.create({
        sourceType: form.sourceType,
        poNumber: form.poNumber || undefined,
        awbNumber: form.awbNumber.trim() || undefined,
        invoiceNumber: form.invoiceNumber.trim() || undefined,
        sourceRef: form.rmaReference.trim() || undefined,
        supplierId: form.sourceType === 'Vendor' ? form.vendorId || undefined : undefined,
        notes: combinedNotes || undefined,
        items: [{
          productId: form.productId,
          quantity: Number(form.quantity),
          condition: form.condition,
          itemCondition: form.itemCondition,
          warehouseId: form.warehouseId || undefined,
          serialNumber: form.serialNumber.trim() || undefined,
          batchNumber: form.batchNumber.trim() || undefined,
        }],
      });
      toast.success(T.received);
      handleOpen(false);
      onCreated();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger render={<Button className="bg-green-600 hover:bg-green-700 text-white gap-1.5" />}>
        <PackagePlus className="h-4 w-4" /> {F.receiveGoods}
      </DialogTrigger>
      <DialogContent className="w-full max-w-2xl sm:max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>{F.dialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {/* Source */}
          <FormSection icon={Truck} title={F.sections.source}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1 min-w-0">
                <Label>{F.sourceType}</Label>
                <Select value={form.sourceType} onValueChange={(v) => handleSourceTypeChange(v ?? 'Brand Owner')}>
                  <SelectTrigger className="w-full min-w-0">
                    <span className={cn('flex flex-1 text-left truncate text-sm', !form.sourceType && 'text-muted-foreground')}>
                      {form.sourceType ? labelOf(m.receiving.sourceType, form.sourceType) : F.select}
                    </span>
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {SOURCE_TYPES.map((s) => (
                      <SelectItem key={s} value={s}>{labelOf(m.receiving.sourceType, s)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {form.sourceType === 'Brand Owner' && (
                <div className="space-y-1 min-w-0">
                  <Label>{F.brand} <span className="text-red-500">*</span>
                    <span className="ml-2 text-xs font-normal text-slate-400">{F.brandHint}</span>
                  </Label>
                  <Select value={form.brandId} onValueChange={handleBrandChange}>
                    <SelectTrigger className="w-full min-w-0">
                      <span className={cn('flex flex-1 text-left truncate text-sm', !form.brandId && 'text-muted-foreground')}>
                        {brands.find((b) => b.id === form.brandId)?.name || F.selectBrand}
                      </span>
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {form.sourceType === 'Vendor' && (
                <div className="space-y-1 min-w-0">
                  <Label>{F.vendor} *
                    <span className="ml-2 text-xs font-normal text-slate-400">{F.vendorHint}</span>
                  </Label>
                  <Select value={form.vendorId} onValueChange={(v) => setForm((f) => ({ ...f, vendorId: v ?? '' }))}>
                    <SelectTrigger className="w-full min-w-0">
                      <span className={cn('flex flex-1 text-left truncate text-sm', !form.vendorId && 'text-muted-foreground')}>
                        {vendors.find((v) => v.id === form.vendorId)?.name || F.selectVendor}
                      </span>
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </FormSection>

          {/* Product */}
          <FormSection icon={Package} title={F.sections.product}>
            <div className="space-y-1 min-w-0">
              <Label>{F.product} <span className="text-red-500">*</span>
                <span className="ml-2 text-xs font-normal text-slate-400">{F.productHint}</span>
              </Label>
              <SearchableSelect
                value={form.productId}
                options={productOptions}
                onSelect={(v) => handleProductChange(v)}
                disabled={form.sourceType === 'Brand Owner' && !form.brandId}
                placeholder={form.sourceType === 'Brand Owner' && !form.brandId ? F.selectBrandFirst : F.searchProduct}
                searchPlaceholder={F.searchProductInput}
              />
              {form.sourceType === 'Brand Owner' && form.brandId && filteredProducts.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">{F.noBrandProducts}</p>
              )}
            </div>
            {selectedProduct && (
              <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <ShieldCheck className="h-4 w-4 text-green-600 flex-shrink-0" />
                  <span className="text-xs font-semibold text-green-700 uppercase tracking-wide">{F.masterInfo}</span>
                  <span className="ml-auto text-[10px] text-green-600 bg-green-100 px-2 py-0.5 rounded-full font-medium">{F.readOnly}</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2.5">
                  {[
                    { label: F.productCode, value: selectedProduct.code, mono: true },
                    { label: F.productName, value: selectedProduct.name },
                    { label: F.model, value: selectedProduct.model },
                    { label: F.partNumber, value: selectedProduct.partNumber, mono: true },
                    { label: F.category, value: selectedProduct.category },
                    { label: F.uom, value: selectedProduct.unit },
                  ].map(({ label, value, mono }) => (
                    <div key={label} className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wide text-green-600 font-semibold mb-0.5">{label}</p>
                      <p className={cn('text-sm text-slate-800 truncate', mono && 'font-mono', !value && 'text-slate-400 italic')}>
                        {value || '—'}
                      </p>
                    </div>
                  ))}
                  {selectedProduct.description && (
                    <div className="col-span-2 md:col-span-3 min-w-0">
                      <p className="text-[10px] uppercase tracking-wide text-green-600 font-semibold mb-0.5">{F.description}</p>
                      <p className="text-sm text-slate-800 truncate">{selectedProduct.description}</p>
                    </div>
                  )}
                  <div className="col-span-2 md:col-span-3 flex gap-3 pt-0.5">
                    {[
                      { active: selectedProduct.serialControlled, term: F.serialTerm },
                      { active: selectedProduct.batchControlled,  term: F.batchTerm },
                    ].map(({ active, term }) => (
                      <span key={term} className={cn(
                        'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium border',
                        active ? 'bg-green-100 text-green-700 border-green-300' : 'bg-slate-100 text-slate-400 border-slate-200',
                      )}>
                        <ShieldCheck className="h-3 w-3" />{term} {active ? F.required : F.notRequired}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </FormSection>

          {/* Receiving Details */}
          <FormSection icon={Info} title={F.sections.details}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1 min-w-0">
                <Label>{F.quantity} <span className="text-red-500">*</span></Label>
                <Input type="number" min={1} value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1 min-w-0">
                <Label>{F.serialNumber}
                  {selectedProduct?.serialControlled ? <span className="text-red-500 ml-0.5">*</span> : <span className="text-slate-400 font-normal ml-1">{F.optional}</span>}
                </Label>
                <Input
                  value={form.serialNumber}
                  onChange={(e) => setForm((f) => ({ ...f, serialNumber: e.target.value }))}
                  placeholder={selectedProduct?.serialControlled ? F.requiredForProduct : 'SN-001234'}
                  className={cn(selectedProduct?.serialControlled && !form.serialNumber && 'border-amber-400')}
                />
              </div>
              <div className="space-y-1 min-w-0">
                <Label>{F.condition} <span className="text-red-500">*</span></Label>
                <Select value={form.itemCondition} onValueChange={(v) => setForm((f) => ({ ...f, itemCondition: (v as ItemCondition) ?? 'NEW' }))}>
                  <SelectTrigger className="w-full min-w-0">
                    <span className="flex flex-1 text-left truncate text-sm">{F.itemCondition[form.itemCondition]}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {ITEM_CONDITIONS.map((c) => <SelectItem key={c} value={c}>{F.itemCondition[c]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </FormSection>

          {/* Reference */}
          <FormSection icon={ClipboardList} title={F.sections.references}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1 min-w-0">
                <Label>{F.poRef} <span className="text-slate-400 font-normal">{F.optional}</span></Label>
                <Input value={form.poNumber} onChange={(e) => setForm((f) => ({ ...f, poNumber: e.target.value }))} placeholder="PO-2026-001" />
              </div>
              <div className="space-y-1 min-w-0">
                <Label>{F.batchNumber}
                  {selectedProduct?.batchControlled ? <span className="text-red-500 ml-0.5">*</span> : <span className="text-slate-400 font-normal ml-1">{F.optional}</span>}
                </Label>
                <Input
                  value={form.batchNumber}
                  onChange={(e) => setForm((f) => ({ ...f, batchNumber: e.target.value }))}
                  placeholder={selectedProduct?.batchControlled ? F.requiredForProduct : 'LOT-2026-001'}
                  className={cn(selectedProduct?.batchControlled && !form.batchNumber && 'border-amber-400')}
                />
              </div>
              <div className="space-y-1 min-w-0">
                <Label>{F.awb} <span className="text-slate-400 font-normal">{F.optional}</span></Label>
                <Input value={form.awbNumber} onChange={(e) => setForm((f) => ({ ...f, awbNumber: e.target.value }))} placeholder="AWB-123456789" />
              </div>
              <div className="space-y-1 min-w-0">
                <Label>{F.invoiceNo} <span className="text-slate-400 font-normal">{F.optional}</span></Label>
                <Input value={form.invoiceNumber} onChange={(e) => setForm((f) => ({ ...f, invoiceNumber: e.target.value }))} placeholder="INV-2026-0001" />
              </div>
              <div className="space-y-1 min-w-0 md:col-span-2">
                <Label>{F.rmaRef} <span className="text-slate-400 font-normal">{F.optional}</span></Label>
                <Input value={form.rmaReference} onChange={(e) => setForm((f) => ({ ...f, rmaReference: e.target.value }))} placeholder={F.rmaPlaceholder} />
              </div>
            </div>
          </FormSection>

          {/* Warehouse */}
          <FormSection icon={MapPin} title={F.sections.warehouse}>
            <div className="space-y-1 min-w-0">
              <Label>{F.warehouse} <span className="text-slate-400 font-normal">{F.warehouseHint}</span></Label>
              <Select value={form.warehouseId} onValueChange={(v) => setForm((f) => ({ ...f, warehouseId: v ?? '' }))}>
                <SelectTrigger className="w-full min-w-0">
                  <span className={cn('flex flex-1 text-left truncate text-sm', !selectedWarehouse && 'text-muted-foreground')}>
                    {selectedWarehouse ? selectedWarehouse.name : m.receiving.form.selectWarehouse}
                  </span>
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </FormSection>

          {/* Notes — last */}
          <FormSection icon={Info} title={F.sections.notes}>
            <div className="space-y-1 min-w-0">
              <Label htmlFor="receive-notes">{F.notes} <span className="text-slate-400 font-normal">{F.optional}</span></Label>
              <Textarea id="receive-notes" rows={5} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder={F.notesPlaceholder} className="field-sizing-fixed resize-y" />
            </div>
          </FormSection>
        </div>
        <DialogFooter>
          {missingForReceive.length > 0 && <p className="mr-auto self-center text-xs text-amber-700">{t(F.stillNeeded, { list: missingForReceive.join(', ') })}</p>}
          <Button onClick={submit} disabled={missingForReceive.length > 0 || busy} className="bg-green-600 hover:bg-green-700 text-white disabled:opacity-50">
            {busy ? F.creating : F.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ReceivingPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('queue');
  const [query, setQuery] = useState('');
  const [inspectBusy, setInspectBusy] = useState(false);
  const user = useAuthStore((s) => s.user);
  const { m, fmt } = useT();
  const RV = m.receiving;
  const canReverse = !!user && REVERSE_ROLES.includes(user.role);
  const sourceLabel = useCallback((v: string) => labelOf(m.receiving.sourceType, v), [m]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [gr, prods, whs, brs, vds] = await Promise.all([
        receivingApi.list(),
        warehouseApi.products(),
        warehouseApi.list(),
        warehouseApi.brands(),
        warehouseApi.vendors(),
      ]);
      setRows(gr);
      setProducts(prods);
      setWarehouses(whs);
      setBrands(brs);
      setVendors(vds);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleInspect(id: string, dto: any) {
    setInspectBusy(true);
    try {
      await receivingApi.inspect(id, dto);
      toast.success(RV.toast.inspected);
      load();
    } catch (e: any) {
      toast.error(e.message || RV.toast.inspectFailed);
    } finally {
      setInspectBusy(false);
    }
  }

  // ── Derived metrics ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const pending       = rows.filter(needsInspection);
    const finished      = rows.filter(isFinished);
    const good          = finished.filter((gr) => !gr.discrepancies?.length && gr.statusEnum !== 'REJECTED');
    const flagged       = rows.filter((gr) => (gr.discrepancies?.length ?? 0) > 0);
    const pending_res   = flagged.filter((gr) => gr.statusEnum !== 'COMPLETED');
    const receivedToday = rows.filter((r) => isToday(r.receivedDate));
    return {
      receivedToday: receivedToday.length,
      awaitingInspection: pending.length,
      verifiedGood: good.length,
      flaggedIssues: flagged.length,
      pendingResolution: pending_res.length,
    };
  }, [rows]);

  const queueRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((gr) => needsInspection(gr) && matchesQuery(gr, q, sourceLabel));
  }, [rows, query, sourceLabel]);

  const allRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((gr) => matchesQuery(gr, q, sourceLabel));
  }, [rows, query, sourceLabel]);

  const tabs: { key: Tab; label: string; count: number; dot?: string }[] = [
    { key: 'queue', label: RV.tabs.queue, count: stats.awaitingInspection, dot: stats.awaitingInspection > 0 ? 'bg-amber-400' : undefined },
    { key: 'all',   label: RV.tabs.all, count: rows.length },
  ];

  return (
    <div className="p-6 space-y-5">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-green-600" />
            {RV.title}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">{RV.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportReceivingDialog warehouses={warehouses} onCreated={load} />
          <ReceiveDialog products={products} warehouses={warehouses} brands={brands} vendors={vendors} onCreated={load} />
        </div>
      </div>

      {/* Process flow indicator */}
      <ProcessFlow activeStage="inspect" />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatTile label={RV.kpi.receivedToday}      value={loading ? '—' : stats.receivedToday}       icon={PackagePlus}  tone="slate" />
        <StatTile label={RV.kpi.awaitingInspection} value={loading ? '—' : stats.awaitingInspection}  icon={Clock}        tone={stats.awaitingInspection > 0 ? 'amber' : 'slate'} />
        <StatTile label={RV.kpi.verifiedGood}      value={loading ? '—' : stats.verifiedGood}        icon={PackageCheck} tone="green" />
        <StatTile label={RV.kpi.flaggedIssues}      value={loading ? '—' : stats.flaggedIssues}       icon={AlertTriangle} tone={stats.flaggedIssues > 0 ? 'red' : 'slate'} />
        <StatTile label={RV.kpi.pendingResolution}  value={loading ? '—' : stats.pendingResolution}   icon={TriangleAlert} tone={stats.pendingResolution > 0 ? 'amber' : 'slate'} />
      </div>

      {/* Tab bar + search */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 self-start">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5',
                tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {t.dot && <span className={cn('w-1.5 h-1.5 rounded-full', t.dot)} />}
              {t.label}
              <span className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                t.key === 'queue' && t.count > 0 ? 'bg-amber-100 text-amber-700'
                  : tab === t.key ? 'bg-green-100 text-green-700'
                  : 'bg-slate-200 text-slate-500',
              )}>{t.count}</span>
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-0 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={RV.searchPlaceholder}
            className="pl-9"
          />
        </div>
      </div>

      {/* ── Inspection Queue tab ── */}
      {tab === 'queue' && (
        <div className="space-y-3">
          {loading
            ? [...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
            : queueRows.length === 0
            ? (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                <EmptyState
                  icon={CheckCircle2}
                  title={RV.empty.queueTitle}
                  message={query ? RV.empty.queueNoMatch : RV.empty.queueAllDone}
                />
              </div>
            )
            : queueRows.map((gr) => (
              <GrRow key={gr.id} gr={gr} onInspectSubmit={handleInspect} inspectBusy={inspectBusy} />
            ))}
        </div>
      )}

      {/* ── All Records tab ── */}
      {tab === 'all' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-3 font-medium text-slate-600">{RV.table.grNo}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{RV.table.source}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{RV.table.items}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{RV.table.outcomes}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{RV.table.status}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{RV.table.received}</th>
                {canReverse && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading
                ? [...Array(5)].map((_, i) => (
                  <tr key={i}>{[...Array(canReverse ? 7 : 6)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>
                ))
                : allRows.length === 0
                ? (
                  <tr><td colSpan={canReverse ? 7 : 6} className="px-0 py-0">
                    <EmptyState icon={FileX} title={rows.length === 0 ? RV.empty.noRecords : RV.empty.noMatches} message={rows.length === 0 ? RV.empty.createFirst : RV.empty.adjustSearch} />
                  </td></tr>
                )
                : allRows.map((gr) => {
                  const outcomes = (gr.items ?? []).reduce((m: Record<string, number>, it: any) => {
                    const k = it.inspectionOutcome ?? it.condition ?? 'good';
                    m[k] = (m[k] ?? 0) + 1;
                    return m;
                  }, {});
                  return (
                    <tr key={gr.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs font-bold text-green-700">{gr.refNumber}</td>
                      <td className="px-4 py-3 text-slate-600">{labelOf(RV.sourceType, gr.sourceType)}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{m.common.units.items.replace('{count}', String(gr.items?.length ?? 0))}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          {Object.entries(outcomes).map(([o, c]) => <OutcomeChip key={o} outcome={o} count={c as number} />)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ReceivingStatusBadge status={gr.statusEnum?.toLowerCase() ?? gr.status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">{fmt.dateTime(gr.receivedDate)}</td>
                      {canReverse && (
                        <td className="px-4 py-3 text-right">
                          {canBeReversed(gr) && gr.receivedById !== user?.id
                            ? <ReverseReceiptDialog gr={gr} onDone={load} />
                            : null}
                        </td>
                      )}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tiny layout helper ───────────────────────────────────────────────────────

function FormSection({
  icon: Icon, title, children,
}: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-slate-700">
        <Icon className="h-4 w-4 text-green-600" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}
