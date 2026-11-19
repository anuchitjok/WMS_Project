import { SlotStatus } from '@prisma/client';
import { maxMovable, reserve, slotSpace, type SlotRow } from './slot-space';

// Requirement 32 — the two ceilings of a slot, kept apart:
//   places  = Slot.capacity    (stock rows; 0 means nobody entered a figure)
//   pieces  = Slot.maxQuantity (NULL means nobody entered a figure)
// Neither is ever guessed from the other, and "no figure" is not "nothing fits".

const slot = (over: Partial<SlotRow> = {}): SlotRow => ({
  id: 's1',
  code: 'A-01',
  status: SlotStatus.EMPTY,
  capacity: 3,
  maxQuantity: 100,
  isActive: true,
  isDeleted: false,
  rack: { code: 'R1' },
  ...over,
});
const none = { places: 0, pieces: 0 };

describe('slotSpace', () => {
  it('subtracts what is on hand and what is promised from both ceilings', () => {
    const sp = slotSpace(
      slot(),
      { places: 1, pieces: 20 },
      { places: 1, pieces: 30 },
    );
    expect(sp).toMatchObject({
      placesFree: 1, // 3 − 1 − 1
      piecesFree: 50, // 100 − 20 − 30
      unavailable: null,
    });
  });

  it('treats capacity 0 and maxQuantity null as "no figure entered", not "nothing fits"', () => {
    const sp = slotSpace(
      slot({ capacity: 0, maxQuantity: null }),
      { places: 9, pieces: 999 },
      none,
    );
    expect(sp.placesFree).toBeNull();
    expect(sp.piecesFree).toBeNull();
    expect(sp.unavailable).toBeNull();
  });

  it('never reports a negative amount of room', () => {
    const sp = slotSpace(slot(), { places: 5, pieces: 400 }, none);
    expect(sp.placesFree).toBe(0);
    expect(sp.piecesFree).toBe(0);
  });

  it('flags, but never bars, a slot with no place left — capacity cannot be trusted to bar', () => {
    const sp = slotSpace(slot(), { places: 3, pieces: 1 }, none);
    expect(sp.atPlaceLimit).toBe(true);
    expect(sp.unavailable).toBeNull();
    expect(maxMovable(sp, 5)).toBe(5);
  });

  it('is full when the pieces are gone, even with places to spare', () => {
    const sp = slotSpace(slot(), { places: 1, pieces: 100 }, none);
    expect(sp.unavailable).toBe('NO_PIECES');
  });

  it('reports blocked and retired slots before any counting', () => {
    expect(
      slotSpace(slot({ status: SlotStatus.BLOCKED }), none, none).unavailable,
    ).toBe('BLOCKED');
    expect(slotSpace(slot({ isActive: false }), none, none).unavailable).toBe(
      'INACTIVE',
    );
    expect(slotSpace(slot({ isDeleted: true }), none, none).unavailable).toBe(
      'INACTIVE',
    );
  });

  it('a slot marked RESERVED or QUARANTINE can still be chosen — that is a warning, not a bar', () => {
    for (const status of [SlotStatus.RESERVED, SlotStatus.QUARANTINE])
      expect(slotSpace(slot({ status }), none, none).unavailable).toBeNull();
  });
});

describe('maxMovable', () => {
  it('is the whole row when the pieces are not limited', () => {
    const sp = slotSpace(slot({ maxQuantity: null }), none, none);
    expect(maxMovable(sp, 40)).toBe(40);
  });

  it('is the room left when the row holds more than that', () => {
    const sp = slotSpace(slot({ maxQuantity: 10 }), { places: 1, pieces: 7 }, none);
    expect(maxMovable(sp, 40)).toBe(3);
  });

  it('is the row when the room is wider than the row', () => {
    const sp = slotSpace(slot({ maxQuantity: 1000 }), none, none);
    expect(maxMovable(sp, 40)).toBe(40);
  });

  it('is nothing at all for a slot that cannot be used', () => {
    const sp = slotSpace(slot({ status: SlotStatus.BLOCKED }), none, none);
    expect(maxMovable(sp, 40)).toBe(0);
  });
});

describe('reserve', () => {
  it('takes one place and the quantity, so the next line of a request sees less', () => {
    const first = slotSpace(slot({ capacity: 2, maxQuantity: 10 }), none, none);
    const after = reserve(first, 6);
    expect(after).toMatchObject({ placesFree: 1, piecesFree: 4 });
    expect(maxMovable(after, 6)).toBe(4);
  });

  it('a second reservation takes the last place — flagged, with pieces still free', () => {
    let sp = slotSpace(slot({ capacity: 2, maxQuantity: 10 }), none, none);
    sp = reserve(sp, 4);
    sp = reserve(sp, 4);
    expect(sp).toMatchObject({ atPlaceLimit: true, piecesFree: 2 });
    expect(sp.unavailable).toBeNull();
    expect(maxMovable(sp, 5)).toBe(2);
  });

  it('a reservation that reaches the piece ceiling does bar the slot', () => {
    const sp = reserve(
      slotSpace(slot({ capacity: 9, maxQuantity: 10 }), none, none),
      10,
    );
    expect(sp.unavailable).toBe('NO_PIECES');
    expect(maxMovable(sp, 1)).toBe(0);
  });

  it('keeps "no figure entered" meaning no limit', () => {
    const sp = reserve(
      slotSpace(slot({ capacity: 0, maxQuantity: null }), none, none),
      99,
    );
    expect(sp.placesFree).toBeNull();
    expect(sp.piecesFree).toBeNull();
    expect(sp.unavailable).toBeNull();
  });
});
