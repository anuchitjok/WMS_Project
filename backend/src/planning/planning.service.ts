import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  PlanningProject,
  PlanningRun,
  PlanningScenario,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS, AccessPrincipal, hasAccess } from '../auth/access';
import {
  ScopePrincipal,
  assertWarehouseAccess,
  warehouseFilter,
} from '../common/warehouse-scope';
import { assertNotSelfApproval } from '../common/separation-of-duties';
import { calculatePlan } from './engine/engine';
import {
  DataSnapshot,
  ENGINE_VERSION,
  PlanResult,
  ProjectHeader,
} from './engine/types';
import { PlanningDataService } from './planning-data.service';
import { PlanningTemplatesService } from './planning-templates.service';
import { WORKFLOW_TEMPLATES, templateStageInput } from './templates';
import {
  CreateProjectDto,
  CreateScenarioDto,
  UpdateProjectDto,
  UpdateScenarioDto,
} from './dto/planning.dto';

export type Principal = AccessPrincipal & ScopePrincipal & { id: string };

const MAX_INPUT_BYTES = 200_000;
const day = (d: Date) => d.toISOString().slice(0, 10);
const LOCKED_FOR_EDIT = ['IN_REVIEW', 'ARCHIVED'];

/**
 * Project Planning — projects, scenarios, calculation runs and plan review.
 *
 * PLANNING ONLY: this service never writes StockItem, requests, receiving,
 * purchasing or any other operational table. It only reads them (through
 * PlanningDataService) and writes Planning* rows and the audit log.
 */
@Injectable()
export class PlanningService {
  constructor(
    private prisma: PrismaService,
    private data: PlanningDataService,
    private companyTemplates: PlanningTemplatesService,
  ) {}

  // ── helpers ──────────────────────────────────────────────────────────────
  private audit(
    userId: string,
    action: string,
    entityId: string,
    detail: string,
  ) {
    return this.prisma.auditLog.create({
      data: { userId, action, entityType: 'PlanningProject', entityId, detail },
    });
  }

  private canCost(u: Principal) {
    return hasAccess(u, ACCESS.planningCost);
  }

  private async project(id: string, u: Principal): Promise<PlanningProject> {
    const p = await this.prisma.planningProject.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Project not found');
    // A sales simulation without a warehouse holds no warehouse data.
    if (p.warehouseId)
      assertWarehouseAccess(u, p.warehouseId, "this project's warehouse");
    return p;
  }

  private async checkWarehouse(id: string, u: Principal) {
    const wh = await this.prisma.warehouse.findFirst({
      where: { id, isDeleted: false },
      select: { id: true },
    });
    if (!wh) throw new BadRequestException('Warehouse not found');
    assertWarehouseAccess(u, id, 'this warehouse');
  }

  /** Editing an approved plan withdraws the approval (it referred to the old inputs). */
  private async beforeEdit(p: PlanningProject, u: Principal, what: string) {
    if (LOCKED_FOR_EDIT.includes(p.planStatus))
      throw new ConflictException(
        p.planStatus === 'IN_REVIEW'
          ? 'The plan is in review — return it to draft before changing it'
          : 'The project is archived',
      );
    if (p.planStatus === 'PLAN_APPROVED') {
      await this.prisma.planningProject.update({
        where: { id: p.id },
        data: {
          planStatus: 'DRAFT',
          approvedRunId: null,
          version: { increment: 1 },
        },
      });
      await this.audit(
        u.id,
        'PLANNING_APPROVAL_WITHDRAWN',
        p.id,
        `${p.code}: plan approval withdrawn because ${what} changed`,
      );
    }
  }

  private parseInputs(s: PlanningScenario) {
    return JSON.parse(s.inputs) as Record<string, any>;
  }

  /** Removes cost data for users without cost visibility. */
  private redactInputs(inputs: Record<string, any>) {
    const c = structuredClone(inputs);
    if (c.labor) delete c.labor.laborRatePerHour;
    if (Array.isArray(c.materials))
      c.materials.forEach((m: any) => delete m.unitCostOverride);
    delete c.costs;
    return c;
  }

