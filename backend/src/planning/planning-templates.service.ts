import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PlanningTemplate } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS, hasAccess } from '../auth/access';
import { assertWarehouseAccess } from '../common/warehouse-scope';
import { assertNotSelfApproval } from '../common/separation-of-duties';
import type { Principal } from './planning.service';
import {
  CreateTemplateDto,
  TemplateDecisionDto,
  UpdateTemplateDto,
} from './dto/planning.dto';

/** What a template carries. Never costs, rates, prices, headcount or holidays. */
export interface TemplateContent {
  transferBatchSize: number | null;
  calendar: Record<string, unknown>;
  labor: Record<string, unknown>;
  stages: Record<string, unknown>[];
  space: Record<string, unknown>;
  materials: Record<string, unknown>[];
}

const pick = (o: unknown, keys: string[]) => {
  const src = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
  return Object.fromEntries(
    keys.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]),
  );
};

const STAGE_KEYS = [
  'key', 'name', 'dependsOn', 'timeBasis', 'stdMinutesPerUnit',
  'unitsPerPersonShift', 'productivitySource', 'setupMinutes', 'changeovers',
  'workstations', 'operatorsPerStation', 'yieldPct', 'reworkPct', 'bufferPct',
  'skill', 'benchAreaM2', 'isQualityGate', 'completionCriteria',
];

/** Builds template content from calculated scenario inputs (cost data is dropped). */
export function templateContent(i: Record<string, any>): TemplateContent {
  return {
    transferBatchSize:
      typeof i.transferBatchSize === 'number' ? i.transferBatchSize : null,
    calendar: pick(i.calendar, [
      'workingDays', 'shiftsPerDay', 'hoursPerShift', 'breakMinutesPerShift',
    ]),
    labor: pick(i.labor, ['absencePct', 'utilizationPct']),
    stages: (Array.isArray(i.stages) ? i.stages : []).map((s: unknown) =>
      pick(s, STAGE_KEYS),
    ),
    space: pick(i.space, [
      'unitsPerCarton', 'cartonsPerPallet', 'palletLengthM', 'palletWidthM',
      'stackLevels', 'receiptPattern', 'storageDwellDays',
      'receivingDwellDays', 'dispatchDwellDays', 'capacityRiskPct',
    ]),
    materials: (Array.isArray(i.materials) ? i.materials : []).map(
      (m: unknown) =>
        pick(m, [
          'productId', 'itemName', 'unit', 'stageKey', 'qtyPerUnit',
          'scrapPct', 'leadTimeDays', 'packMultiple', 'unitsPerPallet',
        ]),
    ),
  };
}

/** Stages a template may not be saved without: every one needs a standard time and workstations. */
function missingStandards(c: TemplateContent): string[] {
  const out: string[] = [];
  if (!c.stages.length) out.push('The scenario has no stages');
  for (const s of c.stages) {
    const perShift = s.timeBasis === 'UNITS_PER_PERSON_SHIFT';
    const v = perShift ? s.unitsPerPersonShift : s.stdMinutesPerUnit;
    if (!(typeof v === 'number' && v > 0))
      out.push(`${String(s.name)}: no standard ${perShift ? 'output per person-shift' : 'minutes per unit'}`);
    if (!(typeof s.workstations === 'number' && s.workstations >= 1))
      out.push(`${String(s.name)}: no number of workstations`);
  }
  return out;
}

/**
 * Company planning templates. A template is saved from a calculated scenario,
 * confirmed by a second person (maker ≠ checker) with the basis of its numbers,
 * and only then offered when a new project is created. Planning data only.
 */
@Injectable()
export class PlanningTemplatesService {
  constructor(private prisma: PrismaService) {}

  private audit(userId: string, action: string, id: string, detail: string) {
    return this.prisma.auditLog.create({
      data: { userId, action, entityType: 'PlanningTemplate', entityId: id, detail },
    });
  }

  private async get(id: string): Promise<PlanningTemplate> {
    const t = await this.prisma.planningTemplate.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Template not found');
    return t;
  }

  private async names(ids: (string | null)[]) {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    const users = list.length
      ? await this.prisma.user.findMany({
          where: { id: { in: list } },
          select: { id: true, fullName: true },
        })
      : [];
    return new Map(users.map((x) => [x.id, x.fullName]));
  }

