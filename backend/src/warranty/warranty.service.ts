import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WarrantyRule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertNotSelfApproval } from '../common/separation-of-duties';
import { ScopePrincipal, canAccessWarehouse, scopedWarehouseIds } from '../common/warehouse-scope';
import { CreateWarrantyRuleDto, UpdateWarrantyRuleDto, WARRANTY_CONTEXTS, WarrantyDateDto } from './dto';
import { RuleLike, SPECIFICITY, StartBasis, UnitFacts, evaluateWarranty, validateRule } from './warranty-engine';

type Principal = ScopePrincipal & { id: string };

/**
 * Warranty rules and lookups. Informational only: a warranty decision is shown
 * and logged but does not block or trigger any receiving, RTV, DOA or RMA step
 * (what it should gate is an open business decision — docs/WARRANTY_MRP.md §9).
 */
@Injectable()
export class WarrantyService {
  constructor(private prisma: PrismaService) {}

  private audit(userId: string, action: string, entityId: string, detail: unknown) {
    return this.prisma.auditLog.create({ data: { userId, action, entityType: 'WarrantyRule', entityId, detail: JSON.stringify(detail) } });
  }

  // ── Rules ──────────────────────────────────────────────────────────────
  async listRules(q: { status?: string; search?: string }) {
    const rows = await this.prisma.warrantyRule.findMany({
      where: {
        ...(q.status ? { status: q.status as never } : {}),
        ...(q.search ? { OR: [{ ruleCode: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }] } : {}),
      },
      orderBy: [{ ruleCode: 'asc' }, { version: 'desc' }],
    });
    return this.withScopeLabels(rows);
  }

  async ruleVersions(ruleCode: string) {
    const rows = await this.prisma.warrantyRule.findMany({ where: { ruleCode }, orderBy: { version: 'desc' } });
    if (!rows.length) throw new NotFoundException('Rule not found');
    return this.withScopeLabels(rows);
  }

