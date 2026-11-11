import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FulfillmentStatus, Prisma } from '@prisma/client';
import * as bwipjs from 'bwip-js';
import { PrismaService } from '../prisma/prisma.service';
import { HandoverService } from '../fulfillment/services/handover.service';
import { ACCESS, AccessPrincipal, hasAccess } from '../auth/access';
import { scopedWarehouseIds } from '../common/warehouse-scope';
import { buildSlipRows, deliveryMethodOf, requestQrUrl, SlipRow, DeliveryMethod } from './picking-slip-data';
import { approverPickedRows, openPicksByItem } from '../fulfillment/approver-picks';
import { decideConfirm, receiptState, resolveRefView, ReceiptState } from './request-ref';

interface Actor extends AccessPrincipal {
  id: string;
  fullName?: string;
  warehouseIds?: string[];
}

const STOCK_INCLUDE = {
  warehouse: { select: { id: true, code: true, name: true } },
  rack: { select: { code: true } },
  slot: { select: { code: true } },
  goodsReceivingItems: { where: { itemCondition: { not: null } }, select: { itemCondition: true }, take: 1 },
} satisfies Prisma.StockItemInclude;

/** Everything the picking slip and the QR page need about one request. */
export interface SlipContext {
  req: Prisma.WithdrawalRequestGetPayload<{
    include: {
      requester: { select: { id: true; fullName: true; department: true; email: true } };
      approver: { select: { fullName: true } };
      items: { include: { product: { include: { brand: true } }; stockItem: { include: typeof STOCK_INCLUDE } } };
    };
  }>;
  task: { id: string; refNumber: string; status: FulfillmentStatus; version: number; warehouseId: string | null; pickedById: string | null } | null;
  rows: SlipRow[];
  /** Warehouses the lines are picked from (task warehouse, else stock warehouses). */
  warehouseIds: string[];
  pickerName: string | null;
  requesterName: string;
  deliveryMethod: DeliveryMethod;
}