  private view(t: PlanningTemplate, who: Map<string, string>, full: boolean) {
    const c = JSON.parse(t.content) as TemplateContent;
    return {
      id: t.id,
      code: t.code,
      name: t.name,
      projectType: t.projectType,
      description: t.description,
      status: t.status,
      basis: t.basis,
      replacesId: t.replacesId,
      sourceProjectId: t.sourceProjectId,
      version: t.version,
      createdAt: t.createdAt,
      createdById: t.createdById,
      createdBy: t.createdById ? (who.get(t.createdById) ?? null) : null,
      confirmedAt: t.confirmedAt,
      confirmedBy: t.confirmedById ? (who.get(t.confirmedById) ?? null) : null,
      retiredAt: t.retiredAt,
      retiredBy: t.retiredById ? (who.get(t.retiredById) ?? null) : null,
      stageCount: c.stages.length,
      materialCount: c.materials.length,
      stageNames: c.stages.map((s) => String(s.name)),
      ...(full ? { content: c } : {}),
    };
  }

  async list(u: Principal, status?: string) {
    const rows = await this.prisma.planningTemplate.findMany({
      where: status ? { status } : { status: { not: 'RETIRED' } },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      take: 500,
    });
    const who = await this.names(
      rows.flatMap((t) => [t.createdById, t.confirmedById, t.retiredById]),
    );
    return {
      rows: rows.map((t) => this.view(t, who, false)),
      userId: u.id,
      canManage: hasAccess(u, ACCESS.planningManage),
      canApprove: hasAccess(u, ACCESS.planningApprove),
    };
  }

  async detail(id: string) {
    const t = await this.get(id);
    const who = await this.names([t.createdById, t.confirmedById, t.retiredById]);
    const products = (JSON.parse(t.content) as TemplateContent).materials
      .map((m) => m.productId)
      .filter((x): x is string => typeof x === 'string' && !!x);
    const prod = products.length
      ? await this.prisma.product.findMany({
          where: { id: { in: products } },
          select: { id: true, code: true, name: true },
        })
      : [];
    return { ...this.view(t, who, true), products: prod };
  }

