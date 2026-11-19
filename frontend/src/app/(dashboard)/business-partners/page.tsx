'use client';

import { useEffect, useState, useCallback } from 'react';
import { Building2, Tag, Truck, Plus, Pencil, Power, Boxes, FolderTree } from 'lucide-react';
import { toast } from 'sonner';
import { warehouseApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { DiscardChangesDialog } from '@/components/ui/discard-changes-dialog';
import { useDiscardGuard } from '@/hooks/use-discard-guard';
import { cn, hasUnsavedChanges } from '@/lib/utils';
import { getT, useT } from '@/i18n';

const BLANK_BRAND_FORM = { name: '', contact: '' };
const BLANK_VENDOR_FORM = { code: '', name: '', contact: '', email: '' };
const BLANK_FAMILY_FORM = { name: '', description: '', parentId: '' };

type Tab = 'brands' | 'families' | 'vendors' | 'rollup';

const TABS: { id: Tab; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'brands',   icon: Tag },
  { id: 'families', icon: FolderTree },
  { id: 'vendors',  icon: Truck },
  { id: 'rollup',  icon: Boxes },
];

export default function BusinessPartnersPage() {
  const { m } = useT();
  const [tab, setTab] = useState<Tab>('brands');

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <PageHeader title={m.partners.title} subtitle={m.partners.subtitle} icon={Building2} />

      <div className="flex gap-2 border-b border-slate-200 overflow-x-auto">
        {TABS.map(({ id, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn('flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap',
              tab === id ? 'border-green-600 text-green-600' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            <Icon className="h-4 w-4" />{m.partners.tabs[id]}
          </button>
        ))}
      </div>

      {tab === 'brands' && <BrandTab />}
      {tab === 'families' && <FamilyTab />}
      {tab === 'vendors' && <VendorTab />}
      {tab === 'rollup' && <RollupTab />}
    </div>
  );
}

// ─── Brand Master ──────────────────────────────────────────────────────────────

function BrandTab() {
  const { m, t } = useT();
  const B = m.partners;
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [editBaseline, setEditBaseline] = useState<any>(null); // snapshot at open-time, for the unsaved-changes guard
  const [form, setForm] = useState(BLANK_BRAND_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await warehouseApi.brandsManaged()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    try {
      // Code is auto-generated server-side (BR-####) — not entered by the user.
      await warehouseApi.createBrand({ name: form.name, contact: form.contact || undefined });
      toast.success(getT().m.partners.brand.created); setCreateOpen(false); setForm(BLANK_BRAND_FORM); load();
    } catch (e: any) { toast.error(e.message); }
  }
  async function save() {
    try {
      await warehouseApi.updateBrand(edit.id, { name: edit.name, contact: edit.contact ?? '' });
      toast.success(getT().m.partners.brand.updated); setEdit(null); setEditBaseline(null); load();
    } catch (e: any) { toast.error(e.message); }
  }
  async function toggle(b: any) {
    try { await warehouseApi.updateBrand(b.id, { isActive: !b.isActive }); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  const createGuard = useDiscardGuard(hasUnsavedChanges(form, BLANK_BRAND_FORM), () => { setCreateOpen(false); setForm(BLANK_BRAND_FORM); });
  const editGuard = useDiscardGuard(hasUnsavedChanges(edit, editBaseline), () => { setEdit(null); setEditBaseline(null); });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Dialog open={createOpen} onOpenChange={(o) => { if (o) setCreateOpen(true); else createGuard.requestClose(); }}>
          <DialogTrigger render={<Button className="bg-green-600 hover:bg-green-700 text-white gap-1.5" />}><Plus className="h-4 w-4" /> {B.brand.create}</DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{B.brand.createTitle}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label>{B.cols.code}</Label><Input value={B.brand.codeAuto} disabled className="text-slate-400 bg-slate-50" /></div>
              <div className="space-y-1"><Label>{B.cols.name} <span className="text-red-500">*</span></Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={B.brand.namePlaceholder} /></div>
              <div className="space-y-1"><Label>{B.cols.contact} <span className="text-slate-400 font-normal">{B.optional}</span></Label><Input value={form.contact} onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))} placeholder={B.brand.contactPlaceholder} /></div>
            </div>
            <DialogFooter><Button onClick={create} disabled={!form.name.trim()} className="bg-green-600 hover:bg-green-700 text-white">{m.common.actions.create}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        <DiscardChangesDialog open={createGuard.confirming} onKeepEditing={createGuard.keepEditing} onDiscard={createGuard.confirmDiscard} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide">
            <th className="text-left px-4 py-3 font-semibold text-slate-500">{B.cols.code}</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-500">{B.cols.name}</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-500">{B.cols.contact}</th>
            <th className="text-center px-4 py-3 font-semibold text-slate-500">{B.cols.products}</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-500">{B.cols.status}</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-500">{B.cols.actions}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">{B.brand.empty}</td></tr>
              : rows.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-bold text-green-700">{b.code}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{b.name}</td>
                  <td className="px-4 py-3 text-slate-500">{b.contact || '—'}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-slate-600">{b._count?.products ?? 0}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className={cn('rounded-full', b.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500')}>{b.isActive ? B.active : B.inactive}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0" title={B.edit} aria-label={B.edit} onClick={() => { setEdit({ ...b }); setEditBaseline({ ...b }); }}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0" title={b.isActive ? B.deactivate : B.activate} aria-label={b.isActive ? B.deactivate : B.activate} onClick={() => toggle(b)}><Power className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => { if (!o) editGuard.requestClose(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t(B.brand.editTitle, { code: edit?.code })}</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div className="space-y-1"><Label>{B.cols.name}</Label><Input value={edit.name} onChange={(e) => setEdit((b: any) => ({ ...b, name: e.target.value }))} /></div>
              <div className="space-y-1"><Label>{B.cols.contact}</Label><Input value={edit.contact ?? ''} onChange={(e) => setEdit((b: any) => ({ ...b, contact: e.target.value }))} /></div>
            </div>
          )}
          <DialogFooter><Button onClick={save} className="bg-green-600 hover:bg-green-700 text-white">{m.common.actions.save}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <DiscardChangesDialog open={editGuard.confirming} onKeepEditing={editGuard.keepEditing} onDiscard={editGuard.confirmDiscard} />
    </div>
  );
}

