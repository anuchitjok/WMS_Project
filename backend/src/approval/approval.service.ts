import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertNotSelfApproval } from '../common/separation-of-duties';

/**
 * Entity types an approval rule may target. Only types whose domain workflow
 * actually consults the engine are listed — a rule for anything else would be
 * saved but never enforced. WithdrawalRequest is wired through
 * RequestsService.approve (when ENABLE_APPROVAL_ENGINE=true).
 */
export const APPROVAL_ENTITY_TYPES = ['WithdrawalRequest'] as const;

/**
 * Entity types whose decisions must go through their own workflow endpoint
 * (which applies the stock effects). A direct /approvals start/decide on them
 * would leave the engine and the document out of step, so it is refused.
 */
const DOMAIN_OWNED = new Set<string>(['WithdrawalRequest']);

/** The permission a step's role needs, or its approvers could never reach the decision endpoint. */
const STEP_PERMISSION: Record<string, string> = { WithdrawalRequest: 'request.approve' };

const MAX_STEPS = 10;

export interface RuleStepInput {
  stepOrder?: number;
  roleKey: string;
  stepName: string;
  isMandatory?: boolean;
  timeoutHours?: number | null;
}
export interface RuleInput {
  name: string;
  entityType: string;
  priority?: number;
  isActive?: boolean;
  conditions?: Record<string, unknown> | null;
  steps: RuleStepInput[];
}

interface ApproverPrincipal {
  id: string;
  fullName: string | null;
  role: UserRole;
  roleKeys: string[];
  rbacAssigned: boolean;
}

