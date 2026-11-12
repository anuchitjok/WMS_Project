import { splitStockRow } from '../common/stock-state';
import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { NOT_COUNT_LOCKED } from '../common/count-lock';
import { getAvailableUnitsByProduct } from '../common/inventory-metrics';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { RequestStatus, UserRole, StockStatus, Prisma } from '@prisma/client';
import { assertNotSelfApproval } from '../common/separation-of-duties';
import { MasterDataService } from '../master-data/master-data.service';
import { nanoid } from 'nanoid';
import { isUnifiedReservationEnabled, isApprovalEngineEnabled } from '../common/feature-flags';
import { ApprovalService } from '../approval/approval.service';
import { InventoryOrchestrationService } from '../inventory/inventory-orchestration.service';
import { HandoverService } from '../fulfillment/services/handover.service';
import { ISSUED_TASK_STATUSES } from '../fulfillment/services/task-state';
import { ACCESS, AccessPrincipal, hasAccess } from '../auth/access';
import { DELIVERY_METHODS, DeliveryMethod } from './dto/create-request.dto';
import { BULK_APPROVE_MAX, BulkApproveResult } from './dto/bulk-approve.dto';
import { ScopePrincipal, scopedWarehouseIds, canAccessWarehouse } from '../common/warehouse-scope';
import {
  PickInput, PICK_ERR, checkPickPlan, readPickRows, lockPickRow, rowProblem,
} from './request-picks';

/** PR6: what approve() needs to honour approver-chosen pick locations. */
/** PR6: most stock rows listed per line in the pick picker (oldest first). */
export const PICK_OPTIONS_MAX = 300;

export interface ApprovePickOptions {
  picks?: PickInput[];
  principal?: ScopePrincipal | null;
}

/**
 * P4 4.1 — free-text search on the request list. Case-insensitive "contains" on
 * ref #, RMA case, creator (full name / username) and any line's product
 * (SKU code / part number / name). Returns null for a blank query so the caller
 * adds nothing. The caller combines it with AND, so it never widens the
 * status / stage / own-requests filters.
 */
export function buildRequestSearchWhere(q?: string | null): Prisma.WithdrawalRequestWhereInput | null {
  const term = (q ?? '').trim().slice(0, 100);
  if (!term) return null;
  const c = { contains: term, mode: 'insensitive' as const };
  return {
    OR: [
      { refNumber: c },
      { rmaCaseNumber: c },
      { requester: { is: { fullName: c } } },
      { requester: { is: { username: c } } },
      { items: { some: { product: { is: { OR: [{ code: c }, { partNumber: c }, { name: c }] } } } } },
    ],
  };
}

/** P4 4.7 — write-side: value to store; absent or null means COLLECT, anything else is rejected. */
export function normalizeDeliveryMethod(v?: string | null): DeliveryMethod {
  if (v == null || v === '') return 'COLLECT';
  if (!(DELIVERY_METHODS as readonly string[]).includes(v)) {
    throw new BadRequestException('deliveryMethod must be COLLECT or SHIP');
  }
  return v as DeliveryMethod;
}

/** Read-side: never throws — anything other than SHIP (incl. older null rows) shows as COLLECT. */
export function displayDeliveryMethod(v?: string | null): DeliveryMethod {
  return v === 'SHIP' ? 'SHIP' : 'COLLECT';
}

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
  // A request whose task was cancelled (not the request itself) is back to
  // APPROVED and waits for a new allocation. Legacy rows cancelled before the
  // request was reopened automatically are still at PICKING; they are
  // re-allocatable too (see FulfillmentService.allocatableRequests).
  if ((status === RequestStatus.APPROVED || status === RequestStatus.PICKING) && taskStatus === 'CANCELLED') return 'APPROVED';
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

export const REQUEST_STAGES: RequestStage[] = [
  'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'IN_FULFILLMENT', 'ISSUED', 'CLOSED', 'REJECTED', 'CANCELLED',
];

const REVIEWABLE: RequestStatus[] = [RequestStatus.SUBMITTED, RequestStatus.PENDING_APPROVAL];

@Injectable()
export class RequestsService {
  constructor(
    private masterData: MasterDataService,
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
    private notifications: NotificationsService,
    private approval: ApprovalService,
    private inventory: InventoryOrchestrationService,
    private handover: HandoverService,
  ) {}

