// Old → new values for audit entries (Phase 3).
// Stored in AuditLog.changes as { field: { from, to } }; only changed fields are kept.

export type FieldChange = { from: unknown; to: unknown };
export type ChangeSet = Record<string, FieldChange>;

function norm(v: unknown): unknown {
  if (v === undefined || v === null || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  // Prisma Decimal and similar value objects
  if (typeof v === 'object' && v !== null && typeof (v as any).toFixed === 'function') return String(v);
  return v;
}

/**
 * Compares `before` and `after` on `fields`. A field missing from `after`
 * (undefined) was not part of the edit and is skipped.
 */
export function diffFields(before: Record<string, any>, after: Record<string, any>, fields: readonly string[]): ChangeSet {
  const out: ChangeSet = {};
  for (const f of fields) {
    if (after[f] === undefined) continue;
    const a = norm(before?.[f]);
    const b = norm(after[f]);
    if (JSON.stringify(a) !== JSON.stringify(b)) out[f] = { from: a, to: b };
  }
  return out;
}

/** Short text for AuditLog.detail, e.g. "name: Old → New; minStock: 1 → 5". */
export function describeChanges(changes: ChangeSet, max = 6): string {
  const fmt = (v: unknown) => (v === null ? '—' : Array.isArray(v) ? v.join(', ') : String(v));
  const parts = Object.entries(changes).map(([k, c]) => `${k}: ${fmt(c.from)} → ${fmt(c.to)}`);
  if (parts.length > max) return `${parts.slice(0, max).join('; ')}; +${parts.length - max} more`;
  return parts.join('; ');
}

export const hasChanges = (c: ChangeSet) => Object.keys(c).length > 0;
