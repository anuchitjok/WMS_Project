import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StockStatus } from '@prisma/client';
import { transitionStock } from '../common/stock-state';
import { ScopePrincipal, assertStockInScope, warehouseFilter } from '../common/warehouse-scope';
import { MasterDataService } from '../master-data/master-data.service';
import { openRtvCase } from '../rtv/rtv.service';

const DECLARABLE: StockStatus[] = [StockStatus.AVAILABLE, StockStatus.QUARANTINE, StockStatus.DAMAGED, StockStatus.PENDING_INSPECTION, StockStatus.RETURNED_UNUSED];

@Injectable()
export class DoaService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
    private masterData: MasterDataService,
  ) {}

  // DOA / defective / quarantine stock items
  list(scope?: ScopePrincipal) {
    const wh = warehouseFilter(scope);
    return this.prisma.stockItem.findMany({
      where: { status: { in: [StockStatus.DOA, StockStatus.DAMAGED, StockStatus.QUARANTINE, StockStatus.RTV_PENDING] }, ...(wh ? { warehouseId: wh } : {}) },
      include: { product: { include: { brand: true } }, warehouse: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  // Mark a stock item DOA (e.g. discovered during inspection).
  // Only stock on hand and not committed to an outbound task can be declared DOA.
  async declare(stockItemId: string, input: { reason?: string; reasonCode?: string }, userId: string, scope?: ScopePrincipal) {
    await assertStockInScope(this.prisma, scope, stockItemId);
    // Requirement 7.4: a DOA declaration needs a reason — a managed code once DOA codes exist.
    const resolved = await this.masterData.resolveReason('DOA', { reasonCode: input.reasonCode, reason: input.reason ?? (input.reasonCode ? undefined : 'DOA declared') });
    const reason = resolved.reasonCode ? `[${resolved.reasonCode}] ${resolved.reason}` : resolved.reason;
    const updated = await this.prisma.$transaction(async (tx) => {
      await transitionStock(tx, stockItemId, DECLARABLE, StockStatus.DOA, { notes: reason });
      await tx.auditLog.create({
        data: { userId, action: 'DOA_DECLARED', entityType: 'StockItem', entityId: stockItemId, detail: reason },
      });
      return tx.stockItem.findUniqueOrThrow({ where: { id: stockItemId } });
    });
    this.realtime.emitInventoryUpdate({ action: 'doa', stockItemId });
    return updated;
  }

  // Create RTV case from a DOA/defective stock item (one open case per unit)
  async createRtv(stockItemId: string, vendorId: string | undefined, userId: string) {
    const item = await this.prisma.stockItem.findUnique({ where: { id: stockItemId }, include: { product: true } });
    if (!item) throw new NotFoundException('Stock item not found');

    const rtv = await this.prisma.$transaction(async (tx) => {
      // One open case per unit, checked under a row lock (double submit safe).
      const c = await openRtvCase(tx, {
        stockItemId,
        reason: item.status === StockStatus.DOA ? 'doa' : 'defective',
        description: `Created from DOA management for ${item.product.code}`,
        vendorId,
        officerId: userId,
      });
      await tx.auditLog.create({
        data: { userId, action: 'RTV_CREATED', entityType: 'RTVCase', entityId: c.id, detail: c.refNumber },
      });
      return c;
    });
    this.realtime.emitInventoryUpdate({ action: 'rtv_created', refNumber: rtv.refNumber });
    return rtv;
  }
}