// ─── Product Family Master (MDM-003) ──────────────────────────────────────────
//
// A family may sit inside a wider one, so the table shows the parent and the
// form offers one. The server refuses a loop; the form simply leaves out the
// family being edited, so the commonest mistake cannot be made at all.

function FamilyTab() {
  const { m, t } = useT();
  const B = m.partners;
  const F = m.partners.family;
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [editBaseline, setEditBaseline] = useState<any>(null);
  const [form, setForm] = useState(BLANK_FAMILY_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await warehouseApi.familiesManaged()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  /** Families a given row may sit inside: anything active but itself. */
  const parentChoices = (selfId?: string) => rows.filter((r) => r.isActive && r.id !== selfId);

  async function create() {
    try {
      // Code is auto-generated server-side (PF-####) — not entered by the user.
      await warehouseApi.createFamily({
        name: form.name,
        description: form.description || undefined,
        parentId: form.parentId || undefined,
      });
      toast.success(getT().m.partners.family.created); setCreateOpen(false); setForm(BLANK_FAMILY_FORM); load();
    } catch (e: any) { toast.error(e.message); }
  }
  async function save() {
    try {
      await warehouseApi.updateFamily(edit.id, {
        name: edit.name, description: edit.description ?? '', parentId: edit.parentId || null,
      });
      toast.success(getT().m.partners.family.updated); setEdit(null); setEditBaseline(null); load();
    } catch (e: any) { toast.error(e.message); }
  }
  async function toggle(f: any) {
    try { await warehouseApi.updateFamily(f.id, { isActive: !f.isActive }); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  const createGuard = useDiscardGuard(hasUnsavedChanges(form, BLANK_FAMILY_FORM), () => { setCreateOpen(false); setForm(BLANK_FAMILY_FORM); });
  const editGuard = useDiscardGuard(hasUnsavedChanges(edit, editBaseline), () => { setEdit(null); setEditBaseline(null); });

  const SELECT = 'h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">{F.hint}</p>
        <Dialog open={createOpen} onOpenChange={(o) => { if (o) setCreateOpen(true); else createGuard.requestClose(); }}>
          <DialogTrigger render={<Button className="bg-green-600 hover:bg-green-700 text-white gap-1.5" />}><Plus className="h-4 w-4" /> {F.create}</DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{F.createTitle}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label>{B.cols.code}</Label><Input value={F.codeAuto} disabled className="text-slate-400 bg-slate-50" /></div>
              <div className="space-y-1">
                <Label htmlFor="pf-name">{B.cols.name} <span className="text-red-500">*</span></Label>
                <Input id="pf-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={F.namePlaceholder} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pf-parent">{F.parent} <span className="text-slate-400 font-normal">{B.optional}</span></Label>
                <select id="pf-parent" className={SELECT} value={form.parentId} onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value }))}>
                  <option value="">{F.noParent}</option>
                  {parentChoices().map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pf-desc">{F.description} <span className="text-slate-400 font-normal">{B.optional}</span></Label>
                <Input id="pf-desc" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
            <DialogFooter><Button onClick={create} disabled={!form.name.trim()} className="bg-green-600 hover:bg-green-700 text-white">{m.common.actions.create}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        <DiscardChangesDialog open={createGuard.confirming} onKeepEditing={createGuard.keepEditing} onDiscard={createGuard.confirmDiscard} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide">
            <th className="text-left px-4 py-3 font-semibold text-slate-500">{B.cols.code}</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-500">{B.cols.name}</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-500">{F.parent}</th>
            <th className="text-center px-4 py-3 font-semibold text-slate-500">{B.cols.products}</th>
            <th className="text-center px-4 py-3 font-semibold text-slate-500">{F.subGroups}</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-500">{B.cols.status}</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-500">{B.cols.actions}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">{F.empty}</td></tr>
              : rows.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-bold text-green-700">{f.code}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{f.name}</td>
                  <td className="px-4 py-3 text-slate-500">{f.parent ? `${f.parent.code} · ${f.parent.name}` : '—'}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-slate-600">{f._count?.products ?? 0}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-slate-600">{f._count?.children ?? 0}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className={cn('rounded-full', f.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500')}>{f.isActive ? B.active : B.inactive}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0" title={B.edit} aria-label={B.edit} onClick={() => { setEdit({ ...f }); setEditBaseline({ ...f }); }}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0" title={f.isActive ? B.deactivate : B.activate} aria-label={f.isActive ? B.deactivate : B.activate} onClick={() => toggle(f)}><Power className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => { if (!o) editGuard.requestClose(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t(F.editTitle, { code: edit?.code })}</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="pf-ename">{B.cols.name}</Label>
                <Input id="pf-ename" value={edit.name} onChange={(e) => setEdit((f: any) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pf-eparent">{F.parent}</Label>
                <select id="pf-eparent" className={SELECT} value={edit.parentId ?? ''} onChange={(e) => setEdit((f: any) => ({ ...f, parentId: e.target.value }))}>
                  <option value="">{F.noParent}</option>
                  {parentChoices(edit.id).map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pf-edesc">{F.description}</Label>
                <Input id="pf-edesc" value={edit.description ?? ''} onChange={(e) => setEdit((f: any) => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
          )}
          <DialogFooter><Button onClick={save} className="bg-green-600 hover:bg-green-700 text-white">{m.common.actions.save}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <DiscardChangesDialog open={editGuard.confirming} onKeepEditing={editGuard.keepEditing} onDiscard={editGuard.confirmDiscard} />
    </div>
  );
}

// ─── Vendor Master ─────────────────────────────────────────────────────────────

function VendorTab() {
  const { m, t } = useT();
  const B = m.partners;
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [editBaseline, setEditBaseline] = useState<any>(null); // snapshot at open-time, for the unsaved-changes guard
  const [form, setForm] = useState(BLANK_VENDOR_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await warehouseApi.vendorsManaged()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    try {
      await warehouseApi.createVendor({ code: form.code, name: form.name, contact: form.contact || undefined, email: form.email || undefined });
      toast.success(getT().m.partners.vendor.created); setCreateOpen(false); setForm(BLANK_VENDOR_FORM); load();
    } catch (e: any) { toast.error(e.message); }
  }
  async function save() {
    try {
      await warehouseApi.updateVendor(edit.id, { name: edit.name, contact: edit.contact ?? '', email: edit.email ?? '' });
      toast.success(getT().m.partners.vendor.updated); setEdit(null); setEditBaseline(null); load();
    } catch (e: any) { toast.error(e.message); }
  }
  async function toggle(v: any) {
    try { await warehouseApi.updateVendor(v.id, { isActive: !v.isActive }); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  const createGuard = useDiscardGuard(hasUnsavedChanges(form, BLANK_VENDOR_FORM), () => { setCreateOpen(false); setForm(BLANK_VENDOR_FORM); });
  const editGuard = useDiscardGuard(hasUnsavedChanges(edit, editBaseline), () => { setEdit(null); setEditBaseline(null); });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Dialog open={createOpen} onOpenChange={(o) => { if (o) setCreateOpen(true); else createGuard.requestClose(); }}>
          <DialogTrigger render={<Button className="bg-green-600 hover:bg-green-700 text-white gap-1.5" />}><Plus className="h-4 w-4" /> {B.vendor.create}</DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{B.vendor.createTitle}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label>{B.cols.code} <span className="text-red-500">*</span></Label><Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder={B.vendor.codePlaceholder} /></div>
              <div className="space-y-1"><Label>{B.cols.name} <span className="text-red-500">*</span></Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={B.vendor.namePlaceholder} /></div>
              <div className="space-y-1"><Label>{B.cols.contact} <span className="text-slate-400 font-normal">{B.optional}</span></Label><Input value={form.contact} onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))} placeholder={B.vendor.contactPlaceholder} /></div>
              <div className="space-y-1"><Label>{B.cols.email} <span className="text-slate-400 font-normal">{B.optional}</span></Label><Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder={B.vendor.emailPlaceholder} /></div>
            </div>
            <DialogFooter><Button onClick={create} disabled={!form.code.trim() || !form.name.trim()} className="bg-green-600 hover:bg-green-700 text-white">{m.common.actions.create}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        <DiscardChangesDialog open={createGuard.confirming} onKeepEditing={createGuard.keepEditing} onDiscard={createGuard.confirmDiscard} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide">
            <th className="text-left px-4 py-3 font-semibold text-slate-500">{B.cols.code}</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-500">{B.cols.name}</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-500">{B.cols.contact}</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-500">{B.cols.email}</th>
            <th className="text-center px-4 py-3 font-semibold text-slate-500">{B.cols.rtvCases}</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-500">{B.cols.status}</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-500">{B.cols.actions}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">{B.vendor.empty}</td></tr>
              : rows.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-bold text-green-700">{v.code}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{v.name}</td>
                  <td className="px-4 py-3 text-slate-500">{v.contact || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{v.email || '—'}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-slate-600">{v._count?.rtvCases ?? 0}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className={cn('rounded-full', v.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500')}>{v.isActive ? B.active : B.inactive}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0" title={B.edit} aria-label={B.edit} onClick={() => { setEdit({ ...v }); setEditBaseline({ ...v }); }}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0" title={v.isActive ? B.deactivate : B.activate} aria-label={v.isActive ? B.deactivate : B.activate} onClick={() => toggle(v)}><Power className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => { if (!o) editGuard.requestClose(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t(B.vendor.editTitle, { code: edit?.code })}</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div className="space-y-1"><Label>{B.cols.name}</Label><Input value={edit.name} onChange={(e) => setEdit((v: any) => ({ ...v, name: e.target.value }))} /></div>
              <div className="space-y-1"><Label>{B.cols.contact}</Label><Input value={edit.contact ?? ''} onChange={(e) => setEdit((v: any) => ({ ...v, contact: e.target.value }))} /></div>
              <div className="space-y-1"><Label>{B.cols.email}</Label><Input value={edit.email ?? ''} onChange={(e) => setEdit((v: any) => ({ ...v, email: e.target.value }))} /></div>
            </div>
          )}
          <DialogFooter><Button onClick={save} className="bg-green-600 hover:bg-green-700 text-white">{m.common.actions.save}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <DiscardChangesDialog open={editGuard.confirming} onKeepEditing={editGuard.keepEditing} onDiscard={editGuard.confirmDiscard} />
    </div>
  );
}

// ─── Phase 2: Inventory by Brand ────────────────────────────────────────────────

function RollupTab() {
  const { m, fmt } = useT();
  const B = m.partners;
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    warehouseApi.inventoryByBrand().then(setRows).catch(() => toast.error(getT().m.partners.rollup.loadFailed)).finally(() => setLoading(false));
  }, []);

  const totals = rows.reduce((a, r) => ({
    skuCount: a.skuCount + r.skuCount, totalQty: a.totalQty + r.totalQty,
    available: a.available + r.available, reserved: a.reserved + r.reserved,
    rtvPending: a.rtvPending + r.rtvPending, inventoryValue: a.inventoryValue + r.inventoryValue,
  }), { skuCount: 0, totalQty: 0, available: 0, reserved: 0, rtvPending: 0, inventoryValue: 0 });

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">{B.rollup.intro}</p>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide">
            <th className="text-left px-4 py-3 font-semibold text-slate-500">{B.cols.brand}</th>
            <th className="text-center px-4 py-3 font-semibold text-slate-500">{B.cols.skus}</th>
            <th className="text-center px-4 py-3 font-semibold text-slate-500">{B.cols.totalQty}</th>
            <th className="text-center px-4 py-3 font-semibold text-slate-500">{B.cols.available}</th>
            <th className="text-center px-4 py-3 font-semibold text-slate-500">{B.cols.reserved}</th>
            <th className="text-center px-4 py-3 font-semibold text-slate-500">{B.cols.rtvPending}</th>
            <th className="text-right px-4 py-3 font-semibold text-slate-500">{B.cols.value}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">{B.rollup.empty}</td></tr>
              : rows.map((r) => (
                <tr key={r.brandId || r.code} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-800">{r.name}</span>
                    {!r.isActive && <Badge variant="outline" className="ml-2 bg-slate-100 text-slate-400 text-[11px]">{B.inactiveTag}</Badge>}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">{fmt.number(r.skuCount)}</td>
                  <td className="px-4 py-3 text-center tabular-nums font-medium">{fmt.number(r.totalQty)}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-green-700">{fmt.number(r.available)}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-slate-600">{fmt.number(r.reserved)}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-amber-700">{fmt.number(r.rtvPending)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{fmt.currency(r.inventoryValue)}</td>
                </tr>
              ))}
          </tbody>
          {!loading && rows.length > 0 && (
            <tfoot><tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <td className="px-4 py-3 text-slate-700">{B.total}</td>
              <td className="px-4 py-3 text-center tabular-nums">{fmt.number(totals.skuCount)}</td>
              <td className="px-4 py-3 text-center tabular-nums">{fmt.number(totals.totalQty)}</td>
              <td className="px-4 py-3 text-center tabular-nums text-green-700">{fmt.number(totals.available)}</td>
              <td className="px-4 py-3 text-center tabular-nums text-slate-600">{fmt.number(totals.reserved)}</td>
              <td className="px-4 py-3 text-center tabular-nums text-amber-700">{fmt.number(totals.rtvPending)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{fmt.currency(totals.inventoryValue)}</td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
