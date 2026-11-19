import { boxOf, spaceNeeded, suggestSlots, unitsBySize, type SlotCandidate } from './putaway-suggest';

// RQ15 — the room a quantity needs and the slots that suit it.
//
// The rule that matters most here: a missing size is reported as unknown, never
// as zero and never as a guess. Everything else is ordering.

const slot = (over: Partial<SlotCandidate> = {}): SlotCandidate => ({
  slotId: over.slotCode ?? 'S1', slotCode: 'S1', rackId: 'R1', rackCode: 'A01', zone: 'Z1',
  warehouseId: 'W1', warehouseCode: 'WH-1', status: 'EMPTY', capacity: 4, used: 0,
  lengthCm: 100, widthCm: 80, heightCm: 60, holdsSameProduct: false,
  ...over,
});

const BOX = { lengthCm: 40, widthCm: 30, heightCm: 20 };
const NO_SIZE = { lengthCm: null, widthCm: null, heightCm: null };

describe('boxOf', () => {
  it('needs all three sides', () => {
    expect(boxOf(BOX)).toEqual([40, 30, 20]);
    expect(boxOf({ lengthCm: 40, widthCm: null, heightCm: 20 })).toBeNull();
    expect(boxOf({ lengthCm: 40, widthCm: 0, heightCm: 20 })).toBeNull();
    expect(boxOf(NO_SIZE)).toBeNull();
  });
});

describe('spaceNeeded', () => {
  it('turns quantity and box into volume and footprint', () => {
    const n = spaceNeeded(10, BOX);
    expect(n.quantity).toBe(10);
    expect(n.unitVolumeM3).toBeCloseTo(0.024, 6);     // 40×30×20 cm = 24,000 cm³
    expect(n.totalVolumeM3).toBeCloseTo(0.24, 6);
    expect(n.unitFootprintM2).toBeCloseTo(0.12, 6);   // 40×30 cm
  });

  it('says "unknown" rather than zero when the product has no size', () => {
    const n = spaceNeeded(10, NO_SIZE);
    expect(n).toEqual({ quantity: 10, unitVolumeM3: null, totalVolumeM3: null, unitFootprintM2: null });
  });

  it('never returns a negative or fractional quantity', () => {
    expect(spaceNeeded(-5, BOX).quantity).toBe(0);
    expect(spaceNeeded(3.7, BOX).quantity).toBe(3);
  });
});

describe('unitsBySize', () => {
  it('counts by volume once the box fits', () => {
    expect(unitsBySize([40, 30, 20], { lengthCm: 100, widthCm: 80, heightCm: 60 })).toBe(20);
  });
  it('is 0 when the box cannot fit at all', () => {
    expect(unitsBySize([200, 30, 20], { lengthCm: 100, widthCm: 80, heightCm: 60 })).toBe(0);
  });
  it('is unknown when either size is missing', () => {
    expect(unitsBySize(null, { lengthCm: 100, widthCm: 80, heightCm: 60 })).toBeNull();
    expect(unitsBySize([40, 30, 20], NO_SIZE)).toBeNull();
  });
  it('counts a snug fit as one', () => {
    expect(unitsBySize([40, 30, 20], { lengthCm: 40, widthCm: 30, heightCm: 20 })).toBe(1);
  });
});

describe('suggestSlots — what is offered', () => {
  it('puts a slot that already holds the product first', () => {
    const r = suggestSlots(5, BOX, [
      slot({ slotCode: 'A-02', used: 0 }),
      slot({ slotCode: 'A-03', used: 2, holdsSameProduct: true }),
    ]);
    expect(r.suggestions.map((s) => s.slotCode)).toEqual(['A-03', 'A-02']);
    expect(r.suggestions[0].reason).toBe('SAME_PRODUCT');
  });

  it('prefers a slot the box is known to fit over one of unknown size', () => {
    const r = suggestSlots(5, BOX, [
      slot({ slotCode: 'B-01', lengthCm: null, widthCm: null, heightCm: null }),
      slot({ slotCode: 'B-02' }),
    ]);
    expect(r.suggestions[0].slotCode).toBe('B-02');
    expect(r.suggestions[0].fits).toBe(true);
    expect(r.suggestions[1].fits).toBeNull();
  });

  it('prefers an empty slot, then the one with more room', () => {
    const r = suggestSlots(5, BOX, [
      slot({ slotCode: 'C-01', used: 3, capacity: 4 }),
      slot({ slotCode: 'C-02', used: 1, capacity: 8 }),
      slot({ slotCode: 'C-03', used: 0, capacity: 2 }),
    ]);
    expect(r.suggestions.map((s) => s.slotCode)).toEqual(['C-03', 'C-02', 'C-01']);
  });

  it('is stable for equal scores — by slot code', () => {
    const r = suggestSlots(1, BOX, [slot({ slotCode: 'D-09' }), slot({ slotCode: 'D-01' })]);
    expect(r.suggestions.map((s) => s.slotCode)).toEqual(['D-01', 'D-09']);
  });

  it('honours the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => slot({ slotCode: `E-${String(i).padStart(2, '0')}` }));
    expect(suggestSlots(1, BOX, many, 3).suggestions).toHaveLength(3);
  });
});

describe('suggestSlots — what is left out, and why', () => {
  it('skips full, blocked and too-small slots, and counts each', () => {
    const r = suggestSlots(5, BOX, [
      slot({ slotCode: 'F-01', used: 4, capacity: 4 }),                                   // full
      slot({ slotCode: 'F-02', status: 'BLOCKED' }),                                      // blocked
      slot({ slotCode: 'F-03', lengthCm: 10, widthCm: 10, heightCm: 10 }),                // too small
      slot({ slotCode: 'F-04' }),                                                         // fine
    ]);
    expect(r.suggestions.map((s) => s.slotCode)).toEqual(['F-04']);
    expect(r.skipped).toEqual({ full: 1, blocked: 1, tooSmall: 1 });
  });

  it('treats quarantine and RTV slots as blocked', () => {
    const r = suggestSlots(1, BOX, [slot({ slotCode: 'G-01', status: 'QUARANTINE' }), slot({ slotCode: 'G-02', status: 'RTV' })]);
    expect(r.suggestions).toHaveLength(0);
    expect(r.skipped.blocked).toBe(2);
  });
});

describe('suggestSlots — a product with no size recorded', () => {
  it('still suggests, by free space, and says the size is missing', () => {
    const r = suggestSlots(5, NO_SIZE, [
      slot({ slotCode: 'H-01', used: 2, capacity: 4 }),
      slot({ slotCode: 'H-02', used: 0, capacity: 4 }),
    ]);
    expect(r.hasProductSize).toBe(false);
    expect(r.need.totalVolumeM3).toBeNull();
    expect(r.suggestions.map((s) => s.slotCode)).toEqual(['H-02', 'H-01']);
    expect(r.suggestions.every((s) => s.fits === null && s.unitsBySize === null)).toBe(true);
    expect(r.skipped.tooSmall).toBe(0); // nothing can be ruled out on size
  });
});
