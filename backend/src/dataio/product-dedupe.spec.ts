import { brandSkuKeys, buildDbIndex, detectProductDuplicates } from './product-dedupe';

describe('product import — Brand + SKU dedupe', () => {
  const db = [
    { code: 'SW-2960X', partNumber: 'WS-C2960X-24', brand: { code: 'CISCO' } },
    { code: 'NOBRAND-1', partNumber: null, brand: null },
  ];

  it('builds case-insensitive, trimmed keys for code and part number', () => {
    expect(brandSkuKeys(' Cisco ', 'SW-1', ' sw-1 ')).toEqual(['cisco|sw-1']);
    expect(brandSkuKeys('CISCO', 'SW-1', 'P-1')).toEqual(['cisco|p-1', 'cisco|sw-1']);
    expect(brandSkuKeys('', '', '')).toEqual([]);
    expect(buildDbIndex(db).get('cisco|ws-c2960x-24')).toBe('SW-2960X');
  });

  it('flags a row whose Brand + SKU already exists in the database (any case / spacing)', () => {
    const hits = detectProductDuplicates([{ brandCode: 'cisco ', code: ' sw-2960x' }], db);
    expect(hits[0]).toMatchObject({ kind: 'db', existingCode: 'SW-2960X' });
  });

  it('matches the database on part number as well as code', () => {
    const hits = detectProductDuplicates([{ brandCode: 'CISCO', code: 'NEW-CODE', partNumber: 'ws-c2960x-24' }], db);
    expect(hits[0]).toMatchObject({ kind: 'db', existingCode: 'SW-2960X' });
  });

  it('does not flag the same SKU under a different brand', () => {
    expect(detectProductDuplicates([{ brandCode: 'HP', code: 'SW-2960X' }], db)[0]).toBeNull();
  });

  it('treats brandless rows as brand "" (matches brandless products only)', () => {
    expect(detectProductDuplicates([{ code: 'nobrand-1' }], db)[0]).toMatchObject({ kind: 'db' });
    expect(detectProductDuplicates([{ brandCode: 'CISCO', code: 'NOBRAND-1' }], db)[0]).toBeNull();
  });

  it('flags later copies within the file as file duplicates of the first row', () => {
    const hits = detectProductDuplicates([
      { brandCode: 'HP', code: 'A-1' },
      { brandCode: 'hp', code: 'X-9', partNumber: 'a-1 ' },
      { brandCode: 'HP', code: 'A-2' },
      { brandCode: 'HP', code: 'a-1' },
    ], db);
    expect(hits[0]).toBeNull();
    expect(hits[1]).toMatchObject({ kind: 'file', firstRowIndex: 0 });
    expect(hits[2]).toBeNull();
    expect(hits[3]).toMatchObject({ kind: 'file', firstRowIndex: 0 });
  });

  it('reports repeated database duplicates against the database, not the file', () => {
    const hits = detectProductDuplicates([{ brandCode: 'CISCO', code: 'SW-2960X' }, { brandCode: 'CISCO', code: 'SW-2960X' }], db);
    expect(hits.map((h) => h?.kind)).toEqual(['db', 'db']);
  });
});
