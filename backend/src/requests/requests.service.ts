import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { RequestStatus, UserRole, StockStatus } from '@prisma/client';
import { nanoid } from 'nanoid';
import { isUnifiedReservationEnabled, isApprovalEngineEnabled } from '../common/feature-flags';
import { ApprovalService } from '../approval/approval.service';

// Phase 5: coarse, business-facing request lifecycle derived from the
// FulfillmentTask (the execution SSOT). The granular RequestStatus values
// PICKED / PACKED / READY_FOR_PICKUP / SHIPPED are DEPRECATED for writes —
// kept in the enum for backward compatibility but no longer the source of truth.
export type RequestStage =
  | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED'
  | 'IN_FULFILLMENT' | 'ISSUED' | 'CLOSED'
  | 'REJECTED' | 'CANCELLED';

export function deriveRequestStage(status: RequestStatus, taskStatus?: string | null): RequestStage {
  switch (status) {
    case RequestStatus.DRAFT: return 'DRAFT';
    case RequestStatus.SUBMITTED:
    case RequestStatus.PENDING_APPROVAL: return 'PENDING_APPROVAL';
    case RequestStatus.REJECTED: return 'REJECTED';
    case RequestStatus.CANCELLED: return 'CANCELLED';
    case RequestStatus.COMPLETED: return 'CLOSED';
    case RequestStatus.ISSUED_TO_RMA: return 'ISSUED';
    default: break;
  }
  // APPROVED or any legacy in-flight status: prefer the task when present.
  if (taskStatus) {
    if (['SHIPPED', 'DELIVERED'].includes(taskStatus)) return 'ISSUED';
    if (taskStatus === 'CLOSED') return 'CLOSED';
    if (['CANCELLED', 'RETURNED'].includes(taskStatus)) return 'CANCELLED';
    return 'IN_FULFILLMENT'; // ALLOCATED/PICKING/PICKED/PACKING/PACKED/READY_TO_SHIP/exceptions
  }
  if (status === RequestStatus.APPROVED) return 'APPROVED';
  if (status === RequestStatus.SHIPPED) return 'ISSUED';
  return 'IN_FULFILLMENT';
}

