import { Injectable, BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StockStatus, OwnershipType, ReceivingStatus } from '@prisma/client';
import { nanoid } from 'nanoid';
import { parseSpreadsheet } from '../common/spreadsheet';

// One file = one Goods Receiving. Header info (source/AWB/invoice/RMA/default
// warehouse) is supplied by the UI; the file carries only the item lines.
export interface ReceivingImportHeader {
  sourceType: string;
  sourceRef?: string;   // RMA reference / case no.
  awbNumber?: string;
  invoiceNumber?: string;
  poNumber?: string;
  warehouseId?: string; // default destination for rows without a warehouseCode
  notes?: string;
}

export interface ColumnSpec {
  key: string;
  header: string;
  required?: boolean;
  example?: string | number;
  hint?: string;
}

export const RECEIVING_IMPORT_COLUMNS: ColumnSpec[] = [
  { key: 'productCode', header: 'productCode', required: true, example: 'SW-2960X', hint: 'Existing product code' },
  { key: 'serialNumber', header: 'serialNumber', example: 'CSC-001-2024', hint: 'Required if product is serial-controlled' },
  { key: 'batchNumber', header: 'batchNumber', example: 'LOT-2026-001', hint: 'Required if product is batch-controlled' },
  { key: 'quantity', header: 'quantity', required: true, example: 1, hint: 'Number >= 1' },
  { key: 'condition', header: 'condition', example: 'good', hint: 'good / damaged / doa' },
  { key: 'ownershipType', header: 'ownershipType', example: 'OWN', hint: 'OWN / CONSIGNMENT / RMA / CUSTOMER' },
  { key: 'warehouseCode', header: 'warehouseCode', example: 'WH-MAIN', hint: 'Existing warehouse code (optional — overrides default)' },
];

const VALID_CONDITIONS = new Set(['good', 'damaged', 'doa']);

export interface ValidatedRow {
  rowNumber: number;
  data: Record<string, any>;
  errors: string[];
  valid: boolean;
}
export interface ReceivingPreviewResult {
  columns: string[];
  rows: ValidatedRow[];
  summary: { total: number; valid: number; invalid: number };
}

