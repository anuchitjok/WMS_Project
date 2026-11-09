import {
  addSlots, boxesPerLayer, buildSpaceSummary, effectiveRackSize, emptySlotCounts, legacyRackType, planCapacity,
  planSlotCodes, rackCategory, rackFootprints, simulate, simulateLine, slotCode, slotSize, warehouseArea,
  floorSpace, rackSpaceRow, splitCents, storageBucket, storageSpace,
} from './space-math';

const STD = { id: 't1', code: 'STD-250', name: 'Standard 2.5 m', category: 'STANDARD_RACK', lengthCm: 250, widthCm: 100, heightCm: 250, levels: 5, columns: 5, slotCapacity: 1 };
const PLT = { id: 't2', code: 'PLT-1210', name: 'Pallet', category: 'PALLET_ON_FLOOR', lengthCm: 120, widthCm: 100, heightCm: 180, levels: 1, columns: 1, slotCapacity: 2 };
const rack = (over: Record<string, unknown> = {}) => ({ code: 'A01', rackType: 'STANDARD', levels: 5, columns: 5, lengthCm: null, widthCm: null, heightCm: null, rackTypeMaster: null, ...over }) as any;
const wh = (over: Record<string, unknown> = {}) => ({ id: 'w1', code: 'WH-A', name: 'WH A', isActive: true, lengthCm: 1000, widthCm: 1000, heightCm: 600, usableAreaPct: null, ...over }) as any;

describe('rack category (display mapping, never rewrites data)', () => {
  it('uses the template category when present', () => {
    expect(rackCategory(rack({ rackType: 'STANDARD', rackTypeMaster: PLT }))).toBe('PALLET_ON_FLOOR');
  });
  it('maps legacy PALLET → Pallet on Floor and every other legacy type → Standard Rack', () => {
    expect(rackCategory(rack({ rackType: 'PALLET' }))).toBe('PALLET_ON_FLOOR');
    for (const t of ['STANDARD', 'DRIVE_IN', 'PUSH_BACK', 'CANTILEVER', 'FLOW', 'MEZZANINE']) {
      expect(rackCategory(rack({ rackType: t }))).toBe('STANDARD_RACK');
    }
  });
  it('writes only STANDARD or PALLET to the legacy enum', () => {
    expect(legacyRackType('STANDARD_RACK')).toBe('STANDARD');
    expect(legacyRackType('PALLET_ON_FLOOR')).toBe('PALLET');
  });
});

describe('sizes', () => {
  it('warehouse 10 m × 10 m × 6 m = 100 m² / 600 m³, usable defaults to 100 %', () => {
    expect(warehouseArea(wh())).toEqual({ hasSize: true, usableAreaPct: 100, totalAreaM2: 100, usableAreaM2: 100, volumeM3: 600 });
    expect(warehouseArea(wh({ usableAreaPct: 70 })).usableAreaM2).toBe(70);
  });
  it('warehouse without size → nulls', () => {
    expect(warehouseArea(wh({ lengthCm: null }))).toMatchObject({ hasSize: false, totalAreaM2: null, usableAreaM2: null, volumeM3: null });
  });
  it('rack size falls back to its template per field', () => {
    expect(effectiveRackSize(rack({ lengthCm: 300, rackTypeMaster: STD }))).toEqual({ lengthCm: 300, widthCm: 100, heightCm: 250 });
    expect(effectiveRackSize(rack())).toEqual({ lengthCm: null, widthCm: null, heightCm: null });
  });
  it('slot = rack length / columns × width × height / levels', () => {
    expect(slotSize({ lengthCm: 250, widthCm: 100, heightCm: 250 }, 5, 5)).toEqual({ lengthCm: 50, widthCm: 100, heightCm: 50, areaM2: 0.5, volumeM3: 0.25 });
    expect(slotSize({ lengthCm: null, widthCm: 100, heightCm: 250 }, 5, 5)).toMatchObject({ lengthCm: null, areaM2: null, volumeM3: null });
  });
});