  /** Readable scope values: product code, brand or vendor name instead of internal ids. */
  private async withScopeLabels<T extends { scopeType: string; scopeValue: string }>(rows: T[]) {
    const ids = (t: string) => [...new Set(rows.filter((r) => r.scopeType === t).map((r) => r.scopeValue))];
    const [products, brands, vendors] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: ids('PRODUCT') } }, select: { id: true, code: true, name: true } }),
      this.prisma.brand.findMany({ where: { id: { in: ids('BRAND') } }, select: { id: true, name: true } }),
      this.prisma.vendor.findMany({ where: { id: { in: ids('VENDOR') } }, select: { id: true, name: true } }),
    ]);
    const label = new Map<string, string>([
      ...products.map((p) => [`PRODUCT|${p.id}`, `${p.code} — ${p.name}`] as [string, string]),
      ...brands.map((b) => [`BRAND|${b.id}`, b.name] as [string, string]),
      ...vendors.map((v) => [`VENDOR|${v.id}`, v.name] as [string, string]),
    ]);
    return rows.map((r) => ({ ...r, scopeLabel: label.get(`${r.scopeType}|${r.scopeValue}`) ?? r.scopeValue }));
  }

  private async checkScopeValue(scopeType: string, scopeValue: string) {
    const exists = async (n: number | null) => {
      if (!n) throw new BadRequestException(`No ${scopeType.toLowerCase().replace('_', ' ')} matches "${scopeValue}"`);
    };
    if (scopeType === 'PRODUCT') await exists(await this.prisma.product.count({ where: { id: scopeValue } }));
    if (scopeType === 'BRAND') await exists(await this.prisma.brand.count({ where: { id: scopeValue } }));
    if (scopeType === 'VENDOR') await exists(await this.prisma.vendor.count({ where: { id: scopeValue } }));
    if (scopeType === 'PRODUCT_TYPE' && !['FINISHED_GOODS', 'SPARE_PART'].includes(scopeValue)) throw new BadRequestException('PRODUCT_TYPE must be FINISHED_GOODS or SPARE_PART');
  }

  private validate(r: { durationValue: number; durationUnit: string; effectiveFrom: Date; effectiveTo: Date | null; scopeValue: string }) {
    const errors = validateRule(r as never);
    if (errors.length) throw new BadRequestException(errors);
  }

  async createRule(u: Principal, dto: CreateWarrantyRuleDto) {
    if (await this.prisma.warrantyRule.count({ where: { ruleCode: dto.ruleCode } })) throw new ConflictException('Rule code already exists — create a new version of it instead');
    const data = { ...dto, effectiveFrom: new Date(dto.effectiveFrom), effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null };
    this.validate(data);
    await this.checkScopeValue(dto.scopeType, dto.scopeValue);
    const rule = await this.prisma.warrantyRule.create({ data: { ...(data as Prisma.WarrantyRuleUncheckedCreateInput), version: 1, status: 'DRAFT', createdById: u.id } });
    await this.audit(u.id, 'WARRANTY_RULE_CREATED', rule.id, { ruleCode: rule.ruleCode, version: 1, values: dto });
    return rule;
  }

  async updateDraft(u: Principal, id: string, dto: UpdateWarrantyRuleDto) {
    const before = await this.prisma.warrantyRule.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Rule not found');
    if (before.status !== 'DRAFT') throw new ConflictException('Only DRAFT versions can be edited; create a new version of an active rule');
    const patch: Record<string, unknown> = definedOnly({ ...dto });
    if (dto.effectiveFrom) patch.effectiveFrom = new Date(dto.effectiveFrom);
    if (dto.effectiveTo !== undefined) patch.effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
    const merged = { ...before, ...patch } as WarrantyRule;
    this.validate(merged);
    await this.checkScopeValue(merged.scopeType, merged.scopeValue);
    const rule = await this.prisma.warrantyRule.update({ where: { id }, data: patch as Prisma.WarrantyRuleUpdateInput });
    await this.audit(u.id, 'WARRANTY_RULE_UPDATED', id, { ruleCode: rule.ruleCode, version: rule.version, changes: dto });
    return rule;
  }

  /** Copies the latest version into a new DRAFT version (same rule code). */
  async newVersion(u: Principal, id: string) {
    const src = await this.prisma.warrantyRule.findUnique({ where: { id } });
    if (!src) throw new NotFoundException('Rule not found');
    const latest = await this.prisma.warrantyRule.findFirst({ where: { ruleCode: src.ruleCode }, orderBy: { version: 'desc' } });
    if (latest!.status === 'DRAFT') throw new ConflictException(`Version ${latest!.version} is still a draft — edit that one`);
    const { id: _id, createdAt: _c, updatedAt: _u, activatedAt: _a, activatedById: _b, ...rest } = latest!;
    void _id; void _c; void _u; void _a; void _b;
    const rule = await this.prisma.warrantyRule.create({
      data: { ...rest, version: latest!.version + 1, status: 'DRAFT', supersedesId: latest!.id, createdById: u.id, changeNote: null },
    });
    await this.audit(u.id, 'WARRANTY_RULE_VERSIONED', rule.id, { ruleCode: rule.ruleCode, version: rule.version, from: latest!.version });
    return rule;
  }

  /**
   * Activates a DRAFT version (by someone other than its author). The previous
   * ACTIVE version of the same code becomes SUPERSEDED. Activation is refused when
   * another active rule has the same scope, value and priority with an
   * overlapping window — every unit it covers would be a CONFLICT.
   */
  async activate(u: Principal, id: string) {
    const rule = await this.prisma.warrantyRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Rule not found');
    if (rule.status !== 'DRAFT') throw new ConflictException(`Only DRAFT versions can be activated (this one is ${rule.status})`);
    assertNotSelfApproval(u.id, [rule.createdById], 'a warranty rule');
    const clashes = await this.clashes(rule);
    if (clashes.length) {
      throw new ConflictException(`Same scope and priority as active rule(s) ${clashes.map((c) => `${c.ruleCode} v${c.version}`).join(', ')} with overlapping dates — change the priority or the dates first`);
    }
    return this.prisma.$transaction(async (tx) => {
      const superseded = await tx.warrantyRule.updateMany({ where: { ruleCode: rule.ruleCode, status: 'ACTIVE', id: { not: id } }, data: { status: 'SUPERSEDED' } });
      const claimed = await tx.warrantyRule.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'ACTIVE', activatedById: u.id, activatedAt: new Date() } });
      if (!claimed.count) throw new ConflictException('Rule was changed by someone else');
      await tx.auditLog.create({ data: { userId: u.id, action: 'WARRANTY_RULE_ACTIVATED', entityType: 'WarrantyRule', entityId: id, detail: JSON.stringify({ ruleCode: rule.ruleCode, version: rule.version, supersededVersions: superseded.count }) } });
      return tx.warrantyRule.findUniqueOrThrow({ where: { id } });
    });
  }

  private async clashes(rule: WarrantyRule) {
    const others = await this.prisma.warrantyRule.findMany({ where: { status: 'ACTIVE', ruleCode: { not: rule.ruleCode }, scopeType: rule.scopeType, priority: rule.priority } });
    const overlaps = (a: WarrantyRule, b: WarrantyRule) =>
      a.effectiveFrom.getTime() < (b.effectiveTo?.getTime() ?? Infinity) && b.effectiveFrom.getTime() < (a.effectiveTo?.getTime() ?? Infinity);
    return others.filter((o) => o.scopeValue.toLowerCase() === rule.scopeValue.toLowerCase() && overlaps(o, rule));
  }

  async deactivate(u: Principal, id: string) {
    const claimed = await this.prisma.warrantyRule.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'INACTIVE' } });
    if (!claimed.count) throw new ConflictException('Only ACTIVE rules can be deactivated');
    const rule = await this.prisma.warrantyRule.findUniqueOrThrow({ where: { id } });
    await this.audit(u.id, 'WARRANTY_RULE_DEACTIVATED', id, { ruleCode: rule.ruleCode, version: rule.version });
    return rule;
  }

  // ── Lookup ─────────────────────────────────────────────────────────────
  async lookup(u: Principal, q: { serial?: string; stockItemId?: string; asOf?: string; context?: string; ref?: string }) {
    if (!q.serial && !q.stockItemId) throw new BadRequestException('Give a serial number or a stock item');
    const asOf = q.asOf ? new Date(q.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) throw new BadRequestException('Invalid asOf');
    const context = q.context && WARRANTY_CONTEXTS.includes(q.context) ? q.context : 'LOOKUP';
    const units = await this.prisma.stockItem.findMany({
      where: q.stockItemId ? { id: q.stockItemId } : { serialNumber: { equals: q.serial!.trim(), mode: 'insensitive' } },
      include: { product: true, goodsReceivingItems: { select: { receiving: { select: { supplierId: true, invoiceNumber: true } } } } },
      orderBy: { receivedDate: 'desc' },
      take: 20,
    });
    const visible = units.filter((s) => canAccessWarehouse(u, s.warehouseId));
    const rules = (await this.prisma.warrantyRule.findMany({ where: { status: 'ACTIVE' } })) as unknown as RuleLike[];

    if (!visible.length) {
      const check = await this.prisma.warrantyCheck.create({
        data: {
          serialNumber: q.serial ?? null, stockItemId: q.stockItemId ?? null, status: 'NOT_FOUND', asOf, context, contextRef: q.ref ?? null, checkedById: u.id,
          explanation: { reason: 'No stock unit with this serial number in the warehouses you can access.' },
        },
      });
      return { asOf, results: [], check };
    }

    const issued = await this.prisma.fulfillmentTaskItem.findMany({
      where: { stockItemId: { in: visible.map((s) => s.id) }, task: { status: { not: 'CANCELLED' }, shipment: { is: { shippedAt: { not: null } } } } },
      select: { stockItemId: true, task: { select: { shipment: { select: { shippedAt: true } } } } },
    });
    const serials = visible.map((s) => s.serialNumber).filter((x): x is string => !!x);
    const recorded = serials.length ? await this.prisma.warrantyDateRecord.findMany({ where: { serialNumber: { in: serials, mode: 'insensitive' } } }) : [];

    const results: unknown[] = [];
    for (const s of visible) {
      const issueDates = issued.filter((i) => i.stockItemId === s.id).map((i) => i.task.shipment!.shippedAt!).sort((a, b) => b.getTime() - a.getTime());
      const rec = (t: StartBasis) => recorded.find((r) => r.dateType === t && !!s.serialNumber && r.serialNumber.toLowerCase() === s.serialNumber.toLowerCase())?.date ?? null;
      const facts: UnitFacts = {
        serialNumber: s.serialNumber, productId: s.productId, model: s.product.model, category: s.product.category,
        brandId: s.product.brandId, productType: s.product.productType,
        vendorIds: [...new Set(s.goodsReceivingItems.map((g) => g.receiving.supplierId).filter((x): x is string => !!x))],
        dates: {
          RECEIPT_DATE: s.receivedDate, GOODS_ISSUE_DATE: issueDates[0] ?? null,
          INVOICE_DATE: rec('INVOICE_DATE'), INSTALLATION_DATE: rec('INSTALLATION_DATE'), ACTIVATION_DATE: rec('ACTIVATION_DATE'),
        },
      };
      const d = evaluateWarranty(rules, facts, asOf);
      const explanation = {
        reason: d.reason,
        candidates: d.candidates,
        conflictingRules: d.conflictingRules,
        datesKnown: Object.fromEntries(Object.entries(facts.dates).map(([k, v]) => [k, v ? v.toISOString().slice(0, 10) : null])),
        precedence: Object.entries(SPECIFICITY).sort((a, b) => a[1] - b[1]).map(([k]) => k),
        daysRemaining: d.daysRemaining,
      };
      const check = await this.prisma.warrantyCheck.create({
        data: {
          serialNumber: s.serialNumber, stockItemId: s.id, productId: s.productId, ruleId: d.rule?.id ?? null, ruleCode: d.rule?.ruleCode ?? null,
          ruleVersion: d.rule?.version ?? null, status: d.status, startBasis: d.startBasis, startDate: d.startDate, expiryDate: d.expiryDate,
          asOf, explanation: explanation as unknown as Prisma.InputJsonValue, context, contextRef: q.ref ?? null, checkedById: u.id,
        },
      });
      results.push({
        stockItem: { id: s.id, serialNumber: s.serialNumber, status: s.status, warehouseId: s.warehouseId, receivedDate: s.receivedDate },
        product: { id: s.product.id, code: s.product.code, name: s.product.name, model: s.product.model, category: s.product.category },
        status: d.status,
        rule: d.rule ? { id: d.rule.id, ruleCode: d.rule.ruleCode, version: d.rule.version, name: d.rule.name, warrantyType: d.rule.warrantyType, durationValue: d.rule.durationValue, durationUnit: d.rule.durationUnit } : null,
        startBasis: d.startBasis, startDate: d.startDate, expiryDate: d.expiryDate, daysRemaining: d.daysRemaining,
        explanation, checkId: check.id,
      });
    }
    return { asOf, results };
  }

  async history(u: Principal, q: { serial?: string; stockItemId?: string; take?: string }) {
    const rows = await this.prisma.warrantyCheck.findMany({
      where: {
        ...(q.serial ? { serialNumber: { equals: q.serial.trim(), mode: 'insensitive' } } : {}),
        ...(q.stockItemId ? { stockItemId: q.stockItemId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, Number(q.take) || 100),
    });
    const stock = await this.prisma.stockItem.findMany({ where: { id: { in: rows.map((r) => r.stockItemId).filter((x): x is string => !!x) } }, select: { id: true, warehouseId: true } });
    const wh = new Map(stock.map((s) => [s.id, s.warehouseId]));
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.checkedById).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
    const un = new Map(users.map((x) => [x.id, x.fullName]));
    return rows
      // Checks with no unit (NOT_FOUND) are visible to their author and to unrestricted users only.
      .filter((r) => (r.stockItemId ? canAccessWarehouse(u, wh.get(r.stockItemId)) : r.checkedById === u.id || !scopedWarehouseIds(u)))
      .map((r) => ({ ...r, checkedBy: r.checkedById ? un.get(r.checkedById) ?? null : null }));
  }

  // ── Dates the WMS does not capture ─────────────────────────────────────
  listDates(serial: string) {
    return this.prisma.warrantyDateRecord.findMany({ where: { serialNumber: { equals: serial.trim(), mode: 'insensitive' } }, orderBy: { dateType: 'asc' } });
  }

  async recordDate(u: Principal, dto: WarrantyDateDto) {
    const serialNumber = dto.serialNumber.trim();
    const date = new Date(dto.date);
    const before = await this.prisma.warrantyDateRecord.findUnique({ where: { serialNumber_dateType: { serialNumber, dateType: dto.dateType as never } } });
    const row = await this.prisma.warrantyDateRecord.upsert({
      where: { serialNumber_dateType: { serialNumber, dateType: dto.dateType as never } },
      update: { date, reference: dto.reference ?? null, source: dto.source ?? null, notes: dto.notes ?? null, recordedById: u.id },
      create: { serialNumber, dateType: dto.dateType as never, date, reference: dto.reference ?? null, source: dto.source ?? null, notes: dto.notes ?? null, recordedById: u.id },
    });
    await this.prisma.auditLog.create({
      data: { userId: u.id, action: 'WARRANTY_DATE_RECORDED', entityType: 'WarrantyDateRecord', entityId: row.id, detail: JSON.stringify({ serialNumber, dateType: dto.dateType, from: before?.date ?? null, to: date, reference: dto.reference }) },
    });
    return row;
  }
}

/** Drops keys whose value is undefined (DTO instances carry every declared property). */
function definedOnly<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
