'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { requestsApi, warehouseApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import type { WithdrawalRequest, RequestStage } from '@/types';
import type { PaginatedResponse } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import Link from 'next/link';
import { REQUEST_STAGE_COLORS, REQUEST_STAGE_LABELS, REQUEST_STATUS_COLORS } from '@/lib/utils';
import { labelOf, useT } from '@/i18n';
import { Plus, Trash2, User, Search, ChevronDown, AlertTriangle, Package, CheckCircle2, Eye, Send, X, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { requestsApiP4, DELIVERY_METHODS, type DeliveryMethod } from '@/lib/api-requests';
import { DeliveryMethodBadge } from '@/components/requests/delivery-method-badge';

// ── Lifecycle timeline row ──────────────────────────────────────────────────────
function TimelineRow({ label, who, at, done, tone = 'slate' }: {
  label: string; who?: string; at?: string | null; done: boolean; tone?: 'slate' | 'green' | 'red';
}) {
  const { fmt } = useT();
  const dot = !done ? 'bg-slate-200' : tone === 'red' ? 'bg-red-500' : tone === 'green' ? 'bg-green-500' : 'bg-slate-400';
  return (
    <li className="flex items-start gap-3">
      <span className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${dot}`} />
      <div className="min-w-0">
        <p className={`text-sm ${done ? 'text-slate-800' : 'text-slate-400'}`}>{label}</p>
        {(who || at) && (
          <p className="text-xs text-slate-400">
            {who}{who && at ? ' · ' : ''}{at ? fmt.dateTime(at) : ''}
          </p>
        )}
      </div>
    </li>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ProductAvailable {
  id: string;
  code: string;
  name: string;
  brand?: { id: string; name: string };
  availableQty: number;
}

interface Brand { id: string; name: string; }

interface ItemRow {
  brandId: string;
  productId: string;
  quantity: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

// Filter by the derived stage (request + its fulfillment task), the same value
// the badges show — so every request is reachable, including in-fulfillment ones.
const STAGE_VALUES: (RequestStage | 'ALL')[] = ['ALL', ...(Object.keys(REQUEST_STAGE_LABELS) as RequestStage[])];

/** Badge for a request: the derived stage when the API sent one, else the raw status. */
function RequestStageBadge({ req }: { req: WithdrawalRequest }) {
  const { m } = useT();
  if (req.stage) {
    return (
      <Badge className={REQUEST_STAGE_COLORS[req.stage]} variant="outline">
        {labelOf(m.status.stage, req.stage)}
      </Badge>
    );
  }
  return (
    <Badge className={REQUEST_STATUS_COLORS[req.status]} variant="outline">
      {labelOf(m.status.request, req.status)}
    </Badge>
  );
}

const EMPTY_ITEM: ItemRow = { brandId: '', productId: '', quantity: 1 };

// ── SearchableDropdown ────────────────────────────────────────────────────────

function SearchableDropdown({
  placeholder,
  value,
  options,
  renderOption,
  renderSelected,
  onSelect,
  disabled,
}: {
  placeholder: string;
  value: string;
  options: { value: string; label: string; sublabel?: string }[];
  renderOption?: (opt: { value: string; label: string; sublabel?: string }) => React.ReactNode;
  renderSelected?: () => React.ReactNode;
  onSelect: (val: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const { m } = useT();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = options.filter(
    (o) =>
      o.label.toLowerCase().includes(search.toLowerCase()) ||
      (o.sublabel ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative w-full">
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setOpen((v) => !v); setSearch(''); }}
        className="w-full flex items-center justify-between px-3 py-2 text-sm border border-input rounded-md bg-background hover:bg-accent/30 disabled:opacity-50 disabled:cursor-not-allowed text-left transition-colors"
      >
        <span className={selected ? 'text-foreground truncate' : 'text-muted-foreground'}>
          {renderSelected ? renderSelected() : selected?.label ?? placeholder}
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[240px] bg-white border border-slate-200 rounded-lg shadow-xl">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                autoFocus
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/20"
                placeholder={m.common.search.placeholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-sm text-slate-400 text-center">{m.common.states.noResults}</li>
            ) : (
              filtered.map((o) => (
                <li
                  key={o.value}
                  onClick={() => { onSelect(o.value); setOpen(false); }}
                  className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                    o.value === value
                      ? 'bg-green-50 text-green-700'
                      : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  {renderOption ? renderOption(o) : (
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{o.label}</span>
                      {o.sublabel && <span className="text-xs text-slate-400">{o.sublabel}</span>}
                    </div>
                  )}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Item Card ─────────────────────────────────────────────────────────────────

function ItemCard({
  idx,
  item,
  brands,
  brandProducts,
  selectedProduct,
  canRemove,
  onUpdate,
  onRemove,
}: {
  idx: number;
  item: ItemRow;
  brands: Brand[];
  brandProducts: ProductAvailable[];
  selectedProduct: ProductAvailable | undefined;
  canRemove: boolean;
  onUpdate: (patch: Partial<ItemRow>) => void;
  onRemove: () => void;
}) {
  const { m, t, fmt } = useT();
  const R = m.requests;
  const overQty = !!selectedProduct && item.quantity > selectedProduct.availableQty;
  const stockOk = !!selectedProduct && selectedProduct.availableQty > 0;

  return (
    <Card className="border-primary/20 shadow-none overflow-visible">
      <CardHeader className="border-b pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs font-semibold px-2.5 py-0.5">
              {t(R.itemNo, { n: idx + 1 })}
            </Badge>
          </div>
          {canRemove && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRemove}
              className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {/* Row 1: Brand | SKU */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Brand */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              {R.brand} <span className="text-red-500">*</span>
            </Label>
            <Select
              value={item.brandId}
              onValueChange={(v) => onUpdate({ brandId: v ?? '' })}
            >
              <SelectTrigger className="bg-background">
                <SelectValue>
                  {item.brandId
                    ? brands.find((b) => b.id === item.brandId)?.name
                    : <span className="text-muted-foreground">{R.selectBrand}</span>}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {brands.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* SKU */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              {R.sku} <span className="text-red-500">*</span>
            </Label>
            <SearchableDropdown
              placeholder={item.brandId ? R.searchSku : R.selectBrandFirst}
              disabled={!item.brandId}
              value={item.productId}
              options={brandProducts.map((p) => ({
                value: p.id,
                label: `${p.code} — ${p.name}`,
                sublabel: t(R.avail, { qty: p.availableQty }),
              }))}
              renderOption={(o) => {
                const prod = brandProducts.find((p) => p.id === o.value);
                const qty = prod?.availableQty ?? 0;
                return (
                  <div className="flex items-center justify-between gap-3 py-0.5">
                    <div className="flex flex-col min-w-0">
                      <span className="font-mono text-xs font-semibold text-slate-800 truncate">{prod?.code}</span>
                      <span className="text-xs text-slate-500 truncate">{prod?.name}</span>
                    </div>
                    <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      qty === 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'
                    }`}>
                      {qty}
                    </span>
                  </div>
                );
              }}
              renderSelected={() =>
                selectedProduct ? (
                  <span className="font-mono text-xs font-medium">
                    {selectedProduct.code} — {selectedProduct.name}
                  </span>
                ) : undefined
              }
              onSelect={(v) => onUpdate({ productId: v })}
            />
          </div>
        </div>

        {/* Row 2: Quantity | Available Stock */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Quantity */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              {R.quantity} <span className="text-red-500">*</span>
            </Label>
            <Input
              type="number"
              min={1}
              max={selectedProduct?.availableQty ?? undefined}
              value={item.quantity}
              onChange={(e) => onUpdate({ quantity: Number(e.target.value) })}
              className={overQty ? 'border-red-400 focus:border-red-500' : ''}
            />
          </div>

          {/* Available Stock display */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-muted-foreground">{R.availableStock}</Label>
            {selectedProduct ? (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm font-semibold ${
                stockOk
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : 'bg-red-50 border-red-200 text-red-600'
              }`}>
                {stockOk
                  ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                  : <AlertTriangle className="h-4 w-4 shrink-0" />}
                {t(R.unitsCount, { count: fmt.number(selectedProduct.availableQty) })}
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
                <Package className="h-4 w-4" />
                {R.selectSkuFirst}
              </div>
            )}
          </div>
        </div>

        {/* Product Summary Panel */}
        {selectedProduct && (
          <div className="rounded-lg bg-muted/30 border border-border p-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{R.productDetail}</p>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">{R.sku}</p>
                <p className="font-mono font-semibold text-slate-800">{selectedProduct.code}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{R.available}</p>
                <Badge
                  variant="secondary"
                  className={`text-xs mt-0.5 ${stockOk ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}
                >
                  {t(R.unitsCount, { count: fmt.number(selectedProduct.availableQty) })}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{R.brand}</p>
                <p className="text-slate-700 font-medium truncate">{selectedProduct.brand?.name ?? '—'}</p>
              </div>
            </div>
            <p className="text-slate-800 font-medium mt-2 text-sm">{selectedProduct.name}</p>
          </div>
        )}

        {/* Qty over-stock warning */}
        {overQty && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              {R.overQty}{' '}
              {R.maxAllowed} <span className="font-bold">{selectedProduct!.availableQty}</span>
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function RequestsPage() {
  const { user } = useAuthStore();
  const { m, t, fmt } = useT();
  const R = m.requests;

  const [data, setData] = useState<PaginatedResponse<WithdrawalRequest> | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  // P4 4.1: server-side search, debounced so typing does not fire a request per key.
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const next = searchInput.trim();
    if (next === q) return;
    const h = setTimeout(() => { setQ(next); setPage(1); }, 350);
    return () => clearTimeout(h);
  }, [searchInput, q]);

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Detail / action state
  const [detailReq, setDetailReq] = useState<WithdrawalRequest | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // 'submit' | 'cancel'

  const [brands, setBrands] = useState<Brand[]>([]);
  const [allProducts, setAllProducts] = useState<ProductAvailable[]>([]);

  const [rmaCaseNumber, setRmaCaseNumber] = useState('');
  const [remark, setRemark] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('COLLECT');
  const [items, setItems] = useState<ItemRow[]>([{ ...EMPTY_ITEM }]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await requestsApi.list({
        stage: status !== 'ALL' ? status : undefined,
        q: q || undefined,
        page,
        limit: 20,
      });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [status, page, q]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!open) return;
    // Reset scroll to top every time the dialog opens
    scrollRef.current?.scrollTo({ top: 0 });
    Promise.all([
      warehouseApi.brands().catch(() => []),
      requestsApi.productsAvailable().catch(() => []),
    ]).then(([b, prods]) => {
      setBrands(b as Brand[]);
      setAllProducts(prods as ProductAvailable[]);
    });
  }, [open]);

  function resetForm() {
    setRmaCaseNumber('');
    setRemark('');
    setDeliveryMethod('COLLECT');
    setItems([{ ...EMPTY_ITEM }]);
  }

  function addItem() {
    setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateItem(index: number, patch: Partial<ItemRow>) {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const next = { ...item, ...patch };
        if (patch.brandId !== undefined && patch.brandId !== item.brandId) {
          next.productId = '';
          next.quantity = 1;
        }
        return next;
      }),
    );
  }

  // Brands that actually have at least one active product (derived from allProducts)
  const brandsWithProducts = brands.filter((b) =>
    allProducts.some((p) => p.brand?.id === b.id),
  );

  function productsForBrand(brandId: string) {
    if (!brandId) return allProducts;
    return allProducts.filter((p) => p.brand?.id === brandId);
  }

  function getProduct(productId: string) {
    return allProducts.find((p) => p.id === productId);
  }

  function openDetail(req: WithdrawalRequest) {
    setDetailReq(req);
    setDetailOpen(true);
  }

  async function handleSubmitReq(id: string) {
    setActionLoading('submit');
    try {
      await requestsApi.submit(id);
      toast.success(R.toast.submitted);
      setDetailOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message || R.toast.submitFailed);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCancelReq(id: string) {
    setActionLoading('cancel');
    try {
      await requestsApi.cancel(id);
      toast.success(R.toast.cancelled);
      setDetailOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message || R.toast.cancelFailed);
    } finally {
      setActionLoading(null);
    }
  }

  // Phase 4: what still blocks Create Request (same checks as handleSubmit and the API).
  const missingForCreate = [
    !rmaCaseNumber.trim() && R.need.rma,
    items.some((i) => !i.brandId) && R.need.brand,
    items.some((i) => !i.productId) && R.need.sku,
    items.some((i) => !(Number(i.quantity) >= 1)) && R.need.qty,
  ].filter(Boolean) as string[];

  async function handleSubmit() {
    if (!rmaCaseNumber.trim()) { toast.error(R.toast.rmaRequired); return; }
    if (items.some((i) => !i.brandId)) { toast.error(R.toast.brandRequired); return; }
    if (items.some((i) => !i.productId)) { toast.error(R.toast.skuRequired); return; }
    if (items.some((i) => i.quantity < 1)) { toast.error(R.toast.qtyMin); return; }
    for (const item of items) {
      const prod = getProduct(item.productId);
      if (prod && item.quantity > prod.availableQty) {
        toast.error(t(R.toast.overStock, { code: prod.code, qty: prod.availableQty }));
        return;
      }
    }

    setSubmitting(true);
    try {
      await requestsApiP4.create({
        rmaCaseNumber: rmaCaseNumber.trim(),
        remark: remark.trim() || undefined,
        deliveryMethod,
        items: items.map((i) => ({ productId: i.productId, quantity: Number(i.quantity) })),
      });
      toast.success(R.toast.created);
      setOpen(false);
      resetForm();
      load();
    } catch (e: any) {
      toast.error(e.message || R.toast.createFailed);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{R.title}</h1>
          <p className="text-slate-500 text-sm mt-1">{data ? t(R.count, { count: fmt.number(data.total) }) : m.common.states.loading}</p>
        </div>

        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger render={<Button className="bg-green-600 hover:bg-green-700 text-white" />}>
            <Plus className="h-4 w-4 mr-2" />{R.newRequest}
          </DialogTrigger>

          {/* ── Modal ── */}
          {/* sm:max-w-4xl overrides the base-ui default sm:max-w-sm; gap-0 overrides default gap-4 */}
          <DialogContent className="w-full sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">

            {/* ── Fixed header ── */}
            <DialogHeader className="px-6 pt-5 pb-4 border-b shrink-0">
              <DialogTitle className="text-lg font-semibold">{R.newTitle}</DialogTitle>
            </DialogHeader>

            {/* ── Pinned: Request Information (never scrolls away) ── */}
            <div className="shrink-0 px-6 py-4 border-b bg-muted/20">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {R.requestInfo}
              </p>
              <div className="grid grid-cols-2 gap-4">
                {/* Created By */}
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-muted-foreground">{R.createdBy}</Label>
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-background border border-border rounded-md text-sm">
                    <User className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-medium text-slate-800 truncate">{user?.fullName ?? '—'}</span>
                    {user?.username && (
                      <span className="text-muted-foreground shrink-0">({user.username})</span>
                    )}
                  </div>
                </div>
                {/* RMA Case Number */}
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">
                    {R.rmaCase} <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    placeholder="RMA-2026-0001"
                    value={rmaCaseNumber}
                    onChange={(e) => setRmaCaseNumber(e.target.value)}
                  />
                </div>
                {/* P4 4.7: Delivery method — Collect (default) / Ship. No address fields yet (on hold). */}
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-sm font-medium">{R.deliveryMethod}</Label>
                  <div role="radiogroup" aria-label={R.deliveryMethod} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {DELIVERY_METHODS.map((dm) => {
                      const on = deliveryMethod === dm;
                      const Icon = dm === 'SHIP' ? Truck : Package;
                      return (
                        <button
                          key={dm}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setDeliveryMethod(dm)}
                          className={`flex items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                            on ? 'border-green-500 bg-green-50 ring-1 ring-green-500/30' : 'border-input bg-background hover:bg-slate-50'
                          }`}
                        >
                          <Icon className={`h-4 w-4 shrink-0 ${on ? 'text-green-600' : 'text-slate-400'}`} />
                          <span className="min-w-0">
                            <span className={`block font-medium ${on ? 'text-green-800' : 'text-slate-800'}`}>{R.delivery[dm]}</span>
                            <span className="block text-xs text-slate-500">{R.deliveryHint[dm]}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Scrollable body ── */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

              {/* ── Requested Items ── */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-slate-800">
                    {R.requestedItems}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      {t(R.itemCount, { count: items.length })}
                    </span>
                  </h3>
                  <Button type="button" variant="outline" size="sm" onClick={addItem} className="gap-1.5">
                    <Plus className="h-3.5 w-3.5" /> {R.addItem}
                  </Button>
                </div>

                <div className="space-y-4">
                  {items.map((item, idx) => (
                    <ItemCard
                      key={idx}
                      idx={idx}
                      item={item}
                      brands={brandsWithProducts}
                      brandProducts={productsForBrand(item.brandId)}
                      selectedProduct={getProduct(item.productId)}
                      canRemove={items.length > 1}
                      onUpdate={(patch) => updateItem(idx, patch)}
                      onRemove={() => removeItem(idx)}
                    />
                  ))}
                </div>
              </div>

              {/* ── Remarks ── */}
              <Card>
                <CardHeader className="border-b pb-3">
                  <CardTitle className="text-base font-semibold">{R.remarks}</CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-2">
                  <textarea
                    rows={5}
                    maxLength={500}
                    placeholder={R.remarksPlaceholder}
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-input rounded-md bg-background resize-none focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500 transition-colors"
                  />
                  <p className="text-right text-xs text-muted-foreground">{remark.length} / 500</p>
                </CardContent>
              </Card>
            </div>

            {/* ── Sticky Footer (plain div — avoids DialogFooter's -mx-4 -mb-4 that assumes p-4 on dialog) ── */}
            <div className="shrink-0 flex justify-end items-center gap-2 px-6 py-4 border-t bg-background">
              {missingForCreate.length > 0 && <p className="mr-auto text-xs text-amber-700">{t(R.stillNeeded, { list: missingForCreate.join(', ') })}</p>}
              <Button
                variant="outline"
                onClick={() => { setOpen(false); resetForm(); }}
                disabled={submitting}
              >
                {m.common.actions.cancel}
              </Button>
              <Button
                className="bg-green-600 hover:bg-green-700 text-white min-w-[140px]"
                onClick={handleSubmit}
                disabled={submitting || missingForCreate.length > 0}
              >
                {submitting ? R.creating : R.create}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={R.searchPlaceholder}
            aria-label={R.searchPlaceholder}
            className="pl-8"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              aria-label={m.common.actions.clear}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v ?? 'ALL'); setPage(1); }}>
          <SelectTrigger className="w-52">
            <SelectValue>{status === 'ALL' ? R.allStatuses : labelOf(m.status.stage, status)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STAGE_VALUES.map((v) => <SelectItem key={v} value={v}>{v === 'ALL' ? R.allStatuses : labelOf(m.status.stage, v)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Detail Dialog */}
      {detailReq && (
        <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
          <DialogContent className="w-full sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
            <DialogHeader className="px-6 pt-5 pb-4 border-b shrink-0 flex-row items-start justify-between">
              <div>
                <DialogTitle className="text-base font-semibold font-mono text-green-700">
                  {detailReq.refNumber}
                </DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">{fmt.dateTime(detailReq.createdAt)}</p>
              </div>
              <RequestStageBadge req={detailReq} />
            </DialogHeader>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Meta */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{R.createdBy}</p>
                  <p className="font-medium">{detailReq.requester?.fullName ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{R.rmaCase}</p>
                  <p className="font-mono font-semibold text-blue-700">{detailReq.rmaCaseNumber ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{R.deliveryMethod}</p>
                  <DeliveryMethodBadge value={(detailReq as any).deliveryMethod} />
                </div>
                {detailReq.notes && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground mb-1">{R.remark}</p>
                    <p className="text-slate-700">{detailReq.notes}</p>
                  </div>
                )}
              </div>

              {/* Items */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {t(R.detailItems, { count: detailReq.items?.length ?? 0 })}
                </p>
                <div className="rounded-lg border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">{R.sku}</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">{R.product}</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-slate-500">{R.qtyRequested}</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-slate-500">{R.qtyApproved}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detailReq.items?.map((item: any) => (
                        <tr key={item.id}>
                          <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-700">
                            {item.product?.code ?? '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{item.product?.name ?? '—'}</td>
                          <td className="px-3 py-2 text-right font-medium">{item.quantityRequested}</td>
                          <td className="px-3 py-2 text-right text-slate-400">
                            {item.quantityApproved ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Progress timeline — real milestones the requester can trust */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{R.progress}</p>
                <ol className="space-y-2.5">
                  <TimelineRow done label={R.tl.created} who={detailReq.requester?.fullName} at={detailReq.createdAt} />
                  <TimelineRow done={detailReq.status !== 'DRAFT'} label={R.tl.submitted} />
                  {detailReq.status === 'REJECTED'
                    ? <TimelineRow done label={R.tl.rejected} tone="red" who={detailReq.approver?.fullName} at={detailReq.approvedAt} />
                    : <TimelineRow done={!!detailReq.approvedAt} label={R.tl.approved} tone="green" who={detailReq.approver?.fullName} at={detailReq.approvedAt} />}
                  {detailReq.status !== 'REJECTED' && (
                    <TimelineRow
                      done={!!(detailReq as any).fulfillmentStatus || detailReq.status === 'COMPLETED'}
                      label={(detailReq as any).fulfillmentStatus
                        ? t(R.tl.fulfillmentAt, { status: labelOf(m.status.fulfillment, String((detailReq as any).fulfillmentStatus)) })
                        : R.tl.fulfillment}
                    />
                  )}
                </ol>
              </div>

              {/* Next-step hint — tells the requester where the request goes after approval */}
              {detailReq.status === 'APPROVED' && (
                <div className="flex items-start gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 text-sm text-green-800">
                  <Truck className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    {R.approvedHint}{' '}
                    <Link href="/outbound/fulfillment" className="font-semibold underline underline-offset-2">{R.fulfillmentBoard}</Link>.
                  </span>
                </div>
              )}

              {/* Status hint */}
              {detailReq.status === 'DRAFT' && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{R.draftHint} <strong className="mx-1">{R.submitForApproval}</strong> {R.draftHint2}</span>
                </div>
              )}
              {detailReq.rejectReason && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
                  <p className="font-semibold mb-0.5">{R.rejectReason}</p>
                  <p>{detailReq.rejectReason}</p>
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div className="shrink-0 flex items-center justify-between gap-2 px-6 py-4 border-t bg-background">
              <div className="flex gap-2">
                {(detailReq.status === 'DRAFT' || detailReq.status === 'SUBMITTED') && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-600 border-red-200 hover:bg-red-50"
                    disabled={!!actionLoading}
                    onClick={() => handleCancelReq(detailReq.id)}
                  >
                    <X className="h-3.5 w-3.5 mr-1" />
                    {actionLoading === 'cancel' ? R.cancelling : R.cancelRequest}
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setDetailOpen(false)}>
                  {m.common.actions.close}
                </Button>
                {detailReq.status === 'DRAFT' && (
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    disabled={!!actionLoading}
                    onClick={() => handleSubmitReq(detailReq.id)}
                  >
                    <Send className="h-3.5 w-3.5 mr-1" />
                    {actionLoading === 'submit' ? R.submitting : R.submitForApproval}
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="text-left px-4 py-3 font-medium text-slate-600">{R.table.ref}</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">{R.table.createdBy}</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">{R.table.rmaCase}</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">{R.deliveryCol}</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">{R.table.status}</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">{R.table.items}</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">{R.table.created}</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">{R.table.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              [...Array(6)].map((_, i) => (
                <tr key={i}>
                  {[...Array(8)].map((_, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>
                  ))}
                </tr>
              ))
            ) : data?.data.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-slate-400">{R.empty}</td>
              </tr>
            ) : (
              data?.data.map((req) => (
                <tr key={req.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-green-700">{req.refNumber}</td>
                  <td className="px-4 py-3 text-slate-800">{req.requester?.fullName ?? '—'}</td>
                  <td className="px-4 py-3 text-xs font-mono text-slate-500">
                    {req.rmaCaseNumber ? (
                      <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded font-medium">
                        {req.rmaCaseNumber}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <DeliveryMethodBadge value={(req as any).deliveryMethod} />
                  </td>
                  <td className="px-4 py-3">
                    <RequestStageBadge req={req} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{req.items?.length ?? 0}</td>
                  <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{fmt.dateTime(req.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-slate-500 hover:text-slate-800"
                        onClick={() => openDetail(req)}
                      >
                        <Eye className="h-3.5 w-3.5 mr-1" /> {R.view}
                      </Button>
                      {req.status === 'DRAFT' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-green-600 hover:text-green-800 hover:bg-green-50"
                          onClick={() => handleSubmitReq(req.id)}
                          disabled={actionLoading === 'submit'}
                        >
                          <Send className="h-3.5 w-3.5 mr-1" /> {R.submit}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50">
            <p className="text-sm text-slate-500">{t(m.common.pagination.pageOf, { page: data.page, pages: data.totalPages })}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>{m.common.actions.previous}</Button>
              <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>{m.common.actions.next}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