describe('space summary', () => {
  it('splits footprint standard/pallet, counts racks without size, never guesses', () => {
    const racks = [
      rack({ code: 'A01', rackTypeMaster: STD }), // 2.5 m²
      rack({ code: 'A02', lengthCm: 200, widthCm: 100 }), // 2 m²
      rack({ code: 'P01', rackType: 'PALLET', rackTypeMaster: PLT }), // 1.2 m²
      rack({ code: 'X01' }), // unknown
    ];
    const fp = rackFootprints(racks);
    expect(fp).toMatchObject({ totalM2: 5.7, standardM2: 4.5, palletM2: 1.2, racks: 4, standardRacks: 3, palletRacks: 1, withoutSize: 1, withoutSizeCodes: ['X01'] });
  });

  it('builds the per-warehouse shape incl. free area and capacity used', () => {
    const slots = emptySlotCounts();
    addSlots(slots, 'EMPTY', 20, 20);
    addSlots(slots, 'OCCUPIED', 4, 4);
    addSlots(slots, 'BLOCKED', 1, 1);
    addSlots(slots, 'QUARANTINE', 1, 1);
    const s = buildSpaceSummary(wh({ usableAreaPct: 80 }), [rack({ rackTypeMaster: STD })], slots, 13);
    expect(s).toMatchObject({
      totalAreaM2: 100, usableAreaM2: 80, rackFootprintM2: 2.5, freeAreaM2: 77.5, overAllocatedM2: 0,
      usedAreaPct: 3.1, volumeM3: 600, stockQty: 13, capacityUsedPct: 50,
      slots: { total: 26, empty: 20, occupied: 4, blocked: 1, reserved: 0, other: 1, capacity: 26 },
      racks: { total: 1, standard: 1, pallet: 0, withoutSize: 0 },
    });
  });

  it('free area never goes negative; the excess is reported separately', () => {
    const s = buildSpaceSummary(wh({ lengthCm: 200, widthCm: 100 }), [rack({ lengthCm: 300, widthCm: 100 })], emptySlotCounts(), 0);
    expect(s.freeAreaM2).toBe(0);
    expect(s.overAllocatedM2).toBe(1);
    expect(s.capacityUsedPct).toBeNull();
  });
});

describe('capacity planner', () => {
  it('WH 100 m² with one STD rack → 39 more STD racks, 25 slots each', () => {
    const s = buildSpaceSummary(wh(), [rack({ rackTypeMaster: STD }), rack({ code: 'X' })], emptySlotCounts(), 0);
    const plan = planCapacity(s, STD);
    expect(plan.freeAreaM2).toBe(97.5);
    expect(plan.racksThatFit).toBe(39); // floor(97.5 / 2.5)
    expect(plan.slotsPerRack).toBe(25);
    expect(plan.slotsThatFit).toBe(975);
    expect(plan.slotSize).toMatchObject({ lengthCm: 50, widthCm: 100, heightCm: 50, areaM2: 0.5 });
    expect(plan.racksWithoutSize).toBe(1);
  });
  it('unknown warehouse size → racksThatFit null', () => {
    const s = buildSpaceSummary(wh({ widthCm: null }), [], emptySlotCounts(), 0);
    expect(planCapacity(s, PLT).racksThatFit).toBeNull();
  });
});

describe('slot code generation', () => {
  it('pads level and column to 2 digits', () => {
    expect(slotCode('A01', 1, 8)).toBe('A01-01-08');
    expect(slotCode(' A01 ', 12, 3)).toBe('A01-12-03');
  });
  it('lists levels × columns and flags existing codes (skip-existing)', () => {
    const p = planSlotCodes('A01', 2, 3, ['A01-01-02', 'LEGACY-1']);
    expect(p.map((x) => x.code)).toEqual(['A01-01-01', 'A01-01-02', 'A01-01-03', 'A01-02-01', 'A01-02-02', 'A01-02-03']);
    expect(p.filter((x) => x.exists).map((x) => x.code)).toEqual(['A01-01-02']);
    expect(p[4]).toEqual({ code: 'A01-02-02', level: 2, column: 2, exists: false });
  });
  it('refuses grids outside 1–99', () => {
    expect(() => planSlotCodes('A', 0, 1, [])).toThrow(RangeError);
    expect(() => planSlotCodes('A', 1, 100, [])).toThrow(RangeError);
    expect(() => planSlotCodes('A', 1.5, 1, [])).toThrow(RangeError);
  });
});