@Injectable()
export class ApprovalService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // ── Rule management ────────────────────────────────────────────────────────
  findRules() {
    return this.prisma.approvalRule.findMany({ include: { steps: { orderBy: { stepOrder: 'asc' } } }, orderBy: [{ entityType: 'asc' }, { priority: 'desc' }] });
  }

  /** Validates a rule definition and returns normalised steps (orders 1..n). Throws 400 with every problem found. */
  private async validateRule(dto: RuleInput, ruleId?: string) {
    const errors: string[] = [];
    const name = typeof dto?.name === 'string' ? dto.name.trim() : '';
    if (!name) errors.push('Name is required');
    if (name.length > 120) errors.push('Name must be at most 120 characters');
    if (!(APPROVAL_ENTITY_TYPES as readonly string[]).includes(dto?.entityType)) {
      errors.push(`Entity type must be one of: ${APPROVAL_ENTITY_TYPES.join(', ')}`);
    }
    const priority = dto?.priority ?? 0;
    if (!Number.isInteger(priority) || priority < 0 || priority > 1000) errors.push('Priority must be a whole number from 0 to 1000');
    // Conditions are stored by the schema but never evaluated by startApproval;
    // accepting them would suggest a rule only applies sometimes when it always applies.
    if (dto?.conditions && Object.keys(dto.conditions).length) {
      errors.push('Rule conditions are not supported yet — every active rule applies to all documents of its type');
    }

    const steps = Array.isArray(dto?.steps) ? dto.steps : [];
    if (steps.length === 0) errors.push('At least one approval step is required');
    if (steps.length > MAX_STEPS) errors.push(`At most ${MAX_STEPS} steps are allowed`);
    const orders = steps.map((s, i) => s.stepOrder ?? i + 1);
    if (orders.some((o) => !Number.isInteger(o) || o < 1)) errors.push('Step order must be a positive whole number');
    if (new Set(orders).size !== orders.length) errors.push('Step orders must be unique');

    const roleKeys = [...new Set(steps.map((s) => s.roleKey).filter(Boolean))];
    const roles = await this.prisma.role.findMany({
      where: { key: { in: roleKeys } },
      select: { key: true, isActive: true, permissions: { select: { permission: { select: { code: true } } } } },
    });
    const byKey = new Map(roles.map((r) => [r.key, r]));
    const needed = STEP_PERMISSION[dto?.entityType];
    steps.forEach((s, i) => {
      const label = `Step ${i + 1}`;
      if (!s.stepName || !String(s.stepName).trim()) errors.push(`${label}: name is required`);
      const role = byKey.get(s.roleKey);
      if (!s.roleKey) errors.push(`${label}: approver role is required`);
      else if (!role) errors.push(`${label}: role ${s.roleKey} does not exist`);
      else if (!role.isActive) errors.push(`${label}: role ${s.roleKey} is disabled`);
      else if (needed && role.key !== 'SUPER_ADMIN' && !role.permissions.some((p) => p.permission.code === needed)) {
        errors.push(`${label}: role ${s.roleKey} lacks the ${needed} permission, so nobody holding it could approve`);
      }
      if (s.timeoutHours != null && (!Number.isInteger(s.timeoutHours) || s.timeoutHours < 1 || s.timeoutHours > 720)) {
        errors.push(`${label}: timeout must be 1–720 hours`);
      }
    });

    // Two active rules of one type at one priority make the winner arbitrary.
    if ((dto?.isActive ?? true) && !errors.length) {
      const clash = await this.prisma.approvalRule.findFirst({
        where: { entityType: dto.entityType, priority, isActive: true, ...(ruleId ? { NOT: { id: ruleId } } : {}) },
        select: { name: true },
      });
      if (clash) errors.push(`Active rule "${clash.name}" already uses priority ${priority} for ${dto.entityType}`);
    }

    if (errors.length) throw new BadRequestException(errors);

    const normalised = steps
      .map((s, i) => ({ ...s, stepOrder: orders[i] }))
      .sort((a, b) => a.stepOrder - b.stepOrder)
      .map((s, i) => ({
        stepOrder: i + 1,
        roleKey: s.roleKey,
        stepName: String(s.stepName).trim(),
        isMandatory: s.isMandatory ?? true,
        timeoutHours: s.timeoutHours ?? null,
      }));
    return { name, priority, steps: normalised };
  }

  async createRule(dto: RuleInput, userId: string) {
    const v = await this.validateRule(dto);
    const rule = await this.prisma.approvalRule.create({
      data: {
        name: v.name,
        entityType: dto.entityType,
        priority: v.priority,
        isActive: dto.isActive ?? true,
        steps: { create: v.steps },
      },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    await this.prisma.auditLog.create({ data: { userId, action: 'APPROVAL_RULE_CREATED', entityType: 'ApprovalRule', entityId: rule.id, detail: `${rule.name}: ${v.steps.map((s) => s.roleKey).join(' → ')}` } });
    return rule;
  }

  /** Replaces a rule's definition. In-flight approvals keep the steps they started with. */
  async updateRule(id: string, dto: RuleInput, userId: string) {
    const existing = await this.prisma.approvalRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Approval rule not found');
    const v = await this.validateRule(dto, id);
    const rule = await this.prisma.$transaction(async (tx) => {
      await tx.approvalStep.deleteMany({ where: { ruleId: id } });
      return tx.approvalRule.update({
        where: { id },
        data: { name: v.name, entityType: dto.entityType, priority: v.priority, isActive: dto.isActive ?? existing.isActive, steps: { create: v.steps } },
        include: { steps: { orderBy: { stepOrder: 'asc' } } },
      });
    });
    await this.prisma.auditLog.create({ data: { userId, action: 'APPROVAL_RULE_UPDATED', entityType: 'ApprovalRule', entityId: id, detail: `${rule.name}: ${v.steps.map((s) => s.roleKey).join(' → ')}` } });
    return rule;
  }

  async setRuleActive(id: string, isActive: boolean, userId: string) {
    const rule = await this.prisma.approvalRule.findUnique({ where: { id }, include: { steps: true } });
    if (!rule) throw new NotFoundException('Approval rule not found');
    if (isActive) {
      // Re-validate: roles may have been disabled since the rule was saved.
      await this.validateRule({ name: rule.name, entityType: rule.entityType, priority: rule.priority, isActive: true, steps: rule.steps }, id);
    }
    const updated = await this.prisma.approvalRule.update({ where: { id }, data: { isActive }, include: { steps: { orderBy: { stepOrder: 'asc' } } } });
    await this.prisma.auditLog.create({ data: { userId, action: isActive ? 'APPROVAL_RULE_ENABLED' : 'APPROVAL_RULE_DISABLED', entityType: 'ApprovalRule', entityId: id, detail: rule.name } });
    return updated;
  }

  // ── Instance lifecycle ─────────────────────────────────────────────────────

  // Start an approval chain for an entity (finds the best matching rule)
  async startApproval(entityType: string, entityId: string, requestedById: string, opts: { internal?: boolean } = {}) {
    if (DOMAIN_OWNED.has(entityType) && !opts.internal) {
      throw new BadRequestException(`${entityType} approvals start from their own workflow endpoint`);
    }
    // Find active rule for this entity type (highest priority wins)
    const rule = await this.prisma.approvalRule.findFirst({
      where: { entityType, isActive: true },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
      orderBy: { priority: 'desc' },
    });

    if (!rule || rule.steps.length === 0) {
      // No rule — single default step (backward compat): any holder of the
      // endpoint's approve permission may decide it.
      return this.prisma.approvalInstance.create({
        data: { ruleId: null, entityType, entityId, status: 'PENDING', totalSteps: 1, requestedById, steps: { create: [{ stepOrder: 1, stepName: 'Default Approval', roleKey: 'WAREHOUSE_MANAGER', status: 'PENDING', dueAt: new Date(Date.now() + 4 * 60 * 60 * 1000) }] } },
        include: { steps: { orderBy: { stepOrder: 'asc' } } },
      });
    }

    const instance = await this.prisma.approvalInstance.create({
      data: {
        ruleId: rule.id,
        entityType,
        entityId,
        status: 'PENDING',
        currentStep: rule.steps[0].stepOrder,
        totalSteps: rule.steps.length,
        requestedById,
        steps: {
          create: rule.steps.map((s) => ({
            stepOrder: s.stepOrder,
            stepName: s.stepName,
            roleKey: s.roleKey,
            status: 'PENDING',
            dueAt: s.timeoutHours ? new Date(Date.now() + s.timeoutHours * 3600000) : undefined,
          })),
        },
      },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });

    // Notify first step approvers
    await this.notifyStepApprovers(instance.steps[0]?.roleKey, entityType, entityId);
    return instance;
  }

  /**
   * Returns the single live (PENDING) instance for an entity, starting one if
   * needed. Concurrent callers may each start one; all of them converge on the
   * oldest and the extras are cancelled, so a document never has two chains.
   */
  async ensurePendingInstance(entityType: string, entityId: string, requestedById: string) {
    const open = () => this.prisma.approvalInstance.findMany({
      where: { entityType, entityId, status: 'PENDING' },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    let live = await open();
    if (live.length === 0) {
      await this.startApproval(entityType, entityId, requestedById, { internal: true });
      live = await open();
    }
    const [keep, ...extra] = live;
    if (extra.length) {
      await this.prisma.approvalInstance.updateMany({
        where: { id: { in: extra.map((i) => i.id) }, status: 'PENDING' },
        data: { status: 'CANCELLED', rejectionReason: `Duplicate of ${keep.id}` },
      });
    }
    return keep ?? null;
  }

  private async notifyStepApprovers(roleKey: string | undefined, entityType: string, entityId: string) {
    if (!roleKey) return;
    await this.notifications.send({
      type: 'GENERAL',
      userIds: [],
      roleKeys: [roleKey],
      title: 'Approval Required',
      message: `${entityType} ${entityId} requires your approval.`,
      entityType,
      entityId,
    }).catch(() => undefined);
  }

  /** The approver's live roles, straight from the DB (same sources as JwtStrategy). */
  private async loadApprover(actorId: string): Promise<ApproverPrincipal> {
    const now = new Date();
    const user = await this.prisma.user.findFirst({
      where: { id: actorId, deletedAt: null, isActive: true },
      select: {
        id: true, fullName: true, role: true, roleId: true,
        rbacRole: { select: { key: true, isActive: true } },
        roleAssignments: {
          where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          select: { role: { select: { key: true, isActive: true } } },
        },
      },
    });
    if (!user) throw new ForbiddenException('Approver account is not active');
    const held = [user.rbacRole, ...user.roleAssignments.map((a) => a.role)].filter((r): r is { key: string; isActive: boolean } => !!r);
    return {
      id: user.id,
      fullName: user.fullName,
      role: user.role,
      roleKeys: held.filter((r) => r.isActive).map((r) => r.key),
      rbacAssigned: held.length > 0,
    };
  }

  /** May this principal decide a step that requires `roleKey`? */
  static canDecideStep(p: Pick<ApproverPrincipal, 'role' | 'roleKeys' | 'rbacAssigned'>, roleKey: string, defaultStep: boolean): boolean {
    if (p.roleKeys.includes('SUPER_ADMIN')) return true;
    // A rule-less default step is open to whoever passed the endpoint's approve check.
    if (defaultStep) return true;
    if (p.rbacAssigned) return p.roleKeys.includes(roleKey);
    // Not yet migrated to DB roles: legacy enum name must match (SYSTEM_ADMIN = full control).
    return p.role === roleKey || p.role === UserRole.SYSTEM_ADMIN;
  }

  // Approve or reject a specific step
  async decide(instanceId: string, stepOrder: number, actorId: string, approved: boolean, notes?: string, opts: { internal?: boolean } = {}) {
    if (typeof approved !== 'boolean') throw new BadRequestException('approved must be true or false');
    const instance = await this.prisma.approvalInstance.findUnique({
      where: { id: instanceId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!instance) throw new NotFoundException('Approval instance not found');
    if (DOMAIN_OWNED.has(instance.entityType) && !opts.internal) {
      throw new BadRequestException(`Decide ${instance.entityType} approvals through their own workflow endpoint`);
    }
    if (instance.status !== 'PENDING') throw new BadRequestException('Instance already decided');

    const step = instance.steps.find((s) => s.stepOrder === stepOrder);
    if (!step) throw new NotFoundException('Step not found');
    if (step.status !== 'PENDING') throw new BadRequestException('Step already decided');
    // Steps are sequential: only the first pending step can be decided.
    const current = instance.steps.find((s) => s.status === 'PENDING');
    if (current && current.stepOrder !== stepOrder) {
      throw new BadRequestException(`Step ${current.stepOrder} (${current.stepName}) must be decided first`);
    }

    const actor = await this.loadApprover(actorId);
    if (!ApprovalService.canDecideStep(actor, step.roleKey, instance.ruleId === null)) {
      throw new ForbiddenException(`Step "${step.stepName}" must be decided by role ${step.roleKey}`);
    }
    if (approved) {
      assertNotSelfApproval(actorId, [instance.requestedById], 'an item');
      if (instance.steps.some((s) => s.status === 'APPROVED' && s.actorId === actorId)) {
        throw new ForbiddenException('Separation of duties: you already approved an earlier step of this item');
      }
    }

    const nextStep = approved ? instance.steps.find((s) => s.stepOrder > stepOrder && s.status === 'PENDING') : undefined;
    await this.prisma.$transaction(async (tx) => {
      // Claim the step and the instance: a concurrent or repeated decision loses.
      const claimedStep = await tx.approvalInstanceStep.updateMany({
        where: { id: step.id, status: 'PENDING' },
        data: { status: approved ? 'APPROVED' : 'REJECTED', actorId, actorName: actor.fullName, decidedAt: new Date(), notes },
      });
      if (claimedStep.count === 0) throw new ConflictException('This step was already decided');

      if (!approved) {
        const claimed = await tx.approvalInstance.updateMany({ where: { id: instanceId, status: 'PENDING' }, data: { status: 'REJECTED', completedById: actorId, completedAt: new Date(), rejectionReason: notes } });
        if (claimed.count === 0) throw new ConflictException('This approval was already decided');
        await tx.auditLog.create({ data: { userId: actorId, action: 'APPROVAL_REJECTED', entityType: instance.entityType, entityId: instance.entityId, detail: `step ${stepOrder} ${step.stepName}${notes ? `: ${notes}` : ''}` } });
      } else if (nextStep) {
        const claimed = await tx.approvalInstance.updateMany({ where: { id: instanceId, status: 'PENDING' }, data: { currentStep: nextStep.stepOrder } });
        if (claimed.count === 0) throw new ConflictException('This approval was already decided');
        await tx.auditLog.create({ data: { userId: actorId, action: 'APPROVAL_STEP_APPROVED', entityType: instance.entityType, entityId: instance.entityId, detail: `step ${stepOrder} ${step.stepName}` } });
      } else {
        const claimed = await tx.approvalInstance.updateMany({ where: { id: instanceId, status: 'PENDING' }, data: { status: 'APPROVED', currentStep: stepOrder, completedById: actorId, completedAt: new Date() } });
        if (claimed.count === 0) throw new ConflictException('This approval was already decided');
        await tx.auditLog.create({ data: { userId: actorId, action: 'APPROVAL_COMPLETED', entityType: instance.entityType, entityId: instance.entityId } });
      }
    });
    // Outside the transaction: notification writes must not hold it open.
    if (nextStep) await this.notifyStepApprovers(nextStep.roleKey, instance.entityType, instance.entityId);
    return this.getByEntity(instance.entityType, instance.entityId);
  }

  async getByEntity(entityType: string, entityId: string) {
    return this.prisma.approvalInstance.findFirst({
      where: { entityType, entityId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  findAll(entityType?: string) {
    return this.prisma.approvalInstance.findMany({
      where: entityType ? { entityType } : {},
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
