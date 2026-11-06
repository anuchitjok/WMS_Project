import {
  binCode, buildSlipRows, conditionOf, deliveryMethodOf, frontendBaseUrl, refFromQrUrl,
  requestQrUrl, signatureBlocks, slipLocation, SLIP_COLUMNS,
} from './picking-slip-data';

const stock = (o: any = {}) => ({
  serialNumber: 'SN-1',
  warehouse: { code: 'WH1', name: 'Main' },
  rack: { code: 'A01' },
  slot: { code: 'A01-01-08' },
  goodsReceivingItems: [],
  ...o,
});
const product = { code: 'SKU-1', partNumber: 'PN-1', name: 'Drive', brand: { name: 'Acme' }, unit: 'pcs' };

describe('picking slip data (plan P5 5.1/5.2)', () => {
  it('columns: Status removed, WH + BIN merged into Location', () => {
    expect(SLIP_COLUMNS).not.toContain('Status');
    expect(SLIP_COLUMNS).not.toContain('WH');
    expect(SLIP_COLUMNS).not.toContain('BIN Location');
    expect(SLIP_COLUMNS).toEqual(['#', 'SKU / Part#', 'Description', 'Brand', 'Serial / Batch', 'Location', 'QTY', 'Condition']);
  });

  describe('binCode / slipLocation', () => {
    it('does not repeat the rack when the slot code already contains it', () => {
      expect(binCode('A01', 'A01-01-08')).toBe('A01-01-08');
    });
    it('prefixes legacy short slot codes with the rack', () => {
      expect(binCode('R1', '05')).toBe('R1-05');
    });
    it('handles missing parts', () => {
      expect(binCode(null, null)).toBe('');
      expect(binCode('R1', null)).toBe('R1');
      expect(binCode(null, 'S9')).toBe('S9');
    });
    it('location is two lines: warehouse code, then rack/slot', () => {
      expect(slipLocation(stock())).toEqual({ warehouse: 'WH1', bin: 'A01-01-08' });
      expect(slipLocation(null)).toEqual({ warehouse: '—', bin: '—' });
    });
  });

  it('condition comes from the receipt (NEW / REFURBISH), default NEW', () => {
    expect(conditionOf(stock({ goodsReceivingItems: [{ itemCondition: 'REFURBISH' }] }))).toBe('REFURBISH');
    expect(conditionOf(stock())).toBe('NEW');
    expect(conditionOf(null)).toBe('NEW');
  });

  describe('buildSlipRows', () => {
    const reqItems = [{ product, quantityRequested: 3, quantityApproved: 2, stockItem: stock({ slot: { code: 'A01-01-01' } }) }];

    it('uses request lines when there is no task (approved qty first)', () => {
      const rows = buildSlipRows(reqItems, null);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        no: 1, sku: 'SKU-1', partNumber: 'PN-1', description: 'Drive', brand: 'Acme',
        serial: 'SN-1', qty: 2, condition: 'NEW', location: { warehouse: 'WH1', bin: 'A01-01-01' },
      });
      expect(rows[0]).not.toHaveProperty('status');
    });

    it('prefers the fulfillment task reservation (where the unit really is)', () => {
      const rows = buildSlipRows(reqItems, [
        { product, qtyRequested: 1, stockItem: stock({ serialNumber: 'SN-A' }) },
        { product, qtyRequested: 1, stockItem: stock({ serialNumber: null, batchNumber: 'B-7', slot: { code: 'A01-02-03' } }) },
      ]);
      expect(rows.map((r) => [r.no, r.serial, r.location.bin, r.qty])).toEqual([
        [1, 'SN-A', 'A01-01-08', 1],
        [2, 'B-7', 'A01-02-03', 1],
      ]);
    });

    it('falls back to request lines when the task has no lines', () => {
      expect(buildSlipRows(reqItems, [])[0].location.bin).toBe('A01-01-01');
    });

    it('fills dashes for missing product / stock', () => {
      const [r] = buildSlipRows([{ product: null, quantityRequested: 1, stockItem: null }]);
      expect(r).toMatchObject({ sku: '—', description: '—', brand: '—', serial: '—', location: { warehouse: '—', bin: '—' } });
    });
  });

  describe('signatureBlocks (5.1 two blocks, 5.2 names)', () => {
    it('left = WH picker, right = requester, names pre-filled', () => {
      const [wh, rq] = signatureBlocks('Somchai Picker', 'Jane Requester');
      expect(wh).toEqual({ role: 'WAREHOUSE', title: 'WH — Picked by', name: 'Somchai Picker' });
      expect(rq).toEqual({ role: 'REQUESTER', title: 'Requester — Received by', name: 'Jane Requester' });
    });
    it('only two blocks — no Checked By / Approved By', () => {
      const titles = signatureBlocks('a', 'b').map((b) => b.title).join(' ');
      expect(titles).not.toMatch(/Checked|Approved/i);
    });
    it('leaves the name blank when nobody has picked yet', () => {
      expect(signatureBlocks(null, '  Jane ')[0].name).toBe('');
      expect(signatureBlocks(null, '  Jane ')[1].name).toBe('Jane');
    });
  });

  it('delivery method: null = COLLECT', () => {
    expect(deliveryMethodOf(null)).toBe('COLLECT');
    expect(deliveryMethodOf('SHIP')).toBe('SHIP');
    expect(deliveryMethodOf('weird')).toBe('COLLECT');
  });

  describe('QR URL builder (5.3)', () => {
    it('uses QR_BASE_URL over FRONTEND_URL, first entry, no trailing slash', () => {
      expect(frontendBaseUrl({ QR_BASE_URL: 'https://qr.example.com/', FRONTEND_URL: 'https://a.example.com' })).toBe('https://qr.example.com');
      expect(frontendBaseUrl({ FRONTEND_URL: 'https://wms.pages.dev/, http://localhost:3000' })).toBe('https://wms.pages.dev');
      expect(frontendBaseUrl({})).toBe('http://localhost:3000');
    });
    it('encodes the ref in the query string (static export has no dynamic routes)', () => {
      expect(requestQrUrl('REQ-2026-0001', { FRONTEND_URL: 'https://wms.pages.dev' })).toBe('https://wms.pages.dev/r?ref=REQ-2026-0001');
      expect(requestQrUrl('A B/1', { FRONTEND_URL: 'https://x.dev' })).toBe('https://x.dev/r?ref=A%20B%2F1');
    });
    it('round-trips through refFromQrUrl', () => {
      const url = requestQrUrl('A B/1', { FRONTEND_URL: 'https://x.dev' });
      expect(refFromQrUrl(url)).toBe('A B/1');
      expect(refFromQrUrl('https://x.dev/r/?ref=REQ-1')).toBe('REQ-1');
    });
    it('ignores anything that is not a request QR URL', () => {
      expect(refFromQrUrl('REQ|REQ-1')).toBeNull();
      expect(refFromQrUrl('https://x.dev/requests?ref=REQ-1')).toBeNull();
      expect(refFromQrUrl('https://x.dev/r')).toBeNull();
      expect(refFromQrUrl('not a url')).toBeNull();
    });
  });
});