@Injectable()
export class RequestsService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
    private notifications: NotificationsService,
    private approval: ApprovalService,
  ) {}

  private genRef() {
    return `WR-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;
  }

  async findAll(filter: { status?: RequestStatus; requesterId?: string; page?: number; limit?: number }) {
    const { status, requesterId, page = 1, limit = 20 } = filter;
    const skip = (page - 1) * limit;
    const where: any = {};
    if (status) where.status = status;
    if (requesterId) where.requesterId = requesterId;

    const [data, total] = await Promise.all([
      this.prisma.withdrawalRequest.findMany({
        where,
        include: {
          requester: { select: { id: true, fullName: true, department: true } },
          approver: { select: { id: true, fullName: true } },
          items: { include: { product: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.withdrawalRequest.count({ where }),
    ]);

    // Phase 5: attach derived coarse stage + fulfillment status (additive fields).
    const ids = data.map((r) => r.id);
    const tasks = ids.length
      ? await this.prisma.fulfillmentTask.findMany({
          where: { requestId: { in: ids } },
          select: { requestId: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const taskByReq = new Map<string, string>();
    for (const t of tasks) if (!taskByReq.has(t.requestId)) taskByReq.set(t.requestId, t.status);

    const augmented = data.map((r) => {
      const fulfillmentStatus = taskByReq.get(r.id) ?? null;
      return { ...r, fulfillmentStatus, stage: deriveRequestStage(r.status, fulfillmentStatus) };
    });

    return { data: augmented, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const req = await this.prisma.withdrawalRequest.findUnique({
      where: { id },
      include: {
        requester: { select: { id: true, fullName: true, department: true, email: true } },
        approver: { select: { id: true, fullName: true } },
        items: { include: { product: { include: { brand: true } }, stockItem: true } },
      },
    });
    if (!req) throw new NotFoundException('Request not found');

    // Phase 5: derived coarse stage + fulfillment status (additive fields).
    const task = await this.prisma.fulfillmentTask.findFirst({
      where: { requestId: id },
      select: { status: true },
      orderBy: { createdAt: 'desc' },
    });
    const fulfillmentStatus = task?.status ?? null;
    return { ...req, fulfillmentStatus, stage: deriveRequestStage(req.status, fulfillmentStatus) };
  }

  async create(
    data: { department?: string; purpose?: string; requiredDate?: string; rmaCaseNumber: string; remark?: string; items: { productId: string; quantity: number }[] },
    requesterId: string,
  ) {
    // Auto-fill department from the requester's profile when not supplied.
    let department = data.department?.trim();
    if (!department) {
      const user = await this.prisma.user.findUnique({ where: { id: requesterId }, select: { department: true } });
      department = user?.department ?? 'N/A';
    }

    const request = await this.prisma.withdrawalRequest.create({
      data: {
        refNumber: this.genRef(),
        requesterId,
        department,
        purpose: data.purpose,
        requiredDate: data.requiredDate ? new Date(data.requiredDate) : undefined,
        rmaCaseNumber: data.rmaCaseNumber,
        notes: data.remark,
        status: RequestStatus.DRAFT,
        items: {
          create: data.items.map((i) => ({
            productId: i.productId,
            quantityRequested: i.quantity,
          })),
        },
      },
      include: { items: { include: { product: true } } },
    });
    return request;
  }

  /** Open RTV cases for the RMA Case Number dropdown. */
  async getOpenRtvCases() {
    const closed = ['COMPLETED', 'REJECTED_BY_VENDOR'];
    return this.prisma.rTVCase.findMany({
      where: { status: { notIn: closed as any[] } },
      select: {
        id: true,
        refNumber: true,
        status: true,
        description: true,
        stockItem: { select: { product: { select: { name: true, code: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** Active products with a count of AVAILABLE stock units (optionally filtered by brand). */
  async getProductsWithAvailableQty(brandId?: string) {
    const where: any = { productStatus: 'ACTIVE' };
    if (brandId) where.brandId = brandId;

    const products = await this.prisma.product.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        brand: { select: { id: true, name: true } },
        stockItems: { where: { status: 'AVAILABLE' }, select: { id: true } },
      },
      orderBy: { name: 'asc' },
    });

    return products.map(({ stockItems, ...p }) => ({
      ...p,
      availableQty: stockItems.length,
    }));
  }

  async submit(id: string, userId: string) {
    await this.findOne(id);
    const updated = await this.prisma.withdrawalRequest.update({
      where: { id },
      data: { status: RequestStatus.SUBMITTED },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'REQUEST_SUBMITTED', entityType: 'WithdrawalRequest', entityId: id },
    });
    this.realtime.emitRequestUpdate({ action: 'submitted', requestId: id });
    // Notify approvers (fire-and-forget — don't block the response)
    const req = await this.findOne(id);
    this.notifications.notifyRequestSubmitted(id, req.refNumber, req.department).catch(() => {});

    // Phase 4: start a governance approval instance (best-effort, non-blocking).
    if (isApprovalEngineEnabled()) {
      this.approval
        .startApproval('WithdrawalRequest', id, userId)
        .catch(() => {}); // never block submit on the engine
    }
    return updated;
  }

  /**
   * Phase 4: drive the decision through the ApprovalService engine.
   * Returns the resulting instance status: 'APPROVED' | 'REJECTED' | 'PENDING'.
   * Falls back to creating an instance if none exists (no-rule path auto-creates
   * a single default step, preserving legacy single-click approval).
   */
  private async decideViaEngine(
    requestId: string,
    requesterId: string,
    actorId: string,
    approved: boolean,
    notes?: string,
  ): Promise<'APPROVED' | 'REJECTED' | 'PENDING'> {
    let instance: any = await this.approval.getByEntity('WithdrawalRequest', requestId);
    if (!instance || instance.status !== 'PENDING') {
      await this.approval.startApproval('WithdrawalRequest', requestId, requesterId);
      // Re-fetch so `steps` are guaranteed loaded (the no-rule create path omits them).
      instance = await this.approval.getByEntity('WithdrawalRequest', requestId);
    }
    if (!instance || !instance.steps?.length) return 'PENDING';
    const step =
      instance.steps.find((s: any) => s.status === 'PENDING') ?? instance.steps[0];
    const result = await this.approval.decide(instance.id, step.stepOrder, actorId, approved, notes);
    return (result?.status as 'APPROVED' | 'REJECTED' | 'PENDING') ?? 'PENDING';
  }

  async approve(id: string, approverId: string, approved: boolean, rejectReason?: string) {
    const req = await this.findOne(id);
    if (req.status !== RequestStatus.SUBMITTED && req.status !== RequestStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Request is not in a reviewable state');
    }

    // Phase 4: when the engine is enabled, the decision is recorded there first.
    // Multi-step rules may keep the request PENDING until all steps approve.
    if (isApprovalEngineEnabled()) {
      const outcome = await this.decideViaEngine(id, req.requesterId, approverId, approved, rejectReason);
      if (outcome === 'PENDING') {
        const pending = await this.prisma.withdrawalRequest.update({
          where: { id },
          data: { status: RequestStatus.PENDING_APPROVAL, version: { increment: 1 } },
        });
        this.realtime.emitRequestUpdate({ action: 'approval_step', requestId: id });
        return pending;
      }
      // Engine reached a terminal decision — apply it below via the existing logic.
      approved = outcome === 'APPROVED';
    }

    // ── Rejection: simple status update, no stock impact ──────────────────
    if (!approved) {
      const rejected = await this.prisma.withdrawalRequest.update({
        where: { id },
        data: { status: RequestStatus.REJECTED, approverId, approvedAt: new Date(), rejectReason, version: { increment: 1 } },
      });
      await this.prisma.auditLog.create({
        data: { userId: approverId, action: 'REQUEST_REJECTED', entityType: 'WithdrawalRequest', entityId: id, detail: rejectReason },
      });
      this.realtime.emitRequestUpdate({ action: RequestStatus.REJECTED, requestId: id });
      this.notifications.notifyRequestDecision(id, req.requesterId, false, rejectReason).catch(() => {});
      return rejected;
    }

    // ── Approval ──────────────────────────────────────────────────────────
    // Unified-reservation mode (C1 fix): approval is GOVERNANCE-ONLY — it records
    // the approved quantities and advances status, but does NOT touch StockItem.
    // Reservation is owned solely by fulfillment allocation. Legacy mode (flag off)
    // keeps reserving stock here for backward compatibility.
    const unified = isUnifiedReservationEnabled();
    const updated = await this.prisma.$transaction(async (tx) => {
      if (unified) {
        // Governance only: set approved quantities, no stock mutation.
        for (const item of req.items) {
          await tx.withdrawalRequestItem.update({
            where: { id: item.id },
            data: { quantityApproved: item.quantityRequested },
          });
        }
      } else {
        // Legacy: reserve stock atomically with row-level locking.
        for (const item of req.items) {
          const needed = Math.ceil(item.quantityRequested);
          for (let i = 0; i < needed; i++) {
            // Lock one AVAILABLE stock row for this product. SKIP LOCKED lets
            // concurrent approvals grab *different* rows instead of deadlocking,
            // which is exactly what prevents the double-allocation race.
            const rows = await tx.$queryRaw<{ id: string }[]>`
              SELECT "id" FROM "StockItem"
              WHERE "productId" = ${item.productId} AND "status" = 'AVAILABLE'
              ORDER BY "receivedDate" ASC
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            `;
            if (rows.length === 0) {
              // Throwing aborts the transaction → previously reserved rows revert
              throw new BadRequestException(
                `Insufficient available stock for product ${item.productId} (requested ${needed})`,
              );
            }
            await tx.stockItem.update({ where: { id: rows[0].id }, data: { status: StockStatus.RESERVED } });
            // Link first reserved unit to the request item for traceability
            if (i === 0) {
              await tx.withdrawalRequestItem.update({
                where: { id: item.id },
                data: { stockItemId: rows[0].id, quantityApproved: item.quantityRequested },
              });
            }
          }
        }
      }

      const result = await tx.withdrawalRequest.update({
        where: { id },
        data: { status: RequestStatus.APPROVED, approverId, approvedAt: new Date(), version: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          userId: approverId,
          action: 'REQUEST_APPROVED',
          entityType: 'WithdrawalRequest',
          entityId: id,
          detail: unified ? 'Approved (governance only — reservation deferred to allocation)' : 'Stock reserved',
        },
      });
      return result;
    });

    this.realtime.emitRequestUpdate({ action: RequestStatus.APPROVED, requestId: id });
    this.notifications.notifyRequestDecision(id, req.requesterId, true).catch(() => {});
    this.notifications.notifyPickingTask(id, req.refNumber).catch(() => {});
    return updated;
  }

  /**
   * Cancel a request and release any RESERVED stock back to AVAILABLE.
   * Safe to call before the goods are physically issued. Idempotent guard
   * prevents double rollback (already-cancelled / completed requests are rejected).
   */
  async cancel(id: string, userId: string) {
    const req = await this.prisma.withdrawalRequest.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!req) throw new NotFoundException('Request not found');

    // Block double rollback / cancelling after goods left the building
    const noCancel: RequestStatus[] = [
      RequestStatus.CANCELLED,
      RequestStatus.COMPLETED,
      RequestStatus.SHIPPED,
      RequestStatus.ISSUED_TO_RMA,
    ];
    if (noCancel.includes(req.status)) {
      throw new BadRequestException(`Cannot cancel a request in status ${req.status}`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Release only stock that is still RESERVED for this request
      for (const item of req.items) {
        if (item.stockItemId) {
          const stock = await tx.stockItem.findUnique({ where: { id: item.stockItemId } });
          if (stock && stock.status === StockStatus.RESERVED) {
            await tx.stockItem.update({ where: { id: item.stockItemId }, data: { status: StockStatus.AVAILABLE } });
          }
        }
      }
      const result = await tx.withdrawalRequest.update({
        where: { id },
        data: { status: RequestStatus.CANCELLED, version: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: { userId, action: 'REQUEST_CANCELLED', entityType: 'WithdrawalRequest', entityId: id, detail: 'Reserved stock released' },
      });
      return result;
    });

    this.realtime.emitRequestUpdate({ action: RequestStatus.CANCELLED, requestId: id });
    return updated;
  }
}