  private redactResult(r: PlanResult): PlanResult {
    const c = structuredClone(r);
    c.cost = null;
    c.summary.estimatedCost = null;
    c.materials.forEach((m) => {
      m.unitCost = null;
      m.totalCost = null;
      m.explanation = m.explanation
        .replace(/[^.]*(cost|exchange rate)[^.]*\.\s*/gi, '')
        .trim();
    });
    c.whatIfs.forEach(
      (w) => (w.tradeOff = w.tradeOff.replace(/\s*\(about [^)]*\)/, '')),
    );
    c.risks = c.risks.filter((x) => x.area !== 'Cost');
    return c;
  }

  // ── reference data ───────────────────────────────────────────────────────
  templates() {
    return WORKFLOW_TEMPLATES;
  }

  // ── projects ─────────────────────────────────────────────────────────────
  async listProjects(
    u: Principal,
    q: {
      warehouseId?: string;
      status?: string;
      search?: string;
      purpose?: string;
    },
  ) {
    const wh = warehouseFilter(u, q.warehouseId);
    const rows = await this.prisma.planningProject.findMany({
      where: {
        // Scoped users also see sales simulations that name no warehouse.
        ...(wh
          ? q.warehouseId
            ? { warehouseId: wh }
            : { OR: [{ warehouseId: wh }, { warehouseId: null }] }
          : {}),
        ...(q.purpose ? { purpose: q.purpose } : {}),
        ...(q.status
          ? { planStatus: q.status }
          : { planStatus: { not: 'ARCHIVED' } }),
        ...(q.search
          ? {
              AND: [
                {
                  OR: [
                    { name: { contains: q.search, mode: 'insensitive' } },
                    { code: { contains: q.search, mode: 'insensitive' } },
                  ],
                },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: {
        _count: { select: { scenarios: true, runs: true } },
        runs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            overallStatus: true,
            flags: true,
            createdAt: true,
          },
        },
      },
    });
    const whs = await this.prisma.warehouse.findMany({
      where: {
        id: {
          in: [
            ...new Set(
              rows.map((r) => r.warehouseId).filter((x): x is string => !!x),
            ),
          ],
        },
      },
      select: { id: true, code: true, name: true },
    });
    return rows.map(({ runs, ...p }) => ({
      ...p,
      warehouse: whs.find((w) => w.id === p.warehouseId) ?? null,
      latestRun: runs[0]
        ? { ...runs[0], flags: runs[0].flags ? runs[0].flags.split(',') : [] }
        : null,
    }));
  }

  async getProject(id: string, u: Principal) {
    const p = await this.project(id, u);
    const [scenarios, runs, warehouse, product] = await Promise.all([
      this.prisma.planningScenario.findMany({
        where: { projectId: id },
        orderBy: [{ isBaseline: 'desc' }, { createdAt: 'asc' }],
      }),
      this.prisma.planningRun.findMany({
        where: { projectId: id },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          scenarioId: true,
          runNumber: true,
          engineVersion: true,
          asOfDate: true,
          inputHash: true,
          overallStatus: true,
          flags: true,
          createdById: true,
          createdAt: true,
        },
      }),
      p.warehouseId
        ? this.prisma.warehouse.findUnique({
            where: { id: p.warehouseId },
            select: { id: true, code: true, name: true },
          })
        : null,
      p.productId
        ? this.prisma.product.findUnique({
            where: { id: p.productId },
            select: { id: true, code: true, name: true },
          })
        : null,
    ]);
    const cost = this.canCost(u);
    const userIds = [
      ...new Set(
        [
          p.createdById,
          p.submittedById,
          p.reviewedById,
          p.ownerId,
          ...runs.map((r) => r.createdById),
        ].filter((x): x is string => !!x),
      ),
    ];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true, username: true },
    });
    const companyTemplate = p.companyTemplateId
      ? await this.prisma.planningTemplate.findUnique({
          where: { id: p.companyTemplateId },
          select: { id: true, code: true, name: true, status: true, confirmedAt: true },
        })
      : null;
    return {
      ...p,
      warehouse,
      product,
      companyTemplate,
      users,
      canViewCost: cost,
      canManage: hasAccess(u, ACCESS.planningManage),
      canApprove: hasAccess(u, ACCESS.planningApprove),
      scenarios: scenarios.map((s) => ({
        ...s,
        inputs: cost
          ? this.parseInputs(s)
          : this.redactInputs(this.parseInputs(s)),
      })),
      runs: runs.map((r) => ({
        ...r,
        flags: r.flags ? r.flags.split(',') : [],
      })),
    };
  }

  async createProject(dto: CreateProjectDto, u: Principal) {
    const purpose = dto.purpose ?? 'OPERATIONAL';
    if (dto.warehouseId) await this.checkWarehouse(dto.warehouseId, u);
    else if (purpose === 'OPERATIONAL')
      throw new BadRequestException('Choose the warehouse for this project');
    if (
      dto.productId &&
      !(await this.prisma.product.findUnique({
        where: { id: dto.productId },
        select: { id: true },
      }))
    )
      throw new BadRequestException('Product not found');
    if (dto.targetEnd < dto.plannedStart)
      throw new BadRequestException(
        'Target completion date is before the planned start date',
      );
    const template =
      WORKFLOW_TEMPLATES.find(
        (t) => t.key === (dto.templateKey ?? dto.projectType),
      ) ?? WORKFLOW_TEMPLATES.find((t) => t.key === 'CUSTOM')!;
    const company = dto.companyTemplateId
      ? await this.companyTemplates.startingInputs(dto.companyTemplateId, purpose)
      : null;
    const inputs: Record<string, any> = {
      quantity: dto.quantity,
      warehouseId: null,
      transferBatchSize: null,
      calendar: {
        workingDays: [1, 2, 3, 4, 5],
        holidays: [],
        shiftsPerDay: 1,
        hoursPerShift: null,
        breakMinutesPerShift: null,
      },
      labor: {
        availableHeadcount: null,
        absencePct: null,
        utilizationPct: null,
        laborRatePerHour: null,
        overtimeAuthorized: false,
        maxOvertimeHoursPerPersonPerDay: 0,
        overtimePremiumPct: 0,
      },
      stages: template.stages.map(templateStageInput),
      materials: [],
      manualInbound: [],
      space: { receiptPattern: 'ALL_AT_START' },
      costs: {
        masterCostCurrency: null,
        fxRateMasterToProject: null,
        otherCosts: [],
      },
      readiness: { workstationsConfirmed: false, equipmentConfirmed: false },
      includePendingRequests: true,
    };
    if (company) {
      // Company-confirmed standards; holidays, headcount, costs and prices stay per project.
      const c = company.content;
      inputs.transferBatchSize = c.transferBatchSize;
      inputs.calendar = { ...inputs.calendar, ...c.calendar };
      inputs.labor = { ...inputs.labor, ...c.labor };
      inputs.space = { ...inputs.space, ...c.space };
      inputs.stages = company.stages;
      inputs.materials = company.materials;
    }
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    for (let attempt = 0; attempt < 4; attempt++) {
      const n =
        (await this.prisma.planningProject.count({
          where: { code: { startsWith: `PRJ-${stamp}-` } },
        })) +
        1 +
        attempt;
      const code = `PRJ-${stamp}-${String(n).padStart(4, '0')}`;
      try {
        const p = await this.prisma.planningProject.create({
          data: {
            code,
            name: dto.name.trim(),
            projectType: dto.projectType,
            description: dto.description,
            customer: dto.customer,
            department: dto.department,
            productId: dto.productId || null,
            scope: dto.scope,
            purpose,
            warehouseId: dto.warehouseId || null,
            workLocation: dto.workLocation,
            priority: dto.priority,
            ownerId: dto.ownerId || u.id,
            teams: dto.teams,
            plannedStart: new Date(`${dto.plannedStart}T00:00:00Z`),
            targetEnd: new Date(`${dto.targetEnd}T00:00:00Z`),
            currency: dto.currency ?? 'THB',
            companyTemplateId: company?.template.id ?? null,
            createdById: u.id,
            scenarios: {
              create: {
                name: 'Baseline',
                isBaseline: true,
                notes: company?.note || null,
                inputs: JSON.stringify(inputs),
                createdById: u.id,
              },
            },
          },
        });
        await this.audit(
          u.id,
          'PLANNING_PROJECT_CREATE',
          p.id,
          `${code} "${p.name}" created${purpose === 'SALES' ? ' as a sales simulation' : ''} (${company ? `company template ${company.template.code}` : `template ${template.key}`}, quantity ${dto.quantity})`,
        );
        return p;
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        )
          continue;
        throw e;
      }
    }
    throw new ConflictException(
      'Could not allocate a project code — try again',
    );
  }

  async updateProject(id: string, dto: UpdateProjectDto, u: Principal) {
    const p = await this.project(id, u);
    if (dto.version !== p.version)
      throw new ConflictException(
        'The project was changed by someone else — reload and try again',
      );
    if (dto.warehouseId === '' && p.purpose !== 'SALES')
      throw new BadRequestException('An operational project needs a warehouse');
    if (dto.warehouseId && dto.warehouseId !== p.warehouseId)
      await this.checkWarehouse(dto.warehouseId, u);
    if (
      dto.productId &&
      !(await this.prisma.product.findUnique({
        where: { id: dto.productId },
        select: { id: true },
      }))
    )
      throw new BadRequestException('Product not found');
    const start = dto.plannedStart ?? day(p.plannedStart);
    const end = dto.targetEnd ?? day(p.targetEnd);
    if (end < start)
      throw new BadRequestException(
        'Target completion date is before the planned start date',
      );
    await this.beforeEdit(p, u, 'the project details');
    // beforeEdit may have bumped the version (approval withdrawn); lock on the current one.
    const current = await this.prisma.planningProject.findUniqueOrThrow({
      where: { id },
      select: { version: true },
    });
    const { version, plannedStart, targetEnd, warehouseId, ...rest } = dto;
    void version;
    const res = await this.prisma.planningProject.updateMany({
      where: { id, version: current.version },
      data: {
        ...rest,
        ...(warehouseId !== undefined
          ? { warehouseId: warehouseId || null }
          : {}),
        ...(plannedStart
          ? { plannedStart: new Date(`${plannedStart}T00:00:00Z`) }
          : {}),
        ...(targetEnd ? { targetEnd: new Date(`${targetEnd}T00:00:00Z`) } : {}),
        version: { increment: 1 },
      },
    });
    if (!res.count)
      throw new ConflictException(
        'The project was changed by someone else — reload and try again',
      );
    const changed = Object.keys(dto).filter((k) => k !== 'version');
    await this.audit(
      u.id,
      'PLANNING_PROJECT_UPDATE',
      id,
      `${p.code}: changed ${changed.join(', ') || 'nothing'}`,
    );
    return this.prisma.planningProject.findUniqueOrThrow({ where: { id } });
  }

  // ── scenarios ────────────────────────────────────────────────────────────
  async createScenario(
    projectId: string,
    dto: CreateScenarioDto,
    u: Principal,
  ) {
    const p = await this.project(projectId, u);
    if (p.planStatus === 'ARCHIVED')
      throw new ConflictException('The project is archived');
    let inputs: string;
    if (dto.cloneFromId) {
      const src = await this.prisma.planningScenario.findFirst({
        where: { id: dto.cloneFromId, projectId },
      });
      if (!src)
        throw new BadRequestException(
          'Scenario to copy not found in this project',
        );
      inputs = src.inputs;
    } else {
      const base = await this.prisma.planningScenario.findFirst({
        where: { projectId, isBaseline: true },
      });
      inputs = base?.inputs ?? '{}';
    }
    const s = await this.prisma.planningScenario.create({
      data: {
        projectId,
        name: dto.name.trim(),
        notes: dto.notes,
        inputs,
        createdById: u.id,
      },
    });
    await this.audit(
      u.id,
      'PLANNING_SCENARIO_CREATE',
      projectId,
      `${p.code}: scenario "${s.name}" created${dto.cloneFromId ? ' (copy)' : ''}`,
    );
    return {
      ...s,
      inputs: this.canCost(u)
        ? JSON.parse(s.inputs)
        : this.redactInputs(JSON.parse(s.inputs)),
    };
  }

  async updateScenario(
    projectId: string,
    scenarioId: string,
    dto: UpdateScenarioDto,
    u: Principal,
  ) {
    const p = await this.project(projectId, u);
    const s = await this.prisma.planningScenario.findFirst({
      where: { id: scenarioId, projectId },
    });
    if (!s) throw new NotFoundException('Scenario not found');
    if (dto.version !== s.version)
      throw new ConflictException(
        'The scenario was changed by someone else — reload and try again',
      );

    let inputsJson: string | undefined;
    let detail = '';
    if (dto.inputs) {
      const old = this.parseInputs(s);
      const next = structuredClone(dto.inputs) as Record<string, any>;
      // Users without cost visibility cannot see — so must not erase — cost inputs.
      if (!this.canCost(u)) {
        next.costs = old.costs;
        next.labor = {
          ...(next.labor ?? {}),
          laborRatePerHour: old.labor?.laborRatePerHour ?? null,
        };
        if (Array.isArray(next.materials))
          next.materials.forEach((m: any) => {
            m.unitCostOverride =
              (old.materials ?? []).find(
                (o: any) => o.productId === m.productId,
              )?.unitCostOverride ?? null;
          });
      }
      if (next.warehouseId)
        await this.checkWarehouse(String(next.warehouseId), u);
      inputsJson = JSON.stringify(next);
      if (inputsJson.length > MAX_INPUT_BYTES)
        throw new BadRequestException('Scenario inputs are too large');
      detail = describeInputChange(old, next);
    }
    if (dto.isBaseline === false && s.isBaseline)
      throw new BadRequestException(
        'Make another scenario the baseline instead',
      );
    if (dto.inputs || dto.name || dto.notes !== undefined || dto.isBaseline)
      await this.beforeEdit(p, u, `scenario "${s.name}"`);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isBaseline && !s.isBaseline)
        await tx.planningScenario.updateMany({
          where: { projectId, isBaseline: true },
          data: { isBaseline: false },
        });
      const res = await tx.planningScenario.updateMany({
        where: { id: scenarioId, version: s.version },
        data: {
          name: dto.name?.trim(),
          notes: dto.notes,
          isBaseline: dto.isBaseline || undefined,
          inputs: inputsJson,
          version: { increment: 1 },
        },
      });
      if (!res.count)
        throw new ConflictException(
          'The scenario was changed by someone else — reload and try again',
        );
      return tx.planningScenario.findUniqueOrThrow({
        where: { id: scenarioId },
      });
    });
    await this.audit(
      u.id,
      'PLANNING_SCENARIO_UPDATE',
      projectId,
      `${p.code} / ${updated.name}: ${detail || 'details changed'}`,
    );
    return {
      ...updated,
      inputs: this.canCost(u)
        ? JSON.parse(updated.inputs)
        : this.redactInputs(JSON.parse(updated.inputs)),
    };
  }

  async deleteScenario(projectId: string, scenarioId: string, u: Principal) {
    const p = await this.project(projectId, u);
    const s = await this.prisma.planningScenario.findFirst({
      where: { id: scenarioId, projectId },
      include: { _count: { select: { runs: true } } },
    });
    if (!s) throw new NotFoundException('Scenario not found');
    if (s.isBaseline)
      throw new BadRequestException('The baseline scenario cannot be deleted');
    if (s._count.runs)
      throw new ConflictException(
        'This scenario has calculation history and is kept for traceability',
      );
    await this.prisma.planningScenario.delete({ where: { id: scenarioId } });
    await this.audit(
      u.id,
      'PLANNING_SCENARIO_DELETE',
      projectId,
      `${p.code}: scenario "${s.name}" deleted`,
    );
    return { ok: true };
  }

  // ── calculation ──────────────────────────────────────────────────────────
  private header(p: PlanningProject): ProjectHeader {
    return {
      code: p.code,
      name: p.name,
      quantity: 0,
      plannedStart: day(p.plannedStart),
      targetEnd: day(p.targetEnd),
      currency: p.currency,
      warehouseId: p.warehouseId,
      demandType:
        p.planStatus === 'PLAN_APPROVED' ? 'PLAN_APPROVED' : 'PLANNED',
      purpose: p.purpose === 'SALES' ? 'SALES' : 'OPERATIONAL',
    };
  }

  /** Validate → snapshot WMS data → calculate → store an immutable run. Never writes operational data. */
  async calculate(projectId: string, scenarioId: string, u: Principal) {
    const p = await this.project(projectId, u);
    if (p.planStatus === 'ARCHIVED')
      throw new ConflictException('The project is archived');
    const s = await this.prisma.planningScenario.findFirst({
      where: { id: scenarioId, projectId },
    });
    if (!s) throw new NotFoundException('Scenario not found');
    const inputs = this.parseInputs(s);
    const warehouseId =
      typeof inputs.warehouseId === 'string' && inputs.warehouseId
        ? inputs.warehouseId
        : p.warehouseId;
    if (warehouseId)
      assertWarehouseAccess(u, warehouseId, 'the planning warehouse');
    else if (p.purpose !== 'SALES')
      throw new BadRequestException('Choose the warehouse for this project');

    const header = {
      ...this.header(p),
      quantity: Number(inputs.quantity) || 0,
    };
    const productIds = [
      ...(Array.isArray(inputs.materials)
        ? inputs.materials.map((m: any) => String(m?.productId ?? ''))
        : []),
      ...(Array.isArray(inputs.manualInbound)
        ? inputs.manualInbound.map((m: any) => String(m?.productId ?? ''))
        : []),
    ];
    const asOf = day(new Date());
    const snapshot = await this.data.snapshot({
      warehouseId,
      productIds,
      excludeProjectId: projectId,
      asOf,
      sales: p.purpose === 'SALES',
    });
    const result = calculatePlan(header, inputs, snapshot);
    const inputSnapshot = JSON.stringify({ header, inputs });
    const dataSnapshot = JSON.stringify(snapshot);
    const inputHash = createHash('sha256')
      .update(inputSnapshot)
      .update(dataSnapshot)
      .digest('hex');

    let run: PlanningRun | null = null;
    for (let attempt = 0; attempt < 3 && !run; attempt++) {
      const last = await this.prisma.planningRun.findFirst({
        where: { scenarioId },
        orderBy: { runNumber: 'desc' },
        select: { runNumber: true },
      });
      try {
        run = await this.prisma.planningRun.create({
          data: {
            projectId,
            scenarioId,
            runNumber: (last?.runNumber ?? 0) + 1,
            engineVersion: ENGINE_VERSION,
            asOfDate: new Date(`${asOf}T00:00:00Z`),
            inputHash,
            inputSnapshot,
            dataSnapshot,
            result: JSON.stringify(result),
            overallStatus: result.overallStatus,
            flags: result.flags.join(','),
            createdById: u.id,
          },
        });
      } catch (e) {
        if (
          !(
            e instanceof Prisma.PrismaClientKnownRequestError &&
            e.code === 'P2002'
          )
        )
          throw e;
      }
    }
    if (!run)
      throw new ConflictException(
        'Another calculation finished at the same time — try again',
      );
    await this.audit(
      u.id,
      'PLANNING_CALCULATE',
      projectId,
      `${p.code} / ${s.name}: run #${run.runNumber} → ${result.overallStatus}${result.flags.length ? ` [${result.flags.join(', ')}]` : ''} (inputs ${inputHash.slice(0, 12)})`,
    );
    return this.getRun(projectId, run.id, u);
  }

  async getRun(projectId: string, runId: string, u: Principal) {
    const p = await this.project(projectId, u);
    const run = await this.prisma.planningRun.findFirst({
      where: { id: runId, projectId },
      include: { scenario: { select: { name: true, updatedAt: true } } },
    });
    if (!run) throw new NotFoundException('Calculation run not found');
    let result = JSON.parse(run.result) as PlanResult;
    const approved =
      p.planStatus === 'PLAN_APPROVED' && p.approvedRunId === run.id;
    if (result.overallStatus !== 'INSUFFICIENT_DATA')
      result.readiness = [
        ...result.readiness,
        {
          key: 'approvals',
          label: 'Required approvals completed',
          status: approved ? 'MET' : 'NOT_MET',
          detail: approved
            ? 'Plan approved for planning (not an execution release)'
            : p.planStatus === 'IN_REVIEW' && p.approvedRunId === run.id
              ? 'Submitted — waiting for review'
              : 'Not approved',
        },
      ];
    const cost = this.canCost(u);
    if (!cost) result = this.redactResult(result);
    const { inputSnapshot, dataSnapshot, result: _r, scenario, ...meta } = run;
    void _r;
    const snap = JSON.parse(inputSnapshot) as {
      header: ProjectHeader;
      inputs: Record<string, any>;
    };
    return {
      ...meta,
      flags: run.flags ? run.flags.split(',') : [],
      scenarioName: scenario.name,
      stale: scenario.updatedAt > run.createdAt,
      inputs: cost ? snap.inputs : this.redactInputs(snap.inputs),
      data: cost
        ? JSON.parse(dataSnapshot)
        : redactData(JSON.parse(dataSnapshot) as DataSnapshot),
      result,
    };
  }

  /** Recalculates a stored run from its own snapshots and checks the numbers are identical. */
  async verifyRun(projectId: string, runId: string, u: Principal) {
    await this.project(projectId, u);
    const run = await this.prisma.planningRun.findFirst({
      where: { id: runId, projectId },
    });
    if (!run) throw new NotFoundException('Calculation run not found');
    const snap = JSON.parse(run.inputSnapshot) as {
      header: ProjectHeader;
      inputs: unknown;
    };
    const hash = createHash('sha256')
      .update(run.inputSnapshot)
      .update(run.dataSnapshot)
      .digest('hex');
    const again = calculatePlan(
      snap.header,
      snap.inputs,
      JSON.parse(run.dataSnapshot) as DataSnapshot,
    );
    return {
      runId,
      inputsIntact: hash === run.inputHash,
      sameEngine: run.engineVersion === ENGINE_VERSION,
      resultMatches: JSON.stringify(again) === run.result,
      engineVersion: ENGINE_VERSION,
    };
  }

  /**
   * One-page summary to show or hand to a customer. Built from a whitelist, so
   * it never carries costs, labour rates, margins, stock levels, warehouse
   * capacity, other projects or internal risks — whatever the caller may see.
   */
  async customerSummary(projectId: string, runId: string, u: Principal) {
    const p = await this.project(projectId, u);
    const run = await this.prisma.planningRun.findFirst({
      where: { id: runId, projectId },
      include: { scenario: { select: { name: true, updatedAt: true } } },
    });
    if (!run) throw new NotFoundException('Calculation run not found');
    const r = JSON.parse(run.result) as PlanResult;
    if (r.overallStatus === 'INSUFFICIENT_DATA' || !r.summary.estimatedFinish)
      throw new BadRequestException(
        'This run has no complete schedule — fix the inputs and recalculate first',
      );
    const { inputs } = JSON.parse(run.inputSnapshot) as {
      inputs: Record<string, any>;
    };
    const stageIn = new Map<string, any>(
      (Array.isArray(inputs.stages) ? inputs.stages : []).map((s: any) => [
        String(s?.key),
        s,
      ]),
    );
    const [product, preparer] = await Promise.all([
      p.productId
        ? this.prisma.product.findUnique({
            where: { id: p.productId },
            select: { code: true, name: true },
          })
        : null,
      this.prisma.user.findUnique({
        where: { id: u.id },
        select: { fullName: true },
      }),
    ]);
    const cal = inputs.calendar ?? {};
    const lastHour = Math.max(0, ...r.stages.map((s) => s.finishHour));
    const durationWorkingDays =
      r.calendar.clockHoursPerDay > 0
        ? Math.ceil(lastHour / r.calendar.clockHoursPerDay - 1e-9)
        : null;
    const WEEKDAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const days: number[] = Array.isArray(cal.workingDays)
      ? cal.workingDays.map(Number).filter((d: number) => d >= 1 && d <= 7)
      : [];
    const gates = r.stages.filter((s) => stageIn.get(s.key)?.isQualityGate);
    const q = r.cost?.quote ?? null;
    const notes = [
      `Working calendar: ${days.map((d) => WEEKDAY[d]).join(', ') || '—'}; ${cal.shiftsPerDay ?? '—'} shift(s) per day of ${cal.hoursPerShift ?? '—'} hours.`,
      ...(Array.isArray(cal.holidays) && cal.holidays.length
        ? [`${cal.holidays.length} holiday(s) are excluded from working days.`]
        : []),
      ...(gates.length
        ? [`Quality check at: ${gates.map((s) => s.name).join(', ')}.`]
        : []),
      'Dates are planning estimates based on the working calendar and the agreed process times. They are confirmed only after the order and start date are agreed.',
    ];
    return {
      runId: run.id,
      runNumber: run.runNumber,
      scenarioName: run.scenario.name,
      stale: run.scenario.updatedAt > run.createdAt,
      asOf: r.asOf,
      generatedAt: new Date().toISOString(),
      preparedBy: preparer?.fullName ?? null,
      project: {
        code: p.code,
        name: p.name,
        projectType: p.projectType,
        customer: p.customer,
        scope: p.scope,
        product: product ? `${product.code} — ${product.name}` : null,
      },
      quantity: r.summary.quantity,
      plannedStart: r.summary.plannedStart,
      targetEnd: r.summary.targetEnd,
      estimatedFinish: r.summary.estimatedFinish,
      meetsTarget: (r.summary.scheduleVarianceWorkingDays ?? 0) <= 0,
      durationWorkingDays,
      outputPerDay: r.summary.lineThroughputPerDay,
      teamSize: r.summary.requiredHeadcount,
      shiftsPerDay: cal.shiftsPerDay ?? null,
      stages: r.stages.map((s) => ({
        name: s.name,
        startDate: s.startDate,
        finishDate: s.finishDate,
        workingDays: s.durationWorkingDays,
        isQualityGate: !!stageIn.get(s.key)?.isQualityGate,
        completionCriteria: String(stageIn.get(s.key)?.completionCriteria ?? ''),
      })),
      notes,
      // Customer-facing price only: never the cost, contingency or margin.
      quote:
        q && q.price !== null
          ? {
              price: q.price,
              pricePerUnit: q.pricePerUnit,
              currency: q.currency,
              vatPct: q.vatPct,
              vatAmount: q.vatAmount,
              priceIncludingVat: q.priceIncludingVat,
              validUntil: q.validUntil,
              complete: q.complete,
            }
          : null,
    };
  }

  async compare(projectId: string, runIds: string[], u: Principal) {
    await this.project(projectId, u);
    if (!runIds.length || runIds.length > 6)
      throw new BadRequestException(
        'Choose 1 to 6 calculation runs to compare',
      );
    const runs = await this.prisma.planningRun.findMany({
      where: { id: { in: runIds }, projectId },
      include: { scenario: { select: { name: true } } },
    });
    if (runs.length !== new Set(runIds).size)
      throw new BadRequestException('Some runs do not belong to this project');
    const cost = this.canCost(u);
    return runIds.map((id) => {
      const run = runs.find((r) => r.id === id)!;
      const r = JSON.parse(run.result) as PlanResult;
      const { inputs } = JSON.parse(run.inputSnapshot) as {
        inputs: Record<string, any>;
      };
      return {
        runId: run.id,
        runNumber: run.runNumber,
        scenarioId: run.scenarioId,
        scenarioName: run.scenario.name,
        createdAt: run.createdAt,
        overallStatus: r.overallStatus,
        flags: r.flags,
        quantity: r.summary.quantity,
        shifts: inputs?.calendar?.shiftsPerDay ?? null,
        warehouseId: r.summary.warehouseId,
        requiredHeadcount: r.summary.requiredHeadcount,
        availableHeadcount: r.summary.availableHeadcount,
        estimatedFinish: r.summary.estimatedFinish,
        targetEnd: r.summary.targetEnd,
        scheduleVarianceWorkingDays: r.summary.scheduleVarianceWorkingDays,
        bottleneckStage: r.summary.bottleneckStage,
        totalLaborHours: r.summary.totalLaborHours,
        materialShortageLines: r.summary.materialShortageLines,
        maxSpaceUtilizationPct: r.space.reduce<number | null>(
          (a, s) =>
            s.utilizationPct === null ? a : Math.max(a ?? 0, s.utilizationPct),
          null,
        ),
        spaceStatus: r.summary.spaceStatus,
        estimatedCost: cost ? r.summary.estimatedCost : null,
        costComplete: r.summary.costComplete,
        currency: r.summary.currency,
        highRisks: r.risks
          .filter((x) => x.level === 'HIGH')
          .map((x) => x.message),
      };
    });
  }

  // ── plan review (planning status only — never an execution release) ─────
  private async freshRun(p: PlanningProject, runId: string) {
    const run = await this.prisma.planningRun.findFirst({
      where: { id: runId, projectId: p.id },
      include: { scenario: true },
    });
    if (!run)
      throw new BadRequestException(
        'Calculation run not found in this project',
      );
    if (run.overallStatus === 'INSUFFICIENT_DATA')
      throw new BadRequestException(
        'This run could not be calculated — fix the inputs and recalculate first',
      );
    const latest = await this.prisma.planningRun.findFirst({
      where: { scenarioId: run.scenarioId },
      orderBy: { runNumber: 'desc' },
      select: { id: true },
    });
    if (latest?.id !== run.id || run.scenario.updatedAt > run.createdAt)
      throw new ConflictException(
        'The scenario changed after this run — recalculate and submit the new run',
      );
    return run;
  }

  async submit(
    projectId: string,
    runId: string,
    note: string | undefined,
    u: Principal,
  ) {
    const p = await this.project(projectId, u);
    if (p.purpose === 'SALES')
      throw new ConflictException(
        'A sales simulation is not submitted for planning approval — create an operational project when the work is confirmed',
      );
    if (!['DRAFT', 'PLAN_REJECTED'].includes(p.planStatus))
      throw new ConflictException(
        `A plan in status ${p.planStatus} cannot be submitted`,
      );
    const run = await this.freshRun(p, runId);
    await this.transition(p, ['DRAFT', 'PLAN_REJECTED'], {
      planStatus: 'IN_REVIEW',
      submittedById: u.id,
      submittedAt: new Date(),
      approvedRunId: run.id,
      reviewNote: note ?? null,
      reviewedById: null,
      reviewedAt: null,
    });
    await this.audit(
      u.id,
      'PLANNING_SUBMIT',
      p.id,
      `${p.code}: run #${run.runNumber} (${run.scenario.name}, ${run.overallStatus}) submitted for planning review${note ? ` — ${note}` : ''}`,
    );
    return this.prisma.planningProject.findUniqueOrThrow({
      where: { id: p.id },
    });
  }

  async decide(
    projectId: string,
    approve: boolean,
    note: string | undefined,
    u: Principal,
  ) {
    const p = await this.project(projectId, u);
    if (p.planStatus !== 'IN_REVIEW' || !p.approvedRunId)
      throw new ConflictException(
        'Only a plan in review can be approved or rejected',
      );
    assertNotSelfApproval(u.id, [p.submittedById, p.createdById], 'a plan');
    if (!approve && !note?.trim())
      throw new BadRequestException('Give a reason for rejecting the plan');
    const run = await this.freshRun(p, p.approvedRunId);
    await this.transition(p, ['IN_REVIEW'], {
      planStatus: approve ? 'PLAN_APPROVED' : 'PLAN_REJECTED',
      reviewedById: u.id,
      reviewedAt: new Date(),
      reviewNote: note ?? null,
    });
    await this.audit(
      u.id,
      approve ? 'PLANNING_APPROVE' : 'PLANNING_REJECT',
      p.id,
      `${p.code}: run #${run.runNumber} ${approve ? 'approved for planning (no stock reserved, no orders created, execution not started)' : 'rejected'}${note ? ` — ${note}` : ''}`,
    );
    return this.prisma.planningProject.findUniqueOrThrow({
      where: { id: p.id },
    });
  }

  async reopen(projectId: string, u: Principal) {
    const p = await this.project(projectId, u);
    if (
      !['IN_REVIEW', 'PLAN_APPROVED', 'PLAN_REJECTED', 'ARCHIVED'].includes(
        p.planStatus,
      )
    )
      throw new ConflictException('The plan is already a draft');
    await this.transition(p, [p.planStatus], {
      planStatus: 'DRAFT',
      approvedRunId: null,
    });
    await this.audit(
      u.id,
      'PLANNING_REOPEN',
      p.id,
      `${p.code}: returned to draft from ${p.planStatus}`,
    );
    return this.prisma.planningProject.findUniqueOrThrow({
      where: { id: p.id },
    });
  }

  async archive(projectId: string, u: Principal) {
    const p = await this.project(projectId, u);
    if (p.planStatus === 'ARCHIVED') return p;
    await this.transition(p, [p.planStatus], { planStatus: 'ARCHIVED' });
    await this.audit(u.id, 'PLANNING_ARCHIVE', p.id, `${p.code}: archived`);
    return this.prisma.planningProject.findUniqueOrThrow({
      where: { id: p.id },
    });
  }

  private async transition(
    p: PlanningProject,
    from: string[],
    data: Prisma.PlanningProjectUpdateManyMutationInput,
  ) {
    const res = await this.prisma.planningProject.updateMany({
      where: { id: p.id, version: p.version, planStatus: { in: from } },
      data: { ...data, version: { increment: 1 } },
    });
    if (!res.count)
      throw new ConflictException(
        'The project was changed by someone else — reload and try again',
      );
  }

  /** Users that may be shown as owner / responsible (active users only). */
  async owners(u: Principal) {
    if (!hasAccess(u, ACCESS.planningRead)) throw new ForbiddenException();
    return this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true, username: true },
      orderBy: { fullName: 'asc' },
      take: 500,
    });
  }
}

