'use client';

import { useEffect, useState } from 'react';
import { masterDataApi, type ReasonCategory } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface ReasonValue { reasonCode?: string; reason?: string }

/**
 * Reason input backed by the Reason Code master.
 * When the category has active codes, the user must pick one (the server
 * enforces the same rule). With no codes configured it falls back to free text.
 */
export function ReasonCodeField({
  category, value, onChange, label = 'Reason', placeholder,
}: {
  category: ReasonCategory;
  value: ReasonValue;
  onChange: (v: ReasonValue) => void;
  label?: string;
  placeholder?: string;
}) {
  const [codes, setCodes] = useState<{ code: string; description: string }[] | null>(null);

  useEffect(() => {
    let alive = true;
    masterDataApi.reasonCodes(category).then((rows) => { if (alive) setCodes(rows); }).catch(() => { if (alive) setCodes([]); });
    return () => { alive = false; };
  }, [category]);

  if (codes === null) return <div className="space-y-1"><Label>{label}</Label><div className="h-9 rounded-md bg-slate-100 animate-pulse" /></div>;

  if (codes.length === 0) {
    return (
      <div className="space-y-1">
        <Label>{label}</Label>
        <Input value={value.reason ?? ''} placeholder={placeholder} onChange={(e) => onChange({ reason: e.target.value })} />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <select
        className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-600/30"
        value={value.reasonCode ?? ''}
        onChange={(e) => onChange({ reasonCode: e.target.value || undefined })}
      >
        <option value="">Select a reason…</option>
        {codes.map((c) => <option key={c.code} value={c.code}>{c.description} ({c.code})</option>)}
      </select>
    </div>
  );
}

export const reasonFilled = (v: ReasonValue) => !!(v.reasonCode || v.reason?.trim());
