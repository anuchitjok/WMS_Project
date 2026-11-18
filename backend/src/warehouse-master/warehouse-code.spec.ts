import {
  FALLBACK_SLUG, MAX_SLUG_LENGTH, buildWarehouseCode, generateWarehouseCode,
  isGeneratedWarehouseCode, nextRunningNumber, warehouseSlug,
} from './warehouse-code';

// Auto-generated warehouse code: WH-{NAME SLUG}-{RUNNING NUMBER}.
// Test cases 1, 2, 4, 5 and 6 of the task spec live here (the rest need the service).

describe('warehouseSlug', () => {
  it('builds a slug from an English name and drops the generic tail word', () => {
    expect(warehouseSlug('Bangkok Warehouse')).toBe('BANGKOK');
    expect(warehouseSlug('bangkok warehouse')).toBe('BANGKOK');
  });

  it('keeps every meaningful word of a multi-word name', () => {
    expect(warehouseSlug('Chiang Mai Warehouse')).toBe('CHIANG-MAI');
    expect(warehouseSlug('Main Distribution Center')).toBe('MAIN-DISTRIBUTION');
    expect(warehouseSlug('Spare Part Warehouse')).toBe('SPARE-PART');
  });

  it('removes special characters and collapses separators', () => {
    expect(warehouseSlug('  Spare   Part / Warehouse!! ')).toBe('SPARE-PART');
    expect(warehouseSlug('A&B (North) #2')).toBe('A-B-NORTH-2');
    expect(warehouseSlug('Café Zürich Warehouse')).toBe('CAFE-ZURICH');
    expect(warehouseSlug('WH_MAIN-2')).toBe('WH-MAIN-2');
  });

  it('falls back when the name has no latin letters', () => {
    expect(warehouseSlug('คลังสินค้าเชียงใหม่')).toBe(FALLBACK_SLUG);
    expect(warehouseSlug('仓库')).toBe(FALLBACK_SLUG);
    expect(warehouseSlug('   ')).toBe(FALLBACK_SLUG);
    expect(warehouseSlug('')).toBe(FALLBACK_SLUG);
    expect(warehouseSlug('123 456')).toBe(FALLBACK_SLUG);
    expect(warehouseSlug(undefined as unknown as string)).toBe(FALLBACK_SLUG);
  });

  it('keeps a generic word when it is the whole name', () => {
    expect(warehouseSlug('Warehouse')).toBe('WAREHOUSE');
    expect(warehouseSlug('Distribution Center')).toBe('DISTRIBUTION');
  });

  it('caps the slug at 20 characters, cutting on a word boundary', () => {
    expect(warehouseSlug('Northern Regional Distribution Hub')).toBe('NORTHERN-REGIONAL');
    expect(warehouseSlug('Supercalifragilisticexpialidocious')).toBe('SUPERCALIFRAGILISTIC');
    for (const name of ['Northern Regional Distribution Hub', 'Supercalifragilisticexpialidocious']) {
      expect(warehouseSlug(name).length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    }
    expect(warehouseSlug('Spare Part Warehouse Zone')).toBe('SPARE-PART-WAREHOUSE'); // exactly 20
  });
});

describe('nextRunningNumber', () => {
  it('starts at 1 on an empty or legacy-only database', () => {
    expect(nextRunningNumber([])).toBe(1);
    expect(nextRunningNumber(['SCG', 'WH-MAIN', 'HSNT_OnMoon', 'THPCA-OS-RF', 'DEMO-WH1'])).toBe(1);
  });

  it('is global — one past the highest generated number, whatever the name', () => {
    expect(nextRunningNumber(['WH-CHIANG-MAI-001', 'WH-BANGKOK-004', 'WH-SPARE-PART-003'])).toBe(5);
  });

  it('ignores junk and legacy codes that merely end in digits', () => {
    expect(nextRunningNumber(['WH-2024', 'RACK-001-X', null, undefined, '', 'wh-bangkok-007'])).toBe(8);
  });

  it('keeps counting past 999 with four digits', () => {
    expect(nextRunningNumber(['WH-A-999'])).toBe(1000);
    expect(buildWarehouseCode('A', 1000)).toBe('WH-A-1000');
    expect(nextRunningNumber(['WH-A-1000'])).toBe(1001);
  });
});

describe('generateWarehouseCode', () => {
  it('pads to three digits and keeps the prefix', () => {
    expect(generateWarehouseCode('Chiang Mai Warehouse', [])).toBe('WH-CHIANG-MAI-001');
    expect(generateWarehouseCode('Bangkok Warehouse', ['WH-CHIANG-MAI-001'])).toBe('WH-BANGKOK-002');
  });

  it('separates two warehouses with the same name by the running number', () => {
    const first = generateWarehouseCode('Spare Part Warehouse', []);
    const second = generateWarehouseCode('Spare Part Warehouse', [first]);
    expect(first).toBe('WH-SPARE-PART-001');
    expect(second).toBe('WH-SPARE-PART-002');
    expect(first).not.toBe(second);
  });

  it('never generates an empty code for a Thai name', () => {
    expect(generateWarehouseCode('คลังอะไหล่', ['WH-A-004'])).toBe('WH-WAREHOUSE-005');
  });

  it('recognises its own codes and leaves legacy ones alone', () => {
    expect(isGeneratedWarehouseCode('WH-CHIANG-MAI-001')).toBe(true);
    expect(isGeneratedWarehouseCode('WH-A-1000')).toBe(true);
    expect(isGeneratedWarehouseCode('WH-MAIN')).toBe(false);
    expect(isGeneratedWarehouseCode('THPCA-OS-RF')).toBe(false);
    expect(isGeneratedWarehouseCode('DEMO-WH1')).toBe(false);
  });
});
