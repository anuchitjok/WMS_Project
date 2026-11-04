import { Injectable } from '@nestjs/common';
import { FulfillmentStatus, ReceivingStatus, RequestStatus, StockStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RTV_CLOSED } from '../rtv/rtv.service';
import type { WarehouseFilter } from './dashboard.service';

/**
 * Phase 4 — Work Queue: every open piece of work with its next action, who is
 * responsible, and since when it has been waiting. Read-only; each row links
 * to the page where the action is done.
 */
export interface WorkItem {
  stage: 'Receive' | 'Putaway' | 'Approve' | 'Allocate' | 'Fulfil' | 'Return' | 'Scrap';
  ref: string;
  summary: string;
  nextAction: string;
  owner: string;
  waitingSince: Date;
  href: string;
}

const PER_STAGE = 50;

const TASK_NEXT: Partial<Record<FulfillmentStatus, string>> = {
  ALLOCATED: 'Start picking',
  PICKING: 'Finish picking',
  PICKED: 'Pack',
  PACKING: 'Finish packing',
  PACKED: 'Mark ready to ship',
  READY_TO_SHIP: 'Hand over',
  SHORT_PICK: 'Resolve short pick',
  DAMAGED: 'Resolve damaged pick',
  HOLD: 'Release hold or cancel',
};

const RTV_NEXT: Record<string, string> = {
  RTV_REQUIRED: 'Review RTV', PENDING_REVIEW: 'Approve RTV', APPROVED: 'Prepare shipment',
  PENDING_SHIPMENT: 'Ship to vendor', SHIPPED_TO_VENDOR: 'Confirm vendor received', VENDOR_RECEIVED: 'Record vendor result',
  REPLACEMENT_PENDING: 'Receive replacement', CREDIT_NOTE_PENDING: 'Record credit note',
};

const name = (u?: { fullName: string | null } | null) => u?.fullName || null;

@Injectable()
export class WorkQueueService {
  constructor(private prisma: PrismaService) {}