  /** Save the inputs of a calculated run as a DRAFT template. */
  async create(dto: CreateTemplateDto, u: Principal) {
    const run = await this.prisma.planningRun.findUnique({
      where: { id: dto.runId },
      include: { project: true, scenario: { select: { id: true } } },
    });
    if (!run) throw new NotFoundException('Calculation run not found');
    if (run.project.warehouseId)
      assertWarehouseAccess(u, run.project.warehouseId, "this project's warehouse");
    if (run.overallStatus === 'INSUFFICIENT_DATA')
      throw new BadRequestException(
        'This run could not be calculated — fix the inputs first, then save the scenario as a template',
      );
    const { inputs } = JSON.parse(run.inputSnapshot) as {
      inputs: Record<string, any>;
    };
    const content = templateContent(inputs);
    const gaps = missingStandards(content);
    if (gaps.length)
      throw new BadRequestException(
        `A template needs a standard for every stage: ${gaps.join('; ')}`,
      );
    if (dto.replacesId) {
      const old = await this.get(dto.replacesId);
      if (old.status !== 'CONFIRMED')
        throw new BadRequestException('Only a confirmed template can be replaced');
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const n = (await this.prisma.planningTemplate.count()) + 1 + attempt;
      const code = `TPL-${String(n).padStart(4, '0')}`;
      try {
        const t = await this.prisma.planningTemplate.create({
          data: {
            code,
            name: dto.name.trim(),
            projectType: dto.projectType ?? run.project.projectType,
            description: dto.description?.trim() || null,
            basis: dto.basis?.trim() || null,
            content: JSON.stringify(content),
            sourceProjectId: run.projectId,
            sourceScenarioId: run.scenarioId,
            sourceRunId: run.id,
            replacesId: dto.replacesId || null,
            createdById: u.id,
          },
        });
        await this.audit(
          u.id,
          'PLANNING_TEMPLATE_CREATE',
          t.id,
          `${code} "${t.name}" saved as draft from ${run.project.code} run #${run.runNumber} (${content.stages.length} stages, ${content.materials.length} materials)`,
        );
        return this.detail(t.id);
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        )
          continue;
        throw e;
      }
    }
    throw new ConflictException('Could not allocate a template code — try again');
  }

  private async write(
    t: PlanningTemplate,
    version: number | undefined,
    data: Prisma.PlanningTemplateUpdateManyMutationInput,
  ) {
    const res = await this.prisma.planningTemplate.updateMany({
      where: { id: t.id, version: version ?? t.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (!res.count)
      throw new ConflictException(
        'The template was changed by someone else — reload and try again',
      );
  }

  async update(id: string, dto: UpdateTemplateDto, u: Principal) {
    const t = await this.get(id);
    if (t.status !== 'DRAFT')
      throw new ConflictException(
        'A confirmed template cannot be changed. Save a scenario as a new template that replaces it.',
      );
    await this.write(t, dto.version, {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
      ...(dto.basis !== undefined ? { basis: dto.basis.trim() || null } : {}),
      ...(dto.projectType !== undefined ? { projectType: dto.projectType } : {}),
    });
    await this.audit(u.id, 'PLANNING_TEMPLATE_UPDATE', id, `${t.code} details edited`);
    return this.detail(id);
  }

  /** Second person confirms the numbers. Retires the template it replaces. */
  async confirm(id: string, dto: TemplateDecisionDto, u: Principal) {
    const t = await this.get(id);
    if (t.status !== 'DRAFT')
      throw new ConflictException(`Template is ${t.status.toLowerCase()}, not a draft`);
    assertNotSelfApproval(u.id, [t.createdById], 'a planning template');
    const basis = (dto.basis ?? t.basis ?? '').trim();
    if (!basis)
      throw new BadRequestException(
        'State the basis of the standard values (e.g. time study, completed project) before confirming',
      );
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.planningTemplate.updateMany({
        where: { id, version: dto.version ?? t.version, status: 'DRAFT' },
        data: {
          status: 'CONFIRMED',
          basis,
          confirmedById: u.id,
          confirmedAt: now,
          version: { increment: 1 },
        },
      });
      if (!res.count)
        throw new ConflictException('The template was changed by someone else — reload and try again');
      if (t.replacesId)
        await tx.planningTemplate.updateMany({
          where: { id: t.replacesId, status: 'CONFIRMED' },
          data: { status: 'RETIRED', retiredById: u.id, retiredAt: now, version: { increment: 1 } },
        });
    });
    await this.audit(
      u.id,
      'PLANNING_TEMPLATE_CONFIRM',
      id,
      `${t.code} confirmed. Basis: ${basis}${t.replacesId ? ' (replaces an earlier template, now retired)' : ''}${dto.note ? `. Note: ${dto.note}` : ''}`,
    );
    return this.detail(id);
  }

  async retire(id: string, dto: TemplateDecisionDto, u: Principal) {
    const t = await this.get(id);
    if (t.status !== 'CONFIRMED')
      throw new ConflictException('Only a confirmed template can be retired');
    await this.write(t, dto.version, {
      status: 'RETIRED',
      retiredById: u.id,
      retiredAt: new Date(),
    });
    await this.audit(u.id, 'PLANNING_TEMPLATE_RETIRE', id, `${t.code} retired${dto.note ? `: ${dto.note}` : ''}`);
    return this.detail(id);
  }

  async remove(id: string, u: Principal) {
    const t = await this.get(id);
    if (t.status !== 'DRAFT')
      throw new ConflictException('Only a draft can be deleted — retire a confirmed template instead');
    if (t.createdById !== u.id && !hasAccess(u, ACCESS.planningApprove))
      throw new ForbiddenException('Only its author or an approver can delete this draft');
    await this.prisma.planningTemplate.delete({ where: { id } });
    await this.audit(u.id, 'PLANNING_TEMPLATE_DELETE', id, `${t.code} "${t.name}" draft deleted`);
    return { ok: true };
  }

  /**
   * Starting inputs for a new project from a CONFIRMED template. Stage values
   * become VALIDATED_STANDARD (the company confirmed them). Free-text materials
   * are copied only into sales simulations.
   */
  async startingInputs(id: string, purpose: string) {
    const t = await this.get(id);
    if (t.status !== 'CONFIRMED')
      throw new BadRequestException('Only a confirmed template can start a project');
    const c = JSON.parse(t.content) as TemplateContent;
    const sales = purpose === 'SALES';
    const skipped = sales
      ? []
      : c.materials.filter((m) => !m.productId).map((m) => String(m.itemName ?? '?'));
    return {
      template: t,
      content: c,
      stages: c.stages.map((s) => ({ ...s, productivitySource: 'VALIDATED_STANDARD' })),
      materials: c.materials
        .filter((m) => sales || !!m.productId)
        .map((m) => ({ unitCostOverride: null, ...m, source: 'MANUAL' })),
      note:
        `Started from company template ${t.code} "${t.name}" (confirmed ${t.confirmedAt?.toISOString().slice(0, 10)}). ` +
        (skipped.length
          ? `Free-text materials not copied — an operational plan needs Product Master items: ${skipped.join(', ')}.`
          : ''),
    };
  }
}
