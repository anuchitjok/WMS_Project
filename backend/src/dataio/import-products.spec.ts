import { ImportService, missingBrandCodes } from './import.service';

// validate() for the products type, with an in-memory Prisma stand-in.
function makeService() {
  const prisma: any = {
    product: {
      findMany: jest.fn((args: any) => {
        if (args?.select?.brand) return Promise.resolve([{ code: 'SW-1', partNumber: 'P-1', brand: { code: 'CISCO' } }]);
        if (args?.where?.partNumber) return Promise.resolve([{ partNumber: 'P-1' }]);
        return Promise.resolve([{ code: 'SW-1' }]);
      }),
    },
    warehouse: { findMany: jest.fn().mockResolvedValue([]) },
    brand: { findMany: jest.fn().mockResolvedValue([{ code: 'CISCO' }]) },
    stockItem: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    unitOfMeasure: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return new ImportService(prisma, {} as any);
}

const row = (n: number, d: Record<string, any>) => ({ __row: n, unit: 'unit', ...d });

describe('product import validation', () => {
  it('reports a database Brand + SKU duplicate as skipped and a within-file copy as an error', async () => {
    const svc = makeService();
    const out = await svc.validate('products', [
      row(2, { code: 'sw-1 ', name: 'x', brandCode: 'cisco' }),
      row(3, { code: 'NEW-1', name: 'y', brandCode: 'CISCO' }),
      row(4, { code: 'new-1', name: 'z', brandCode: 'Cisco' }),
    ]);
    expect(out[0]).toMatchObject({ valid: false, duplicate: { kind: 'db', existingCode: 'SW-1' } });
    expect(out[0].errors[0]).toMatch(/^Skipped/);
    expect(out[1].valid).toBe(true);
    expect(out[2]).toMatchObject({ valid: false, duplicate: { kind: 'file' } });
    expect(out[2].errors.join(' ')).toMatch(/same as row 3/);
  });

  it('keeps the existing code and part number uniqueness rules', async () => {
    const out = await makeService().validate('products', [
      row(2, { code: 'SW-1', name: 'x', brandCode: 'HP' }),
      row(3, { code: 'Z-9', partNumber: 'P-1', name: 'x' }),
    ]);
    // Unknown brand HP is an error too (option off); code SW-1 already exists under another brand.
    expect(out[0].errors).toEqual(expect.arrayContaining(['Duplicate SKU already exists: SW-1', 'Unknown brandCode: HP']));
    expect(out[1].errors).toContain('Part number already exists: P-1');
  });

  it('unknown brands are errors by default and notes when createMissingBrands is on', async () => {
    const off = await makeService().validate('products', [row(2, { code: 'A', name: 'a', brandCode: 'LENOVO' })]);
    expect(off[0].errors).toContain('Unknown brandCode: LENOVO');
    const on = await makeService().validate('products', [row(2, { code: 'A', name: 'a', brandCode: 'LENOVO' })], undefined, { createMissingBrands: true });
    expect(on[0].valid).toBe(true);
    expect(on[0].notes).toContain('New brand LENOVO will be created');
  });

  it('accepts description in place of name and checks the new numeric columns', async () => {
    const out = await makeService().validate('products', [
      row(2, { code: 'A', description: 'Panel 55' }),
      row(3, { code: 'B' }),
      row(4, { code: 'C', name: 'c', defaultPrice: 'abc', lengthCm: -1, productType: 'WIDGET' }),
    ]);
    expect(out[0].valid).toBe(true);
    expect(out[1].errors).toContain('Missing required field: name (or description)');
    expect(out[2].errors).toEqual(expect.arrayContaining([
      'defaultPrice must be a number', 'lengthCm must be 0 or more', expect.stringMatching(/^Invalid productType/),
    ]));
  });

  it('old files without the new columns still validate', async () => {
    const out = await makeService().validate('products', [row(2, { code: 'OLD-1', name: 'Old', category: 'Net', unitCost: 1, minStock: 0, serialControlled: 'false', brandCode: 'CISCO' })]);
    expect(out[0].valid).toBe(true);
  });

  it('lists each missing brand once, case-insensitively', () => {
    expect(missingBrandCodes([{ brandCode: 'Lenovo' }, { brandCode: 'LENOVO' }, { brandCode: 'cisco' }, {}], [{ code: 'CISCO' }])).toEqual(['Lenovo']);
  });
});
