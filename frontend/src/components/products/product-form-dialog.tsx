'use client';

// Product create / edit form (plan 2.1 group A + read-only group B; other fields
// in a collapsible "Additional information" section). The form has Description
// only — the API stores it as the name for new products; existing names stay.
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { masterDataApi, productsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DiscardChangesDialog } from '@/components/ui/discard-changes-dialog';
import { useDiscardGuard } from '@/hooks/use-discard-guard';
import { cn, hasUnsavedChanges } from '@/lib/utils';
import { getT, labelOf, useT } from '@/i18n';
import { BrandQuickAdd } from './brand-quick-add';

export const PRODUCT_TYPES = ['SPARE_PART', 'FINISHED_GOODS'];
export const PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE', 'DISCONTINUED'];

// A select popup is sized to its trigger by default; these options are sentences.
const SELECT_POPUP_FITS_CONTENT = 'w-auto min-w-(--anchor-width) max-w-(--available-width)';

type Form = {
  partNumber: string; description: string; brandId: string; model: string;
  productStatus: string; productType: string; partType: string; unitCost: string; defaultPrice: string;
  unit: string; category: string; manufacturer: string; vendorPartNumber: string; minStock: string;
  serialControlled: boolean; batchControlled: boolean; lengthCm: string; widthCm: string; heightCm: string;
};

const BLANK: Form = {
  partNumber: '', description: '', brandId: '', model: '',
  productStatus: 'ACTIVE', productType: 'SPARE_PART', partType: '', unitCost: '0', defaultPrice: '',
  unit: 'unit', category: '', manufacturer: '', vendorPartNumber: '', minStock: '0',
  serialControlled: false, batchControlled: false, lengthCm: '', widthCm: '', heightCm: '',
};

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function fromProduct(p: any): Form {
  return {
    partNumber: str(p.partNumber), description: str(p.description), brandId: str(p.brandId ?? p.brand?.id), model: str(p.model),
    productStatus: p.productStatus ?? 'ACTIVE', productType: p.productType ?? 'SPARE_PART', partType: str(p.partType),
    unitCost: str(p.unitCost ?? 0), defaultPrice: str(p.defaultPrice), unit: p.unit ?? 'unit', category: str(p.category),
    manufacturer: str(p.manufacturer), vendorPartNumber: str(p.vendorPartNumber), minStock: str(p.minStock ?? 0),
    serialControlled: !!p.serialControlled, batchControlled: !!p.batchControlled,
    lengthCm: str(p.lengthCm), widthCm: str(p.widthCm), heightCm: str(p.heightCm),
  };
}

const optNum = (v: string) => (v.trim() === '' ? null : Number(v));

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-snug text-slate-500">{children}</p>;
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <button type="button" role="switch" aria-checked={on} onClick={onClick}
        className={cn('relative inline-flex h-6 w-11 items-center rounded-full transition-colors', on ? 'bg-green-600' : 'bg-slate-300')}>
        <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform', on ? 'translate-x-6' : 'translate-x-1')} />
      </button>
      <span className="text-sm text-slate-600">{label}</span>
    </div>
  );
}

