'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { warehouseApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getT, useT } from '@/i18n';

/**
 * Plan 2.3: create a Brand without leaving the product form. Uses the existing
 * Brand API (POST /warehouse/brands, same roles as Business Partners); a blank
 * code is generated server-side (BR-####).
 */
export function BrandQuickAdd({ onCreated }: { onCreated: (brand: { id: string; code: string; name: string }) => void }) {
  const { m } = useT();
  const F = m.products.form;
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      const b = await warehouseApi.createBrand({ code: code.trim() || undefined, name: name.trim() });
      const { m: mm, t } = getT();
      toast.success(t(mm.products.toast.brandCreated, { name: b.name }));
      onCreated(b);
      setOpen(false); setCode(''); setName('');
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:text-green-800">
        <Plus className="w-3.5 h-3.5" /> {F.newBrand}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600">{F.newBrand}</p>
        <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label={m.common.actions.close}><X className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">{F.brandCode}</Label>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="BR-####" className="h-8 text-sm" />
          <p className="text-[11px] text-slate-500">{F.brandCodeHint}</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{F.brandName} *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm" />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="button" size="sm" className="h-8 bg-green-600 hover:bg-green-700 text-white" disabled={busy || !name.trim()} onClick={add}>
          {busy ? m.common.actions.saving : F.addBrand}
        </Button>
      </div>
    </div>
  );
}
