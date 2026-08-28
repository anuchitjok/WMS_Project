'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  PackagePlus, PackageCheck, Clock, AlertTriangle, ClipboardList,
  Search, Truck, Package, MapPin, ShieldCheck, CheckCircle2,
  Info, ChevronDown, ChevronUp, ArrowRight, CircleDot,
  TriangleAlert, FileX, Upload, FileDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { receivingApi, warehouseApi, type ReceivingImportPreview } from '@/lib/api';
import { StatTile } from '@/components/ui/stat-tile';
import { ReceivingStatusBadge } from '@/components/receiving/receiving-status-badge';
import { InspectionWorkspace } from '@/components/receiving/inspection-workspace';
import { EmptyState } from '@/components/layout/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { formatDate, cn } from '@/lib/utils';

// ─── Types & constants ────────────────────────────────────────────────────────

type Tab = 'queue' | 'all';

const BLANK_FORM = {
  sourceType: 'Brand Owner',
  brandId: '',
  vendorId: '',
  productId: '',
  quantity: 1,
  condition: 'good',
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

const matchesQuery = (gr: any, q: string) =>
  !q || (gr.refNumber ?? '').toLowerCase().includes(q) ||
  (gr.sourceType ?? '').toLowerCase().includes(q) ||
  (gr.poNumber ?? '').toLowerCase().includes(q);

// ─── Process flow indicator ───────────────────────────────────────────────────

const STAGES = [
  { key: 'receive',    label: 'Receive',   icon: Truck,         desc: 'Goods arrive' },
  { key: 'inspect',   label: 'Inspect',   icon: ClipboardList, desc: 'QC check' },
  { key: 'verify',    label: 'Verify',    icon: ShieldCheck,   desc: 'Approve outcome' },
  { key: 'inventory', label: 'Inventory', icon: PackageCheck,  desc: 'Stock finalized' },
];

function ProcessFlow({ activeStage }: { activeStage: 'receive' | 'inspect' | 'verify' | 'inventory' }) {
  const idx = STAGES.findIndex((s) => s.key === activeStage);
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
              <span className="hidden sm:inline whitespace-nowrap">{stage.label}</span>
            </div>
            {i < STAGES.length - 1 && (
              <ArrowRight className={cn('h-3.5 w-3.5 flex-shrink-0', i < idx ? 'text-green-400' : 'text-slate-300')} />
            )}
          </div>
        );
      })}
      <div className="ml-auto pl-3 border-l border-slate-200 hidden md:block">
        <p className="text-xs text-slate-500">
          <span className="font-medium text-blue-600">{STAGES[idx]?.label}</span>
          {' — '}{STAGES[idx]?.desc}
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
                  {gr.discrepancies.length} discrepancy
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
              <span>{gr.sourceType}</span>
              {gr.poNumber && <span className="font-mono">PO: {gr.poNumber}</span>}
              <span>{items.length} item{items.length !== 1 ? 's' : ''} · {units.toLocaleString()} units</span>
              <span>{formatDate(gr.receivedDate)}</span>
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
                <CheckCircle2 className="h-3.5 w-3.5" /> Inspected
              </span>
            ) : (
              <span className="text-xs text-amber-600 font-medium flex items-center gap-1">
                <CircleDot className="h-3.5 w-3.5" /> Awaiting
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
  const items: any[] = gr.items ?? [];
  return (
    <div className="border-t border-slate-200 bg-slate-50/40">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 bg-white">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <span className="text-sm font-semibold text-slate-800">Inspection Complete</span>
        {gr.discrepancies?.length > 0 && (
          <span className="ml-2 text-xs text-orange-600 font-medium">{gr.discrepancies.length} discrepancy record{gr.discrepancies.length !== 1 ? 's' : ''} filed</span>
        )}
        <button onClick={onClose} className="ml-auto text-xs text-slate-400 hover:text-slate-600">Close ↑</button>
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
                Received: {Number(it.quantity).toLocaleString()}
                {it.inspectedQty != null && ` · Inspected: ${Number(it.inspectedQty).toLocaleString()}`}
                {it.serialNumber && ` · SN: ${it.serialNumber}`}
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
const OUTCOME_LABEL: Record<string, string> = {
  good: 'Good', doa: 'DOA', damaged: 'Damaged',
  short_qty: 'Short Qty', wrong_item: 'Wrong Item', missing_accessories: 'Missing Acc.',
};

function OutcomeChip({ outcome, count }: { outcome: string; count?: number }) {
  const style = OUTCOME_STYLE[outcome] ?? 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border', style)}>
      {count != null && <span>{count}×</span>}
      {OUTCOME_LABEL[outcome] ?? outcome.replace(/_/g, ' ')}
    </span>
  );
}

// ─── Import from file dialog (one file = one goods receipt) ───────────────────

const BLANK_IMPORT_HEADER = {
  sourceType: 'Brand Owner', sourceRef: '', awbNumber: '', invoiceNumber: '', warehouseId: '', notes: '',
};

function ImportReceivingDialog({ warehouses, onCreated }: { warehouses: any[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [header, setHeader] = useState({ ...BLANK_IMPORT_HEADER });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ReceivingImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedWarehouse = warehouses.find((w) => w.id === header.warehouseId);

  function handleOpen(v: boolean) {
    setOpen(v);
    if (!v) { setFile(null); setPreview(null); setHeader({ ...BLANK_IMPORT_HEADER }); }
  }

  async function onFile(f: File) {
    if (!/\.(xlsx|csv)$/i.test(f.name)) { toast.error('Only .xlsx or .csv files are supported'); return; }
    setFile(f); setBusy(true);
    try {
      const p = await receivingApi.importPreview(f);
      setPreview(p);
      toast.success(`File read — ${p.summary.valid}/${p.summary.total} rows ready`);
    } catch (e: any) {
      toast.error(e.message); setFile(null); setPreview(null);
    } finally { setBusy(false); }
  }

  async function downloadTemplate() {
    try { await receivingApi.importTemplate(); toast.success('Template downloaded'); }
    catch (e: any) { toast.error(e.message); }
  }

  async function confirm() {
    if (!file || !preview) return;
    if (!header.sourceType.trim()) { toast.error('Source Type is required'); return; }
    setBusy(true);
    try {
      const r = await receivingApi.importCommit({ ...header }, file);
      toast.success(`Created ${r.refNumber} — ${r.inserted} items received (skipped ${r.skipped})`);
      handleOpen(false);
      onCreated();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger render={<Button variant="outline" className="gap-1.5" />}>
        <Upload className="h-4 w-4" /> Import File
      </DialogTrigger>
      <DialogContent className="w-full max-w-3xl sm:max-w-3xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>Import Goods Receiving</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {/* Receipt header — applies to the whole file */}
          <FormSection icon={Truck} title="Receipt Details (applies to all rows)">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1 min-w-0">
                <Label>Source Type <span className="text-red-500">*</span></Label>
                <Select value={header.sourceType} onValueChange={(v) => setHeader((h) => ({ ...h, sourceType: v ?? 'Brand Owner' }))}>
                  <SelectTrigger className="w-full min-w-0">
                    <span className="flex flex-1 text-left truncate text-sm">{header.sourceType || 'Select…'}</span>
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {['Brand Owner', 'Vendor', 'Customer Return', 'RTV Replacement'].map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 min-w-0">
                <Label>Default Warehouse <span className="text-slate-400 font-normal">(for rows without warehouseCode)</span></Label>
                <Select value={header.warehouseId} onValueChange={(v) => setHeader((h) => ({ ...h, warehouseId: v ?? '' }))}>
                  <SelectTrigger className="w-full min-w-0">
                    <span className={cn('flex flex-1 text-left truncate text-sm', !selectedWarehouse && 'text-muted-foreground')}>
                      {selectedWarehouse ? selectedWarehouse.name : 'Select warehouse…'}
                    </span>
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 min-w-0">
                <Label>AWB <span className="text-slate-400 font-normal">(optional)</span></Label>
                <Input value={header.awbNumber} onChange={(e) => setHeader((h) => ({ ...h, awbNumber: e.target.value }))} placeholder="e.g. AWB-123456789" />
              </div>
              <div className="space-y-1 min-w-0">
                <Label>Invoice No <span className="text-slate-400 font-normal">(optional)</span></Label>
                <Input value={header.invoiceNumber} onChange={(e) => setHeader((h) => ({ ...h, invoiceNumber: e.target.value }))} placeholder="e.g. INV-2026-0001" />
              </div>
              <div className="space-y-1 min-w-0">
                <Label>RMA Reference No <span className="text-slate-400 font-normal">(optional)</span></Label>
                <Input value={header.sourceRef} onChange={(e) => setHeader((h) => ({ ...h, sourceRef: e.target.value }))} placeholder="e.g. RMA case no." />
              </div>
              <div className="space-y-1 min-w-0">
                <Label>Notes <span className="text-slate-400 font-normal">(optional)</span></Label>
                <Input value={header.notes} onChange={(e) => setHeader((h) => ({ ...h, notes: e.target.value }))} placeholder="Internal notes" />
              </div>
            </div>
          </FormSection>

          {/* File */}
          <FormSection icon={Package} title="Item File">
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-xs text-slate-500">Columns: productCode, serialNumber, batchNumber, quantity, condition, ownershipType, warehouseCode</p>
              <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-1.5 shrink-0">
                <FileDown className="h-4 w-4" /> Template
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
              <p className="text-sm font-medium text-slate-700">Drag &amp; drop a file, or click to browse</p>
              <p className="text-xs text-slate-400 mt-1">.xlsx or .csv (max 10MB)</p>
              {file && <p className="text-xs text-green-600 mt-2 font-medium">{file.name}</p>}
            </div>
          </FormSection>

          {/* Preview */}
          {preview && (
            <FormSection icon={CheckCircle2} title="Review Before Import">
              <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
                <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium">Total {preview.summary.total}</span>
                <span className="px-2 py-0.5 rounded-md bg-green-100 text-green-700 font-medium">✓ Valid {preview.summary.valid}</span>
                <span className="px-2 py-0.5 rounded-md bg-red-100 text-red-700 font-medium">✗ Issues {preview.summary.invalid}</span>
              </div>
              <div className="rounded-lg border border-slate-200 overflow-auto max-h-[320px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0">
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="text-left px-2 py-1.5 font-medium text-slate-600">#</th>
                      <th className="text-left px-2 py-1.5 font-medium text-slate-600">Status</th>
                      {preview.columns.map((c) => <th key={c} className="text-left px-2 py-1.5 font-medium text-slate-600">{c}</th>)}
                      <th className="text-left px-2 py-1.5 font-medium text-slate-600">Errors</th>
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
            disabled={busy || !preview || preview.summary.valid === 0}
            className="bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4 mr-1.5" />
            {busy ? 'Working…' : `Confirm Import ${preview?.summary.valid ?? 0} items →`}
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

  async function submit() {
    if (!form.productId) { toast.error('Please select a product'); return; }
    if (selectedProduct?.serialControlled && !form.serialNumber.trim()) {
      toast.error(`${selectedProduct.code} is serial-controlled — serial number is required`); return;
    }
    if (selectedProduct?.batchControlled && !form.batchNumber.trim()) {
      toast.error(`${selectedProduct.code} is batch-controlled — lot/batch number is required`); return;
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
        notes: combinedNotes || undefined,
        items: [{
          productId: form.productId,
          quantity: Number(form.quantity),
          condition: form.condition,
          warehouseId: form.warehouseId || undefined,
          serialNumber: form.serialNumber.trim() || undefined,
          batchNumber: form.batchNumber.trim() || undefined,
        }],
      });
      toast.success('Goods received — pending inspection');
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
        <PackagePlus className="h-4 w-4" /> Receive Goods
      </DialogTrigger>
      <DialogContent className="w-full max-w-2xl sm:max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>Goods Receiving</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {/* Source */}
          <FormSection icon={Truck} title="Source">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1 min-w-0">
                <Label>Source Type</Label>
                <Select value={form.sourceType} onValueChange={(v) => handleSourceTypeChange(v ?? 'Brand Owner')}>
                  <SelectTrigger className="w-full min-w-0">
                    <span className={cn('flex flex-1 text-left truncate text-sm', !form.sourceType && 'text-muted-foreground')}>
                      {form.sourceType || 'Select…'}
                    </span>
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {['Brand Owner', 'Vendor', 'Customer Return', 'RTV Replacement'].map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 min-w-0">
                <Label>PO / Reference No. <span className="text-slate-400 font-normal">(optional)</span></Label>
                <Input value={form.poNumber} onChange={(e) => setForm((f) => ({ ...f, poNumber: e.target.value }))} placeholder="e.g. PO-2026-001" />
              </div>

              {form.sourceType === 'Brand Owner' && (
                <div className="space-y-1 min-w-0">
                  <Label>Brand <span className="text-red-500">*</span>
                    <span className="ml-2 text-xs font-normal text-slate-400">— narrows Product list below</span>
                  </Label>
                  <Select value={form.brandId} onValueChange={handleBrandChange}>
                    <SelectTrigger className="w-full min-w-0">
                      <span className={cn('flex flex-1 text-left truncate text-sm', !form.brandId && 'text-muted-foreground')}>
                        {brands.find((b) => b.id === form.brandId)?.name || 'Select brand…'}
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
                  <Label>Vendor
                    <span className="ml-2 text-xs font-normal text-slate-400">— reference only, recorded in notes</span>
                  </Label>
                  <Select value={form.vendorId} onValueChange={(v) => setForm((f) => ({ ...f, vendorId: v ?? '' }))}>
                    <SelectTrigger className="w-full min-w-0">
                      <span className={cn('flex flex-1 text-left truncate text-sm', !form.vendorId && 'text-muted-foreground')}>
                        {vendors.find((v) => v.id === form.vendorId)?.name || 'Select vendor…'}
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
          <FormSection icon={Package} title="Product">
            <div className="space-y-1 min-w-0">
              <Label>Select Product <span className="text-red-500">*</span>
                <span className="ml-2 text-xs font-normal text-slate-400">— from Product Master only</span>
              </Label>
              <Select value={form.productId} onValueChange={handleProductChange} disabled={form.sourceType === 'Brand Owner' && !form.brandId}>
                <SelectTrigger className="w-full min-w-0">
                  <span className={cn('flex flex-1 text-left truncate text-sm', !selectedProduct && 'text-muted-foreground')}>
                    {selectedProduct ? `${selectedProduct.code} — ${selectedProduct.name}`
                      : form.sourceType === 'Brand Owner' && !form.brandId ? 'Select a brand first…'
                      : 'Search and select a product…'}
                  </span>
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {filteredProducts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.sourceType === 'Brand Owner' && form.brandId && filteredProducts.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">No products found for this brand in Product Master.</p>
              )}
            </div>
            {selectedProduct && (
              <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <ShieldCheck className="h-4 w-4 text-green-600 flex-shrink-0" />
                  <span className="text-xs font-semibold text-green-700 uppercase tracking-wide">Product Master Information</span>
                  <span className="ml-auto text-[10px] text-green-600 bg-green-100 px-2 py-0.5 rounded-full font-medium">Read-only</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2.5">
                  {[
                    { label: 'Product Code', value: selectedProduct.code, mono: true },
                    { label: 'Product Name', value: selectedProduct.name },
                    { label: 'Model', value: selectedProduct.model },
                    { label: 'Internal Part Number', value: selectedProduct.partNumber, mono: true },
                    { label: 'Category', value: selectedProduct.category },
                    { label: 'UOM', value: selectedProduct.unit },
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
                      <p className="text-[10px] uppercase tracking-wide text-green-600 font-semibold mb-0.5">Description</p>
                      <p className="text-sm text-slate-800 truncate">{selectedProduct.description}</p>
                    </div>
                  )}
                  <div className="col-span-2 md:col-span-3 flex gap-3 pt-0.5">
                    {[
                      { active: selectedProduct.serialControlled, term: 'Serial number' },
                      { active: selectedProduct.batchControlled,  term: 'Batch / lot number' },
                    ].map(({ active, term }) => (
                      <span key={term} className={cn(
                        'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium border',
                        active ? 'bg-green-100 text-green-700 border-green-300' : 'bg-slate-100 text-slate-400 border-slate-200',
                      )}>
                        <ShieldCheck className="h-3 w-3" />{term} {active ? 'required' : 'not required'}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </FormSection>

          {/* Receiving Details */}
          <FormSection icon={Info} title="Receiving Details">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1 min-w-0">
                <Label>Quantity <span className="text-red-500">*</span></Label>
                <Input type="number" min={1} value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1 min-w-0">
                <Label>Serial Number
                  {selectedProduct?.serialControlled ? <span className="text-red-500 ml-0.5">*</span> : <span className="text-slate-400 font-normal ml-1">(optional)</span>}
                </Label>
                <Input
                  value={form.serialNumber}
                  onChange={(e) => setForm((f) => ({ ...f, serialNumber: e.target.value }))}
                  placeholder={selectedProduct?.serialControlled ? 'Required for this product' : 'e.g. SN-001234'}
                  className={cn(selectedProduct?.serialControlled && !form.serialNumber && 'border-amber-400')}
                />
              </div>
              <div className="space-y-1 min-w-0">
                <Label>Lot / Batch Number
                  {selectedProduct?.batchControlled ? <span className="text-red-500 ml-0.5">*</span> : <span className="text-slate-400 font-normal ml-1">(optional)</span>}
                </Label>
                <Input
                  value={form.batchNumber}
                  onChange={(e) => setForm((f) => ({ ...f, batchNumber: e.target.value }))}
                  placeholder={selectedProduct?.batchControlled ? 'Required for this product' : 'e.g. LOT-2026-001'}
                  className={cn(selectedProduct?.batchControlled && !form.batchNumber && 'border-amber-400')}
                />
              </div>
            </div>
          </FormSection>

          {/* Destination */}
          <FormSection icon={MapPin} title="Destination">
            <div className="space-y-1 min-w-0">
              <Label>Warehouse</Label>
              <Select value={form.warehouseId} onValueChange={(v) => setForm((f) => ({ ...f, warehouseId: v ?? '' }))}>
                <SelectTrigger className="w-full min-w-0">
                  <span className={cn('flex flex-1 text-left truncate text-sm', !selectedWarehouse && 'text-muted-foreground')}>
                    {selectedWarehouse ? selectedWarehouse.name : 'Select warehouse…'}
                  </span>
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 min-w-0">
              <Label>Notes <span className="text-slate-400 font-normal">(optional)</span></Label>
              <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Internal notes for this receipt" />
            </div>
          </FormSection>

          {/* Reference Documents */}
          <FormSection icon={ClipboardList} title="Reference Documents">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1 min-w-0">
                <Label>AWB <span className="text-slate-400 font-normal">(optional)</span></Label>
                <Input value={form.awbNumber} onChange={(e) => setForm((f) => ({ ...f, awbNumber: e.target.value }))} placeholder="e.g. AWB-123456789" />
              </div>
              <div className="space-y-1 min-w-0">
                <Label>Invoice No <span className="text-slate-400 font-normal">(optional)</span></Label>
                <Input value={form.invoiceNumber} onChange={(e) => setForm((f) => ({ ...f, invoiceNumber: e.target.value }))} placeholder="e.g. INV-2026-0001" />
              </div>
              <div className="space-y-1 min-w-0">
                <Label>RMA Reference No <span className="text-slate-400 font-normal">(optional)</span></Label>
                <Input value={form.rmaReference} onChange={(e) => setForm((f) => ({ ...f, rmaReference: e.target.value }))} placeholder="e.g. RMA case no." />
              </div>
            </div>
          </FormSection>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!form.productId || busy} className="bg-green-600 hover:bg-green-700 text-white disabled:opacity-50">
            {busy ? 'Creating…' : 'Receive Goods →'}
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
      toast.success('Inspection submitted — stock routed');
      load();
    } catch (e: any) {
      toast.error(e.message ?? 'Inspection failed');
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
    return rows.filter((gr) => needsInspection(gr) && matchesQuery(gr, q));
  }, [rows, query]);

  const allRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((gr) => matchesQuery(gr, q));
  }, [rows, query]);

  const tabs: { key: Tab; label: string; count: number; dot?: string }[] = [
    { key: 'queue', label: 'Awaiting Inspection', count: stats.awaitingInspection, dot: stats.awaitingInspection > 0 ? 'bg-amber-400' : undefined },
    { key: 'all',   label: 'All Records',         count: rows.length },
  ];

  return (
    <div className="p-6 space-y-5">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-green-600" />
            Goods Receiving &amp; Verification
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Receive → Inspect → Verify → Inventory</p>
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
        <StatTile label="Received Today"       value={loading ? '—' : stats.receivedToday}       icon={PackagePlus}  tone="slate" />
        <StatTile label="Awaiting Inspection"  value={loading ? '—' : stats.awaitingInspection}  icon={Clock}        tone={stats.awaitingInspection > 0 ? 'amber' : 'slate'} />
        <StatTile label="Verified Good"        value={loading ? '—' : stats.verifiedGood}        icon={PackageCheck} tone="green" />
        <StatTile label="Flagged Issues"       value={loading ? '—' : stats.flaggedIssues}       icon={AlertTriangle} tone={stats.flaggedIssues > 0 ? 'red' : 'slate'} />
        <StatTile label="Pending Resolution"   value={loading ? '—' : stats.pendingResolution}   icon={TriangleAlert} tone={stats.pendingResolution > 0 ? 'amber' : 'slate'} />
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
            placeholder="Search GR no., source, PO…"
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
                  title="Inspection queue clear"
                  message={query ? 'No matching records await inspection.' : 'All received goods have been inspected.'}
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
                <th className="text-left px-4 py-3 font-medium text-slate-600">GR No.</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Source</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Items</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Outcomes</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading
                ? [...Array(5)].map((_, i) => (
                  <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>
                ))
                : allRows.length === 0
                ? (
                  <tr><td colSpan={6} className="px-0 py-0">
                    <EmptyState icon={FileX} title={rows.length === 0 ? 'No records' : 'No matches'} message={rows.length === 0 ? 'Create a goods receiving to begin.' : 'Try adjusting your search.'} />
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
                      <td className="px-4 py-3 text-slate-600">{gr.sourceType}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{gr.items?.length ?? 0} item{gr.items?.length !== 1 ? 's' : ''}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          {Object.entries(outcomes).map(([o, c]) => <OutcomeChip key={o} outcome={o} count={c as number} />)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ReceivingStatusBadge status={gr.statusEnum?.toLowerCase() ?? gr.status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">{formatDate(gr.receivedDate)}</td>
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
