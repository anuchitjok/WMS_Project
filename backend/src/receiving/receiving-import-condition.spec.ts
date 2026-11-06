import { ReceivingImportService, RECEIVING_IMPORT_COLUMNS } from './receiving-import.service';

describe('Receiving import — itemCondition column', () => {
  const prisma: any = {
    product: { findMany: jest.fn().mockResolvedValue([{ code: 'P1', serialControlled: false, batchControlled: false, isActive: true, productStatus: 'ACTIVE' }]) },
    warehouse: { findMany: jest.fn().mockResolvedValue([]) },
    stockItem: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const svc = new ReceivingImportService(prisma, {} as any);
  const validate = (rows: Record<string, any>[]) => (svc as any).validate(rows.map((r, i) => ({ __row: i + 2, ...r })));

  it('keeps the original headers and adds itemCondition last', () => {
    expect(RECEIVING_IMPORT_COLUMNS.map((c) => c.header)).toEqual([
      'productCode', 'serialNumber', 'batchNumber', 'quantity', 'condition', 'ownershipType', 'warehouseCode', 'itemCondition',
    ]);
  });

  it('accepts files without the column, and NEW / Refurbish values', async () => {
    const out = await validate([
      { productCode: 'P1', quantity: 1 },
      { productCode: 'P1', quantity: 1, itemCondition: 'new' },
      { productCode: 'P1', quantity: 1, itemCondition: 'Refurbish' },
    ]);
    expect(out.map((r: any) => r.valid)).toEqual([true, true, true]);
  });

  it('flags an unknown condition', async () => {
    const [r] = await validate([{ productCode: 'P1', quantity: 1, itemCondition: 'used' }]);
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toContain('Invalid itemCondition');
  });
});