export function ProductFormDialog({ open, product, brands, onBrandCreated, onClose, onSaved }: {
  open: boolean;
  /** Product being edited (list row or detail), or null for a new product. */
  product: any | null;
  brands: { id: string; code?: string; name: string }[];
  onBrandCreated: (brand: any) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { m, t, fmt } = useT();
  const P = m.products;
  const F = P.form;
  const editId: string | null = product?.id ?? null;
  const [form, setForm] = useState<Form>(BLANK);
  const [baseline, setBaseline] = useState<Form>(BLANK);
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uoms, setUoms] = useState<{ code: string; name: string }[] | null>(null);

  useEffect(() => { masterDataApi.uoms().then(setUoms).catch(() => setUoms([])); }, []);
  useEffect(() => {
    if (!open) return;
    const f = product ? fromProduct(product) : BLANK;
    setForm(f); setBaseline(f); setMoreOpen(false);
  }, [open, product]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const onText = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value as any);

  const unitOk = !!form.unit.trim() && (!uoms?.length || uoms.some((u) => u.code === form.unit) || (!!editId && form.unit === baseline.unit));
  const missing = [
    !editId && !form.partNumber.trim() && F.sku,
    !form.description.trim() && !(editId && product?.name) && F.description,
    !unitOk && F.uom,
  ].filter(Boolean) as string[];
  // The unit lives in the collapsed section — open it when it needs attention.
  useEffect(() => { if (open && uoms && !unitOk) setMoreOpen(true); }, [open, uoms, unitOk]);

  const guard = useDiscardGuard(hasUnsavedChanges(form, baseline), onClose);

  async function submit() {
    setBusy(true);
    try {
      const payload: Record<string, any> = {
        partNumber: form.partNumber.trim(), description: form.description.trim(), brandId: form.brandId || undefined,
        model: form.model, productStatus: form.productStatus, productType: form.productType, partType: form.partType,
        unitCost: Number(form.unitCost) || 0, defaultPrice: optNum(form.defaultPrice),
        unit: form.unit, category: form.category, manufacturer: form.manufacturer, vendorPartNumber: form.vendorPartNumber,
        minStock: Math.trunc(Number(form.minStock) || 0),
        serialControlled: form.serialControlled, batchControlled: form.batchControlled,
        lengthCm: optNum(form.lengthCm), widthCm: optNum(form.widthCm), heightCm: optNum(form.heightCm),
      };
      const { m: mm } = getT();
      if (editId) {
        // An unchanged legacy unit is not re-sent, so it is not re-validated against Lists & Codes.
        if (payload.unit === baseline.unit) delete payload.unit;
        if (!payload.description) delete payload.description;
        await productsApi.update(editId, payload);
        toast.success(mm.products.toast.updated);
      } else {
        await productsApi.create(payload);
        toast.success(mm.products.toast.created);
      }
      onSaved();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  const numInput = (k: keyof Form, extra?: string) => (
    <Input type="number" min={0} inputMode="decimal" value={form[k] as string} onChange={onText(k)} className={extra} />
  );

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) guard.requestClose(); }}>
        <DialogContent className="w-full sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
          <DialogHeader className="shrink-0 px-6 pt-5 pb-4 border-b">
            <DialogTitle>{editId ? F.editTitle : F.newTitle}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-6">
            {/* A — item information (Acumatica Stock Item order) */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{F.groupItem}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-4">
                <div className="space-y-1">
                  <Label htmlFor="pf-sku">{F.sku}{!editId && ' *'}</Label>
                  <Input id="pf-sku" value={form.partNumber} onChange={onText('partNumber')} placeholder={editId ? product?.code : undefined} />
                  <Hint>{editId ? F.skuEditHint : F.skuHint}</Hint>
                  {editId && product?.code && <Hint>{t(F.internalCode, { code: product.code })}</Hint>}
                </div>
                <div className="space-y-1 md:row-span-2">
                  <Label htmlFor="pf-desc">{F.description} *</Label>
                  <Textarea id="pf-desc" value={form.description} onChange={onText('description')} rows={3} className="resize-y" />
                  <Hint>{F.descriptionHint}</Hint>
                  {editId && product?.name && product.name !== form.description && <Hint>{t(F.legacyName, { name: product.name })}</Hint>}
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <Label>{F.brand}</Label>
                  </div>
                  <Select
                    items={brands.map((b) => ({ value: b.id, label: b.name }))}
                    value={form.brandId}
                    onValueChange={(v) => set('brandId', (v as string) ?? '')}
                  >
                    <SelectTrigger><SelectValue placeholder={F.brandPlaceholder} /></SelectTrigger>
                    <SelectContent align="start" className={`max-h-56 ${SELECT_POPUP_FITS_CONTENT}`}>
                      {brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <BrandQuickAdd onCreated={(b) => { onBrandCreated(b); set('brandId', b.id); }} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pf-model">{F.model}</Label>
                  <Input id="pf-model" value={form.model} onChange={onText('model')} />
                  <Hint>{F.modelHint}</Hint>
                </div>
                <div className="space-y-1">
                  <Label>{F.status}</Label>
                  <Select value={form.productStatus} onValueChange={(v) => set('productStatus', (v as string) ?? 'ACTIVE')}>
                    <SelectTrigger>
                      <span className="flex flex-1 text-left text-sm">{labelOf(P.status, form.productStatus) || F.statusPlaceholder}</span>
                    </SelectTrigger>
                    <SelectContent align="start" className={SELECT_POPUP_FITS_CONTENT}>
                      {PRODUCT_STATUSES.filter((s) => editId || s !== 'DISCONTINUED').map((s) => (
                        <SelectItem key={s} value={s}>{labelOf(P.statusHelp, s)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Hint>{F.statusHint}</Hint>
                </div>
                <div className="space-y-1">
                  <Label>{F.type}</Label>
                  <Select value={form.productType} onValueChange={(v) => set('productType', (v as string) ?? 'SPARE_PART')}>
                    <SelectTrigger><span className="flex flex-1 text-left text-sm">{labelOf(P.type, form.productType)}</span></SelectTrigger>
                    <SelectContent align="start" className={SELECT_POPUP_FITS_CONTENT}>
                      {PRODUCT_TYPES.map((x) => <SelectItem key={x} value={x}>{labelOf(P.type, x)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pf-parttype">{F.partType}</Label>
                  <Input id="pf-parttype" value={form.partType} onChange={onText('partType')} />
                  <Hint>{F.partTypeHint}</Hint>
                </div>
                <div className="space-y-1">
                  <Label>{F.cost}</Label>
                  {numInput('unitCost')}
                  <Hint>{F.costHint}</Hint>
                </div>
                <div className="space-y-1">
                  <Label>{F.price}</Label>
                  {numInput('defaultPrice')}
                </div>
              </div>
            </section>

            {/* B — system information, read only */}
            {editId && (
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{F.groupSystem}</h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { l: F.createdBy, v: product?.createdByName || '—' },
                    { l: F.createdOn, v: fmt.dateTime(product?.createdAt) },
                    { l: F.modifiedBy, v: product?.updatedByName || '—' },
                    { l: F.modifiedOn, v: fmt.dateTime(product?.updatedAt) },
                  ].map(({ l, v }) => (
                    <div key={l} className="rounded-lg bg-slate-50 px-3 py-2">
                      <dt className="text-xs text-slate-500">{l}</dt>
                      <dd className="text-sm font-medium text-slate-800">{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {/* Additional information (collapsible) */}
            <section className="rounded-xl border border-slate-200">
              <button type="button" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen}
                className="flex w-full items-center gap-2 px-4 py-3 text-left">
                {moreOpen ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                <span className="text-sm font-semibold text-slate-700">{F.groupMore}</span>
                <span className="text-xs text-slate-500 hidden sm:inline">· {F.groupMoreHint}</span>
              </button>
              {moreOpen && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-4 px-4 pb-4">
                  <div className="space-y-1">
                    <Label htmlFor="pf-uom">{F.uom} *</Label>
                    {uoms && uoms.length > 0 ? (
                      <select id="pf-uom" value={editId || uoms.some((u) => u.code === form.unit) ? form.unit : ''} onChange={(e) => set('unit', e.target.value)}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 focus:border-green-500 focus:outline-none">
                        <option value="" disabled>{F.uomSelect}</option>
                        {editId && form.unit && !uoms.some((u) => u.code === form.unit) && <option value={form.unit}>{t(F.uomNotListed, { unit: form.unit })}</option>}
                        {uoms.map((u) => <option key={u.code} value={u.code}>{u.code} — {u.name}</option>)}
                      </select>
                    ) : (
                      <Input id="pf-uom" value={form.unit} onChange={onText('unit')} placeholder={F.uomPlaceholder} />
                    )}
                    <Hint>{F.uomHint}</Hint>
                  </div>
                  <div className="space-y-1"><Label htmlFor="pf-cat">{F.category}</Label><Input id="pf-cat" value={form.category} onChange={onText('category')} /></div>
                  <div className="space-y-1"><Label htmlFor="pf-mfr">{F.manufacturer}</Label><Input id="pf-mfr" value={form.manufacturer} onChange={onText('manufacturer')} /><Hint>{F.manufacturerHint}</Hint></div>
                  <div className="space-y-1"><Label htmlFor="pf-vpn">{F.vendorPart}</Label><Input id="pf-vpn" value={form.vendorPartNumber} onChange={onText('vendorPartNumber')} /><Hint>{F.vendorPartHint}</Hint></div>
                  <div className="space-y-1"><Label>{F.minStock}</Label>{numInput('minStock')}<Hint>{F.minStockHint}</Hint></div>
                  <div className="space-y-1">
                    <Label>{F.boxSize}</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['lengthCm', 'widthCm', 'heightCm'] as const).map((k, i) => (
                        <div key={k} className="space-y-0.5">
                          {numInput(k)}
                          <p className="text-xs text-slate-500 text-center">{[F.length, F.width, F.height][i]}</p>
                        </div>
                      ))}
                    </div>
                    <Hint>{F.boxSizeHint}</Hint>
                  </div>
                  <div className="space-y-1">
                    <Label>{F.serial}</Label>
                    <Toggle on={form.serialControlled} onClick={() => set('serialControlled', !form.serialControlled)} label={form.serialControlled ? F.required : F.notRequired} />
                    <Hint>{F.serialHint}</Hint>
                  </div>
                  <div className="space-y-1">
                    <Label>{F.batch}</Label>
                    <Toggle on={form.batchControlled} onClick={() => set('batchControlled', !form.batchControlled)} label={form.batchControlled ? F.required : F.notRequired} />
                    <Hint>{F.batchHint}</Hint>
                  </div>
                </div>
              )}
            </section>
          </div>
          <div className="shrink-0 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 px-6 py-4 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={guard.requestClose}>{m.common.actions.cancel}</Button>
            {missing.length > 0 && <p className="text-xs text-amber-700 sm:mr-auto self-center">{t(F.missing, { fields: missing.join(', ') })}</p>}
            <Button onClick={submit} className="bg-green-600 hover:bg-green-700 text-white" disabled={busy || missing.length > 0}>
              {busy ? m.common.actions.saving : editId ? m.common.actions.save : F.create}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <DiscardChangesDialog open={guard.confirming} onKeepEditing={guard.keepEditing} onDiscard={guard.confirmDiscard} />
    </>
  );
}
