import { ForbiddenException } from '@nestjs/common';
import { BarcodeParserService } from '../scan/barcode-parser.service';
import { buildLocationLabel, isPalletOnFloor, labelFromKey, locationPayload } from './location-label';
import { LabelsService } from './labels.service';

const parser = new BarcodeParserService();
const wh = { code: 'WHCM', name: 'Chiang Mai DC' };
const slot = (o: any = {}) => ({
  code: 'A01-01-08', level: 1, column: 8, capacity: 4,
  rack: { code: 'A01', name: null, rackType: 'STANDARD', rackTypeMaster: { category: 'STANDARD_RACK' }, warehouse: wh },
  ...o,
});

describe('location label (plan P5 5.4)', () => {
  it('shows the code big, warehouse name, rack and position, capacity', () => {
    expect(buildLocationLabel(slot())).toEqual({
      code: 'A01-01-08',
      warehouseLine: 'Chiang Mai DC (WHCM)',
      rackLine: 'Rack A01',
      positionLine: 'Level 1 · Column 8',
      capacityLine: 'Capacity: 4',
      payload: 'LOC|WHCM|A01|A01-01-08',
      locationKey: 'WHCM|A01|A01-01-08',
    });
  });

  it('marks pallet-on-floor positions', () => {
    const l = buildLocationLabel(slot({ code: 'P01-01-01', column: 1, rack: { ...slot().rack, code: 'P01', rackTypeMaster: { category: 'PALLET_ON_FLOOR' } } }));
    expect(l.rackLine).toBe('Pallet on Floor · P01');
    expect(isPalletOnFloor({ code: 'X', rackType: 'PALLET', warehouse: wh })).toBe(true);
    expect(isPalletOnFloor({ code: 'X', rackType: 'PALLET', rackTypeMaster: { category: 'STANDARD_RACK' }, warehouse: wh })).toBe(false);
  });

  it('prefixes legacy short slot codes with the rack for display only', () => {
    const l = buildLocationLabel(slot({ code: '05' }));
    expect(l.code).toBe('A01-05');
    expect(l.payload).toBe('LOC|WHCM|A01|05'); // the scanner still gets the real slot code
  });

  it('hides empty capacity', () => {
    expect(buildLocationLabel(slot({ capacity: 0 })).capacityLine).toBe('');
  });

  describe('QR payload is accepted by the scanner parser and putaway', () => {
    it.each([
      slot(),
      slot({ code: '05' }),
      slot({ rack: { ...slot().rack, code: 'P01', rackTypeMaster: { category: 'PALLET_ON_FLOOR' } }, code: 'P01-01-01' }),
    ])('round-trips %#', (s) => {
      const l = buildLocationLabel(s);
      const parsed = parser.parse(l.payload);
      expect(parsed.type).toBe('location');
      expect(parsed.value).toBe(l.locationKey);
      // ScanService.doPutaway splits the context.locationKey on '|'
      const [whCode, rackCode, slotCode] = parsed.value.split('|');
      expect([whCode, rackCode, slotCode]).toEqual([s.rack.warehouse.code, s.rack.code, s.code]);
    });

    it('matches the encoder the scanner module uses', () => {
      expect(locationPayload('WHCM', 'A01', 'A01-01-08')).toBe(parser.encode('location', 'WHCM|A01|A01-01-08'));
    });

    it('legacy key fallback keeps the same payload', () => {
      expect(labelFromKey('WHCM|A01|A01-01-08')).toMatchObject({ code: 'A01-01-08', payload: 'LOC|WHCM|A01|A01-01-08' });
    });
  });

  it('parser also recognises the request QR URL as a request', () => {
    expect(parser.parse('https://wms.example.com/r?ref=REQ-2026-0001')).toEqual({ symbology: 'QR', type: 'request', value: 'REQ-2026-0001' });
    expect(parser.parse('LOC|WHCM|A01|A01-01-08').type).toBe('location');
  });
});

describe('LabelsService.binLabels', () => {
  const dbSlot = (id: string, warehouseId: string, code = 'A01-01-01', level = 1, column = 1) => ({
    id, code, level, column, capacity: 1,
    rack: { code: 'A01', name: null, rackType: 'STANDARD', rackTypeMaster: null, warehouseId, warehouse: { id: warehouseId, code: 'WH' + warehouseId, name: 'W' } },
  });
  function svc(slots: any[]) {
    const prisma: any = {
      slot: { findMany: jest.fn(async () => slots), findFirst: jest.fn(async () => null) },
      warehouse: { findFirst: jest.fn(async () => ({ id: 'w1' })) },
    };
    return { s: new LabelsService(prisma, parser), prisma };
  }

  it('prints per rack, sorted by level / column, as a PDF', async () => {
    const { s, prisma } = svc([dbSlot('b', 'w1', 'A01-02-01', 2, 1), dbSlot('a', 'w1', 'A01-01-01', 1, 1)]);
    const labels = await s.resolveLocationLabels({ rackIds: ['r1'] }, { roleKey: 'X', warehouseIds: ['w1'] });
    expect(labels.map((l) => l.code)).toEqual(['A01-01-01', 'A01-02-01']);
    expect(prisma.slot.findMany.mock.calls[0][0].where.OR).toEqual([{ rackId: { in: ['r1'] } }]);
    const pdf = await s.binLabels({ rackIds: ['r1'] });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('keeps warehouse scope', async () => {
    const { s } = svc([dbSlot('a', 'w2')]);
    await expect(s.resolveLocationLabels({ slotIds: ['a'] }, { roleKey: 'X', warehouseIds: ['w1'] })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.resolveLocationLabels({ warehouseIds: ['w2'] }, { roleKey: 'X', warehouseIds: ['w1'] })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still accepts legacy location keys', async () => {
    const { s } = svc([]);
    const labels = await s.resolveLocationLabels({ locations: ['WHw1|A01|A01-01-01'] });
    expect(labels).toHaveLength(1);
    expect(labels[0].payload).toBe('LOC|WHw1|A01|A01-01-01');
  });
});
