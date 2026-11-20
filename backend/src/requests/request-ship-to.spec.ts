import { shipToOf } from './requests.service';

// Migration 44 — where a SHIP request is going. The rules worth pinning are
// the quiet ones: a blank field must become NULL rather than '', so "is there
// an address?" stays one check, and a COLLECT request must never carry one.

describe('shipToOf', () => {
  const full = {
    shipToName: 'สมชาย ใจดี',
    shipToPhone: '081-234-5678',
    shipToAddress: '99/1 ถนนสีลม',
    shipToTambonId: '103301',
    shipToTambon: 'สีลม',
    shipToDistrict: 'บางรัก',
    shipToProvince: 'กรุงเทพมหานคร',
    shipToPostCode: '10500',
    shipToNote: 'โทรก่อนส่ง',
  };

  it('keeps every part of a complete address', () => {
    expect(shipToOf(full)).toEqual(full);
  });

  it('turns a blank into nothing, so a half-filled address is still readable', () => {
    const out = shipToOf({ ...full, shipToPhone: '', shipToNote: '   ' });
    expect(out.shipToPhone).toBeNull();
    expect(out.shipToNote).toBeNull();
    expect(out.shipToName).toBe('สมชาย ใจดี');
  });

  it('trims what was typed, so a stray space never reaches the label', () => {
    expect(shipToOf({ shipToName: '  สมชาย  ' }).shipToName).toBe('สมชาย');
  });

  it('answers with every column even when nothing was filled in', () => {
    const out = shipToOf({});
    expect(Object.keys(out).sort()).toEqual(Object.keys(full).sort());
    expect(Object.values(out).every((v) => v === null)).toBe(true);
  });

  it('ignores anything that is not text, rather than storing it', () => {
    const out = shipToOf({ shipToPostCode: 10500 as unknown as string, shipToName: null });
    expect(out.shipToPostCode).toBeNull();
    expect(out.shipToName).toBeNull();
  });
});
