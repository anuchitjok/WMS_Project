import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RTVStatus } from '@prisma/client';
import { nanoid } from 'nanoid';
import { ScopePrincipal, assertWarehouseAccess, warehouseFilter } from '../common/warehouse-scope';
import { SystemSettingsService } from '../settings/system-settings.service';

/** RTV cases that are finished and no longer age. */
export const RTV_CLOSED: RTVStatus[] = [RTVStatus.COMPLETED, RTVStatus.REJECTED_BY_VENDOR, RTVStatus.CANCELLED];

/**
 * Aging against the `rtv.agingSla` setting: elapsed whole 24-hour days since
 * the case was created (timezone-independent). No SLA in force → overdue is null.
 */
export function rtvAging(c: { createdAt: Date; status: RTVStatus }, slaDays: number | null, now = new Date()) {
  const ageMs = now.getTime() - c.createdAt.getTime();
  const ageDays = Math.floor(ageMs / 86_400_000);
  const open = !RTV_CLOSED.includes(c.status);
  // Same rule as the dashboard count: older than the SLA by any amount = overdue.
  return { ageDays, slaDays, overdue: slaDays === null || !open ? null : ageMs > slaDays * 86_400_000 };
}

@Injectable()
export class RtvService {
  constructor(private prisma: PrismaService, private settings: SystemSettingsService) {}

  private async stockWarehouse(stockItemId: string) {
    const stock = await this.prisma.stockItem.findUnique({ where: { id: stockItemId }, select: { warehouseId: true } });
    if (!stock) throw new NotFoundException('Stock item not found');
    return stock.warehouseId;
  }

  private genRef() {
    return `RTV-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;
  }

  async findAll(filter: { status?: RTVStatus; page?: number; limit?: number; overdue?: boolean }, scope?: ScopePrincipal) {
    const { status, page = 1, limit = 20 } = filter;
    const skip = (page - 1) * limit;
    const wh = warehouseFilter(scope);
    const slaDays = await this.settings.rtvAgingSlaDays();
    const rows = await this.prisma.rTVCase.findMany({
      where: { ...(status ? { status } : {}), ...(wh ? { stockItem: { warehouseId: wh } } : {}) },
      include: {
        stockItem: { include: { product: true } },
        vendor: true,
        rtvOfficer: { select: { fullName: true } },
      },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const withAging = rows.map((r) => ({ ...r, ...rtvAging(r, slaDays) }));
    return filter.overdue ? withAging.filter((r) => r.overdue) : withAging;
  }

  async findOne(id: string, scope?: ScopePrincipal) {
    const c = await this.prisma.rTVCase.findUnique({
      where: { id },
      include: {
        stockItem: { include: { product: { include: { brand: true } } } },
        vendor: true,
        rtvOfficer: { select: { fullName: true } },
      },
    });
    if (!c) throw new NotFoundException('RTV case not found');
    assertWarehouseAccess(scope, c.stockItem?.warehouseId, 'this RTV case');
    return { ...c, ...rtvAging(c, await this.settings.rtvAgingSlaDays()) };
  }

  async create(data: { stockItemId: string; reason: string; description?: string; vendorId?: string }, officerId: string, scope?: ScopePrincipal) {
    assertWarehouseAccess(scope, await this.stockWarehouse(data.stockItemId), 'this stock item');
    const rtv = await this.prisma.rTVCase.create({
      data: {
        refNumber: this.genRef(),
        stockItemId: data.stockItemId,
        reason: data.reason,
        description: data.description,
        vendorId: data.vendorId,
        rtvOfficerId: officerId,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: officerId,
        action: 'RTV_CASE_CREATED',
        entityType: 'RTVCase',
        entityId: rtv.id,
        detail: `${rtv.refNumber} · ${data.reason}`,
      },
    });
    return rtv;
  }

  async updateStatus(id: string, status: RTVStatus, actorId: string, scope?: ScopePrincipal) {
    const existing = await this.prisma.rTVCase.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('RTV case not found');
    assertWarehouseAccess(scope, await this.stockWarehouse(existing.stockItemId), 'this RTV case');
    const updated = await this.prisma.rTVCase.update({ where: { id }, data: { status } });
    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'RTV_STATUS_CHANGED',
        entityType: 'RTVCase',
        entityId: id,
        detail: `${existing.refNumber}: ${existing.status} → ${status}`,
      },
    });
    return updated;
  }
}
