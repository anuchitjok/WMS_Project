import { BarcodeParserService } from '../scan/barcode-parser.service';
import { containerPayload } from './container-code';

// RQ17 — the box sticker reads BOX|<code>, next to the location sticker's
// LOC|<wh>|<rack>|<slot>. One scanner, two kinds of place.

const parser = new BarcodeParserService();

describe('container QR', () => {
  it('builds the payload that goes in the QR', () => {
    expect(containerPayload('BOX-000123')).toBe('BOX|BOX-000123');
    expect(containerPayload(' box-000123 ')).toBe('BOX|BOX-000123');
  });

  it('is read back as a container', () => {
    expect(parser.parse('BOX|BOX-000123')).toMatchObject({ type: 'container', value: 'BOX-000123', symbology: 'QR' });
  });

  it('survives the round trip through the parser’s own encoder', () => {
    const payload = parser.encode('container', 'BOX-000123');
    expect(payload).toBe('BOX|BOX-000123');
    expect(parser.parse(payload).type).toBe('container');
  });

  it('leaves the other stickers exactly as they were', () => {
    expect(parser.parse('LOC|WHCM|A01|A01-01-08')).toMatchObject({ type: 'location', value: 'WHCM|A01|A01-01-08', symbology: 'QR' });
    expect(parser.parse('SKU|ACER-123')).toMatchObject({ type: 'product', value: 'ACER-123' });
    expect(parser.parse('SN|SER-9')).toMatchObject({ type: 'serial', value: 'SER-9' });
    expect(parser.parse('WHAT|ever')).toMatchObject({ type: 'unknown' });
  });
});
