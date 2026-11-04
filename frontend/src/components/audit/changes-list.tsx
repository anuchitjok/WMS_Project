'use client';

// Old → new values recorded on an audit entry (Phase 3).
// Shape: { field: { from, to } }, or for role permissions { permissions: { added, removed } }.

const LABEL: Record<string, string> = {
  brandId: 'Brand', minStock: 'Min stock', unitCost: 'Unit cost', partNumber: 'Part number',
  vendorPartNumber: 'Vendor part #', productType: 'Product type', productStatus: 'Status',
  serialControlled: 'Serial controlled', batchControlled: 'Batch controlled', isActive: 'Active',
};

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));

export function ChangesList({ changes }: { changes: unknown }) {
  if (!changes || typeof changes !== 'object') return null;
  const entries = Object.entries(changes as Record<string, any>);
  if (!entries.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs">
      {entries.map(([field, c]) => {
        if (c && (Array.isArray(c.added) || Array.isArray(c.removed))) {
          return (
            <li key={field} className="text-slate-600">
              <span className="text-slate-400">{LABEL[field] ?? field}: </span>
              {c.added?.length ? <span className="text-green-700">+ {c.added.join(', ')}</span> : null}
              {c.added?.length && c.removed?.length ? ' · ' : null}
              {c.removed?.length ? <span className="text-red-600">− {c.removed.join(', ')}</span> : null}
              {!c.added?.length && !c.removed?.length ? 'no change' : null}
            </li>
          );
        }
        return (
          <li key={field} className="text-slate-600">
            <span className="text-slate-400">{LABEL[field] ?? field}: </span>
            <span className="line-through decoration-slate-300">{show(c?.from)}</span>
            <span className="text-slate-400"> → </span>
            <span className="font-medium text-slate-800">{show(c?.to)}</span>
          </li>
        );
      })}
    </ul>
  );
}
