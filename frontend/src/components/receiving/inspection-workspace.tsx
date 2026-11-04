'use client';

import { useState, useMemo } from 'react';
import {
  CheckCircle2, XCircle, AlertTriangle, MinusCircle,
  RotateCcw, Package, ShieldCheck, ClipboardList, Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { labelOf, useT, type Messages } from '@/i18n';

type InspMsgs = Messages['receiving']['inspection'];
const IMPACT: Record<string, keyof InspMsgs> = {
  good: 'impactGood', doa: 'impactDoa', damaged: 'impactDamaged',
  short_qty: 'impactShort', wrong_item: 'impactWrong', missing_accessories: 'impactMissing',
};

// ─── Outcome config ──────────────────────────────────────────────────────────

type Outcome = 'good' | 'doa' | 'damaged' | 'short_qty' | 'wrong_item' | 'missing_accessories';

const OUTCOMES: {
  id: Outcome;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  border: string;
  activeColor: string;
  activeBorder: string;
  stockResult: string;
  severity: 'success' | 'error' | 'warning' | 'info';
}[] = [
  {
    id: 'good',
    icon: CheckCircle2,
    color: 'text-slate-600',
    border: 'border-slate-200 bg-white hover:border-green-400 hover:bg-green-50',
    activeColor: 'text-green-700',
    activeBorder: 'border-green-500 bg-green-50 ring-2 ring-green-200',
    stockResult: 'PENDING_INSPECTION',
    severity: 'success',
  },
  {
    id: 'doa',
    icon: XCircle,
    color: 'text-slate-600',
    border: 'border-slate-200 bg-white hover:border-red-400 hover:bg-red-50',
    activeColor: 'text-red-700',
    activeBorder: 'border-red-500 bg-red-50 ring-2 ring-red-200',
    stockResult: 'RTV_PENDING',
    severity: 'error',
  },
  {
    id: 'damaged',
    icon: AlertTriangle,
    color: 'text-slate-600',
    border: 'border-slate-200 bg-white hover:border-amber-400 hover:bg-amber-50',
    activeColor: 'text-amber-700',
    activeBorder: 'border-amber-500 bg-amber-50 ring-2 ring-amber-200',
    stockResult: 'QUARANTINE',
    severity: 'warning',
  },
  {
    id: 'short_qty',
    icon: MinusCircle,
    color: 'text-slate-600',
    border: 'border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50',
    activeColor: 'text-blue-700',
    activeBorder: 'border-blue-500 bg-blue-50 ring-2 ring-blue-200',
    stockResult: 'PENDING_INSPECTION',
    severity: 'info',
  },
  {
    id: 'wrong_item',
    icon: RotateCcw,
    color: 'text-slate-600',
    border: 'border-slate-200 bg-white hover:border-purple-400 hover:bg-purple-50',
    activeColor: 'text-purple-700',
    activeBorder: 'border-purple-500 bg-purple-50 ring-2 ring-purple-200',
    stockResult: 'QUARANTINE',
    severity: 'error',
  },
  {
    id: 'missing_accessories',
    icon: Package,
    color: 'text-slate-600',
    border: 'border-slate-200 bg-white hover:border-orange-400 hover:bg-orange-50',
    activeColor: 'text-orange-700',
    activeBorder: 'border-orange-500 bg-orange-50 ring-2 ring-orange-200',
    stockResult: 'QUARANTINE',
    severity: 'warning',
  },
];

// ─── Per-item inspection form state ─────────────────────────────────────────

interface ItemState {
  inspectedQty: number;
  outcome: Outcome | null;
  notes: string;
  serial: string;
  batch: string;
}

// ─── Impact preview ──────────────────────────────────────────────────────────

function ImpactPreview({ outcome, qty }: { outcome: Outcome; qty: number }) {
  const cfg = OUTCOMES.find((o) => o.id === outcome)!;
  const { m, t } = useT();
  const I = m.receiving.inspection;
  const Icon = cfg.icon;
  const colors = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error:   'bg-red-50   border-red-200   text-red-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
    info:    'bg-blue-50  border-blue-200  text-blue-800',
  }[cfg.severity];

  return (
    <div className={cn('rounded-lg border p-3 flex gap-3 items-start', colors)}>
      <Icon className="h-4 w-4 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide mb-0.5">{I.impact}</p>
        <p className="text-sm font-medium">{t(I[IMPACT[outcome]], { qty })}</p>
        <p className="text-xs mt-1 opacity-75">{I.stockStatusTo} <span className="font-mono font-semibold">{cfg.stockResult}</span>{outcome === 'short_qty' ? ` ${I.partial}` : ''}</p>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

interface InspectionWorkspaceProps {
  gr: any;
  onSubmit: (dto: {
    items: {
      itemId: string;
      inspectedQty: number;
      inspectionOutcome: string;
      inspectorNotes?: string;
      serialNumber?: string;
      batchNumber?: string;
    }[];
  }) => Promise<void>;
  onClose: () => void;
  busy: boolean;
}

export function InspectionWorkspace({ gr, onSubmit, onClose, busy }: InspectionWorkspaceProps) {
  const { m, t, fmt } = useT();
  const I = m.receiving.inspection;
  const F = m.receiving.form;
  const items: any[] = gr.items ?? [];

  // Per-item state keyed by GR item id
  const [states, setStates] = useState<Record<string, ItemState>>(() =>
    Object.fromEntries(
      items.map((it) => [
        it.id,
        {
          inspectedQty: Number(it.quantity ?? 1),
          outcome: null,
          notes: '',
          serial: it.serialNumber ?? '',
          batch: it.batchNumber ?? '',
        } satisfies ItemState,
      ]),
    ),
  );

  function update(itemId: string, patch: Partial<ItemState>) {
    setStates((s) => ({ ...s, [itemId]: { ...s[itemId], ...patch } }));
  }

  const allOutcomesSet = useMemo(
    () => items.every((it) => states[it.id]?.outcome !== null),
    [items, states],
  );

  async function handleSubmit() {
    if (!allOutcomesSet) return;
    await onSubmit({
      items: items.map((it) => {
        const s = states[it.id];
        return {
          itemId: it.id,
          inspectedQty: s.inspectedQty,
          inspectionOutcome: s.outcome!,
          inspectorNotes: s.notes || undefined,
          serialNumber: s.serial || undefined,
          batchNumber: s.batch || undefined,
        };
      }),
    });
  }

  return (
    <div className="border-t border-slate-200 bg-slate-50/40">
      {/* Workspace header */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 bg-white">
        <ClipboardList className="h-4 w-4 text-blue-600" />
        <span className="text-sm font-semibold text-slate-800">{I.workspace}</span>
        <span className="ml-1 text-xs text-slate-400">{t(I.toInspect, { count: items.length })}</span>
      </div>

      <div className="px-5 py-4 space-y-6">
        {items.map((item: any, idx: number) => {
          const s = states[item.id];
          if (!s) return null;
          const product = item.product;
          const isSerial = product?.serialControlled;
          const isBatch  = product?.batchControlled;

          return (
            <div key={item.id} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">

              {/* ── Product Master panel ── */}
              <div className="bg-green-50 border-b border-green-200 px-4 py-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-green-600" />
                  <span className="text-[10px] font-bold text-green-700 uppercase tracking-wide">{I.productMaster}</span>
                  {items.length > 1 && (
                    <span className="ml-auto text-[10px] text-green-600 font-medium">{t(I.itemOf, { n: idx + 1, total: items.length })}</span>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1.5">
                  <PF label={F.productCode} value={product?.code} mono />
                  <PF label={F.productName} value={product?.name} />
                  <PF label={F.model}   value={product?.model} />
                  <PF label={F.category} value={product?.category} />
                  <PF label={F.uom}     value={product?.unit} />
                  <PF label={I.internalPartNo} value={product?.partNumber} mono />
                  <div className="col-span-2 flex gap-2 pt-0.5">
                    <ControlBadge active={isSerial} label={isSerial ? I.serialReq : I.serialNotReq} />
                    <ControlBadge active={isBatch}  label={isBatch ? I.batchReq : I.batchNotReq} />
                  </div>
                </div>
              </div>

              {/* ── Quantity + fields row ── */}
              <div className="px-4 py-4 space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {/* Received qty — locked */}
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">{I.receivedQty} <span className="text-slate-300">{I.locked}</span></Label>
                    <div className="h-9 flex items-center px-3 rounded-lg bg-slate-100 border border-slate-200 text-sm font-medium text-slate-600 font-mono">
                      {fmt.number(Number(item.quantity))}
                    </div>
                  </div>

                  {/* Inspect qty — editable */}
                  <div className="space-y-1">
                    <Label className="text-xs">{I.inspectQty} <span className="text-red-500">*</span></Label>
                    <Input
                      type="number"
                      min={0}
                      max={Number(item.quantity) * 2}
                      value={s.inspectedQty}
                      onChange={(e) => update(item.id, { inspectedQty: Number(e.target.value) })}
                      className="h-9 font-mono"
                    />
                  </div>

                  {/* Serial */}
                  <div className="space-y-1">
                    <Label className="text-xs">
                      {I.serialNo} {isSerial
                        ? <span className="text-red-500">*</span>
                        : <span className="text-slate-300">{F.optional}</span>}
                    </Label>
                    <Input
                      value={s.serial}
                      onChange={(e) => update(item.id, { serial: e.target.value })}
                      placeholder={isSerial ? I.requiredShort : '—'}
                      className={cn('h-9 font-mono text-xs', isSerial && !s.serial && 'border-amber-400')}
                    />
                  </div>

                  {/* Batch */}
                  <div className="space-y-1">
                    <Label className="text-xs">
                      {I.lotBatch} {isBatch
                        ? <span className="text-red-500">*</span>
                        : <span className="text-slate-300">{F.optional}</span>}
                    </Label>
                    <Input
                      value={s.batch}
                      onChange={(e) => update(item.id, { batch: e.target.value })}
                      placeholder={isBatch ? I.requiredShort : '—'}
                      className={cn('h-9 font-mono text-xs', isBatch && !s.batch && 'border-amber-400')}
                    />
                  </div>
                </div>

                {/* Inspector notes */}
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">
                    <Info className="inline h-3 w-3 mr-1" />{I.notes} <span className="text-slate-300">{F.optional}</span>
                  </Label>
                  <Input
                    value={s.notes}
                    onChange={(e) => update(item.id, { notes: e.target.value })}
                    placeholder={I.notesPlaceholder}
                    className="h-9 text-sm"
                  />
                </div>

                {/* ── Outcome selector ── */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
                    {I.outcome} <span className="text-red-500 ml-0.5">*</span>
                  </Label>
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    {OUTCOMES.map((o) => {
                      const Icon = o.icon;
                      const active = s.outcome === o.id;
                      return (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => update(item.id, { outcome: o.id })}
                          className={cn(
                            'flex flex-col items-center gap-1 py-2.5 px-2 rounded-lg border text-xs font-medium transition-all cursor-pointer',
                            active ? cn(o.activeColor, o.activeBorder) : cn(o.color, o.border),
                          )}
                        >
                          <Icon className={cn('h-4 w-4', active ? o.activeColor : 'text-slate-400')} />
                          {labelOf(m.receiving.outcome, o.id)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ── Impact preview ── */}
                {s.outcome && (
                  <ImpactPreview outcome={s.outcome} qty={s.inspectedQty} />
                )}
              </div>
            </div>
          );
        })}

        {/* Footer */}
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
          >
            {m.common.actions.cancel}
          </button>
          <Button
            onClick={handleSubmit}
            disabled={!allOutcomesSet || busy}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2 disabled:opacity-50"
          >
            <ClipboardList className="h-4 w-4" />
            {busy ? I.submitting : I.submit}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Small presentational helpers ────────────────────────────────────────────

function PF({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] uppercase tracking-wide text-green-600 font-bold">{label}</p>
      <p className={cn('text-xs text-slate-800 truncate', mono && 'font-mono', !value && 'text-slate-300 italic')}>
        {value || '—'}
      </p>
    </div>
  );
}

function ControlBadge({ active, label }: { active?: boolean; label: string }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-semibold border',
      active
        ? 'bg-green-100 text-green-700 border-green-300'
        : 'bg-slate-100 text-slate-400 border-slate-200',
    )}>
      <ShieldCheck className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}
