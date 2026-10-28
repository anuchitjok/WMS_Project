import { Injectable } from '@nestjs/common';
import { Prisma, RequestStatus, SlotType, StockStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NOT_IN_LOCATION } from '../common/stock-presence';
import {
  DataSnapshot,
  LayoutSnapshot,
  PlanResult,
  ProductSnapshot,
} from './engine/types';

const RESERVED: StockStatus[] = [
  StockStatus.RESERVED,
  StockStatus.PICKING,
  StockStatus.PICKED,
  StockStatus.PACKED,
  StockStatus.READY_FOR_PICKUP,
];
const IN_INSPECTION: StockStatus[] = [
  StockStatus.PENDING_RECEIVING,
  StockStatus.PENDING_INSPECTION,
];
const BLOCKED: StockStatus[] = [
  StockStatus.QUARANTINE,
  StockStatus.DAMAGED,
  StockStatus.DOA,
];
/** Requests whose stock is not reserved yet. Approved requests already hold RESERVED stock. */
const UNRESERVED_REQUEST: RequestStatus[] = [
  RequestStatus.SUBMITTED,
  RequestStatus.PENDING_APPROVAL,
];
const PALLET_SLOTS: SlotType[] = [SlotType.PALLET, SlotType.BULK];

type Tx = Prisma.TransactionClient;

/**
 * Reads everything a calculation needs from the live WMS in ONE repeatable-read
 * transaction, so stock, demand and layout figures are mutually consistent.
 * Read-only: no row is written, locked for update, reserved or changed.
 */
@Injectable()
export class PlanningDataService {
  constructor(private prisma: PrismaService) {}

  async snapshot(opts: {
    warehouseId: string;
    productIds: string[];
    excludeProjectId: string;
    asOf: string;
  }): Promise<DataSnapshot> {
    return this.prisma.$transaction(
      async (tx) => ({
        asOf: opts.asOf,
        products: await this.products(tx, opts),
        layout: await this.layout(tx, opts.warehouseId),
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async products(
    tx: Tx,
    opts: {
      warehouseId: string;
      productIds: string[];
      excludeProjectId: string;
    },
  ): Promise<ProductSnapshot[]> {
    const ids = [...new Set(opts.productIds.filter(Boolean))];
    if (!ids.length) return [];
    const products = await tx.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        code: true,
        name: true,
        unit: true,
        unitCost: true,
        minStock: true,
        isActive: true,
        productStatus: true,
      },
    });
    const stock = await tx.stockItem.groupBy({
      by: ['productId', 'status'],
      where: { productId: { in: ids }, warehouseId: opts.warehouseId },
      _sum: { quantity: true },
    });
    const qty = (pid: string, statuses: StockStatus[]) =>
      stock
        .filter((s) => s.productId === pid && statuses.includes(s.status))
        .reduce((a, s) => a + (s._sum.quantity ?? 0), 0);

    const reqItems = await tx.withdrawalRequestItem.findMany({
      where: {
        productId: { in: ids },
        request: { status: { in: UNRESERVED_REQUEST } },
      },
      select: { productId: true, quantityRequested: true },
    });

    // Other projects whose plan is approved for this warehouse: their approved run's material totals.
    const others = await tx.planningProject.findMany({
      where: {
        planStatus: 'PLAN_APPROVED',
        id: { not: opts.excludeProjectId },
        approvedRunId: { not: null },
      },
      select: { code: true, approvedRunId: true },
    });
    const runs = others.length
      ? await tx.planningRun.findMany({
          where: { id: { in: others.map((o) => o.approvedRunId!) } },
          select: { id: true, result: true },
        })
      : [];
    const otherDemand = new Map<string, { qty: number; refs: string[] }>();
    for (const run of runs) {
      const res = JSON.parse(run.result) as PlanResult;
      if (res.summary?.warehouseId !== opts.warehouseId) continue;
      const code = others.find((o) => o.approvedRunId === run.id)!.code;
      for (const m of res.materials ?? []) {
        if (!ids.includes(m.productId)) continue;
        const cur = otherDemand.get(m.productId) ?? { qty: 0, refs: [] };
        cur.qty += m.totalRequirement;
        cur.refs.push(code);
        otherDemand.set(m.productId, cur);
      }
    }

    return products.map((p) => ({
      productId: p.id,
      code: p.code,
      name: p.name,
      unit: p.unit,
      standardUnitCost: p.unitCost,
      minimumStock: p.minStock,
      isActive: p.isActive && p.productStatus === 'ACTIVE',
      available: qty(p.id, [StockStatus.AVAILABLE]),
      reserved: qty(p.id, RESERVED),
      inInspection: qty(p.id, IN_INSPECTION),
      blocked: qty(p.id, BLOCKED),
      pendingRequestDemand: reqItems
        .filter((r) => r.productId === p.id)
        .reduce((a, r) => a + r.quantityRequested, 0),
      otherPlanDemand: otherDemand.get(p.id)?.qty ?? 0,
      otherPlanRefs: otherDemand.get(p.id)?.refs ?? [],
    }));
  }

  private async layout(tx: Tx, warehouseId: string): Promise<LayoutSnapshot> {
    const wh = await tx.warehouse.findUnique({
      where: { id: warehouseId },
      select: { code: true },
    });
    const slots = await tx.slot.findMany({
      where: {
        isActive: true,
        isDeleted: false,
        rack: { warehouseId, isDeleted: false, isActive: true },
      },
      select: {
        slotType: true,
        capacity: true,
        status: true,
        _count: {
          select: {
            stockItems: { where: { status: { notIn: NOT_IN_LOCATION } } },
          },
        },
      },
    });
    const pallet = slots.filter(
      (s) => PALLET_SLOTS.includes(s.slotType) && s.status !== 'BLOCKED',
    );
    const layout = await tx.warehouseLayout.findFirst({
      where: { warehouseId, isDeleted: false },
      select: {
        unitLabel: true,
        objects: {
          where: { isDeleted: false, status: 'ACTIVE' },
          select: { objectType: true, width: true, height: true },
        },
      },
    });
    // Floor Plan geometry is in grid units; only a layout drawn in metres gives m².
    const metric = layout?.unitLabel === 'm';
    const area = (types: string[]) => {
      if (!layout || !metric) return null;
      const objs = layout.objects.filter((o) => types.includes(o.objectType));
      return objs.length
        ? Math.round(objs.reduce((a, o) => a + o.width * o.height, 0) * 100) /
            100
        : null;
    };
    return {
      warehouseId,
      warehouseCode: wh?.code ?? null,
      palletSlotCount: pallet.length,
      palletSlotFreeCapacity: pallet.reduce(
        (a, s) => a + Math.max(0, s.capacity - s._count.stockItems),
        0,
      ),
      otherSlotCount: slots.length - pallet.length,
      hasLayout: !!layout,
      layoutUnit: layout?.unitLabel ?? null,
      receivingAreaM2: area(['RECEIVING_AREA']),
      dispatchAreaM2: area(['SHIPPING_AREA']),
      stagingAreaM2: area(['STAGING_AREA']),
      workAreaM2: area(['WORK_AREA', 'QC_AREA']),
    };
  }
}
