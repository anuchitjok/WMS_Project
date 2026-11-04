import { describeChanges, diffFields } from './audit-diff';

describe('audit-diff', () => {
  it('keeps only changed fields and skips fields not in the edit', () => {
    const before = { name: 'A', minStock: 1, model: 'X', unit: 'pcs' };
    const after = { name: 'B', minStock: 1, model: undefined, unit: 'box' };
    expect(diffFields(before, after, ['name', 'minStock', 'model', 'unit'])).toEqual({
      name: { from: 'A', to: 'B' },
      unit: { from: 'pcs', to: 'box' },
    });
  });

  it('treats null, undefined and empty string as the same empty value', () => {
    expect(diffFields({ contact: null }, { contact: '' }, ['contact'])).toEqual({});
    expect(diffFields({ contact: 'x' }, { contact: null }, ['contact'])).toEqual({ contact: { from: 'x', to: null } });
  });

  it('normalises dates and decimal-like values', () => {
    const d1 = new Date('2026-01-01T00:00:00Z');
    const d2 = new Date('2026-01-01T00:00:00Z');
    expect(diffFields({ at: d1 }, { at: d2 }, ['at'])).toEqual({});
    const dec = (v: string) => ({ toFixed: () => v, toString: () => v });
    expect(diffFields({ cost: dec('1.50') }, { cost: dec('2.00') }, ['cost'])).toEqual({ cost: { from: '1.50', to: '2.00' } });
  });

  it('describes changes briefly and caps long lists', () => {
    expect(describeChanges({ name: { from: 'A', to: 'B' }, contact: { from: null, to: 'x' } })).toBe('name: A → B; contact: — → x');
    const many = Object.fromEntries([...Array(8)].map((_, i) => [`f${i}`, { from: i, to: i + 1 }]));
    expect(describeChanges(many, 3)).toBe('f0: 0 → 1; f1: 1 → 2; f2: 2 → 3; +5 more');
  });
});
