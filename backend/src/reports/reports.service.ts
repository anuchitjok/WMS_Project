import { Injectable, BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { StockStatus, RequestStatus, RTVStatus, Prisma } from '@prisma/client';
import { getLowStockProducts } from '../common/inventory-metrics';

// Statuses that mean the unit has physically left the warehouse — excluded from
// the on-hand Balance Report.
const GONE_STATUSES: StockStatus[] = [
  StockStatus.SHIPPED,
  StockStatus.CONSUMED,
  StockStatus.ISSUED_TO_RMA,
  StockStatus.RTV_SHIPPED,
  StockStatus.CLOSED,
  StockStatus.CANCELLED,
];

export interface ReportFilters {
  from?: string;
  to?: string;
  warehouseId?: string;
  q?: string;
}

export type ReportType = 'master-data' | 'balance' | 'receive';

function parseDate(d?: string): Date | undefined {
  if (!d) return undefined;
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? undefined : dt;
}

function dateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  const gte = parseDate(from);
  const lte = parseDate(to);
  if (!gte && !lte) return undefined;
  const f: Prisma.DateTimeFilter = {};
  if (gte) f.gte = gte;
  if (lte) {
    // make `to` inclusive of the whole day
    lte.setHours(23, 59, 59, 999);
    f.lte = lte;
  }
  return f;
}

function iso(d?: Date | null): string {
  return d ? d.toISOString() : '';
}

function bin(item: { rack?: { code: string } | null; slot?: { code: string } | null }): string {
  const parts = [item.rack?.code, item.slot?.code].filter(Boolean);
  return parts.join(' / ');
}