@Injectable()
export class RequestRefService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly handover: HandoverService,
  ) {}

  /** Loads a request by id or ref with its active fulfillment task and pick locations. */
  async loadContext(where: { id: string } | { refNumber: string }): Promise<SlipContext> {
    const req = await this.prisma.withdrawalRequest.findUnique({
      where,
      include: {
        requester: { select: { id: true, fullName: true, department: true, email: true } },
        approver: { select: { fullName: true } },
        items: { include: { product: { include: { brand: true } }, stockItem: { include: STOCK_INCLUDE } } },
      },
    });
    if (!req) throw new NotFoundException('Request not found');

    // Active task = not cancelled / returned (one per request, see ux_fulfillment_task_request_active).
    const task = await this.prisma.fulfillmentTask.findFirst({
      where: { requestId: req.id, status: { notIn: [FulfillmentStatus.CANCELLED, FulfillmentStatus.RETURNED] } },
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { product: { include: { brand: true } } } } },
    });

    let taskItems: Parameters<typeof buildSlipRows>[1] = null;
    if (task?.items.length) {
      const ids = task.items.map((i) => i.stockItemId).filter((x): x is string => !!x);
      const stocks = ids.length
        ? await this.prisma.stockItem.findMany({ where: { id: { in: ids } }, include: STOCK_INCLUDE })
        : [];
      const byId = new Map(stocks.map((s) => [s.id, s]));
      taskItems = task.items.map((i) => ({
        product: i.product,
        qtyRequested: i.qtyRequested,
        stockItem: i.stockItemId ? byId.get(i.stockItemId) ?? null : null,
      }));
    }
    // PR6 (read only): rows the approver chose — on the task once allocated, else the
    // still-open picks. Before allocation a Manual Pick line shows one row per chosen
    // location; FIFO lines are left as they were.
    let approverRows: Set<string> | undefined;
    let pickSplits: Map<string, Array<{ qty: number; stockItem: SlipContext['req']['items'][number]['stockItem'] & { id: string } }>> | null = null;
    if (taskItems && task) {
      approverRows = (await approverPickedRows(this.prisma as any, [{ id: task.id, requestId: req.id }])).get(task.id);
    } else {
      pickSplits = await openPicksByItem(this.prisma as any, req.id, STOCK_INCLUDE);
      approverRows = new Set([...pickSplits.values()].flat().map((p) => p.stockItem.id));
    }
    const rows = buildSlipRows(req.items, taskItems, approverRows, pickSplits);

    const stockWh = (taskItems ?? req.items).map((i) => i.stockItem?.warehouse?.id).filter((x): x is string => !!x);
    const warehouseIds = task?.warehouseId ? [task.warehouseId] : [...new Set(stockWh)];

    const picker = task?.pickedById
      ? await this.prisma.user.findUnique({ where: { id: task.pickedById }, select: { fullName: true } })
      : null;

    return {
      req,
      task: task
        ? { id: task.id, refNumber: task.refNumber, status: task.status, version: task.version, warehouseId: task.warehouseId, pickedById: task.pickedById }
        : null,
      rows,
      warehouseIds,
      pickerName: picker?.fullName ?? null,
      requesterName: req.requester?.fullName ?? '',
      deliveryMethod: deliveryMethodOf(req.deliveryMethod),
    };
  }

  /** Fulfillment access inside the actor's warehouse scope. */
  private isWarehouseUser(actor: Actor, ctx: SlipContext): boolean {
    if (!hasAccess(actor, ACCESS.fulfillment)) return false;
    const scope = scopedWarehouseIds(actor);
    if (!scope) return true;
    return ctx.warehouseIds.some((id) => scope.includes(id));
  }

  // ── GET /documents/ref/:ref ────────────────────────────────────────────────
  async view(ref: string, actor: Actor) {
    const ctx = await this.loadContext({ refNumber: ref });
    const access = resolveRefView({ isOwner: ctx.req.requesterId === actor.id, isWarehouse: this.isWarehouseUser(actor, ctx) });
    if (access.view === 'NONE') return { ...access, refNumber: ctx.req.refNumber };

    const state: ReceiptState = receiptState(ctx.req.status, ctx.task?.status);
    return {
      ...access,
      refNumber: ctx.req.refNumber,
      requestId: ctx.req.id,
      status: ctx.req.status,
      createdAt: ctx.req.createdAt,
      requiredDate: ctx.req.requiredDate,
      purpose: ctx.req.purpose,
      deliveryMethod: ctx.deliveryMethod,
      requesterName: ctx.requesterName,
      department: ctx.req.requester?.department ?? ctx.req.department ?? null,
      pickerName: ctx.pickerName,
      receiptState: state,
      task: ctx.task ? { id: ctx.task.id, refNumber: ctx.task.refNumber, status: ctx.task.status, version: ctx.task.version } : null,
      // The requester sees what they will receive; only the warehouse needs pick locations.
      items: ctx.rows.map((r) => (access.canPick ? r : { ...r, location: null, selectedByApprover: false })),
    };
  }

  // ── POST /documents/ref/:ref/confirm-receipt ───────────────────────────────
  // Reuses HandoverService.issueToRma — same goods issue, status changes and audit
  // as the Handover screen. A repeat press returns alreadyConfirmed without writing.
  async confirmReceipt(ref: string, actor: Actor, expectedVersion?: number | null) {
    const ctx = await this.loadContext({ refNumber: ref });
    const decision = decideConfirm({
      isOwner: ctx.req.requesterId === actor.id,
      requestStatus: ctx.req.status,
      task: ctx.task,
      expectedVersion,
    });
    if (decision.action === 'ALREADY_DONE') return { alreadyConfirmed: true, receiptState: 'RECEIVED' as ReceiptState };
    if (decision.action === 'REJECT') {
      switch (decision.reason) {
        case 'NOT_OWNER': throw new ForbiddenException('Only the requester can confirm receipt');
        case 'STALE': throw new ConflictException('This request was updated — refresh and try again');
        case 'CANCELLED': throw new BadRequestException('This request was cancelled');
        default: throw new BadRequestException('Items are not ready for handover yet');
      }
    }

    const task = ctx.task!;
    try {
      await this.handover.issueToRma(task.id, { receiver: ctx.requesterName || actor.fullName || 'Requester' }, actor.id);
    } catch (e) {
      // Two presses at once: the second loses the atomic status claim. If the task is
      // now closed the receipt is recorded — report it instead of an error.
      const fresh = await this.prisma.fulfillmentTask.findUnique({ where: { id: task.id }, select: { status: true } });
      if (fresh?.status === FulfillmentStatus.CLOSED) return { alreadyConfirmed: true, receiptState: 'RECEIVED' as ReceiptState };
      throw e;
    }
    return { alreadyConfirmed: false, receiptState: 'RECEIVED' as ReceiptState };
  }

  // ── GET /documents/ref/:ref/qr ─────────────────────────────────────────────
  /** QR (SVG) for showing on screen, so printing the slip is optional. */
  async qr(ref: string) {
    const req = await this.prisma.withdrawalRequest.findUnique({ where: { refNumber: ref }, select: { refNumber: true } });
    if (!req) throw new NotFoundException('Request not found');
    const url = requestQrUrl(req.refNumber);
    const svg = bwipjs.toSVG({ bcid: 'qrcode', text: url, scale: 4, paddingwidth: 2, paddingheight: 2 } as any);
    return { refNumber: req.refNumber, url, svg };
  }
}