describe('space simulator', () => {
  const pallet = { lengthCm: 120, widthCm: 100 };
  it('boxes per layer tries both orientations', () => {
    expect(boxesPerLayer(pallet, 40, 30)).toBe(9); // 3×3 vs 4×2=8
    expect(boxesPerLayer(pallet, 50, 50)).toBe(4);
    expect(boxesPerLayer(pallet, 130, 50)).toBe(0);
  });
  it('quantity → pallets → m² and slots', () => {
    const r = simulateLine({ label: 'Box', lengthCm: 40, widthCm: 30, heightCm: 30, quantity: 100, stackLayers: 4 }, pallet);
    expect(r).toMatchObject({ boxesPerLayer: 9, boxesPerPallet: 36, pallets: 3, slots: 3, areaM2: 3.6, oversize: false, error: null });
  });
  it('box larger than the pallet is floor-stacked on its own footprint', () => {
    const r = simulateLine({ label: 'Big', lengthCm: 200, widthCm: 100, heightCm: 50, quantity: 5, stackLayers: 2 }, pallet);
    expect(r).toMatchObject({ pallets: 0, slots: 3, areaM2: 6, oversize: true });
  });
  it('missing size is reported, not guessed', () => {
    expect(simulateLine({ label: 'x', lengthCm: null, widthCm: 10, heightCm: 10, quantity: 5, stackLayers: 1 }, pallet).error).toBe('MISSING_SIZE');
  });

  const summaries = [
    buildSpaceSummary(wh(), [], addSlots(emptySlotCounts(), 'EMPTY', 10, 10), 0), // 100 m² free, 10 empty
    buildSpaceSummary(wh({ id: 'w2', code: 'WH-B', lengthCm: null }), [], addSlots(emptySlotCounts(), 'EMPTY', 2, 2), 0),
  ];
  it('area mode: fits + free after per warehouse; unknown size → null', () => {
    const r = simulate({ mode: 'AREA', areaM2: 30 }, summaries);
    expect(r.warehouses[0]).toMatchObject({ fitsArea: true, freeAreaAfterM2: 70 });
    expect(r.warehouses[1]).toMatchObject({ fitsArea: null, freeAreaAfterM2: null });
  });
  it('slot mode compares with empty slots', () => {
    const r = simulate({ mode: 'SLOTS', slots: 5 }, summaries);
    expect(r.warehouses.map((w) => [w.fitsSlots, w.emptySlotsAfter])).toEqual([[true, 5], [false, -3]]);
  });
  it('items mode sums lines and defaults the pallet to 120 × 100', () => {
    const r = simulate({
      mode: 'ITEMS',
      lines: [
        { label: 'a', lengthCm: 40, widthCm: 30, heightCm: 30, quantity: 100, stackLayers: 4 },
        { label: 'b', lengthCm: 60, widthCm: 50, heightCm: 30, quantity: 4, stackLayers: 1 },
      ],
    }, summaries);
    expect(r.pallet).toEqual({ lengthCm: 120, widthCm: 100 });
    expect(r.pallets).toBe(4);
    expect(r.requiredSlots).toBe(4);
    expect(r.requiredAreaM2).toBe(4.8);
    expect(r.warehouses[0].fitsArea).toBe(true);
  });
});

// ── Layer 1 floor space / Layer 2 storage space (user-defined formulas, 9 Nov 2026) ──
describe('floor space (Layer 1, full area 100%)', () => {
  // User example: warehouse 150 m², 10 racks × 10 m² = 100 m², available 50 m².
  const tenRacks = Array.from({ length: 10 }, (_, i) => rack({ code: `R${i}`, lengthCm: 500, widthCm: 200 }));

  it('matches the user example and ignores usableAreaPct', () => {
    const f = floorSpace({ lengthCm: 1500, widthCm: 1000, heightCm: null }, tenRacks);
    expect(f).toMatchObject({ totalAreaM2: 150, rackFootprintM2: 100, availableM2: 50, utilPct: 66.7, overCapacity: false });
    const s = buildSpaceSummary(wh({ lengthCm: 1500, widthCm: 1000, usableAreaPct: 85 }), tenRacks, emptySlotCounts(), 0);
    expect(s.floor.totalAreaM2).toBe(150);
    expect(s.floor.availableM2).toBe(50);
  });

  it('flags racks larger than the warehouse and never clamps the numbers', () => {
    const f = floorSpace({ lengthCm: 1000, widthCm: 800, heightCm: null }, tenRacks); // 80 m² vs 100 m²
    expect(f.overCapacity).toBe(true);
    expect(f.availableM2).toBe(-20);
    expect(f.utilPct).toBe(125);
  });

  it('returns null figures when the warehouse has no size and lists racks without size', () => {
    const f = floorSpace({ lengthCm: null, widthCm: null, heightCm: null }, [rack({ code: 'X1' }), tenRacks[0]]);
    expect(f.totalAreaM2).toBeNull();
    expect(f.availableM2).toBeNull();
    expect(f.utilPct).toBeNull();
    expect(f.rackFootprintM2).toBe(10);
    expect(f.racksWithoutSizeCodes).toEqual(['X1']);
  });
});

