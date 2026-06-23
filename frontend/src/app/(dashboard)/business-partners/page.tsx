'use client';

import { useEffect, useState, useCallback } from 'react';
import { Building2, Tag, Truck, Plus, Pencil, Power, Boxes } from 'lucide-react';
import { toast } from 'sonner';
import { warehouseApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type Tab = 'brands' | 'vendors' | 'rollup';

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'brands',  label: 'Brand Master',       icon: Tag },
  { id: 'vendors', label: 'Vendor Master',      icon: Truck },
  { id: 'rollup',  label: 'Inventory by Brand', icon: Boxes },
];

export default function BusinessPartnersPage() {
  const [tab, setTab] = useState<Tab>('brands');

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Business Partners" subtitle="Master Data — Brands, Vendors and per-brand inventory" icon={Building2} />

      <div className="flex gap-2 border-b border-slate-200">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn('flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px',
              tab === id ? 'border-green-600 text-green-600' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {tab === 'brands' && <BrandTab />}
      {tab === 'vendors' && <VendorTab />}
      {tab === 'rollup' && <RollupTab />}
    </div>
  );
}

// ─── Brand Master ──────────────────────────────────────────────────────────────

function BrandTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [form, setForm] = useState({ name: '', contact: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await warehouseApi.brandsManaged()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    try {
      // Code is auto-generated server-side (BR-####) — not entered by the user.
      await warehouseApi.createBrand({ name: form.name, contact: form.contact || undefined });
      toast.success('Brand created'); setCreateOpen(false); setForm({ name: '', contact: '' }); load();
    } catch (e: any) { toast.error(e.message); }
  }
  async function save() {
    try {
      await warehouseApi.updateBrand(edit.id, { name: edit.name, contact: edit.contact ?? '' });
      toast.success('Brand updated'); setEdit(null); load();
    } catch (e: any) { toast.error(e.message); }
  }
  async function toggle(b: any) {
    try { await warehouseApi.updateBrand(b.id, { isActive: !b.isActive }); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button className="bg-green-600 hover:bg-green-700 text-white gap-1.5" />}><Plus className="h-4 w-4" /> Create Brand</DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create New Brand</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label>Code</Label><Input value="Auto-generated (BR-####)" disabled className="text-slate-400 bg-slate-50" /></div>
              <div className="space-y-1"><Label>Name <span className="text-red-500">*</span></Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Dell Technologies" /></div>
              <div className="space-y-1"><Label>Contact <span className="text-slate-400 font-normal">(optional)</span></Label><Input value={form.contact} onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))} placeholder="e.g. sales@dell.com" /></div>
            </div>
            <DialogFooter><Button onClick={create} disabled={!form.name.trim()} className="bg-green-600 hover:bg-green-700 text-white">Create</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">Code</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Contact</th>
            <th className="text-center px-4 py-3 font-medium text-slate-600">Products</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No brands yet</td></tr>
              : rows.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-bold text-green-700">{b.code}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{b.name}</td>
                  <td className="px-4 py-3 text-slate-500">{b.contact || '—'}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-slate-600">{b._count?.products ?? 0}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className={b.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}>{b.isActive ? 'Active' : 'Inactive'}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0" title="Edit" onClick={() => setEdit({ ...b })}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0" title={b.isActive ? 'Deactivate' : 'Activate'} onClick={() => toggle(b)}><Power className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Brand: {edit?.code}</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div className="space-y-1"><Label>Name</Label><Input value={edit.name} onChange={(e) => setEdit((b: any) => ({ ...b, name: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Contact</Label><Input value={edit.contact ?? ''} onChange={(e) => setEdit((b: any) => ({ ...b, contact: e.target.value }))} /></div>
            </div>
          )}
          <DialogFooter><Button onClick={save} className="bg-green-600 hover:bg-green-700 text-white">Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Vendor Master ─────────────────────────────────────────────────────────────

function VendorTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [form, setForm] = useState({ code: '', name: '', contact: '', email: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await warehouseApi.vendorsManaged()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    try {
      await warehouseApi.createVendor({ code: form.code, name: form.name, contact: form.contact || undefined, email: form.email || undefined });
      toast.success('Vendor created'); setCreateOpen(false); setForm({ code: '', name: '', contact: '', email: '' }); load();
    } catch (e: any) { toast.error(e.message); }
  }
  async function save() {
    try {
      await warehouseApi.updateVendor(edit.id, { name: edit.name, contact: edit.contact ?? '', email: edit.email ?? '' });
      toast.success('Vendor updated'); setEdit(null); load();
    } catch (e: any) { toast.error(e.message); }
  }
  async function toggle(v: any) {
    try { await warehouseApi.updateVendor(v.id, { isActive: !v.isActive }); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button className="bg-green-600 hover:bg-green-700 text-white gap-1.5" />}><Plus className="h-4 w-4" /> Create Vendor</DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create New Vendor</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label>Code <span className="text-red-500">*</span></Label><Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="e.g. VND010" /></div>
              <div className="space-y-1"><Label>Name <span className="text-red-500">*</span></Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Acme Distribution" /></div>
              <div className="space-y-1"><Label>Contact <span className="text-slate-400 font-normal">(optional)</span></Label><Input value={form.contact} onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))} placeholder="Phone / contact person" /></div>
              <div className="space-y-1"><Label>Email <span className="text-slate-400 font-normal">(optional)</span></Label><Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="sales@vendor.com" /></div>
            </div>
            <DialogFooter><Button onClick={create} disabled={!form.code.trim() || !form.name.trim()} className="bg-green-600 hover:bg-green-700 text-white">Create</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">Code</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Contact</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Email</th>
            <th className="text-center px-4 py-3 font-medium text-slate-600">RTV Cases</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No vendors yet</td></tr>
              : rows.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-bold text-green-700">{v.code}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{v.name}</td>
                  <td className="px-4 py-3 text-slate-500">{v.contact || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{v.email || '—'}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-slate-600">{v._count?.rtvCases ?? 0}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className={v.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}>{v.isActive ? 'Active' : 'Inactive'}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0" title="Edit" onClick={() => setEdit({ ...v })}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0" title={v.isActive ? 'Deactivate' : 'Activate'} onClick={() => toggle(v)}><Power className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Vendor: {edit?.code}</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div className="space-y-1"><Label>Name</Label><Input value={edit.name} onChange={(e) => setEdit((v: any) => ({ ...v, name: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Contact</Label><Input value={edit.contact ?? ''} onChange={(e) => setEdit((v: any) => ({ ...v, contact: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Email</Label><Input value={edit.email ?? ''} onChange={(e) => setEdit((v: any) => ({ ...v, email: e.target.value }))} /></div>
            </div>
          )}
          <DialogFooter><Button onClick={save} className="bg-green-600 hover:bg-green-700 text-white">Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Phase 2: Inventory by Brand ────────────────────────────────────────────────

function RollupTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    warehouseApi.inventoryByBrand().then(setRows).catch(() => toast.error('Failed to load')).finally(() => setLoading(false));
  }, []);

  const totals = rows.reduce((a, r) => ({
    skuCount: a.skuCount + r.skuCount, totalQty: a.totalQty + r.totalQty,
    available: a.available + r.available, reserved: a.reserved + r.reserved,
    rtvPending: a.rtvPending + r.rtvPending, inventoryValue: a.inventoryValue + r.inventoryValue,
  }), { skuCount: 0, totalQty: 0, available: 0, reserved: 0, rtvPending: 0, inventoryValue: 0 });

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Inventory rolled up by brand (derived from each item&apos;s product). Excludes shipped/closed/consumed/cancelled stock.</p>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">Brand</th>
            <th className="text-center px-4 py-3 font-medium text-slate-600">SKUs</th>
            <th className="text-center px-4 py-3 font-medium text-slate-600">Total Qty</th>
            <th className="text-center px-4 py-3 font-medium text-green-700">Available</th>
            <th className="text-center px-4 py-3 font-medium text-teal-700">Reserved</th>
            <th className="text-center px-4 py-3 font-medium text-orange-700">RTV Pending</th>
            <th className="text-right px-4 py-3 font-medium text-slate-600">Inventory Value</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No inventory</td></tr>
              : rows.map((r) => (
                <tr key={r.brandId || r.code} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-800">{r.name}</span>
                    {!r.isActive && <Badge variant="outline" className="ml-2 bg-slate-100 text-slate-400 text-[10px]">inactive</Badge>}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">{r.skuCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-center tabular-nums font-medium">{r.totalQty.toLocaleString()}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-green-700">{r.available.toLocaleString()}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-teal-700">{r.reserved.toLocaleString()}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-orange-700">{r.rtvPending.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">฿{r.inventoryValue.toLocaleString()}</td>
                </tr>
              ))}
          </tbody>
          {!loading && rows.length > 0 && (
            <tfoot><tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <td className="px-4 py-3 text-slate-700">Total</td>
              <td className="px-4 py-3 text-center tabular-nums">{totals.skuCount.toLocaleString()}</td>
              <td className="px-4 py-3 text-center tabular-nums">{totals.totalQty.toLocaleString()}</td>
              <td className="px-4 py-3 text-center tabular-nums text-green-700">{totals.available.toLocaleString()}</td>
              <td className="px-4 py-3 text-center tabular-nums text-teal-700">{totals.reserved.toLocaleString()}</td>
              <td className="px-4 py-3 text-center tabular-nums text-orange-700">{totals.rtvPending.toLocaleString()}</td>
              <td className="px-4 py-3 text-right tabular-nums">฿{totals.inventoryValue.toLocaleString()}</td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