@Injectable()
export class ReceivingImportService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
  ) {}

  // ── Excel template (.xlsx) — headers + example row + field guide ──────────
  async template(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'HSNT WMS';
    const ws = wb.addWorksheet('Goods Receiving');
    ws.columns = RECEIVING_IMPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: Math.max(16, c.header.length + 4) }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };

    const example: Record<string, any> = {};
    RECEIVING_IMPORT_COLUMNS.forEach((c) => { example[c.key] = c.example ?? ''; });
    ws.addRow(example);

    const guide = wb.addWorksheet('Field Guide');
    guide.columns = [
      { header: 'Field', key: 'field', width: 22 },
      { header: 'Required', key: 'req', width: 12 },
      { header: 'Notes', key: 'hint', width: 56 },
    ];
    guide.getRow(1).font = { bold: true };
    RECEIVING_IMPORT_COLUMNS.forEach((c) => guide.addRow({ field: c.header, req: c.required ? 'YES' : 'no', hint: c.hint ?? '' }));
    guide.addRow({ field: '', req: '', hint: '' });
    guide.addRow({ field: 'Note', req: '', hint: 'Source Type, AWB, Invoice No and RMA Reference are entered in the app, not in this file. One file = one goods receipt.' });

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private num(v: any): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // ── Validate parsed item rows ────────────────────────────────────────────
  private async validate(rows: Record<string, any>[]): Promise<ValidatedRow[]> {
    const [products, warehouses] = await Promise.all([
      this.prisma.product.findMany({ select: { code: true, serialControlled: true, batchControlled: true } }),
      this.prisma.warehouse.findMany({ select: { code: true } }),
    ]);
    const productMap = new Map(products.map((p) => [p.code, p]));
    const warehouseCodes = new Set(warehouses.map((w) => w.code));

    const existingSerials = new Set(
      (await this.prisma.stockItem.findMany({
        where: { serialNumber: { not: null }, status: { notIn: [StockStatus.CONSUMED, StockStatus.SHIPPED, StockStatus.CLOSED, StockStatus.CANCELLED] } },
        select: { serialNumber: true },
      })).map((s) => s.serialNumber as string),
    );
    const seenSerial = new Set<string>();

    return rows.map((data) => {
      const errors: string[] = [];
      const rowNumber = data.__row as number;

      const code = String(data.productCode ?? '').trim();
      if (!code) errors.push('Missing required field: productCode');
      const product = code ? productMap.get(code) : undefined;
      if (code && !product) errors.push(`Unknown productCode: ${code}`);

      const q = this.num(data.quantity);
      if (q === null || q < 1) errors.push('quantity must be a number >= 1');

      const serial = data.serialNumber ? String(data.serialNumber).trim() : '';
      if (serial) {
        if (existingSerials.has(serial)) errors.push(`Duplicate serial already in stock: ${serial}`);
        if (seenSerial.has(serial)) errors.push(`Duplicate serial within file: ${serial}`);
        seenSerial.add(serial);
      }

      // Serial / batch control enforcement (mirrors manual receiving)
      if (product?.serialControlled && !serial) errors.push(`Product ${code} is serial-controlled — serialNumber is required`);
      if (product?.batchControlled && !(data.batchNumber && String(data.batchNumber).trim())) {
        errors.push(`Product ${code} is batch-controlled — batchNumber is required`);
      }

      if (data.condition && !VALID_CONDITIONS.has(String(data.condition).trim().toLowerCase())) {
        errors.push(`Invalid condition: ${data.condition} (good / damaged / doa)`);
      }
      if (data.ownershipType && !(String(data.ownershipType).trim() in OwnershipType)) {
        errors.push(`Invalid ownershipType: ${data.ownershipType}`);
      }
      if (data.warehouseCode && !warehouseCodes.has(String(data.warehouseCode).trim())) {
        errors.push(`Unknown warehouseCode: ${data.warehouseCode}`);
      }

      return { rowNumber, data, errors, valid: errors.length === 0 };
    });
  }

  async preview(file: Express.Multer.File): Promise<ReceivingPreviewResult> {
    const rows = await parseSpreadsheet(file);
    if (rows.length === 0) throw new BadRequestException('No data rows found in file');
    const validated = await this.validate(rows);
    const valid = validated.filter((r) => r.valid).length;
    return {
      columns: RECEIVING_IMPORT_COLUMNS.map((c) => c.header),
      rows: validated,
      summary: { total: validated.length, valid, invalid: validated.length - valid },
    };
  }

  // ── Commit: create ONE GoodsReceiving with all valid item lines ──────────
  async commit(header: ReceivingImportHeader, file: Express.Multer.File, userId: string) {
    if (!header.sourceType || !String(header.sourceType).trim()) {
      throw new BadRequestException('Source Type is required');
    }
    const rows = await parseSpreadsheet(file);
    const validated = await this.validate(rows);
    const validRows = validated.filter((r) => r.valid).map((r) => r.data);
    const skipped = validated.filter((r) => !r.valid);

    if (validRows.length === 0) {
      throw new BadRequestException('No valid rows to import. Fix the highlighted errors and retry.');
    }

    const refNumber = `GR-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;

    const gr = await this.prisma.$transaction(async (tx) => {
      const warehouses = await tx.warehouse.findMany({ select: { id: true, code: true } });
      const wMap = new Map(warehouses.map((w) => [w.code, w.id]));

      const created = await tx.goodsReceiving.create({
        data: {
          refNumber,
          sourceType: String(header.sourceType).trim(),
          sourceRef: header.sourceRef?.trim() || null,
          awbNumber: header.awbNumber?.trim() || null,
          invoiceNumber: header.invoiceNumber?.trim() || null,
          poNumber: header.poNumber?.trim() || null,
          notes: header.notes?.trim() || null,
          receivedById: userId,
          status: 'pending_inspection',
          statusEnum: ReceivingStatus.QC_PENDING,
        },
      });

      const products = await tx.product.findMany({ select: { id: true, code: true } });
      const pMap = new Map(products.map((p) => [p.code, p.id]));

      for (const d of validRows) {
        const productId = pMap.get(String(d.productCode).trim())!;
        const warehouseId = d.warehouseCode
          ? wMap.get(String(d.warehouseCode).trim()) ?? null
          : header.warehouseId || null;
        const ownershipType = (d.ownershipType && String(d.ownershipType).trim() in OwnershipType
          ? String(d.ownershipType).trim()
          : 'OWN') as OwnershipType;
        const condition = d.condition ? String(d.condition).trim().toLowerCase() : 'good';
        const quantity = this.num(d.quantity) ?? 1;
        const serialNumber = d.serialNumber ? String(d.serialNumber).trim() : null;
        const batchNumber = d.batchNumber ? String(d.batchNumber).trim() : null;

        const stock = await tx.stockItem.create({
          data: {
            productId,
            serialNumber,
            batchNumber,
            quantity,
            status: StockStatus.PENDING_RECEIVING,
            ownershipType,
            warehouseId,
            createdById: userId,
          },
        });

        await tx.goodsReceivingItem.create({
          data: {
            receivingId: created.id,
            productId,
            serialNumber,
            batchNumber,
            quantity,
            condition,
            stockItemId: stock.id,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId,
          action: 'GOODS_RECEIVED_IMPORT',
          entityType: 'GoodsReceiving',
          entityId: created.id,
          detail: `${refNumber} — imported ${validRows.length} items (${skipped.length} skipped)`,
        },
      });

      return created;
    });

    this.realtime.emitInventoryUpdate({ action: 'received', refNumber });

    return {
      refNumber,
      receivingId: gr.id,
      inserted: validRows.length,
      skipped: skipped.length,
      skippedRows: skipped.map((s) => ({ rowNumber: s.rowNumber, errors: s.errors })),
    };
  }
}
