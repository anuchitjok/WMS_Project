import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The Thai Post address book (migration 43), read only.
 *
 * Someone types a postal code, or part of a place name, and gets back the
 * tambon with its district and province. 7,436 tambons is small enough that a
 * plain ILIKE over the names is instant; nothing here needs a search engine.
 *
 * Only the migration writes these tables. They are the published list, not the
 * warehouse's own data, so the app never edits them — a correction goes into
 * the next revision of the sheet and is re-applied by re-running the migration.
 */

const TAMBON = {
  id: true,
  nameTh: true,
  nameEn: true,
  nameThShort: true,
  nameEnShort: true,
  postCode: true,
  postCodes: true,
  postCodeRemark: true,
  district: {
    select: {
      id: true,
      nameTh: true,
      nameEn: true,
      nameThShort: true,
      nameEnShort: true,
      province: {
        select: {
          id: true,
          nameTh: true,
          nameEn: true,
          regionOfficial: true,
          region4: true,
          regionTourism: true,
          metroGroup: true,
        },
      },
    },
  },
} satisfies Prisma.ThaiTambonSelect;

@Injectable()
export class ThaiAddressService {
  constructor(private prisma: PrismaService) {}

  /**
   * One box, one answer. Digits are read as a postal code, anything else as a
   * place name in Thai or English, at any of the three levels — people know
   * "บางรัก" without knowing whether it is a district or a tambon.
   */
  async search(q: string | undefined, limit?: number) {
    const text = (q ?? '').trim().slice(0, 60);
    const take = Math.min(200, Math.max(1, Number(limit) || 50));
    if (!text) return { query: '', mode: 'empty' as const, total: 0, rows: [] };

    const digits = /^[0-9]+$/.test(text);
    const where: Prisma.ThaiTambonWhereInput = digits
      ? { OR: [{ postCode: { startsWith: text } }, { postCodes: { contains: text } }] }
      : {
          OR: [
            { nameTh: { contains: text } },
            { nameEn: { contains: text, mode: 'insensitive' } },
            { nameThShort: { contains: text } },
            { district: { nameTh: { contains: text } } },
            { district: { nameEn: { contains: text, mode: 'insensitive' } } },
            { district: { nameThShort: { contains: text } } },
            { district: { province: { nameTh: { contains: text } } } },
            { district: { province: { nameEn: { contains: text, mode: 'insensitive' } } } },
          ],
        };

    const [found, total] = await Promise.all([
      this.prisma.thaiTambon.findMany({
        where,
        select: TAMBON,
        orderBy: digits
          ? [{ postCode: 'asc' }, { id: 'asc' }]
          : [{ districtId: 'asc' }, { id: 'asc' }],
        // Both kinds are ranked below, so each has to look at more than it will
        // show, or the best answer can be cut off before it is ever scored.
        take: digits ? Math.max(take, 200) : Math.max(take, 400),
      }),
      this.prisma.thaiTambon.count({ where }),
    ]);

    const rows = (digits ? this.rankByCode(found, text) : this.rank(found, text)).slice(0, take);
    return {
      query: text,
      mode: digits ? ('postCode' as const) : ('name' as const),
      total,
      rows,
    };
  }

  /**
   * A tambon whose own code is the one typed comes before one that merely also
   * uses it. Searching 10500 should not open with a Pathum Wan tambon whose
   * code is 10330 just because 10330 sorts lower.
   */
  private rankByCode<T extends { postCode: string }>(rows: T[], text: string): T[] {
    return [...rows].sort((a, b) => {
      const ea = a.postCode === text ? 0 : 1;
      const eb = b.postCode === text ? 0 : 1;
      return ea - eb || a.postCode.localeCompare(b.postCode);
    });
  }

  /**
   * Puts the obvious answer first. Typing "Chiang Mai" must not open with
   * Si Chiang Mai in Nong Khai just because its postal code sorts lower.
   *
   * The wider the thing matched the better - someone typing a province means
   * the province - and a name that IS what was typed beats one that merely
   * contains it.
   */
  private rank<T extends { nameTh: string; nameEn: string; district: { nameTh: string; nameEn: string; province: { nameTh: string; nameEn: string } } }>(
    rows: T[],
    text: string,
  ): T[] {
    const q = text.toLowerCase();
    const hit = (value: string, level: number) => {
      const v = value.toLowerCase();
      if (!v.includes(q)) return 0;
      // level 3 province, 2 district, 1 tambon; exact beats starts-with beats contains
      const how = v === q ? 3 : v.startsWith(q) ? 2 : 1;
      return level * 10 + how;
    };
    const score = (r: T) =>
      Math.max(
        hit(r.district.province.nameTh, 3),
        hit(r.district.province.nameEn, 3),
        hit(r.district.nameTh, 2),
        hit(r.district.nameEn, 2),
        hit(r.nameTh, 1),
        hit(r.nameEn, 1),
      );
    return [...rows].sort((a, b) => {
      const d = score(b) - score(a);
      if (d) return d;
      // Same relevance: keep it in a stable, readable order.
      const p = a.district.province.nameTh.localeCompare(b.district.province.nameTh, 'th');
      if (p) return p;
      const dd = a.district.nameTh.localeCompare(b.district.nameTh, 'th');
      return dd || a.nameTh.localeCompare(b.nameTh, 'th');
    });
  }

  /** Everything under one postal code — what a parcel label needs filled in. */
  async byPostCode(code: string) {
    const rows = await this.prisma.thaiTambon.findMany({
      where: { postCode: code.trim().slice(0, 5) },
      select: TAMBON,
      orderBy: { id: 'asc' },
    });
    return { postCode: code, total: rows.length, rows };
  }

  // ── The three levels, for a form that narrows down ────────────────────────

  provinces() {
    return this.prisma.thaiProvince.findMany({ orderBy: { nameTh: 'asc' } });
  }

  districts(provinceId?: string) {
    return this.prisma.thaiDistrict.findMany({
      where: provinceId ? { provinceId } : undefined,
      orderBy: { nameTh: 'asc' },
      take: 1000,
    });
  }

  tambons(districtId?: string) {
    return this.prisma.thaiTambon.findMany({
      where: districtId ? { districtId } : undefined,
      select: TAMBON,
      orderBy: { nameTh: 'asc' },
      take: 1000,
    });
  }
}
