import { DocumentsService } from './documents.service';
import { buildSlipRows } from './picking-slip-data';

// Smoke test: the picking slip renders for short and long requests (continuation pages)
// without throwing. Layout itself is checked by eye in the browser.
describe('DocumentsService.pickingSlip', () => {
  function ctx(n: number) {
    const items = Array.from({ length: n }, (_, i) => ({
      product: { code: `SKU-${i}`, name: `Item ${i} with a fairly long description text`, brand: { name: 'Acme' }, serialControlled: i === 0 },
      quantityRequested: 1,
      stockItem: { serialNumber: `SN-${i}`, warehouse: { id: 'w1', code: 'WH1' }, rack: { code: 'A01' }, slot: { code: `A01-01-0${i % 9}` }, goodsReceivingItems: [] },
    }));
    return {
      req: {
        id: 'r1', refNumber: 'REQ-2026-0001', status: 'PICKING', priority: 'HIGH', createdAt: new Date('2026-11-05'),
        department: 'IT', rmaCaseNumber: null, purpose: 'Repair', notes: 'Handle with care',
        requester: { id: 'u1', fullName: 'Jane Requester', department: 'IT' }, approver: { fullName: 'Boss' }, items,
      },
      task: null,
      rows: buildSlipRows(items as any),
      warehouseIds: ['w1'],
      pickerName: 'Pete Picker',
      requesterName: 'Jane Requester',
      deliveryMethod: 'COLLECT',
    };
  }

  it.each([1, 5, 6, 40])('renders a PDF with %i lines', async (n) => {
    const refs: any = { loadContext: jest.fn(async () => ctx(n)) };
    const svc = new DocumentsService({} as any, refs);
    const pdf = await svc.pickingSlip('r1');
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBe(n <= 5 ? 1 : 1 + Math.ceil((n - 5) / 30));
  });
});