  private genRef() {
    return `WR-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;
  }

  async findAll(filter: { status?: RequestStatus; stage?: string; requesterId?: string; page?: number; limit?: number; q?: string }) {
    const { status, stage, requesterId, page = 1, limit = 20, q } = filter;
    const skip = (page - 1) * limit;
    const where: any = {};
    if (status) where.status = status;
    if (requesterId) where.requesterId = requesterId;
    if (stage) where.id = { in: await this.requestIdsInStage(stage, requesterId) };
    const search = buildRequestSearchWhere(q);
    if (search) where.AND = [search];

    const [data, total] = await Promise.all([
      this.prisma.withdrawalRequest.findMany({
        where,
        include: {
          requester: { select: { id: true, fullName: true, username: true, department: true } },
          approver: { select: { id: true, fullName: true } },
          items: { include: { product: { include: { brand: { select: { id: true, name: true } } } } } },
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

    // Real stock validation: available AVAILABLE units per product across all listed requests.
    // Replaces the previous hardcoded "Stock OK" badge with an honest check the approver can trust.
    // Units (summed quantity), not stock rows — same pool approval reserves from.
    const productIds = [...new Set(data.flatMap((r) => r.items.map((i) => i.productId)))];
    const availByProduct = await getAvailableUnitsByProduct(this.prisma, productIds);

    const augmented = data.map((r) => {
      const fulfillmentStatus = taskByReq.get(r.id) ?? null;
      const shortages = r.items
        .map((i) => ({
          productName: i.product?.name ?? i.productId,
          requested: i.quantityRequested,
          available: availByProduct.get(i.productId) ?? 0,
        }))
        .filter((s) => s.available < s.requested);
      return {
        ...r,
        deliveryMethod: displayDeliveryMethod(r.deliveryMethod),
        fulfillmentStatus,
        stage: deriveRequestStage(r.status, fulfillmentStatus),
        stockOk: shortages.length === 0,
        stockShortages: shortages,
      };
    });

    return { data: augmented, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Ids of requests whose derived stage is `stage`. The stage depends on the
   * latest fulfillment task (no FK between the two), so it is computed here with
   * the same rule the list and detail views display.
   */
  private async requestIdsInStage(stage: string, requesterId?: string): Promise<string[]> {
    if (!REQUEST_STAGES.includes(stage as RequestStage)) {
      throw new BadRequestException(`Unknown stage "${stage}" (expected one of ${REQUEST_STAGES.join(', ')})`);
    }
    const [requests, tasks] = await Promise.all([
      this.prisma.withdrawalRequest.findMany({
        where: requesterId ? { requesterId } : {},
        select: { id: true, status: true },
      }),
      this.prisma.$queryRaw<{ requestId: string; status: string }[]>`
        SELECT DISTINCT ON ("requestId") "requestId", "status"::text AS "status"
        FROM "FulfillmentTask" ORDER BY "requestId", "createdAt" DESC`,
    ]);
    const latest = new Map(tasks.map((t) => [t.requestId, t.status]));
    return requests.filter((r) => deriveRequestStage(r.status, latest.get(r.id)) === stage).map((r) => r.id);
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
    // P4 4.3: live AVAILABLE units per line so the approver sees what is short.
    const avail = await getAvailableUnitsByProduct(this.prisma, [...new Set(req.items.map((i) => i.productId))]);
    return {
      ...req,
      deliveryMethod: displayDeliveryMethod(req.deliveryMethod),
      items: req.items.map((i) => ({ ...i, availableQty: avail.get(i.productId) ?? 0 })),
      fulfillmentStatus,
      stage: deriveRequestStage(req.status, fulfillmentStatus),
    };
  }

  async create(
    data: { department?: string; purpose?: string; requiredDate?: string; rmaCaseNumber: string; remark?: string; deliveryMethod?: string | null; items: { productId: string; quantity: number }[] },
    requesterId: string,
  ) {
    // Auto-fill department from the requester's profile when not supplied.
    // An explicit department must be a managed, active one; the profile fallback was validated when it was set.
    let department = (await this.masterData.assertDepartment(data.department)) ?? undefined;
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
        deliveryMethod: normalizeDeliveryMethod(data.deliveryMethod),
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

  /** Active products with their requestable AVAILABLE units (optionally filtered by brand). */
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
      },
      orderBy: { name: 'asc' },
    });

    const units = await getAvailableUnitsByProduct(this.prisma, products.map((p) => p.id));
    return products.map((p) => ({
      ...p,
      availableQty: units.get(p.id) ?? 0,
    }));
  }

  async submit(id: string, userId: string) {
    const current = await this.prisma.withdrawalRequest.findUnique({
      where: { id },
      select: { requesterId: true, status: true },
    });
    if (!current) throw new NotFoundException('Request not found');
    if (current.requesterId !== userId) throw new ForbiddenException('Only the requester can submit this request');
    // Only a draft can be submitted — re-submitting an approved/cancelled request
    // would send it through approval (and stock reservation) a second time.
    const claimed = await this.prisma.withdrawalRequest.updateMany({
      where: { id, status: RequestStatus.DRAFT },
      data: { status: RequestStatus.SUBMITTED, version: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw new ConflictException(`Only a DRAFT request can be submitted (current: ${current.status})`);
    }
    const updated = await this.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id } });
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
        .ensurePendingInstance('WithdrawalRequest', id, userId)
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
  // ── PR6: pick locations chosen by the approver ───────────────────────────

  /** Why picks cannot be chosen for this request now, or null when they can. */
  private async pickBlock(req: { id: string; requesterId: string; status: RequestStatus }): Promise<'STATUS' | 'MODE' | 'NOT_FINAL_STEP' | null> {
    if (req.status !== RequestStatus.SUBMITTED && req.status !== RequestStatus.PENDING_APPROVAL) return 'STATUS';
    // ALLOCATION mode reserves nothing at approval, so there is nothing to place.
    if (isUnifiedReservationEnabled()) return 'MODE';
    if (isApprovalEngineEnabled()) {
      // Only the step that makes the request APPROVED reserves stock (Q1).
      const instance: any = await this.approval.ensurePendingInstance('WithdrawalRequest', req.id, req.requesterId);
      const pending = (instance?.steps ?? []).filter((s: any) => s.status === 'PENDING').length;
      if (!instance?.steps?.length || pending > 1) return 'NOT_FINAL_STEP';
    }
    return null;
  }

  /** Checks a pick plan without locks; also reads what the audit entry needs. */
  private async preparePicks(
    items: Array<{ id: string; productId: string; quantityRequested: number }>,
    picks: PickInput[],
    principal: ScopePrincipal | null,
  ) {
    const ids = [...new Set(picks.map((p) => p.stockItemId))];
    const rows = await readPickRows(this.prisma, ids);
    const { byLine, warehouseId } = checkPickPlan(items, picks, rows, principal);

    const locs = await this.prisma.stockItem.findMany({
      where: { id: { in: ids } },
      select: { id: true, warehouse: { select: { code: true } }, rack: { select: { code: true } }, slot: { select: { code: true } } },
    });
    const loc = new Map(locs.map((l) => [l.id, [l.warehouse?.code, l.rack?.code, l.slot?.code].filter(Boolean).join('|')]));
    // The row FIFO would have taken first, so the audit shows when FIFO was overridden.
    const fifo = new Map<string, string | null>();
    for (const lineId of byLine.keys()) {
      const item = items.find((i) => i.id === lineId)!;
      const first = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT s."id" FROM "StockItem" s
        WHERE s."productId" = ${item.productId} AND s."status" = 'AVAILABLE' AND s."quantity" > 0 AND ${NOT_COUNT_LOCKED}
        ORDER BY s."receivedDate" ASC LIMIT 1`;
      fifo.set(lineId, first[0]?.id ?? null);
    }
    return { byLine, warehouseId, principal, audit: { loc, fifo } };
  }

  /**
   * Reserves exactly the chosen rows of one line (inside the approval
   * transaction): lock, re-check, split, AVAILABLE → RESERVED, record the pick.
   * Any row that changed since it was chosen aborts the whole approval.
   */
  private async reservePicks(
    tx: Prisma.TransactionClient,
    item: { id: string; productId: string; quantityRequested: number },
    chosen: PickInput[],
    approverId: string,
    plan: { warehouseId: string | null; principal: ScopePrincipal | null; audit: { loc: Map<string, string>; fifo: Map<string, string | null> } },
  ): Promise<string> {
    let first = true;
    for (const p of chosen) {
      const row = await lockPickRow(tx, p.stockItemId);
      const why = !row ? 'NOT_FOUND'
        : row.warehouseId !== plan.warehouseId || !canAccessWarehouse(plan.principal, row.warehouseId) ? 'MOVED'
          : rowProblem(row, item.productId, p.qty);
      if (why) throw new ConflictException({ message: PICK_ERR.rowTaken, stockItemId: p.stockItemId, reason: why });

      // Bulk row: the chosen quantity keeps the row id, the rest stays AVAILABLE.
      await splitStockRow(tx, p.stockItemId, p.qty, StockStatus.AVAILABLE);
      await tx.stockItem.update({ where: { id: p.stockItemId }, data: { status: StockStatus.RESERVED } });
      if (first) {
        // Same first-row link as FIFO approval, so existing screens read it unchanged.
        await tx.withdrawalRequestItem.update({
          where: { id: item.id },
          data: { stockItemId: p.stockItemId, quantityApproved: item.quantityRequested },
        });
        first = false;
      }
      await tx.withdrawalRequestPick.create({
        data: { requestItemId: item.id, stockItemId: p.stockItemId, quantity: p.qty, pickedById: approverId },
      });
    }
    const fifoId = plan.audit.fifo.get(item.id) ?? null;
    const where = chosen.map((p) => `${plan.audit.loc.get(p.stockItemId) || p.stockItemId} ×${p.qty}`).join(', ');
    const sameAsFifo = chosen.length > 0 && chosen[0].stockItemId === fifoId;
    await tx.auditLog.create({
      data: {
        userId: approverId,
        action: 'REQUEST_PICK_CHOSEN',
        entityType: 'WithdrawalRequestItem',
        entityId: item.id,
        detail: `${item.productId}: ${where}${sameAsFifo ? ' (same as FIFO)' : ` (FIFO would take ${fifoId ?? 'none'})`}`,
      },
    });
    return `${item.productId}: ${item.quantityRequested} unit(s) from ${chosen.length} chosen row(s)`;
  }

  /**
   * Stock rows the approver may choose from, per request line: AVAILABLE, not
   * being counted, inside the caller's warehouses, oldest first (FIFO order).
   * Read only. `canPick` is false (with the reason) when picks would be refused.
   */
  async pickOptions(id: string, principal: ScopePrincipal | null) {
    const req = await this.prisma.withdrawalRequest.findUnique({
      where: { id },
      include: { items: { include: { product: { select: { id: true, code: true, name: true, partNumber: true } } } } },
    });
    if (!req) throw new NotFoundException('Request not found');
    const block = await this.pickBlock(req);
    const products = [...new Set(req.items.map((i) => i.productId))];
    const scope = scopedWarehouseIds(principal);

    type Opt = {
      id: string; productId: string; quantity: number; serialNumber: string | null; batchNumber: string | null;
      receivedDate: Date; expiryDate: Date | null; warehouseId: string | null; warehouseCode: string | null;
      warehouseName: string | null; rackCode: string | null; slotCode: string | null;
    };
    const rows = block || !products.length ? [] : await this.prisma.$queryRaw<Opt[]>`
      SELECT x."id", x."productId", x."quantity", x."serialNumber", x."batchNumber", x."receivedDate", x."expiryDate",
             x."warehouseId", x."warehouseCode", x."warehouseName", x."rackCode", x."slotCode"
      FROM (
        SELECT s."id", s."productId", s."quantity", s."serialNumber", s."batchNumber", s."receivedDate", s."expiryDate",
               s."warehouseId", w."code" AS "warehouseCode", w."name" AS "warehouseName",
               r."code" AS "rackCode", sl."code" AS "slotCode",
               ROW_NUMBER() OVER (PARTITION BY s."productId" ORDER BY s."receivedDate" ASC, s."id" ASC) AS "rn"
        FROM "StockItem" s
        LEFT JOIN "Warehouse" w ON w."id" = s."warehouseId"
        LEFT JOIN "Rack" r ON r."id" = s."rackId"
        LEFT JOIN "Slot" sl ON sl."id" = s."slotId"
        WHERE s."productId" = ANY(${products}::text[]) AND s."status" = 'AVAILABLE' AND s."quantity" > 0
          AND ${NOT_COUNT_LOCKED}
          AND (${scope}::text[] IS NULL OR s."warehouseId" = ANY(${scope}::text[]))
      ) x WHERE x."rn" <= ${PICK_OPTIONS_MAX + 1}
      ORDER BY x."productId", x."rn"`;
    // FIFO's first row over all warehouses (what approval without picks would take).
    const fifoRows = block || !products.length ? [] : await this.prisma.$queryRaw<{ productId: string; id: string }[]>`
      SELECT DISTINCT ON (s."productId") s."productId", s."id" FROM "StockItem" s
      WHERE s."productId" = ANY(${products}::text[]) AND s."status" = 'AVAILABLE' AND s."quantity" > 0 AND ${NOT_COUNT_LOCKED}
      ORDER BY s."productId", s."receivedDate" ASC, s."id" ASC`;
    const fifo = new Map(fifoRows.map((r) => [r.productId, r.id]));

    return {
      requestId: req.id,
      canPick: !block,
      blocked: block,
      lines: req.items.map((item) => {
        const opts = rows.filter((r) => r.productId === item.productId);
        return {
          itemId: item.id,
          productId: item.productId,
          productCode: item.product?.code ?? null,
          productName: item.product?.name ?? null,
          partNumber: item.product?.partNumber ?? null,
          quantity: item.quantityRequested,
          fifoStockItemId: fifo.get(item.productId) ?? null,
          more: opts.length > PICK_OPTIONS_MAX,
          options: opts.slice(0, PICK_OPTIONS_MAX).map((r) => ({
            stockItemId: r.id,
            quantity: Number(r.quantity),
            serialNumber: r.serialNumber,
            batchNumber: r.batchNumber,
            receivedDate: r.receivedDate,
            expiryDate: r.expiryDate,
            warehouseId: r.warehouseId,
            warehouseCode: r.warehouseCode,
            warehouseName: r.warehouseName,
            rackCode: r.rackCode,
            slotCode: r.slotCode,
          })),
        };
      }),
    };
  }

  private async decideViaEngine(
    requestId: string,
    requesterId: string,
    actorId: string,
    approved: boolean,
    notes?: string,
  ): Promise<'APPROVED' | 'REJECTED' | 'PENDING'> {
    const instance: any = await this.approval.ensurePendingInstance('WithdrawalRequest', requestId, requesterId);
    if (!instance || !instance.steps?.length) return 'PENDING';
    const step =
      instance.steps.find((s: any) => s.status === 'PENDING') ?? instance.steps[0];
    const result = await this.approval.decide(instance.id, step.stepOrder, actorId, approved, notes, { internal: true });
    return (result?.status as 'APPROVED' | 'REJECTED' | 'PENDING') ?? 'PENDING';
  }

  async approve(id: string, approverId: string, approved: boolean, rejectReason?: string, opts: ApprovePickOptions = {}) {
    const req = await this.findOne(id);
    if (req.status !== RequestStatus.SUBMITTED && req.status !== RequestStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Request is not in a reviewable state');
    }
    // Maker ≠ checker: a requester cannot approve their own request (rejecting it is harmless).
    if (approved) assertNotSelfApproval(approverId, [req.requesterId], 'a request');

    // PR6: approver-chosen pick locations. Checked here, before the approval
    // engine records a decision, so a bad choice changes nothing; every row is
    // checked again under a lock inside the transaction below.
    const picks = opts.picks ?? [];
    let pickPlan: Awaited<ReturnType<RequestsService['preparePicks']>> | null = null;
    if (picks.length) {
      if (!approved) throw new BadRequestException(PICK_ERR.approveOnly);
      const block = await this.pickBlock(req);
      if (block === 'MODE') throw new BadRequestException(PICK_ERR.modeOnly);
      if (block === 'NOT_FINAL_STEP') throw new BadRequestException(PICK_ERR.finalStepOnly);
      pickPlan = await this.preparePicks(req.items, picks, opts.principal ?? null);
    }

    // Phase 4: when the engine is enabled, the decision is recorded there first.
    // Multi-step rules may keep the request PENDING until all steps approve.
    if (isApprovalEngineEnabled()) {
      const outcome = await this.decideViaEngine(id, req.requesterId, approverId, approved, rejectReason);
      if (outcome === 'PENDING') {
        const claimed = await this.prisma.withdrawalRequest.updateMany({
          where: { id, status: { in: REVIEWABLE } },
          data: { status: RequestStatus.PENDING_APPROVAL, version: { increment: 1 } },
        });
        if (claimed.count === 0) throw new ConflictException('Request was already decided');
        const pending = await this.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id } });
        this.realtime.emitRequestUpdate({ action: 'approval_step', requestId: id });
        return pending;
      }
      // Engine reached a terminal decision — apply it below via the existing logic.
      approved = outcome === 'APPROVED';
    }

    // ── Rejection: simple status update, no stock impact ──────────────────
    if (!approved) {
      const claimed = await this.prisma.withdrawalRequest.updateMany({
        where: { id, status: { in: REVIEWABLE } },
        data: { status: RequestStatus.REJECTED, approverId, approvedAt: new Date(), rejectReason, version: { increment: 1 } },
      });
      if (claimed.count === 0) throw new ConflictException('Request was already decided');
      const rejected = await this.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id } });
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
      // Claim the decision first. A concurrent second approval matches zero rows
      // (Postgres re-checks the WHERE after the row lock) and never reserves stock.
      const claimed = await tx.withdrawalRequest.updateMany({
        where: { id, status: { in: REVIEWABLE } },
        data: { status: RequestStatus.APPROVED, approverId, approvedAt: new Date(), version: { increment: 1 } },
      });
      if (claimed.count === 0) throw new ConflictException('Request was already decided');

      const reservedSummary: string[] = [];
      if (unified) {
        // Governance only: set approved quantities, no stock mutation.
        for (const item of req.items) {
          await tx.withdrawalRequestItem.update({
            where: { id: item.id },
            data: { quantityApproved: item.quantityRequested },
          });
        }
      } else {
        // Legacy: reserve stock atomically with row-level locking, by QUANTITY.
        // Rows are taken FIFO until the approved units are covered; a bulk row
        // larger than what is still needed is split — the reserved part keeps
        // the row id, the remainder stays AVAILABLE (same model as allocation).
        // Serial rows hold 1 unit each, so they behave exactly as before.
        for (const item of req.items) {
          const chosen = pickPlan?.byLine.get(item.id);
          if (chosen) {
            reservedSummary.push(await this.reservePicks(tx, item, chosen, approverId, pickPlan!));
            continue;
          }
          const need = item.quantityRequested;
          const taken: string[] = [];
          let covered = 0;
          while (covered < need) {
            // SKIP LOCKED lets concurrent approvals grab *different* rows instead
            // of deadlocking, which is what prevents double allocation.
            const exclude = taken.length ? taken : [''];
            const rows = await tx.$queryRaw<{ id: string; quantity: number }[]>`
              SELECT s."id", s."quantity" FROM "StockItem" s
              WHERE s."productId" = ${item.productId} AND s."status" = 'AVAILABLE' AND s."quantity" > 0
                AND s."id" <> ALL(${exclude}::text[])
                AND ${NOT_COUNT_LOCKED}
              ORDER BY s."receivedDate" ASC
              FOR UPDATE OF s SKIP LOCKED
              LIMIT 1
            `;
            if (rows.length === 0) {
              // Throwing aborts the transaction → previously reserved rows revert
              const p = (item as { product?: { code?: string | null; name?: string | null } }).product;
              const which = [p?.code, p?.name].filter(Boolean).join(' · ') || item.productId;
              throw new BadRequestException(
                `Insufficient available stock for ${which} (requested ${need}, available ${covered})`,
              );
            }
            const row = rows[0];
            const take = Math.min(Number(row.quantity), need - covered);
            await splitStockRow(tx, row.id, take, StockStatus.AVAILABLE);
            await tx.stockItem.update({ where: { id: row.id }, data: { status: StockStatus.RESERVED } });
            // Link the first reserved row to the request item for traceability
            if (taken.length === 0) {
              await tx.withdrawalRequestItem.update({
                where: { id: item.id },
                data: { stockItemId: row.id, quantityApproved: item.quantityRequested },
              });
            }
            taken.push(row.id);
            covered += take;
          }
          reservedSummary.push(`${item.productId}: ${covered} unit(s) in ${taken.length} row(s)`);
        }
      }

      const result = await tx.withdrawalRequest.findUniqueOrThrow({ where: { id } });
      await tx.auditLog.create({
        data: {
          userId: approverId,
          action: 'REQUEST_APPROVED',
          entityType: 'WithdrawalRequest',
          entityId: id,
          detail: unified ? 'Approved (governance only — reservation deferred to allocation)' : `Stock reserved — ${reservedSummary.join('; ')}`,
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
   * P4 4.4 — approve or reject many requests in one call. Each id goes through
   * approve() unchanged (its own claim + transaction, version bump, approval-engine
   * step and, in legacy mode, FIFO reservation), one after another. A failure on
   * one request (already decided, short stock, self-approval, …) is reported for
   * that id and the rest still run. Sequential on purpose: FIFO reservation order
   * stays deterministic and requests in the batch never compete for stock rows.
   */
  async bulkApprove(
    ids: string[],
    approverId: string,
    approve: boolean,
    reason?: string,
  ): Promise<{ results: BulkApproveResult[]; approved: number; rejected: number; failed: number }> {
    if (!Array.isArray(ids)) throw new BadRequestException('at least one request is required');
    const unique = [...new Set(ids.filter((x) => typeof x === 'string' && x.trim()))];
    if (unique.length === 0) throw new BadRequestException('at least one request is required');
    if (unique.length > BULK_APPROVE_MAX) {
      throw new BadRequestException(`at most ${BULK_APPROVE_MAX} requests per bulk decision`);
    }
    const why = reason?.trim() || undefined;
    if (!approve && !why) throw new BadRequestException('A reason is required to reject requests');

    const refs = await this.prisma.withdrawalRequest.findMany({
      where: { id: { in: unique } },
      select: { id: true, refNumber: true },
    });
    const refById = new Map(refs.map((r) => [r.id, r.refNumber]));

    const results: BulkApproveResult[] = [];
    for (const id of unique) {
      try {
        const r: any = await this.approve(id, approverId, approve, approve ? undefined : why);
        results.push({ id, refNumber: r?.refNumber ?? refById.get(id) ?? null, ok: true, status: r?.status });
      } catch (e: any) {
        const msg = e?.response?.message ?? e?.message ?? 'Failed';
        results.push({ id, refNumber: refById.get(id) ?? null, ok: false, error: Array.isArray(msg) ? msg.join(', ') : String(msg) });
      }
    }
    const done = results.filter((r) => r.ok).length;
    return {
      results,
      approved: approve ? done : 0,
      rejected: approve ? 0 : done,
      failed: results.length - done,
    };
  }

  /**
   * Cancel a request and release every unit it holds. Safe to call before the goods
   * are physically issued. The requester may cancel their own request; anyone else
   * needs approver rights. Guards prevent double rollback.
   */
  async cancel(id: string, user: AccessPrincipal & { id: string }) {
    const userId = user.id;
    const owner = await this.prisma.withdrawalRequest.findUnique({ where: { id }, select: { requesterId: true } });
    if (!owner) throw new NotFoundException('Request not found');
    if (owner.requesterId !== userId && !hasAccess(user, ACCESS.requestCancelAny)) {
      throw new ForbiddenException('You can only cancel your own requests');
    }

    // Block double rollback / cancelling after goods left the building
    const noCancel: RequestStatus[] = [
      RequestStatus.CANCELLED,
      RequestStatus.COMPLETED,
      RequestStatus.SHIPPED,
      RequestStatus.ISSUED_TO_RMA,
    ];

    const updated = await this.prisma.$transaction(async (tx) => {
      // Serialize with approval / allocation / another cancel of the same request.
      await tx.$queryRaw`SELECT "id" FROM "WithdrawalRequest" WHERE "id" = ${id} FOR UPDATE`;
      const req = await tx.withdrawalRequest.findUniqueOrThrow({ where: { id }, include: { items: true } });
      if (noCancel.includes(req.status)) {
        throw new BadRequestException(`Cannot cancel a request in status ${req.status}`);
      }

      const task = await tx.fulfillmentTask.findFirst({
        where: { requestId: id, status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'desc' },
      });
      let detail: string;
      if (task) {
        if (ISSUED_TASK_STATUSES.includes(task.status)) {
          throw new BadRequestException(`Goods already issued on ${task.refNumber} — the request cannot be cancelled`);
        }
        // Releases every unit the task reserved or picked.
        await this.handover.cancelInTx(tx, task.id, userId, `Request ${req.refNumber} cancelled`);
        detail = `Fulfillment task ${task.refNumber} cancelled and its stock released`;
      } else if (req.status === RequestStatus.APPROVED) {
        // Legacy approval reserved ceil(qty) units per line but linked only the
        // first; release all of them, not just the linked one.
        let released = 0;
        // PR6: rows the approver chose are released exactly (they are not in the pool).
        const openPicks = await tx.withdrawalRequestPick.findMany({
          where: { releasedAt: null, requestItem: { requestId: id } },
          select: { id: true, requestItemId: true, stockItemId: true },
        });
        const pickedLines = new Set(openPicks.map((p) => p.requestItemId));
        if (openPicks.length) {
          const ids = openPicks.map((p) => p.stockItemId);
          await tx.$queryRaw`SELECT "id" FROM "StockItem" WHERE "id" = ANY(${ids}::text[]) FOR UPDATE`;
          await this.inventory.releaseReservation(
            tx,
            ids.map((stockItemId) => ({ stockItemId })),
            `request ${req.refNumber} (chosen at approval)`,
            userId,
          );
          await tx.withdrawalRequestPick.updateMany({
            where: { id: { in: openPicks.map((p) => p.id) } },
            data: { releasedAt: new Date() },
          });
          released += openPicks.length;
        }
        for (const item of req.items) {
          if (!item.stockItemId) continue; // unified mode: approval reserved nothing
          if (pickedLines.has(item.id)) continue; // released above
          const rows = await this.inventory.lockApprovalPool(tx, {
            productId: item.productId,
            requestId: id,
            preferId: item.stockItemId,
            warehouseId: null,
            limit: Math.ceil(item.quantityRequested),
          });
          await this.inventory.releaseReservation(
            tx,
            rows.map((r) => ({ stockItemId: r.id })),
            `request ${req.refNumber}`,
            userId,
          );
          released += rows.length;
        }
        detail = `Reserved stock released (${released} unit(s))`;
      } else {
        detail = 'No stock reserved';
      }

      const result = await tx.withdrawalRequest.update({
        where: { id },
        data: { status: RequestStatus.CANCELLED, version: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: { userId, action: 'REQUEST_CANCELLED', entityType: 'WithdrawalRequest', entityId: id, detail },
      });
      return result;
    });

    this.realtime.emitRequestUpdate({ action: RequestStatus.CANCELLED, requestId: id });
    return updated;
  }

  /**
   * Recovery for a request stranded in a fulfillment status with no live task —
   * e.g. a task that was walked to CLOSED without picking anything (legacy
   * data; the current fulfillment guard prevents new cases). Only when nothing
   * was shipped or issued and no stock is still committed to it does the
   * request move to CANCELLED, with a mandatory reason, audited.
   */
  async recoverStalled(id: string, reason: string, actorId: string) {
    if (typeof reason !== 'string' || reason.trim().length < 5) {
      throw new BadRequestException('A reason (at least 5 characters) is required for a recovery');
    }
    const STALLED: RequestStatus[] = [RequestStatus.PICKING, RequestStatus.PICKED, RequestStatus.PACKED, RequestStatus.READY_FOR_PICKUP];
    const TERMINAL_TASK = ['CLOSED', 'CANCELLED', 'RETURNED'];
    const COMMITTED: StockStatus[] = [StockStatus.RESERVED, StockStatus.PICKING, StockStatus.PICKED, StockStatus.PACKED, StockStatus.READY_FOR_PICKUP];

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "WithdrawalRequest" WHERE "id" = ${id} FOR UPDATE`;
      const req = await tx.withdrawalRequest.findUnique({ where: { id }, include: { items: true } });
      if (!req) throw new NotFoundException('Request not found');
      if (!STALLED.includes(req.status)) {
        throw new BadRequestException(`Only a request stuck in ${STALLED.join('/')} can be recovered (current: ${req.status})`);
      }
      const tasks = await tx.fulfillmentTask.findMany({
        where: { requestId: id },
        select: { id: true, refNumber: true, status: true, shipment: { select: { refNumber: true } }, items: { select: { stockItemId: true, qtyPicked: true } } },
      });
      const live = tasks.find((t) => !TERMINAL_TASK.includes(t.status));
      if (live) throw new ConflictException(`Task ${live.refNumber} is still ${live.status} — finish or cancel it through fulfillment`);
      const shipped = tasks.find((t) => t.shipment);
      if (shipped) throw new ConflictException(`Task ${shipped.refNumber} has shipment ${shipped.shipment!.refNumber} — goods left the warehouse; use returns instead`);
      const picked = tasks.find((t) => t.items.some((i) => (i.qtyPicked ?? 0) > 0));
      if (picked) throw new ConflictException(`Task ${picked.refNumber} recorded picked quantities — resolve them through fulfillment`);

      const linked = [...req.items.map((i) => i.stockItemId), ...tasks.flatMap((t) => t.items.map((i) => i.stockItemId))].filter((x): x is string => !!x);
      const held = linked.length
        ? await tx.stockItem.findMany({ where: { id: { in: linked }, status: { in: COMMITTED } }, select: { id: true, status: true } })
        : [];
      if (held.length) {
        throw new ConflictException(`Stock ${held.map((h) => `${h.id} (${h.status})`).join(', ')} is still committed to this request — release it first (Reports → Balance → open the unit → Release stuck reservation)`);
      }

      const claimed = await tx.withdrawalRequest.updateMany({
        where: { id, status: req.status },
        data: { status: RequestStatus.CANCELLED, rejectReason: `Recovered: ${reason.trim()}`, version: { increment: 1 } },
      });
      if (claimed.count === 0) throw new ConflictException('Request changed concurrently — reload and retry');
      await tx.auditLog.create({
        data: {
          userId: actorId, action: 'REQUEST_RECOVERED', entityType: 'WithdrawalRequest', entityId: id,
          detail: `${req.refNumber}: ${req.status} → CANCELLED (no live task, nothing shipped or held). Tasks: ${tasks.map((t) => `${t.refNumber}=${t.status}`).join(', ') || 'none'}. Reason: ${reason.trim()}`,
        },
      });
      return tx.withdrawalRequest.findUniqueOrThrow({ where: { id } });
    });
  }

}
