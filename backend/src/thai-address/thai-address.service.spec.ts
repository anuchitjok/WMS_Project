import { ThaiAddressService } from './thai-address.service';

// Migration 43 — the Thai Post address book. The lookup is the whole feature:
// digits mean a postal code, letters mean a place, and the obvious answer has
// to come first.

const province = (id: string, th: string, en: string) => ({
  id, nameTh: th, nameEn: en,
  regionOfficial: null, region4: null, regionTourism: null, metroGroup: null,
});
const tambon = (
  id: string, th: string, en: string,
  d: { nameTh: string; nameEn: string; province: ReturnType<typeof province> },
  postCode = '50000',
) => ({
  id, nameTh: th, nameEn: en, nameThShort: th, nameEnShort: en,
  postCode, postCodes: postCode, postCodeRemark: null,
  district: { id: id.slice(0, 4), nameTh: d.nameTh, nameEn: d.nameEn, nameThShort: d.nameTh, nameEnShort: d.nameEn, province: d.province },
});

const CHIANGMAI = province('50', 'เชียงใหม่', 'Chiang Mai');
const NONGKHAI = province('43', 'หนองคาย', 'Nong Khai');

const ROWS = [
  // a district whose NAME contains the query, in another province
  tambon('430401', 'พานพร้าว', 'Phan Phrao',
    { nameTh: 'อำเภอศรีเชียงใหม่', nameEn: 'Si Chiang Mai', province: NONGKHAI }, '43130'),
  // the province itself
  tambon('500101', 'ศรีภูมิ', 'Si Phum',
    { nameTh: 'อำเภอเมืองเชียงใหม่', nameEn: 'Mueang Chiang Mai', province: CHIANGMAI }, '50200'),
  // a tambon that merely contains it
  tambon('500102', 'เชียงใหม่น้อย', 'Chiang Mai Noi',
    { nameTh: 'อำเภอสันทราย', nameEn: 'San Sai', province: CHIANGMAI }, '50210'),
];

function makeDb(rows = ROWS) {
  return {
    thaiTambon: {
      // The argument is typed so the recorded calls can be read back below.
      findMany: jest.fn(async (_args: any) => rows),
      count: jest.fn(async (_args?: any) => rows.length),
    },
    thaiProvince: { findMany: jest.fn(async () => [CHIANGMAI, NONGKHAI]) },
    thaiDistrict: { findMany: jest.fn(async () => []) },
  };
}

describe('ThaiAddressService.search', () => {
  const svc = (db: any) => new ThaiAddressService(db as any);

  it('an empty box asks for nothing and returns nothing', async () => {
    const db = makeDb();
    const out = await svc(db).search('   ');
    expect(out).toMatchObject({ mode: 'empty', total: 0, rows: [] });
    expect(db.thaiTambon.findMany).not.toHaveBeenCalled();
  });

  it('digits are read as a postal code, not a name', async () => {
    const db = makeDb();
    const out = await svc(db).search('10330');
    expect(out.mode).toBe('postCode');
    const where = db.thaiTambon.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { postCode: { startsWith: '10330' } },
      { postCodes: { contains: '10330' } },
    ]);
  });

  it('a part of a code still matches, so half a code is enough to start', async () => {
    const db = makeDb();
    await svc(db).search('103');
    expect(db.thaiTambon.findMany.mock.calls[0][0].where.OR[0]).toEqual({
      postCode: { startsWith: '103' },
    });
  });

  it('letters search every level, in Thai and in English', async () => {
    const db = makeDb();
    const out = await svc(db).search('บางรัก');
    expect(out.mode).toBe('name');
    const asText = JSON.stringify(db.thaiTambon.findMany.mock.calls[0][0].where.OR);
    expect(asText).toContain('nameTh');
    expect(asText).toContain('district');
    expect(asText).toContain('province');
  });

  it('puts the province before a district that merely contains the words', async () => {
    const out = await svc(makeDb()).search('Chiang Mai');
    // Mueang Chiang Mai sits in the province that IS Chiang Mai, so it leads;
    // Si Chiang Mai in Nong Khai is a match, but not the one meant.
    expect(out.rows[0].district.province.nameEn).toBe('Chiang Mai');
    expect(out.rows[out.rows.length - 1].district.province.nameEn).toBe('Nong Khai');
  });

  it('an exact name beats one that only contains it', async () => {
    const out = await svc(makeDb()).search('เชียงใหม่');
    expect(out.rows[0].district.province.nameTh).toBe('เชียงใหม่');
  });

  it('reads more rows than it shows, so ranking cannot be cut off first', async () => {
    const db = makeDb();
    await svc(db).search('เชียงใหม่', 5);
    expect(db.thaiTambon.findMany.mock.calls[0][0].take).toBeGreaterThanOrEqual(400);
  });

  it('a postal code search is read in code order, then ranked', async () => {
    const db = makeDb();
    await svc(db).search('50000', 10);
    expect(db.thaiTambon.findMany.mock.calls[0][0].orderBy).toEqual([
      { postCode: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('a tambon whose own code was typed comes before one that merely also uses it', async () => {
    // 10330 sorts lower, but 10500 is what was asked for.
    const alsoUses = { ...tambon('100501', 'วังใหม่', 'Wang Mai',
      { nameTh: 'เขตปทุมวัน', nameEn: 'Pathum Wan', province: province('10', 'กรุงเทพมหานคร', 'Bangkok') }, '10330') };
    const own = tambon('100502', 'สีลม', 'Si Lom',
      { nameTh: 'เขตบางรัก', nameEn: 'Bang Rak', province: province('10', 'กรุงเทพมหานคร', 'Bangkok') }, '10500');
    const out = await svc(makeDb([alsoUses, own])).search('10500');
    expect(out.rows[0].postCode).toBe('10500');
  });

  it('keeps the total of everything that matched, not just what is shown', async () => {
    const db = makeDb();
    db.thaiTambon.count = jest.fn(async () => 209);
    const out = await svc(db).search('Chiang Mai', 2);
    expect(out.total).toBe(209);
    expect(out.rows).toHaveLength(2);
  });

  it('will not take a sentence as a search, or more than 200 rows', async () => {
    const db = makeDb();
    await svc(db).search('x'.repeat(500), 9999);
    expect(db.thaiTambon.findMany.mock.calls[0][0].take).toBeLessThanOrEqual(400);
    const or = db.thaiTambon.findMany.mock.calls[0][0].where.OR as any[];
    expect(or[0].nameTh.contains).toHaveLength(60);
  });
});
