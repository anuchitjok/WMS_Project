import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async findAll(filter: {
    userId?: string;
    entityType?: string;
    entityId?: string;
    action?: string;
    from?: string;
    to?: string;
    q?: string;
    page?: number;
    limit?: number;
    /** transactions (default) hides notification sends; notifications shows only them; all shows both. */
    category?: 'transactions' | 'notifications' | 'all';
  }) {
    const { userId, entityType, entityId, action, from, to, q } = filter;
    const category = filter.category ?? 'transactions';
    const page = Number(filter.page) > 0 ? Number(filter.page) : 1;
    const limit = Number(filter.limit) > 0 ? Number(filter.limit) : 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (userId) where.userId = userId;
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    if (action) where.action = action;
    else if (category === 'transactions') where.action = { notIn: NOTIFICATION_ACTIONS };
    else if (category === 'notifications') where.action = { in: NOTIFICATION_ACTIONS };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) {
        // inclusive end-of-day for a plain date input
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }
    if (q) {
      where.OR = [
        { detail: { contains: q, mode: 'insensitive' } },
        { action: { contains: q, mode: 'insensitive' } },
        { entityType: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [data, total, actions, entityTypes] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: { fullName: true, username: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
      this.prisma.auditLog.findMany({
        distinct: ['entityType'],
        where: { entityType: { not: null } },
        select: { entityType: true },
        orderBy: { entityType: 'asc' },
      }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      filters: {
        actions: actions.map((a) => a.action),
        entityTypes: entityTypes.map((e) => e.entityType).filter((e): e is string => !!e),
      },
    };
  }

  /**
   * Phase 3 — one timeline for a reference: a GR, WR (request), FT (task) or
   * shipment number, or a serial number. The reference is expanded along its
   * chain (request ↔ tasks ↔ shipments ↔ stock units ↔ receiving) and every
   * transaction entry on that chain is returned oldest first. Notification
   * sends are not transactions and are left out.
   */
  async timeline(raw: string) {
    const ref = raw?.trim();
    if (!ref || ref.length < 3) throw new BadRequestException('Enter at least 3 characters of a GR, WR, FT, shipment or serial number');
    const eq = { equals: ref, mode: 'insensitive' as const };

    const [grs, reqs, tasks, ships, units] = await Promise.all([
      this.prisma.goodsReceiving.findMany({ where: { refNumber: eq }, select: { id: true, refNumber: true } }),
      this.prisma.withdrawalRequest.findMany({ where: { refNumber: eq }, select: { id: true, refNumber: true } }),
      this.prisma.fulfillmentTask.findMany({ where: { refNumber: eq }, select: { id: true, refNumber: true, requestId: true } }),
      this.prisma.shipment.findMany({ where: { refNumber: eq }, select: { id: true, refNumber: true, taskId: true } }),
      this.prisma.stockItem.findMany({ where: { serialNumber: eq }, select: { id: true, serialNumber: true } }),
    ]);
    const matches = [
      ...grs.map((x) => ({ type: 'GR', ref: x.refNumber, id: x.id })),
      ...reqs.map((x) => ({ type: 'WR', ref: x.refNumber, id: x.id })),
      ...tasks.map((x) => ({ type: 'FT', ref: x.refNumber, id: x.id })),
      ...ships.map((x) => ({ type: 'Shipment', ref: x.refNumber, id: x.id })),
      ...units.map((x) => ({ type: 'Serial', ref: x.serialNumber ?? x.id, id: x.id })),
    ];
    if (!matches.length) return { query: ref, matches, events: [], truncated: false };

    const grIds = new Set(grs.map((g) => g.id));
    const requestIds = new Set(reqs.map((r) => r.id));
    const taskIds = new Set(tasks.map((t) => t.id));
    const stockIds = new Set(units.map((u) => u.id));
    tasks.forEach((t) => requestIds.add(t.requestId));
    if (ships.length) {
      const shipTasks = await this.prisma.fulfillmentTask.findMany({ where: { id: { in: ships.map((s) => s.taskId) } }, select: { id: true, requestId: true } });
      shipTasks.forEach((t) => { taskIds.add(t.id); requestIds.add(t.requestId); });
    }
    // A serial pulls in the documents that touched that unit.
    if (units.length) {
      const ids = [...stockIds];
      const [gri, wri, fti] = await Promise.all([
        this.prisma.goodsReceivingItem.findMany({ where: { stockItemId: { in: ids } }, select: { receivingId: true } }),
        this.prisma.withdrawalRequestItem.findMany({ where: { stockItemId: { in: ids } }, select: { requestId: true } }),
        this.prisma.fulfillmentTaskItem.findMany({ where: { stockItemId: { in: ids } }, select: { taskId: true } }),
      ]);
      gri.forEach((g) => grIds.add(g.receivingId));
      wri.forEach((w) => requestIds.add(w.requestId));
      fti.forEach((f) => taskIds.add(f.taskId));
    }
    // Requests → all their tasks; tasks → their shipments and stock lines; GRs → their units.
    const [reqTasks, grItems, reqItems] = await Promise.all([
      this.prisma.fulfillmentTask.findMany({ where: { requestId: { in: [...requestIds] } }, select: { id: true } }),
      this.prisma.goodsReceivingItem.findMany({ where: { receivingId: { in: [...grIds] }, stockItemId: { not: null } }, select: { stockItemId: true } }),
      this.prisma.withdrawalRequestItem.findMany({ where: { requestId: { in: [...requestIds] }, stockItemId: { not: null } }, select: { stockItemId: true } }),
    ]);
    reqTasks.forEach((t) => taskIds.add(t.id));
    grItems.forEach((g) => g.stockItemId && stockIds.add(g.stockItemId));
    reqItems.forEach((r) => r.stockItemId && stockIds.add(r.stockItemId));
    const [taskShips, taskItems] = await Promise.all([
      this.prisma.shipment.findMany({ where: { taskId: { in: [...taskIds] } }, select: { id: true } }),
      this.prisma.fulfillmentTaskItem.findMany({ where: { taskId: { in: [...taskIds] }, stockItemId: { not: null } }, select: { stockItemId: true } }),
    ]);
    const shipmentIds = new Set([...ships.map((s) => s.id), ...taskShips.map((s) => s.id)]);
    taskItems.forEach((t) => t.stockItemId && stockIds.add(t.stockItemId));

    const LIMIT = 500;
    const pairs: { entityType: string; ids: Set<string> }[] = [
      { entityType: 'GoodsReceiving', ids: grIds },
      { entityType: 'WithdrawalRequest', ids: requestIds },
      { entityType: 'FulfillmentTask', ids: taskIds },
      { entityType: 'Shipment', ids: shipmentIds },
      { entityType: 'StockItem', ids: stockIds },
    ];
    const rows = await this.prisma.auditLog.findMany({
      where: {
        OR: pairs.filter((p) => p.ids.size).map((p) => ({ entityType: p.entityType, entityId: { in: [...p.ids] } })),
        action: { notIn: NOTIFICATION_ACTIONS },
      },
      include: { user: { select: { fullName: true, username: true } } },
      orderBy: { createdAt: 'asc' },
      take: LIMIT + 1,
    });

    // Readable reference for each entry (GR/WR/FT/shipment number or serial).
    const [grRefs, reqRefs, taskRefs, shipRefs, stockRefs] = await Promise.all([
      this.prisma.goodsReceiving.findMany({ where: { id: { in: [...grIds] } }, select: { id: true, refNumber: true } }),
      this.prisma.withdrawalRequest.findMany({ where: { id: { in: [...requestIds] } }, select: { id: true, refNumber: true } }),
      this.prisma.fulfillmentTask.findMany({ where: { id: { in: [...taskIds] } }, select: { id: true, refNumber: true } }),
      this.prisma.shipment.findMany({ where: { id: { in: [...shipmentIds] } }, select: { id: true, refNumber: true } }),
      this.prisma.stockItem.findMany({ where: { id: { in: [...stockIds] } }, select: { id: true, serialNumber: true, batchNumber: true, product: { select: { code: true } } } }),
    ]);
    const label = new Map<string, string>();
    [...grRefs, ...reqRefs, ...taskRefs, ...shipRefs].forEach((x) => label.set(x.id, x.refNumber));
    stockRefs.forEach((s) => label.set(s.id, s.serialNumber ?? s.batchNumber ?? `${s.product.code} · ${s.id.slice(-6)}`));

    const events = rows.slice(0, LIMIT).map((r) => ({
      id: r.id, at: r.createdAt, action: r.action, entityType: r.entityType, entityId: r.entityId,
      ref: (r.entityId && label.get(r.entityId)) ?? null,
      detail: r.detail, changes: r.changes, user: r.user?.fullName ?? r.user?.username ?? 'System',
    }));
    return { query: ref, matches, events, truncated: rows.length > LIMIT };
  }
}

// Notification sends are messages, not stock or document transactions.
export const NOTIFICATION_ACTIONS = ['NOTIFICATION_SENT'];
