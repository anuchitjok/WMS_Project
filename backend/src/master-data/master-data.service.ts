import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const REASON_CATEGORIES = ['ADJUSTMENT', 'DOA', 'SCRAP'] as const;
export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;

function cleanText(v: unknown, field: string, max = 120): string {
  if (typeof v !== 'string' || !v.trim())
    throw new BadRequestException(`${field} is required`);
  const t = v.trim();
  if (t.length > max)
    throw new BadRequestException(`${field} must be at most ${max} characters`);
  return t;
}

/**
 * Managed master data: reason codes, departments and units of measure.
 *
 * Documents store the code string (not a foreign key), so deactivating a code
 * hides it from new entries but never breaks or rewrites history. Codes are
 * immutable once created; only the description/name and active flag change.
 *
 * Validation is strict as soon as a list has entries. An empty list (a
 * database the 21_system_control.sql data migration has not run on) keeps the
 * previous free-text behaviour instead of blocking every form.
 */
@Injectable()
export class MasterDataService {
  constructor(private prisma: PrismaService) {}

  private audit(
    userId: string,
    action: string,
    entityType: string,
    entityId: string,
    detail: string,
  ) {
    return this.prisma.auditLog.create({
      data: { userId, action, entityType, entityId, detail },
    });
  }

  // ── Reason codes ──────────────────────────────────────────────────────────
  listReasonCodes(category?: string, includeInactive = false) {
    return this.prisma.reasonCode.findMany({
      where: {
        ...(category ? { category } : {}),
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ category: 'asc' }, { code: 'asc' }],
    });
  }

  async createReasonCode(
    dto: { category?: string; code?: string; description?: string },
    userId: string,
  ) {
    if (
      !(REASON_CATEGORIES as readonly string[]).includes(dto?.category ?? '')
    ) {
      throw new BadRequestException(
        `Category must be one of: ${REASON_CATEGORIES.join(', ')}`,
      );
    }
    const code = cleanText(dto.code, 'Code', 32).toUpperCase();
    if (!CODE_RE.test(code))
      throw new BadRequestException(
        'Code may contain only letters, digits, - and _ (max 32)',
      );
    const description = cleanText(dto.description, 'Description');
    const clash = await this.prisma.reasonCode.findUnique({
      where: { category_code: { category: dto.category!, code } },
    });
    if (clash)
      throw new ConflictException(
        `Reason code ${code} already exists for ${dto.category}`,
      );
    const row = await this.prisma.reasonCode.create({
      data: { category: dto.category!, code, description },
    });
    await this.audit(
      userId,
      'REASON_CODE_CREATED',
      'ReasonCode',
      row.id,
      `${row.category}/${row.code}`,
    );
    return row;
  }

  async updateReasonCode(
    id: string,
    dto: { description?: string; isActive?: boolean },
    userId: string,
  ) {
    const row = await this.prisma.reasonCode.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Reason code not found');
    if (dto.isActive === false && row.isSystem)
      throw new BadRequestException(
        `${row.code} is used by the system and cannot be deactivated`,
      );
    const data: { description?: string; isActive?: boolean } = {};
    if (dto.description !== undefined)
      data.description = cleanText(dto.description, 'Description');
    if (typeof dto.isActive === 'boolean') data.isActive = dto.isActive;
    const updated = await this.prisma.reasonCode.update({
      where: { id },
      data,
    });
    await this.audit(
      userId,
      'REASON_CODE_UPDATED',
      'ReasonCode',
      id,
      `${row.category}/${row.code}${data.isActive === false ? ' deactivated' : data.isActive ? ' activated' : ''}`,
    );
    return updated;
  }

  /**
   * Resolves the reason for a new document. Returns the code (or null for
   * legacy free text) and the text to store in the document's `reason` field.
   */
  async resolveReason(
    category: ReasonCategory,
    input: { reasonCode?: string | null; reason?: string | null },
  ): Promise<{ reasonCode: string | null; reason: string }> {
    const active = await this.prisma.reasonCode.findMany({
      where: { category, isActive: true },
      select: { code: true, description: true },
    });
    const code = input.reasonCode?.trim().toUpperCase();
    if (code) {
      const hit = active.find((r) => r.code === code);
      if (!hit)
        throw new BadRequestException(
          `Unknown or inactive ${category.toLowerCase()} reason code: ${code}`,
        );
      return { reasonCode: hit.code, reason: hit.description };
    }
    const text = input.reason?.trim();
    if (active.length) {
      // Older clients send the label text: accept it when it names an active code.
      const byText = text
        ? active.find(
            (r) =>
              r.code === text.toUpperCase() ||
              r.description.toLowerCase() === text.toLowerCase(),
          )
        : undefined;
      if (byText)
        return { reasonCode: byText.code, reason: byText.description };
      throw new BadRequestException(
        `Select a ${category.toLowerCase()} reason code (one of: ${active.map((r) => r.code).join(', ')})`,
      );
    }
    if (!text) throw new BadRequestException('reason is required');
    return { reasonCode: null, reason: text };
  }

  // ── Departments ───────────────────────────────────────────────────────────
  listDepartments(includeInactive = false) {
    return this.prisma.department.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  async createDepartment(
    dto: { code?: string; name?: string },
    userId: string,
  ) {
    const code = cleanText(dto.code, 'Code', 60);
    const name = cleanText(dto.name ?? dto.code, 'Name');
    if (await this.prisma.department.findUnique({ where: { code } }))
      throw new ConflictException(`Department ${code} already exists`);
    const row = await this.prisma.department.create({ data: { code, name } });
    await this.audit(userId, 'DEPARTMENT_CREATED', 'Department', row.id, code);
    return row;
  }

  async updateDepartment(
    id: string,
    dto: { name?: string; isActive?: boolean },
    userId: string,
  ) {
    const row = await this.prisma.department.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Department not found');
    const data: { name?: string; isActive?: boolean } = {};
    if (dto.name !== undefined) data.name = cleanText(dto.name, 'Name');
    if (typeof dto.isActive === 'boolean') data.isActive = dto.isActive;
    const updated = await this.prisma.department.update({
      where: { id },
      data,
    });
    await this.audit(
      userId,
      'DEPARTMENT_UPDATED',
      'Department',
      id,
      `${row.code}${data.isActive === false ? ' deactivated' : ''}`,
    );
    return updated;
  }

  /** A department on a new or edited record must be an active managed department (when any exist). */
  async assertDepartment(
    value: string | null | undefined,
  ): Promise<string | null | undefined> {
    if (value === undefined || value === null) return value;
    const v = value.trim();
    if (!v) return null;
    const total = await this.prisma.department.count();
    if (total === 0) return v;
    const hit = await this.prisma.department.findFirst({
      where: { isActive: true, OR: [{ code: v }, { name: v }] },
      select: { code: true },
    });
    if (!hit)
      throw new BadRequestException(`Unknown or inactive department: ${v}`);
    return hit.code;
  }

  // ── Units of measure ──────────────────────────────────────────────────────
  listUoms(includeInactive = false) {
    return this.prisma.unitOfMeasure.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  async createUom(dto: { code?: string; name?: string }, userId: string) {
    const code = cleanText(dto.code, 'Code', 20);
    const name = cleanText(dto.name ?? dto.code, 'Name');
    if (await this.prisma.unitOfMeasure.findUnique({ where: { code } }))
      throw new ConflictException(`Unit ${code} already exists`);
    const row = await this.prisma.unitOfMeasure.create({
      data: { code, name },
    });
    await this.audit(userId, 'UOM_CREATED', 'UnitOfMeasure', row.id, code);
    return row;
  }

  async updateUom(
    id: string,
    dto: { name?: string; isActive?: boolean },
    userId: string,
  ) {
    const row = await this.prisma.unitOfMeasure.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Unit of measure not found');
    const data: { name?: string; isActive?: boolean } = {};
    if (dto.name !== undefined) data.name = cleanText(dto.name, 'Name');
    if (typeof dto.isActive === 'boolean') data.isActive = dto.isActive;
    const updated = await this.prisma.unitOfMeasure.update({
      where: { id },
      data,
    });
    await this.audit(
      userId,
      'UOM_UPDATED',
      'UnitOfMeasure',
      id,
      `${row.code}${data.isActive === false ? ' deactivated' : ''}`,
    );
    return updated;
  }

  /** Product.unit must be an active unit of measure (when any exist). Existing products keep their unit. */
  async assertUom(
    value: string | null | undefined,
  ): Promise<string | undefined> {
    if (value === undefined || value === null) return undefined;
    const v = value.trim();
    if (!v) throw new BadRequestException('Unit of measure cannot be blank');
    const total = await this.prisma.unitOfMeasure.count();
    if (total === 0) return v;
    const hit = await this.prisma.unitOfMeasure.findFirst({
      where: { isActive: true, code: v },
      select: { code: true },
    });
    if (!hit)
      throw new BadRequestException(
        `Unknown or inactive unit of measure: ${v}`,
      );
    return hit.code;
  }
}
