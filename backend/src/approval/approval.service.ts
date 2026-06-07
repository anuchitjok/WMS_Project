import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { nanoid } from 'nanoid';

@Injectable()
export class ApprovalService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // ── Rule management ────────────────────────────────────────────────────────
  findRules() { return this.prisma.approvalRule.findMany({ include: { steps: { orderBy: { stepOrder: 'asc' } } }, orderBy: { priority: 'desc' } }); }

  async createRule(dto: { name: string; entityType: string; conditions?: Record<string, unknown>; steps: { stepOrder: number; roleKey: string; stepName: string; isMandatory?: boolean; timeoutHours?: number }[] }, userId: string) {
    const rule = await this.prisma.approvalRule.create({
      data: {
        name: dto.name,
        entityType: dto.entityType,
        conditions: dto.conditions ? JSON.stringify(dto.conditions) : null,
        steps: { create: dto.steps.map((s) => ({ stepOrder: s.stepOrder, roleKey: s.roleKey, stepName: s.stepName, isMandatory: s.isMandatory ?? true, timeoutHours: s.timeoutHours })) },
      },
      include: { steps: true },
    });
    await this.prisma.auditLog.create({ data: { userId, action: 'APPROVAL_RULE_CREATED', entityType: 'ApprovalRule', entityId: rule.id, detail: rule.name } });
    return rule;
  }

  // ── Instance lifecycle ─────────────────────────────────────────────────────

  // Start an approval chain for an entity (finds the best matching rule)
  async startApproval(entityType: string, entityId: string, requestedById: string, meta?: Record<string, unknown>) {
    // Find active rule for this entity type (highest priority wins)
    const rule = await this.prisma.approvalRule.findFirst({
      where: { entityType, isActive: true },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
      orderBy: { priority: 'desc' },
    });

    if (!rule) {
      // No rule — single-step auto-approve path (backward compat)
      return this.prisma.approvalInstance.create({
        data: { ruleId: null, entityType, entityId, status: 'PENDING', totalSteps: 1, requestedById, steps: { create: [{ stepOrder: 1, stepName: 'Default Approval', roleKey: 'WAREHOUSE_MANAGER', status: 'PENDING', dueAt: new Date(Date.now() + 4 * 60 * 60 * 1000) }] } },
      });
    }

    const instance = await this.prisma.approvalInstance.create({
      data: {
        ruleId: rule.id,
        entityType,
        entityId,
        status: 'PENDING',
        currentStep: 0,
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
    });
  }

  // Approve or reject a specific step
  async decide(instanceId: string, stepOrder: number, actorId: string, approved: boolean, notes?: string) {
    const instance = await this.prisma.approvalInstance.findUnique({
      where: { id: instanceId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!instance) throw new NotFoundException('Approval instance not found');
    if (instance.status !== 'PENDING') throw new BadRequestException('Instance already decided');

    const step = instance.steps.find((s) => s.stepOrder === stepOrder);
    if (!step) throw new NotFoundException('Step not found');
    if (step.status !== 'PENDING') throw new BadRequestException('Step already decided');

    const actorInfo = await this.prisma.user.findUnique({ where: { id: actorId }, select: { fullName: true, role: true } });

    await this.prisma.$transaction(async (tx) => {
      await tx.approvalInstanceStep.update({
        where: { id: step.id },
        data: { status: approved ? 'APPROVED' : 'REJECTED', actorId, actorName: actorInfo?.fullName, decidedAt: new Date(), notes },
      });

      if (!approved) {
        // Rejection cascades to instance
        await tx.approvalInstance.update({ where: { id: instanceId }, data: { status: 'REJECTED', completedById: actorId, completedAt: new Date(), rejectionReason: notes } });
        await tx.auditLog.create({ data: { userId: actorId, action: 'APPROVAL_REJECTED', entityType: instance.entityType, entityId: instance.entityId, detail: notes } });
      } else {
        const nextStep = instance.steps.find((s) => s.stepOrder > stepOrder && s.status === 'PENDING');
        if (nextStep) {
          // Move to next step
          await tx.approvalInstance.update({ where: { id: instanceId }, data: { currentStep: nextStep.stepOrder } });
          await this.notifyStepApprovers(nextStep.roleKey, instance.entityType, instance.entityId);
        } else {
          // All steps approved
          await tx.approvalInstance.update({ where: { id: instanceId }, data: { status: 'APPROVED', currentStep: stepOrder, completedById: actorId, completedAt: new Date() } });
          await tx.auditLog.create({ data: { userId: actorId, action: 'APPROVAL_COMPLETED', entityType: instance.entityType, entityId: instance.entityId } });
        }
      }
    });
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
