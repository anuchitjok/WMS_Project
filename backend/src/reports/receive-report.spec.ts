import { RECEIVE_COLUMNS, buildReceiveRow, ReceiveLine } from './receive-report';

const line = (over: Partial<ReceiveLine> = {}): ReceiveLine => ({
  serialNumber: 'SN-1',
  quantity: 1,
  condition: 'good',
  itemCondition: 'REFURBISH',
  product: {
    id: 'p1', code: 'AUTO-CODE-123', partNumber: 'PN-1', description: 'Panel 55"', model: 'M55',
    productType: 'SPARE_PART', productStatus: 'ACTIVE', partType: 'Panel',
    unitCost: 100, defaultPrice: 150,
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-02-01T00:00:00Z'),
    brand: { name: 'Acme' },
  },
  receiving: {
    receivedDate: new Date('2026-03-01T00:00:00Z'), sourceType: 'RTV Replacement', sourceRef: 'RMA-9',
    awbNumber: 'AWB-1', invoiceNumber: 'INV-1', poNumber: 'PO-1', receivedBy: { fullName: 'Rita' },
  },
  stockItem: { warehouse: { name: 'Main' }, rack: { code: 'A01' }, slot: { code: 'A01-01-08' } },
  ...over,
});

describe('Receive report', () => {
  it('has exactly the agreed columns in order, with English export headers', () => {
    expect(RECEIVE_COLUMNS.map((c) => c.header)).toEqual([
      'AWB', 'Bin Number', 'Brand', 'Condition', 'Created By', 'Created On', 'Current Cost', 'Default Price',
      'Description', 'Inventory ID/SKU', 'Invoice No', 'Item Status', 'Item Type', 'Last Modified By',
      'Last Modified On', 'Model', 'Part Type', 'QTY', 'Receive By', 'Receive Date', 'RMA Reference No',
      'S/N', 'Source Type', 'Warehouse', 'PO / Reference No.',
    ]);
  });

  it('builds a value for every column', () => {
    const row = buildReceiveRow(line(), { createdBy: 'Alice', updatedBy: 'Bob' }) as Record<string, unknown>;
    for (const c of RECEIVE_COLUMNS) expect(row).toHaveProperty(c.key);
    expect(row).toMatchObject({
      awb: 'AWB-1', binNumber: 'A01 / A01-01-08', brand: 'Acme', condition: 'Refurbish',
      createdBy: 'Alice', createdOn: '2026-01-01T00:00:00.000Z', currentCost: 100, defaultPrice: 150,
      description: 'Panel 55"', sku: 'PN-1', invoiceNo: 'INV-1', itemStatus: 'Active', itemType: 'Spare Parts',
      lastModifiedBy: 'Bob', lastModifiedOn: '2026-02-01T00:00:00.000Z', model: 'M55', partType: 'Panel',
      qty: 1, receiveBy: 'Rita', receiveDate: '2026-03-01T00:00:00.000Z', rmaRef: 'RMA-9', serialNumber: 'SN-1',
      sourceType: 'RTV Return', sourceTypeValue: 'RTV Replacement', warehouse: 'Main', poNumber: 'PO-1',
    });
  });

  it('falls back: QC condition, product code as SKU, blanks for missing names/location', () => {
    const row = buildReceiveRow(line({
      itemCondition: null,
      stockItem: null,
      product: { ...line().product, partNumber: null, defaultPrice: null },
    }));
    expect(row.condition).toBe('QC: good');
    expect(row.sku).toBe('AUTO-CODE-123');
    expect(row.defaultPrice).toBeNull();
    expect(row.createdBy).toBe('');
    expect(row.lastModifiedBy).toBe('');
    expect(row.warehouse).toBe('');
    expect(row.binNumber).toBe('');
  });

  it('keeps other source types unchanged', () => {
    const row = buildReceiveRow(line({ receiving: { ...line().receiving, sourceType: 'Vendor' } }));
    expect(row.sourceType).toBe('Vendor');
  });
});
