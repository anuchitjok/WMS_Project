'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { requestsApi, warehouseApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import type { WithdrawalRequest, RequestStatus } from '@/types';
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
import { REQUEST_STATUS_COLORS, formatDate } from '@/lib/utils';
import { Plus, Trash2, User, Search, ChevronDown, AlertTriangle, Package, CheckCircle2, Eye, Send, X, Truck } from 'lucide-react';
import { toast } from 'sonner';

// ── Lifecycle timeline row ──────────────────────────────────────────────────────
function TimelineRow({ label, who, at, done, tone = 'slate' }: {
  label: string; who?: string; at?: string | null; done: boolean; tone?: 'slate' | 'green' | 'red';
}) {
  const dot = !done ? 'bg-slate-200' : tone === 'red' ? 'bg-red-500' : tone === 'green' ? 'bg-green-500' : 'bg-slate-400';
  return (
    <li className="flex items-start gap-3">
      <span className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${dot}`} />
      <div className="min-w-0">
        <p className={`text-sm ${done ? 'text-slate-800' : 'text-slate-400'}`}>{label}</p>
        {(who || at) && (
          <p className="text-xs text-slate-400">
            {who}{who && at ? ' · ' : ''}{at ? formatDate(at) : ''}
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

const STATUS_OPTIONS: { value: RequestStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All Statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'PENDING_APPROVAL', label: 'Pending Approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'COMPLETED', label: 'Completed' },
];

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
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-sm text-slate-400 text-center">No results found</li>
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
  const overQty = !!selectedProduct && item.quantity > selectedProduct.availableQty;
  const stockOk = !!selectedProduct && selectedProduct.availableQty > 0;

  return (
    <Card className="border-primary/20 shadow-none overflow-visible">
      <CardHeader className="border-b pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs font-semibold px-2.5 py-0.5">
              Item #{idx + 1}
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
              Brand <span className="text-red-500">*</span>
            </Label>
            <Select
              value={item.brandId}
              onValueChange={(v) => onUpdate({ brandId: v ?? '' })}
            >
              <SelectTrigger className="bg-background">
                <SelectValue>
                  {item.brandId
                    ? brands.find((b) => b.id === item.brandId)?.name
                    : <span className="text-muted-foreground">Select brand…</span>}
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
              SKU <span className="text-red-500">*</span>
            </Label>
            <SearchableDropdown
              placeholder={item.brandId ? 'Search SKU…' : 'Select brand first'}
              disabled={!item.brandId}
              value={item.productId}
              options={brandProducts.map((p) => ({
                value: p.id,
                label: `${p.code} — ${p.name}`,
                sublabel: `Avail: ${p.availableQty}`,
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
              Quantity <span className="text-red-500">*</span>
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
            <Label className="text-sm font-medium text-muted-foreground">Available Stock</Label>
            {selectedProduct ? (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm font-semibold ${
                stockOk
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : 'bg-red-50 border-red-200 text-red-600'
              }`}>
                {stockOk
                  ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                  : <AlertTriangle className="h-4 w-4 shrink-0" />}
                {selectedProduct.availableQty.toLocaleString()} Units
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
                <Package className="h-4 w-4" />
                Select SKU first
              </div>
            )}
          </div>
        </div>

        {/* Product Summary Panel */}
        {selectedProduct && (
          <div className="rounded-lg bg-muted/30 border border-border p-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Product Detail</p>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">SKU</p>
                <p className="font-mono font-semibold text-slate-800">{selectedProduct.code}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Available</p>
                <Badge
                  variant="secondary"
                  className={`text-xs mt-0.5 ${stockOk ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}
                >
                  {selectedProduct.availableQty} Units
                </Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Brand</p>
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
              Quantity exceeds available stock.
              Maximum allowed: <span className="font-bold">{selectedProduct!.availableQty}</span>
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

  const [data, setData] = useState<PaginatedResponse<WithdrawalRequest> | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>('ALL');
  const [page, setPage] = useState(1);

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
  const [items, setItems] = useState<ItemRow[]>([{ ...EMPTY_ITEM }]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await requestsApi.list({
        status: status !== 'ALL' ? status : undefined,
        page,
        limit: 20,
      });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [status, page]);

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
      toast.success('Request submitted for approval');
      setDetailOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to submit');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCancelReq(id: string) {
    setActionLoading('cancel');
    try {
      await requestsApi.cancel(id);
      toast.success('Request cancelled');
      setDetailOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to cancel');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSubmit() {
    if (!rmaCaseNumber.trim()) { toast.error('RMA Case Number is required'); return; }
    if (items.some((i) => !i.brandId)) { toast.error('Please select a Brand for all items'); return; }
    if (items.some((i) => !i.productId)) { toast.error('Please select an SKU for all items'); return; }
    if (items.some((i) => i.quantity < 1)) { toast.error('Quantity must be at least 1'); return; }
    for (const item of items) {
      const prod = getProduct(item.productId);
      if (prod && item.quantity > prod.availableQty) {
        toast.error(`${prod.code}: Quantity exceeds available stock (${prod.availableQty})`);
        return;
      }
    }

    setSubmitting(true);
    try {
      await requestsApi.create({
        rmaCaseNumber: rmaCaseNumber.trim(),
        remark: remark.trim() || undefined,
        items: items.map((i) => ({ productId: i.productId, quantity: Number(i.quantity) })),
      });
      toast.success('Request created successfully');
      setOpen(false);
      resetForm();
      load();
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to create request');
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
          <h1 className="text-2xl font-bold text-slate-900">Withdrawal Requests</h1>
          <p className="text-slate-500 text-sm mt-1">{data ? `${data.total} requests` : 'Loading…'}</p>
        </div>

        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger render={<Button className="bg-green-600 hover:bg-green-700 text-white" />}>
            <Plus className="h-4 w-4 mr-2" />New Request
          </DialogTrigger>

          {/* ── Modal ── */}
          {/* sm:max-w-4xl overrides the base-ui default sm:max-w-sm; gap-0 overrides default gap-4 */}
          <DialogContent className="w-full sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">

            {/* ── Fixed header ── */}
            <DialogHeader className="px-6 pt-5 pb-4 border-b shrink-0">
              <DialogTitle className="text-lg font-semibold">New Withdrawal Request</DialogTitle>
            </DialogHeader>

            {/* ── Pinned: Request Information (never scrolls away) ── */}
            <div className="shrink-0 px-6 py-4 border-b bg-muted/20">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Request Information
              </p>
              <div className="grid grid-cols-2 gap-4">
                {/* Created By */}
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-muted-foreground">Created By</Label>
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
                    RMA Case Number <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    placeholder="e.g. RMA-2026-0001"
                    value={rmaCaseNumber}
                    onChange={(e) => setRmaCaseNumber(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* ── Scrollable body ── */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

              {/* ── Requested Items ── */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-slate-800">
                    Requested Items
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      ({items.length} {items.length === 1 ? 'item' : 'items'})
                    </span>
                  </h3>
                  <Button type="button" variant="outline" size="sm" onClick={addItem} className="gap-1.5">
                    <Plus className="h-3.5 w-3.5" /> Add Item
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
                  <CardTitle className="text-base font-semibold">Remarks</CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-2">
                  <textarea
                    rows={5}
                    maxLength={500}
                    placeholder="Additional notes or reason for this request…"
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-input rounded-md bg-background resize-none focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500 transition-colors"
                  />
                  <p className="text-right text-xs text-muted-foreground">{remark.length} / 500</p>
                </CardContent>
              </Card>
            </div>

            {/* ── Sticky Footer (plain div — avoids DialogFooter's -mx-4 -mb-4 that assumes p-4 on dialog) ── */}
            <div className="shrink-0 flex justify-end gap-2 px-6 py-4 border-t bg-background">
              <Button
                variant="outline"
                onClick={() => { setOpen(false); resetForm(); }}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                className="bg-green-600 hover:bg-green-700 text-white min-w-[140px]"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? 'Creating…' : 'Create Request'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filter bar */}
      <div className="flex gap-3">
        <Select value={status} onValueChange={(v) => { setStatus(v ?? 'ALL'); setPage(1); }}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
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
                <p className="text-xs text-muted-foreground mt-0.5">{formatDate(detailReq.createdAt)}</p>
              </div>
              <Badge className={REQUEST_STATUS_COLORS[detailReq.status]} variant="outline">
                {detailReq.status.replace(/_/g, ' ')}
              </Badge>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Meta */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Created By</p>
                  <p className="font-medium">{detailReq.requester?.fullName ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">RMA Case Number</p>
                  <p className="font-mono font-semibold text-blue-700">{detailReq.rmaCaseNumber ?? '—'}</p>
                </div>
                {detailReq.notes && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground mb-1">Remark</p>
                    <p className="text-slate-700">{detailReq.notes}</p>
                  </div>
                )}
              </div>

              {/* Items */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Requested Items ({detailReq.items?.length ?? 0})
                </p>
                <div className="rounded-lg border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">SKU</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">Product</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-slate-500">Qty Requested</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-slate-500">Qty Approved</th>
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
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Progress</p>
                <ol className="space-y-2.5">
                  <TimelineRow done label="Created" who={detailReq.requester?.fullName} at={detailReq.createdAt} />
                  <TimelineRow done={detailReq.status !== 'DRAFT'} label="Submitted for approval" />
                  {detailReq.status === 'REJECTED'
                    ? <TimelineRow done label="Rejected" tone="red" who={detailReq.approver?.fullName} at={detailReq.approvedAt} />
                    : <TimelineRow done={!!detailReq.approvedAt} label="Approved" tone="green" who={detailReq.approver?.fullName} at={detailReq.approvedAt} />}
                  {detailReq.status !== 'REJECTED' && (
                    <TimelineRow
                      done={!!(detailReq as any).fulfillmentStatus || detailReq.status === 'COMPLETED'}
                      label={(detailReq as any).fulfillmentStatus
                        ? `Fulfillment · ${String((detailReq as any).fulfillmentStatus).replace(/_/g, ' ')}`
                        : 'Fulfillment (allocate → pick → pack → ship)'}
                    />
                  )}
                </ol>
              </div>

              {/* Next-step hint — tells the requester where the request goes after approval */}
              {detailReq.status === 'APPROVED' && (
                <div className="flex items-start gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 text-sm text-green-800">
                  <Truck className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Approved — the warehouse is now preparing your items. Track progress on the{' '}
                    <Link href="/outbound/fulfillment" className="font-semibold underline underline-offset-2">Fulfillment Board</Link>.
                  </span>
                </div>
              )}

              {/* Status hint */}
              {detailReq.status === 'DRAFT' && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  This request is still a Draft — click <strong className="mx-1">Submit for Approval</strong> to send it to the approver
                </div>
              )}
              {detailReq.rejectReason && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
                  <p className="font-semibold mb-0.5">Reject Reason</p>
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
                    {actionLoading === 'cancel' ? 'Cancelling…' : 'Cancel Request'}
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setDetailOpen(false)}>
                  Close
                </Button>
                {detailReq.status === 'DRAFT' && (
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    disabled={!!actionLoading}
                    onClick={() => handleSubmitReq(detailReq.id)}
                  >
                    <Send className="h-3.5 w-3.5 mr-1" />
                    {actionLoading === 'submit' ? 'Submitting…' : 'Submit for Approval'}
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="text-left px-4 py-3 font-medium text-slate-600">Ref #</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Created By</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">RMA Case</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Items</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Created</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              [...Array(6)].map((_, i) => (
                <tr key={i}>
                  {[...Array(7)].map((_, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>
                  ))}
                </tr>
              ))
            ) : data?.data.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-400">No requests found</td>
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
                    <Badge className={REQUEST_STATUS_COLORS[req.status]} variant="outline">
                      {req.status.replace(/_/g, ' ')}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{req.items?.length ?? 0}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{formatDate(req.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-slate-500 hover:text-slate-800"
                        onClick={() => openDetail(req)}
                      >
                        <Eye className="h-3.5 w-3.5 mr-1" /> View
                      </Button>
                      {req.status === 'DRAFT' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-green-600 hover:text-green-800 hover:bg-green-50"
                          onClick={() => handleSubmitReq(req.id)}
                          disabled={actionLoading === 'submit'}
                        >
                          <Send className="h-3.5 w-3.5 mr-1" /> Submit
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50">
            <p className="text-sm text-slate-500">Page {data.page} of {data.totalPages}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