  async list(warehouse?: WarehouseFilter): Promise<{ items: WorkItem[]; counts: Record<string, number> }> {
    const wh = warehouse ? { warehouseId: warehouse } : {};
    const users = (ids: (string | null | undefined)[]) => {
      const list = [...new Set(ids.filter((x): x is string => !!x))];
      return list.length
        ? this.prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, fullName: true } }).then((r) => new Map(r.map((u) => [u.id, u.fullName])))
        : Promise.resolve(new Map<string, string>());
    };

    const [grs, putaway, pending, tasks, rtvs, scraps, doa] = await Promise.all([
      this.prisma.goodsReceiving.findMany({
        where: { statusEnum: { in: [ReceivingStatus.QC_PENDING, ReceivingStatus.QC_HOLD] } },
        select: { id: true, refNumber: true, statusEnum: true, createdAt: true, receivedBy: { select: { fullName: true } }, _count: { select: { items: true } } },
        orderBy: { createdAt: 'asc' }, take: PER_STAGE,
      }),
      this.prisma.stockItem.findMany({
        where: { status: StockStatus.PENDING_INSPECTION, ...(warehouse ? { OR: [{ warehouseId: warehouse }, { warehouseId: null }] } : {}) },
        select: { id: true, serialNumber: true, quantity: true, receivedDate: true, product: { select: { code: true, unit: true } } },
        orderBy: { receivedDate: 'asc' }, take: PER_STAGE,
      }),
      this.prisma.withdrawalRequest.findMany({
        where: { status: { in: [RequestStatus.SUBMITTED, RequestStatus.PENDING_APPROVAL, RequestStatus.APPROVED] } },
        select: { id: true, refNumber: true, status: true, createdAt: true, updatedAt: true, approvedAt: true, approver: { select: { fullName: true } }, requester: { select: { fullName: true } }, _count: { select: { items: true } } },
        orderBy: { createdAt: 'asc' }, take: PER_STAGE * 2,
      }),
      this.prisma.fulfillmentTask.findMany({
        where: { status: { in: Object.keys(TASK_NEXT) as FulfillmentStatus[] }, ...wh },
        select: { id: true, refNumber: true, requestRef: true, status: true, updatedAt: true, allocatedById: true, pickedById: true, packedById: true, _count: { select: { items: true } } },
        orderBy: { updatedAt: 'asc' }, take: PER_STAGE,
      }),
      this.prisma.rTVCase.findMany({
        where: { status: { notIn: RTV_CLOSED as any }, ...(warehouse ? { stockItem: { warehouseId: warehouse } } : {}) },
        select: { id: true, refNumber: true, status: true, updatedAt: true, rtvOfficer: { select: { fullName: true } }, stockItem: { select: { serialNumber: true, product: { select: { code: true } } } } },
        orderBy: { updatedAt: 'asc' }, take: PER_STAGE,
      }),
      this.prisma.scrapCase.findMany({
        where: { status: { in: ['PENDING_REVIEW', 'APPROVED'] as any }, ...(warehouse ? { stockItem: { warehouseId: warehouse } } : {}) },
        select: { id: true, refNumber: true, status: true, createdAt: true, approvedAt: true, quantity: true, requestedBy: { select: { fullName: true } }, approvedBy: { select: { fullName: true } } },
        orderBy: { createdAt: 'asc' }, take: PER_STAGE,
      }),
      this.prisma.stockItem.findMany({
        where: { status: StockStatus.DOA, rtvCases: { none: { status: { notIn: RTV_CLOSED as any } } }, ...wh },
        select: { id: true, serialNumber: true, updatedAt: true, product: { select: { code: true } } },
        orderBy: { updatedAt: 'asc' }, take: PER_STAGE,
      }),
    ]);

    // Requests that already have a live task are tracked by the task row instead.
    const live = await this.prisma.fulfillmentTask.findMany({
      where: { requestId: { in: pending.filter((r) => r.status === RequestStatus.APPROVED).map((r) => r.id) }, status: { notIn: [FulfillmentStatus.CANCELLED] } },
      select: { requestId: true },
    });
    const hasTask = new Set(live.map((t) => t.requestId));
    const people = await users(tasks.flatMap((t) => [t.packedById, t.pickedById, t.allocatedById]));

    const items: WorkItem[] = [
      ...grs.map((g) => ({
        stage: 'Receive' as const, ref: g.refNumber, summary: `${g._count.items} line(s)${g.statusEnum === ReceivingStatus.QC_HOLD ? ' · on QC hold' : ''}`,
        nextAction: g.statusEnum === ReceivingStatus.QC_HOLD ? 'Resolve QC hold' : 'Inspect receipt',
        owner: name(g.receivedBy) ?? 'Receiving team', waitingSince: g.createdAt, href: '/receiving',
      })),
      ...putaway.map((s) => ({
        stage: 'Putaway' as const, ref: s.serialNumber ?? s.product.code, summary: `${s.product.code} · ${s.quantity} ${s.product.unit ?? ''}`.trim(),
        nextAction: 'Put away to a slot', owner: 'Warehouse staff', waitingSince: s.receivedDate, href: '/putaway',
      })),
      ...pending.filter((r) => r.status !== RequestStatus.APPROVED).map((r) => ({
        stage: 'Approve' as const, ref: r.refNumber, summary: `${r._count.items} item(s) · by ${name(r.requester) ?? '—'}`,
        nextAction: 'Approve or reject', owner: name(r.approver) ?? 'Approver', waitingSince: r.updatedAt ?? r.createdAt, href: '/approvals',
      })),
      ...pending.filter((r) => r.status === RequestStatus.APPROVED && !hasTask.has(r.id)).map((r) => ({
        stage: 'Allocate' as const, ref: r.refNumber, summary: `${r._count.items} item(s) approved`,
        nextAction: 'Allocate to fulfillment', owner: 'Warehouse supervisor', waitingSince: r.approvedAt ?? r.updatedAt, href: '/outbound/fulfillment',
      })),
      ...tasks.map((t) => ({
        stage: 'Fulfil' as const, ref: t.refNumber, summary: `${t.requestRef} · ${t._count.items} line(s) · ${t.status.replace(/_/g, ' ').toLowerCase()}`,
        nextAction: TASK_NEXT[t.status] ?? 'Continue',
        owner: people.get(t.packedById ?? '') ?? people.get(t.pickedById ?? '') ?? people.get(t.allocatedById ?? '') ?? 'Warehouse team',
        waitingSince: t.updatedAt, href: '/outbound/fulfillment',
      })),
      ...doa.map((s) => ({
        stage: 'Return' as const, ref: s.serialNumber ?? s.product.code, summary: `${s.product.code} · declared DOA`,
        nextAction: 'Create RTV', owner: 'RTV officer', waitingSince: s.updatedAt, href: '/doa',
      })),
      ...rtvs.map((r) => ({
        stage: 'Return' as const, ref: r.refNumber, summary: `${r.stockItem?.product.code ?? ''}${r.stockItem?.serialNumber ? ` · ${r.stockItem.serialNumber}` : ''}`,
        nextAction: RTV_NEXT[r.status] ?? 'Continue RTV', owner: name(r.rtvOfficer) ?? 'RTV officer', waitingSince: r.updatedAt, href: '/rtv',
      })),
      ...scraps.map((c) => ({
        stage: 'Scrap' as const, ref: c.refNumber, summary: `qty ${c.quantity}`,
        nextAction: c.status === 'APPROVED' ? 'Dispose (stock is deducted then)' : 'Approve or reject',
        owner: c.status === 'APPROVED' ? (name(c.approvedBy) ?? 'Warehouse manager') : 'Warehouse manager',
        waitingSince: (c.status === 'APPROVED' ? c.approvedAt : null) ?? c.createdAt, href: '/scrap',
      })),
    ];
    items.sort((a, b) => new Date(a.waitingSince).getTime() - new Date(b.waitingSince).getTime());
    const counts: Record<string, number> = {};
    items.forEach((i) => { counts[i.stage] = (counts[i.stage] ?? 0) + 1; });
    return { items, counts };
  }
}