function redactData(d: DataSnapshot): DataSnapshot {
  return {
    ...d,
    products: d.products.map((p) => ({ ...p, standardUnitCost: 0 })),
  };
}

/** Short audit description of what changed in a scenario's inputs (material overrides in particular). */
export function describeInputChange(
  oldI: Record<string, any>,
  newI: Record<string, any>,
): string {
  const parts: string[] = [];
  for (const k of [
    'quantity',
    'warehouseId',
    'transferBatchSize',
    'includePendingRequests',
  ])
    if (JSON.stringify(oldI?.[k]) !== JSON.stringify(newI?.[k]))
      parts.push(
        `${k} ${JSON.stringify(oldI?.[k] ?? null)} → ${JSON.stringify(newI?.[k] ?? null)}`,
      );
  for (const k of ['calendar', 'labor', 'space', 'costs', 'readiness'])
    if (JSON.stringify(oldI?.[k]) !== JSON.stringify(newI?.[k]))
      parts.push(`${k} changed`);
  const os = JSON.stringify(oldI?.stages ?? []);
  if (os !== JSON.stringify(newI?.stages ?? []))
    parts.push(
      `workflow changed (${(oldI?.stages ?? []).length} → ${(newI?.stages ?? []).length} stages)`,
    );
  const om = new Map<string, string>(
    (oldI?.materials ?? []).map((m: any) => [
      String(m.productId),
      JSON.stringify(m),
    ]),
  );
  const nm = new Map<string, string>(
    (newI?.materials ?? []).map((m: any) => [
      String(m.productId),
      JSON.stringify(m),
    ]),
  );
  const added = [...nm.keys()].filter((k) => !om.has(k));
  const removed = [...om.keys()].filter((k) => !nm.has(k));
  const changed = [...nm.keys()].filter(
    (k) => om.has(k) && om.get(k) !== nm.get(k),
  );
  if (added.length || removed.length || changed.length)
    parts.push(
      `manual material list: +${added.length} −${removed.length} ~${changed.length} (${[...added, ...removed, ...changed].join(', ')})`,
    );
  if (
    JSON.stringify(oldI?.manualInbound ?? []) !==
    JSON.stringify(newI?.manualInbound ?? [])
  )
    parts.push('expected supply changed');
  return parts.join('; ');
}
