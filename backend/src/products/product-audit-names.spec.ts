import { pickAuditNames, resolveAuditNames, resolveProductName, nameAfterUpdate } from './product-audit-names';

describe('product Created By / Last Modified By', () => {
  const users = [
    { id: 'u1', fullName: 'Alice' },
    { id: 'u2', fullName: 'Bob' },
    { id: 'u3', fullName: '', username: 'carol' },
  ];
  const t = (d: number) => new Date(2026, 0, d);

  it('uses the stored ids when present', () => {
    const r = pickAuditNames([{ id: 'p1', createdById: 'u1', updatedById: 'u2' }], [
      { entityId: 'p1', action: 'PRODUCT_CREATED', createdAt: t(1), userId: 'u3' },
    ], users);
    expect(r.get('p1')).toEqual({ createdBy: 'Alice', updatedBy: 'Bob' });
  });

  it('falls back to the earliest create and latest update audit entry', () => {
    const r = pickAuditNames([{ id: 'p1', createdById: null, updatedById: null }], [
      { entityId: 'p1', action: 'PRODUCT_UPDATED', createdAt: t(5), userId: 'u1' },
      { entityId: 'p1', action: 'PRODUCT_IMPORT_CREATE', createdAt: t(2), userId: 'u2' },
      { entityId: 'p1', action: 'PRODUCT_CREATED', createdAt: t(3), userId: 'u1' },
      { entityId: 'p1', action: 'PRODUCT_STATUS_CHANGED', createdAt: t(9), userId: 'u3' },
      { entityId: 'p1', action: 'SOMETHING_ELSE', createdAt: t(10), userId: 'u1' },
    ], users);
    expect(r.get('p1')).toEqual({ createdBy: 'Bob', updatedBy: 'carol' });
  });

  it('returns nulls when nothing is known', () => {
    expect(pickAuditNames([{ id: 'p9' }], [], users).get('p9')).toEqual({ createdBy: null, updatedBy: null });
  });

  it('batches: one audit query for products missing ids, one user query, none per product', async () => {
    const db = {
      auditLog: { findMany: jest.fn().mockResolvedValue([{ entityId: 'p2', action: 'PRODUCT_CREATED', createdAt: t(1), userId: 'u2' }]) },
      user: { findMany: jest.fn().mockResolvedValue(users) },
    };
    const r = await resolveAuditNames(db, [
      { id: 'p1', createdById: 'u1', updatedById: 'u1' },
      { id: 'p2', createdById: null, updatedById: null },
      { id: 'p3', createdById: 'u1', updatedById: null },
    ]);
    expect(db.auditLog.findMany).toHaveBeenCalledTimes(1);
    expect(db.auditLog.findMany.mock.calls[0][0].where.entityId).toEqual({ in: ['p2', 'p3'] });
    expect(db.user.findMany).toHaveBeenCalledTimes(1);
    expect(r.get('p2')).toEqual({ createdBy: 'Bob', updatedBy: null });
    expect(r.get('p3')).toEqual({ createdBy: 'Alice', updatedBy: null });
  });

  it('skips the audit query when every product has both ids', async () => {
    const db = { auditLog: { findMany: jest.fn() }, user: { findMany: jest.fn().mockResolvedValue(users) } };
    await resolveAuditNames(db, [{ id: 'p1', createdById: 'u1', updatedById: 'u2' }]);
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });
});

describe('product name := description', () => {
  it('new products use the description when no name is given', () => {
    expect(resolveProductName(undefined, '  Panel 55in ')).toBe('Panel 55in');
    expect(resolveProductName('', 'Panel')).toBe('Panel');
    expect(resolveProductName('Own name', 'Panel')).toBe('Own name');
    expect(resolveProductName(null, null)).toBe('');
  });

  it('existing products with their own name keep it when the description changes', () => {
    expect(nameAfterUpdate({ name: 'Legacy name', description: 'Old desc' }, { description: 'New desc' })).toBeUndefined();
  });

  it('a name derived from the description follows it', () => {
    expect(nameAfterUpdate({ name: 'Old desc', description: 'Old desc' }, { description: 'New desc' })).toBe('New desc');
  });

  it('explicit name wins; blank or missing description leaves the name', () => {
    expect(nameAfterUpdate({ name: 'A', description: 'A' }, { name: 'B', description: 'C' })).toBe('B');
    expect(nameAfterUpdate({ name: 'A', description: 'A' }, { description: '' })).toBeUndefined();
    expect(nameAfterUpdate({ name: 'A', description: 'A' }, {})).toBeUndefined();
  });
});
