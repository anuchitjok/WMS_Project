import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CycleCountStatus } from '@prisma/client';
import { nanoid } from 'nanoid';

@Injectable()
export class CycleCountService {
  constructor(private prisma: PrismaService) {}

  async createSession(dto: { warehouseId: string; type?: string; assignedTo?: string; notes?: string }, userId: string) {
    const ref = `CC-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;

    // Build count lines from all AVAILABLE stock in the warehouse
    const stockItems = await this.prisma.stockItem.findMany({
      where: { warehouseId: dto.warehouseId, status: 'AVAILABLE' },
      include: { rack: true, slot: true },
    });

    const session = await this.prisma.$transaction(async (tx) => {
      const s = await tx.cycleCountSession.create({
        data: {
          refNumber: ref,
          warehouseId: dto.warehouseId,
          type: dto.type ?? 'BLIND',
          assignedTo: dto.assignedTo,
          startedById: userId,
          notes: dto.notes,
          frozenAt: new Date(), // freeze the location state
        },
      });

      // Create lines (blind = countedQty hidden from counter)
      await tx.cycleCountLine.createMany({
        data: stockItems.map((item) => ({
          sessionId: s.id,
          productId: item.productId,
          stockItemId: item.id,
          locationKey: [item.rack?.code, item.slot?.code].filter(Boolean).join('|'),
          expectedQty: item.quantity,
          countedQty: null, // null = not yet counted
        })),
      });

      await tx.auditLog.create({
        data: { userId, action: 'CYCLE_COUNT_CREATED', entityType: 'CycleCountSession', entityId: s.id, detail: `${stockItems.length} lines` },
      });
      return s;
    });
    return this.findOne(session.id);
  }

  findAll(warehouseId?: string, status?: CycleCountStatus) {
    return this.prisma.cycleCountSession.findMany({
      where: { ...(warehouseId ? { warehouseId } : {}), ...(status ? { status } : {}) },
      include: { _count: { select: { lines: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const s = await this.prisma.cycleCountSession.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!s) throw new NotFoundException('CycleCountSession not found');

    // CycleCountLine has no product relation — resolve product code/name in one query and merge,
    // so the UI can show a readable product instead of a raw id slice.
    const productIds = [...new Set(s.lines.map((l) => l.productId))];
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, code: true, name: true } })
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));
    const lines = s.lines.map((l) => ({
      ...l,
      productCode: productById.get(l.productId)?.code ?? null,
      productName: productById.get(l.productId)?.name ?? null,
    }));

    // Summary stats
    const total = lines.length;
    const counted = lines.filter((l) => l.countedQty !== null).length;
    const variances = lines.filter((l) => l.countedQty !== null && l.variance !== 0);
    return { ...s, lines, summary: { total, counted, remaining: total - counted, varianceCount: variances.length } };
  }

  // Submit a count for one line (idempotent — can recount)
  async countLine(sessionId: string, lineId: string, countedQty: number, userId: string) {
    const session = await this.prisma.cycleCountSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    if (!['OPEN', 'IN_PROGRESS'].includes(session.status)) throw new BadRequestException('Session is not open for counting');
    if (countedQty < 0) throw new BadRequestException('Counted quantity cannot be negative');

    const line = await this.prisma.cycleCountLine.findUnique({ where: { id: lineId } });
    if (!line || line.sessionId !== sessionId) throw new NotFoundException('Line not found in this session');

    const variance = countedQty - line.expectedQty;
    await this.prisma.$transaction(async (tx) => {
      await tx.cycleCountLine.update({
        where: { id: lineId },
        data: { countedQty, variance, countedById: userId, countedAt: new Date() },
      });
      // Advance session to IN_PROGRESS on first count
      if (session.status === 'OPEN') {
        await tx.cycleCountSession.update({ where: { id: sessionId }, data: { status: CycleCountStatus.IN_PROGRESS } });
      }
    });
    return this.findOne(sessionId);
  }

  // Submit session for review (all lines must be counted)
  async submitForReview(sessionId: string, userId: string) {
    const s = await this.findOne(sessionId);
    const uncounted = s.lines.filter((l: any) => l.countedQty === null);
    if (uncounted.length > 0) throw new BadRequestException(`${uncounted.length} lines not yet counted`);

    await this.prisma.cycleCountSession.update({ where: { id: sessionId }, data: { status: CycleCountStatus.REVIEW } });
    await this.prisma.auditLog.create({ data: { userId, action: 'CYCLE_COUNT_REVIEW', entityType: 'CycleCountSession', entityId: sessionId } });
    return this.findOne(sessionId);
  }

  // Approve and apply variances to stock
  async approve(sessionId: string, userId: string) {
    const s = await this.findOne(sessionId);
    if (s.status !== CycleCountStatus.REVIEW) throw new BadRequestException('Session must be in REVIEW status');

    await this.prisma.$transaction(async (tx) => {
      for (const line of s.lines as any[]) {
        if (line.variance !== 0 && line.stockItemId && line.countedQty !== null) {
          await tx.stockItem.update({ where: { id: line.stockItemId }, data: { quantity: line.countedQty } });
          // Create adjustment record for traceability
          await tx.stockAdjustment.create({
            data: {
              refNumber: `ADJ-CC-${nanoid(6).toUpperCase()}`,
              stockItemId: line.stockItemId,
              productLabel: `Cycle Count: ${s.refNumber}`,
              reason: 'cycle_count_variance',
              quantityBefore: line.expectedQty,
              quantityAfter: line.countedQty,
              status: 'COMPLETED',
              requestedById: userId,
              approvedById: userId,
              approvedAt: new Date(),
            },
          });
        }
      }
      await tx.cycleCountSession.update({
        where: { id: sessionId },
        data: { status: CycleCountStatus.APPROVED, closedById: userId, closedAt: new Date() },
      });
      await tx.auditLog.create({
        data: { userId, action: 'CYCLE_COUNT_APPROVED', entityType: 'CycleCountSession', entityId: sessionId, detail: `${s.summary.varianceCount} variances applied` },
      });
    });
    return this.findOne(sessionId);
  }

  async cancel(sessionId: string, userId: string) {
    await this.prisma.cycleCountSession.update({ where: { id: sessionId }, data: { status: CycleCountStatus.CANCELLED, closedById: userId, closedAt: new Date() } });
    return { cancelled: true };
  }
}
