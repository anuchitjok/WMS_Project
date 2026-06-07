import { Injectable, BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { IMPORT_SCHEMAS, ImportType, ExportType } from './import-schemas';

@Injectable()
export class DataioService {
  constructor(private prisma: PrismaService) {}

  // ── Generate an import template (.xlsx) with headers + example row ────────
  async template(type: ImportType): Promise<Buffer> {
    const schema = IMPORT_SCHEMAS[type];
    if (!schema) throw new BadRequestException('Unknown template type');

    const wb = new ExcelJS.Workbook();
    wb.creator = 'HSNT WMS';
    const ws = wb.addWorksheet(schema.label);
    ws.columns = schema.columns.map((c) => ({ header: c.header, key: c.key, width: Math.max(16, c.header.length + 4) }));

    // header styling
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // example row
    const example: Record<string, any> = {};
    schema.columns.forEach((c) => { example[c.key] = c.example ?? ''; });
    ws.addRow(example);

    // hints as a second sheet
    const hintWs = wb.addWorksheet('Field Guide');
    hintWs.columns = [
      { header: 'Field', key: 'field', width: 22 },
      { header: 'Required', key: 'req', width: 12 },
      { header: 'Notes', key: 'hint', width: 50 },
    ];
    hintWs.getRow(1).font = { bold: true };
    schema.columns.forEach((c) => hintWs.addRow({ field: c.header, req: c.required ? 'YES' : 'no', hint: c.hint ?? '' }));

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Export data to .xlsx or .csv ─────────────────────────────────────────
  async export(type: ExportType, format: 'xlsx' | 'csv'): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'HSNT WMS';
    const ws = wb.addWorksheet(type);

    if (type === 'inventory') {
      ws.columns = [
        { header: 'Item ID', key: 'id', width: 26 },
        { header: 'Product Code', key: 'code', width: 18 },
        { header: 'Product Name', key: 'name', width: 30 },
        { header: 'Serial', key: 'serial', width: 20 },
        { header: 'Batch', key: 'batch', width: 16 },
        { header: 'Qty', key: 'qty', width: 8 },
        { header: 'Status', key: 'status', width: 18 },
        { header: 'Ownership', key: 'owner', width: 16 },
        { header: 'Warehouse', key: 'wh', width: 16 },
      ];
      const items = await this.prisma.stockItem.findMany({
        include: { product: true, warehouse: true },
        orderBy: { updatedAt: 'desc' },
      });
      items.forEach((i) =>
        ws.addRow({
          id: i.id, code: i.product.code, name: i.product.name, serial: i.serialNumber ?? '',
          batch: i.batchNumber ?? '', qty: i.quantity, status: i.status, owner: i.ownershipType, wh: i.warehouse?.code ?? '',
        }),
      );
    } else if (type === 'audit') {
      ws.columns = [
        { header: 'Time', key: 'time', width: 22 },
        { header: 'User', key: 'user', width: 22 },
        { header: 'Action', key: 'action', width: 24 },
        { header: 'Entity', key: 'entity', width: 18 },
        { header: 'Detail', key: 'detail', width: 50 },
      ];
      const logs = await this.prisma.auditLog.findMany({
        include: { user: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      });
      logs.forEach((l) =>
        ws.addRow({ time: l.createdAt.toISOString(), user: l.user?.fullName ?? 'System', action: l.action, entity: l.entityType ?? '', detail: l.detail ?? '' }),
      );
    } else if (type === 'requests') {
      ws.columns = [
        { header: 'Ref', key: 'ref', width: 20 },
        { header: 'Requester', key: 'requester', width: 22 },
        { header: 'Department', key: 'dept', width: 20 },
        { header: 'RMA', key: 'rma', width: 18 },
        { header: 'Status', key: 'status', width: 18 },
        { header: 'Priority', key: 'priority', width: 12 },
        { header: 'Items', key: 'items', width: 8 },
        { header: 'Created', key: 'created', width: 22 },
      ];
      const reqs = await this.prisma.withdrawalRequest.findMany({
        include: { requester: { select: { fullName: true } }, items: true },
        orderBy: { createdAt: 'desc' },
      });
      reqs.forEach((r) =>
        ws.addRow({
          ref: r.refNumber, requester: r.requester.fullName, dept: r.department, rma: r.rmaCaseNumber ?? '',
          status: r.status, priority: r.priority, items: r.items.length, created: r.createdAt.toISOString(),
        }),
      );
    } else if (type === 'reports') {
      ws.columns = [
        { header: 'Metric', key: 'metric', width: 30 },
        { header: 'Value', key: 'value', width: 20 },
      ];
      const [totalStock, available, reserved, products, openReq, rtv] = await Promise.all([
        this.prisma.stockItem.count(),
        this.prisma.stockItem.count({ where: { status: 'AVAILABLE' } }),
        this.prisma.stockItem.count({ where: { status: 'RESERVED' } }),
        this.prisma.product.count({ where: { isActive: true } }),
        this.prisma.withdrawalRequest.count({ where: { status: { in: ['SUBMITTED', 'PENDING_APPROVAL'] } } }),
        this.prisma.rTVCase.count({ where: { status: { not: 'COMPLETED' } } }),
      ]);
      [
        ['Total stock items', totalStock], ['Available', available], ['Reserved', reserved],
        ['Active products', products], ['Open requests', openReq], ['Open RTV cases', rtv],
      ].forEach(([metric, value]) => ws.addRow({ metric, value }));
    } else {
      throw new BadRequestException('Unknown export type');
    }

    ws.getRow(1).font = { bold: true };
    return format === 'csv'
      ? Buffer.from(await wb.csv.writeBuffer())
      : Buffer.from(await wb.xlsx.writeBuffer());
  }
}