function sku(p: { partNumber?: string | null; code: string }): string {
  return p.partNumber || p.code;
}

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async summary() {
    const [
      totalRequests,
      completedRequests,
      doaCount,
      totalStockItems,
      openRtv,
      lowStockItems,
      stockByOwnership,
      stockByWarehouse,
    ] = await Promise.all([
      this.prisma.withdrawalRequest.count(),
      this.prisma.withdrawalRequest.count({ where: { status: RequestStatus.COMPLETED } }),
      this.prisma.stockItem.count({ where: { status: { in: [StockStatus.DOA, StockStatus.DAMAGED] } } }),
      this.prisma.stockItem.count(),
      this.prisma.rTVCase.count({ where: { status: { not: RTVStatus.COMPLETED } } }),
      // Single shared low-stock metric (available-based) — consistent with dashboard.
      getLowStockProducts(this.prisma),
      this.prisma.stockItem.groupBy({ by: ['ownershipType'], _count: { _all: true }, _sum: { quantity: true } }),
      this.prisma.stockItem.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const slaRate = totalRequests > 0 ? Math.round((completedRequests / totalRequests) * 100) : 0;
    const doaRate = totalStockItems > 0 ? ((doaCount / totalStockItems) * 100).toFixed(1) : '0.0';

    return {
      kpis: {
        slaRate,
        doaRate,
        openRtv,
        lowStockCount: lowStockItems.length,
        totalRequests,
        completedRequests,
        totalStockItems,
      },
      stockByOwnership,
      stockByWarehouse,
      lowStockItems: lowStockItems.map((p) => ({ code: p.code, name: p.name, onHand: p.available, minStock: p.minStock })),
    };
  }

  // ── Free-text filter applied in-memory across the visible string fields ──────
  private applyQuery<T extends Record<string, any>>(rows: T[], q?: string): T[] {
    const term = q?.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      Object.values(r).some((v) => v != null && String(v).toLowerCase().includes(term)),
    );
  }

  // ── 1. Master Data Report — one row per stock item (full lineage) ────────────
  async masterData(filters: ReportFilters = {}) {
    const where: Prisma.StockItemWhereInput = {};
    if (filters.warehouseId) where.warehouseId = filters.warehouseId;
    const rd = dateRange(filters.from, filters.to);
    if (rd) where.receivedDate = rd;

    const items = await this.prisma.stockItem.findMany({
      where,
      include: {
        product: { include: { brand: true } },
        warehouse: true,
        rack: true,
        slot: true,
        createdBy: { select: { fullName: true } },
        goodsReceivingItems: {
          include: { receiving: { include: { receivedBy: { select: { fullName: true } } } } },
          take: 1,
        },
      },
      orderBy: { receivedDate: 'desc' },
    });

    const rows = items.map((i) => {
      const gr = i.goodsReceivingItems[0]?.receiving;
      return {
        createDate: iso(i.receivedDate),
        createBy: i.createdBy?.fullName ?? '',
        brand: i.product.brand?.name ?? '',
        model: i.product.model ?? '',
        sku: sku(i.product),
        productType: i.product.productType,
        description: i.product.description ?? '',
        receiveDate: iso(gr?.receivedDate ?? i.receivedDate),
        receiveBy: gr?.receivedBy?.fullName ?? i.createdBy?.fullName ?? '',
        serialNumber: i.serialNumber ?? '',
        qty: i.quantity,
        sourceType: gr?.sourceType ?? i.ownershipType,
        condition: i.goodsReceivingItems[0]?.condition ?? i.status,
        warehouse: i.warehouse?.name ?? '',
        binNumber: bin(i),
        awb: gr?.awbNumber ?? '',
        invoiceNo: gr?.invoiceNumber ?? '',
        rmaRef: gr?.sourceRef ?? '',
      };
    });
    return this.applyQuery(rows, filters.q);
  }

  // ── 2. Balance Report — on-hand stock + last in/out per product ──────────────
  async balance(filters: ReportFilters = {}) {
    const where: Prisma.StockItemWhereInput = { status: { notIn: GONE_STATUSES } };
    if (filters.warehouseId) where.warehouseId = filters.warehouseId;
    const rd = dateRange(filters.from, filters.to);
    if (rd) where.receivedDate = rd;

    const [items, lastIn, lastOut] = await Promise.all([
      this.prisma.stockItem.findMany({
        where,
        include: {
          product: { include: { brand: true } },
          warehouse: true,
          rack: true,
          slot: true,
        },
        orderBy: { receivedDate: 'desc' },
      }),
      // Last transaction IN per product (latest stock-item received date).
      this.prisma.stockItem.groupBy({ by: ['productId'], _max: { receivedDate: true } }),
      // Last transaction OUT per product (latest fulfillment pick).
      this.prisma.fulfillmentTaskItem.groupBy({
        by: ['productId'],
        where: { pickedAt: { not: null } },
        _max: { pickedAt: true },
      }),
    ]);

    const inMap = new Map(lastIn.map((g) => [g.productId, g._max.receivedDate]));
    const outMap = new Map(lastOut.map((g) => [g.productId, g._max.pickedAt]));

    const rows = items.map((i) => ({
      createDate: iso(i.receivedDate),
      brand: i.product.brand?.name ?? '',
      model: i.product.model ?? '',
      sku: sku(i.product),
      productType: i.product.productType,
      description: i.product.description ?? '',
      serialNumber: i.serialNumber ?? '',
      qty: i.quantity,
      sourceType: i.ownershipType,
      condition: i.status,
      warehouse: i.warehouse?.name ?? '',
      binNumber: bin(i),
      lastInDate: iso(inMap.get(i.productId)),
      lastOutDate: iso(outMap.get(i.productId)),
    }));
    return this.applyQuery(rows, filters.q);
  }

  // ── 3. Receive Report — one row per goods-receiving line ─────────────────────
  async receive(filters: ReportFilters = {}) {
    const where: Prisma.GoodsReceivingItemWhereInput = {};
    const rd = dateRange(filters.from, filters.to);
    if (rd) where.receiving = { receivedDate: rd };
    if (filters.warehouseId) where.stockItem = { warehouseId: filters.warehouseId };

    const items = await this.prisma.goodsReceivingItem.findMany({
      where,
      include: {
        product: { include: { brand: true } },
        receiving: { include: { receivedBy: { select: { fullName: true } } } },
        stockItem: { include: { warehouse: true, rack: true, slot: true } },
      },
      orderBy: { receiving: { receivedDate: 'desc' } },
    });

    const rows = items.map((it) => {
      const gr = it.receiving;
      return {
        createBy: gr.receivedBy?.fullName ?? '',
        brand: it.product.brand?.name ?? '',
        model: it.product.model ?? '',
        sku: sku(it.product),
        productType: it.product.productType,
        description: it.product.description ?? '',
        receiveDate: iso(gr.receivedDate),
        receiveBy: gr.receivedBy?.fullName ?? '',
        serialNumber: it.serialNumber ?? '',
        qty: it.quantity,
        sourceType: gr.sourceType ?? '',
        condition: it.condition,
        warehouse: it.stockItem?.warehouse?.name ?? '',
        binNumber: it.stockItem ? bin(it.stockItem) : '',
        awb: gr.awbNumber ?? '',
        invoiceNo: gr.invoiceNumber ?? '',
        rmaRef: gr.sourceRef ?? '',
      };
    });
    return this.applyQuery(rows, filters.q);
  }

  // ── Column definitions (shared by web table + export) ────────────────────────
  private columns(report: ReportType): { header: string; key: string; width: number }[] {
    switch (report) {
      case 'master-data':
        return [
          { header: 'CreateDate', key: 'createDate', width: 22 },
          { header: 'CreateBy', key: 'createBy', width: 18 },
          { header: 'Brand', key: 'brand', width: 16 },
          { header: 'Model', key: 'model', width: 16 },
          { header: 'PartNumber / SKU', key: 'sku', width: 20 },
          { header: 'ProductType', key: 'productType', width: 16 },
          { header: 'Description', key: 'description', width: 30 },
          { header: 'ReceiveDate', key: 'receiveDate', width: 22 },
          { header: 'ReceiveBy', key: 'receiveBy', width: 18 },
          { header: 'S/N', key: 'serialNumber', width: 20 },
          { header: 'QTY', key: 'qty', width: 8 },
          { header: 'Source Type', key: 'sourceType', width: 16 },
          { header: 'Condition', key: 'condition', width: 16 },
          { header: 'Warehouse', key: 'warehouse', width: 18 },
          { header: 'Bin Number', key: 'binNumber', width: 16 },
          { header: 'AWB', key: 'awb', width: 18 },
          { header: 'Invoice No', key: 'invoiceNo', width: 18 },
          { header: 'RMA Reference No', key: 'rmaRef', width: 20 },
        ];
      case 'balance':
        return [
          { header: 'CreateDate', key: 'createDate', width: 22 },
          { header: 'Brand', key: 'brand', width: 16 },
          { header: 'Model', key: 'model', width: 16 },
          { header: 'PartNumber / SKU', key: 'sku', width: 20 },
          { header: 'ProductType', key: 'productType', width: 16 },
          { header: 'Description', key: 'description', width: 30 },
          { header: 'S/N', key: 'serialNumber', width: 20 },
          { header: 'QTY', key: 'qty', width: 8 },
          { header: 'Source Type', key: 'sourceType', width: 16 },
          { header: 'Condition', key: 'condition', width: 16 },
          { header: 'Warehouse', key: 'warehouse', width: 18 },
          { header: 'Bin Number', key: 'binNumber', width: 16 },
          { header: 'Last Transaction In Date', key: 'lastInDate', width: 24 },
          { header: 'Last Transaction Out Date', key: 'lastOutDate', width: 24 },
        ];
      case 'receive':
        return [
          { header: 'CreateBy', key: 'createBy', width: 18 },
          { header: 'Brand', key: 'brand', width: 16 },
          { header: 'Model', key: 'model', width: 16 },
          { header: 'PartNumber / SKU', key: 'sku', width: 20 },
          { header: 'ProductType', key: 'productType', width: 16 },
          { header: 'Description', key: 'description', width: 30 },
          { header: 'ReceiveDate', key: 'receiveDate', width: 22 },
          { header: 'ReceiveBy', key: 'receiveBy', width: 18 },
          { header: 'S/N', key: 'serialNumber', width: 20 },
          { header: 'QTY', key: 'qty', width: 8 },
          { header: 'Source Type', key: 'sourceType', width: 16 },
          { header: 'Condition', key: 'condition', width: 16 },
          { header: 'Warehouse', key: 'warehouse', width: 18 },
          { header: 'Bin Number', key: 'binNumber', width: 16 },
          { header: 'AWB', key: 'awb', width: 18 },
          { header: 'Invoice No', key: 'invoiceNo', width: 18 },
          { header: 'RMA Reference No', key: 'rmaRef', width: 20 },
        ];
    }
  }

  // Column metadata for the web table (header + key only).
  schema(report: ReportType) {
    return this.columns(report).map((c) => ({ header: c.header, key: c.key }));
  }

  private async rows(report: ReportType, filters: ReportFilters) {
    if (report === 'master-data') return this.masterData(filters);
    if (report === 'balance') return this.balance(filters);
    if (report === 'receive') return this.receive(filters);
    throw new BadRequestException(`Unknown report: ${report}`);
  }

  // ── Export to .xlsx / .csv ───────────────────────────────────────────────────
  async export(report: ReportType, format: 'xlsx' | 'csv', filters: ReportFilters = {}): Promise<Buffer> {
    const rows = await this.rows(report, filters);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'HSNT WMS';
    const ws = wb.addWorksheet(report);
    ws.columns = this.columns(report);
    rows.forEach((r) => ws.addRow(r));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    return format === 'csv'
      ? Buffer.from(await wb.csv.writeBuffer())
      : Buffer.from(await wb.xlsx.writeBuffer());
  }
}