describe('storage space (Layer 2, slot share × rack area)', () => {
  const slots = (o: Partial<Record<'EMPTY' | 'OCCUPIED' | 'RESERVED' | 'BLOCKED' | 'QUARANTINE' | 'WEIRD', number>>) => {
    const c = emptySlotCounts();
    for (const [st, n] of Object.entries(o)) addSlots(c, st, n!, n!);
    return c;
  };

  it('maps statuses into 4 buckets; unknown statuses go to blockedOther, never available', () => {
    expect(storageBucket('OCCUPIED')).toBe('occupied');
    expect(storageBucket('RESERVED')).toBe('reserved');
    expect(storageBucket('EMPTY')).toBe('available');
    expect(storageBucket('BLOCKED')).toBe('blockedOther');
    expect(storageBucket('QUARANTINE')).toBe('blockedOther');
    expect(storageBucket('SOMETHING_NEW')).toBe('blockedOther');
    const row = rackSpaceRow({ ...rack({ lengthCm: 500, widthCm: 200 }), id: 'r1' }, slots({ EMPTY: 2, WEIRD: 3 }));
    expect(row.slots.blockedOther).toBe(3);
    expect(row.slots.available).toBe(2);
  });

  it('matches the user example: 100 m² of racks, 60% used → 60 used, 40 available', () => {
    const row = rackSpaceRow({ ...rack({ lengthCm: 1000, widthCm: 1000 }), id: 'r1' }, slots({ OCCUPIED: 4, RESERVED: 2, EMPTY: 4 }));
    expect(row.areaM2).toEqual({ occupied: 40, reserved: 20, available: 40, blockedOther: 0 });
    expect(row.utilPct).toBe(60);
  });

  it('the 4 areas always add up exactly to the rack area (awkward fractions too)', () => {
    const r = rackSpaceRow({ ...rack({ lengthCm: 600, widthCm: 110 }), id: 'r1' }, slots({ OCCUPIED: 13, EMPTY: 10, BLOCKED: 1 }));
    const a = r.areaM2!;
    expect(Math.round((a.occupied + a.reserved + a.available + a.blockedOther) * 100)).toBe(Math.round(r.rackSizeM2! * 100));
    const s = storageSpace([r, rackSpaceRow({ ...rack({ code: 'B', lengthCm: 333, widthCm: 77 }), id: 'r2' }, slots({ OCCUPIED: 1, RESERVED: 1, QUARANTINE: 1 }))]);
    const t = s.areaM2;
    expect(Math.round((t.occupied + t.reserved + t.available + t.blockedOther) * 100)).toBe(Math.round(s.totalRackAreaM2 * 100));
  });

  it('blockedOther is neither used nor available', () => {
    const r = rackSpaceRow({ ...rack({ lengthCm: 1000, widthCm: 1000 }), id: 'r1' }, slots({ BLOCKED: 5, EMPTY: 5 }));
    expect(r.utilPct).toBe(0);
    expect(r.areaM2).toEqual({ occupied: 0, reserved: 0, available: 50, blockedOther: 50 });
  });

  it('leaves out racks without a size or without slots and lists them', () => {
    const noSize = rackSpaceRow({ ...rack({ code: 'NS' }), id: 'a' }, slots({ OCCUPIED: 3 }));
    const noSlots = rackSpaceRow({ ...rack({ code: 'NO', lengthCm: 100, widthCm: 100 }), id: 'b' }, emptySlotCounts());
    expect(noSize.areaM2).toBeNull();
    expect(noSize.utilPct).toBeNull();
    expect(noSlots.counted).toBe(false);
    const s = storageSpace([noSize, noSlots]);
    expect(s.racksCounted).toBe(0);
    expect(s.utilPct).toBeNull();
    expect(s.racksWithoutSizeCodes).toEqual(['NS']);
    expect(s.racksWithoutSlotsCodes).toEqual(['NO']);
  });

  it('splitCents keeps the total exact', () => {
    const p = splitCents(100, { occupied: 1, reserved: 1, available: 1, blockedOther: 0 });
    expect(p.occupied + p.reserved + p.available + p.blockedOther).toBe(100);
  });
});
