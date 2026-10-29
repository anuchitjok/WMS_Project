'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BadgeCheck, ImageOff, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { companyApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Field, Section, TextInput } from '@/components/planning/shared';

const MAX_BYTES = 1024 * 1024;
const FIELDS = ['legalName', 'displayName', 'address', 'phone', 'email', 'website', 'taxId', 'defaultTerms'] as const;
type Form = Record<(typeof FIELDS)[number], string>;

/** Reads the image size in the browser so problems show before upload (the server checks again). */
function imageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { reject(new Error('The file could not be read as an image')); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

/**
 * Company Profile — the WMS owner's own identity printed on customer proposals.
 * Never a customer's details. Editable only with the settings permission.
 */
export default function CompanyProfilePage() {
  const [p, setP] = useState<any>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [prof, lg] = await Promise.all([companyApi.get(), companyApi.logo()]);
      setP(prof);
      setForm(Object.fromEntries(FIELDS.map((k) => [k, prof[k] ?? ''])) as Form);
      setLogo(lg.dataUrl);
    } catch (e: any) { toast.error(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!p || !form) return <div className="p-6"><Skeleton className="h-96" /></div>;
  const ro = !p.canEdit;
  const dirty = FIELDS.some((k) => (p[k] ?? '') !== form[k]);
  const set = (k: keyof Form, v: string) => setForm({ ...form, [k]: v });

  async function save() {
    setBusy(true);
    try { const r = await companyApi.update({ ...form, version: p.version }); setP(r); toast.success('Company profile saved'); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) { toast.error('Choose a PNG or JPEG image'); return; }
    if (file.size > MAX_BYTES) { toast.error('The logo must be 1 MB or smaller'); return; }
    try {
      const { width, height } = await imageSize(file);
      if (Math.max(width, height) < 150 || Math.min(width, height) < 32) {
        toast.error(`The logo is too small (${width} × ${height} px) — use at least 150 px on the long side`); return;
      }
    } catch (e: any) { toast.error(e.message); return; }
    setBusy(true);
    try {
      const r = await companyApi.uploadLogo(file, p.version);
      setP(r); setLogo((await companyApi.logo()).dataUrl);
      toast.success(p.hasLogo ? 'Logo replaced' : 'Logo uploaded');
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function remove() {
    if (!window.confirm('Remove the official logo? Customer documents will show no logo until a new one is uploaded.')) return;
    setBusy(true);
    try { const r = await companyApi.removeLogo(p.version); setP(r); setLogo(null); toast.success('Logo removed'); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  const name = form.displayName || form.legalName;
  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <PageHeader title="Company Profile" icon={BadgeCheck}
        subtitle="Your company's official name, contact details and logo, printed on customer proposals and quotations. Never enter a customer's details here." />

      {!p.configured && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not set up yet. Until a legal name is saved, customer proposals show no company identity.
        </p>
      )}
      {ro && <p className="text-sm text-slate-500">Read only — changing the company profile needs the System Settings permission.</p>}

      <div className="grid lg:grid-cols-5 gap-4">
        <Section title="Official logo" className="lg:col-span-2"
          hint="PNG or JPEG, up to 1 MB, at least 150 px on the long side. Upload only your company's official logo file.">
          <div className="space-y-3">
            <div className="flex h-36 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-4">
              {logo
                ? <img src={logo} alt="Official company logo" className="max-h-full max-w-full object-contain" />
                : <span className="flex flex-col items-center gap-1 text-xs text-slate-400"><ImageOff className="h-6 w-6" />No logo — documents print without one</span>}
            </div>
            {p.hasLogo && <p className="text-xs text-slate-500">{p.logoMime === 'image/png' ? 'PNG' : 'JPEG'} · {p.logoWidth} × {p.logoHeight} px · updated {String(p.logoUpdatedAt).slice(0, 10)}</p>}
            {!ro && (
              <div className="flex flex-wrap gap-2">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" aria-label="Logo file" onChange={(e) => pick(e.target.files?.[0])} />
                <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-1.5" />{p.hasLogo ? 'Replace logo' : 'Upload logo'}</Button>
                {p.hasLogo && <Button variant="outline" disabled={busy} onClick={remove}><Trash2 className="h-4 w-4 mr-1.5" />Remove</Button>}
              </div>
            )}
          </div>
        </Section>

        <Section title="Document header preview" className="lg:col-span-3" hint="How the top of a customer proposal will look.">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between gap-4 border-b-2 border-emerald-600 pb-3">
              <div className="flex items-center gap-3 min-w-0">
                {logo && <img src={logo} alt="" className="h-12 w-auto max-w-[180px] object-contain" />}
                {name ? <span className="text-lg font-semibold text-slate-900 truncate">{name}</span> : <span className="text-sm text-slate-400">Company name not set</span>}
              </div>
              <div className="text-right text-[11px] leading-relaxed text-slate-500 max-w-[55%]">
                {form.legalName && <p className="font-medium text-slate-700">{form.legalName}</p>}
                {form.address && <p className="whitespace-pre-line">{form.address}</p>}
                <p>{[form.phone, form.email, form.website].filter(Boolean).join(' · ')}</p>
                {form.taxId && <p>Tax ID {form.taxId}</p>}
              </div>
            </div>
          </div>
        </Section>
      </div>

      <Section title="Company details">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Legal name" hint="Required for documents — e.g. the registered company name"><TextInput value={form.legalName} maxLength={200} disabled={ro} onChange={(e) => set('legalName', e.target.value)} /></Field>
          <Field label="Display name (optional)" hint="Short trading name used as the heading"><TextInput value={form.displayName} maxLength={120} disabled={ro} onChange={(e) => set('displayName', e.target.value)} /></Field>
          <Field label="Address" className="sm:col-span-2">
            <textarea aria-label="Address" className="w-full min-h-[64px] rounded-md border border-slate-200 px-2.5 py-1.5 text-sm disabled:bg-slate-50" maxLength={500} disabled={ro} value={form.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <Field label="Phone"><TextInput value={form.phone} maxLength={60} disabled={ro} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="E-mail"><TextInput type="email" value={form.email} maxLength={120} disabled={ro} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Website"><TextInput value={form.website} maxLength={200} disabled={ro} onChange={(e) => set('website', e.target.value)} /></Field>
          <Field label="Tax ID / registration no."><TextInput value={form.taxId} maxLength={40} disabled={ro} onChange={(e) => set('taxId', e.target.value)} /></Field>
          <Field label="Default commercial terms" className="sm:col-span-2" hint="One term per line, e.g. payment or delivery conditions your company actually uses. A project can replace them. Leave empty to print no terms.">
            <textarea aria-label="Default commercial terms" className="w-full min-h-[96px] rounded-md border border-slate-200 px-2.5 py-1.5 text-sm disabled:bg-slate-50" maxLength={4000} disabled={ro} value={form.defaultTerms} onChange={(e) => set('defaultTerms', e.target.value)} />
          </Field>
        </div>
        {!ro && (
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" disabled={!dirty || busy} onClick={() => setForm(Object.fromEntries(FIELDS.map((k) => [k, p[k] ?? ''])) as Form)}>Discard</Button>
            <Button className="bg-green-600 hover:bg-green-700 text-white" disabled={!dirty || busy || !form.legalName.trim()} onClick={save}>Save details</Button>
          </div>
        )}
      </Section>
    </div>
  );
}
