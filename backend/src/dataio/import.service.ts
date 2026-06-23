import { Injectable, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { IMPORT_SCHEMAS, ImportType } from './import-schemas';
import { parseSpreadsheet } from '../common/spreadsheet';
import { UserRole, StockStatus, OwnershipType } from '@prisma/client';

export interface ValidatedRow {
  rowNumber: number;
  data: Record<string, any>;
  errors: string[];
  valid: boolean;
}
export interface PreviewResult {
  type: ImportType;
  columns: string[];
  rows: ValidatedRow[];
  summary: { total: number; valid: number; invalid: number };
}

@Injectable()
export class ImportService {
  constructor(private prisma: PrismaService) {}

  // ── Parse .xlsx or .csv into array of row objects keyed by header ─────────
  private parseFile(file: Express.Multer.File): Promise<Record<string, any>[]> {
    return parseSpreadsheet(file);
  }

  private num(v: any): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // ── Validate parsed rows for a given type (with duplicate detection) ──────
  async validate(type: ImportType, rows: Record<string, any>[]): Promise<ValidatedRow[]> {
    const schema = IMPORT_SCHEMAS[type];
    const required = schema.columns.filter((c) => c.required).map((c) => c.key);

    // Pre-load reference data for cross-checks
    const [products, warehouses, brands] = await Promise.all([
      this.prisma.product.findMany({ select: { code: true } }),
      this.prisma.warehouse.findMany({ select: { code: true } }),
      this.prisma.brand.findMany({ select: { code: true } }),
    ]);
    const productCodes = new Set(products.map((p) => p.code));
    const warehouseCodes = new Set(warehouses.map((w) => w.code));
    const brandCodes = new Set(brands.map((b) => b.code));

    // existing identifiers for duplicate detection
    const existingProductCodes = productCodes;
    const existingSerials = new Set(
      (await this.prisma.stockItem.findMany({
        where: { serialNumber: { not: null }, status: { notIn: [StockStatus.CONSUMED, StockStatus.SHIPPED, StockStatus.CLOSED, StockStatus.CANCELLED] } },
        select: { serialNumber: true },
      })).map((s) => s.serialNumber as string),
    );
    const existingUsernames = new Set(
      (await this.prisma.user.findMany({ where: { deletedAt: null }, select: { username: true } })).map((u) => u.username),
    );

    // within-file duplicate trackers
    const seenSku = new Set<string>();
    const seenSerial = new Set<string>();
    const seenUsername = new Set<string>();

    return rows.map((data) => {
      const errors: string[] = [];
      const rowNumber = data.__row as number;

      for (const r of required) {
        if (data[r] === null || data[r] === undefined || String(data[r]).trim() === '') {
          errors.push(`Missing required field: ${r}`);
        }
      }

      if (type === 'products') {
        const code = String(data.code ?? '').trim();
        if (code && existingProductCodes.has(code)) errors.push(`Duplicate SKU already exists: ${code}`);
        if (code && seenSku.has(code)) errors.push(`Duplicate SKU within file: ${code}`);
        if (code) seenSku.add(code);
        if (data.unitCost !== undefined && data.unitCost !== '' && this.num(data.unitCost) === null) errors.push('unitCost must be a number');
        if (data.minStock !== undefined && data.minStock !== '' && this.num(data.minStock) === null) errors.push('minStock must be a number');
        if (data.brandCode && !brandCodes.has(String(data.brandCode).trim())) errors.push(`Unknown brandCode: ${data.brandCode}`);
      }

      if (type === 'inventory' || type === 'serials') {
        const pc = String(data.productCode ?? '').trim();
        if (pc && !productCodes.has(pc)) errors.push(`Unknown productCode: ${pc}`);
        const serial = data.serialNumber ? String(data.serialNumber).trim() : '';
        if (serial) {
          if (existingSerials.has(serial)) errors.push(`Duplicate serial already in stock: ${serial}`);
          if (seenSerial.has(serial)) errors.push(`Duplicate serial within file: ${serial}`);
          seenSerial.add(serial);
        }
        if (type === 'inventory') {
          const q = this.num(data.quantity);
          if (q === null || q < 1) errors.push('quantity must be a number >= 1');
        }
        if (data.warehouseCode && !warehouseCodes.has(String(data.warehouseCode).trim())) {
          errors.push(`Unknown warehouseCode: ${data.warehouseCode}`);
        }
        if (data.status && !(String(data.status).trim() in StockStatus)) errors.push(`Invalid status: ${data.status}`);
      }

      if (type === 'users') {
        const u = String(data.username ?? '').trim();
        if (u && existingUsernames.has(u)) errors.push(`Username already exists: ${u}`);
        if (u && seenUsername.has(u)) errors.push(`Duplicate username within file: ${u}`);
        if (u) seenUsername.add(u);
        const role = String(data.role ?? '').trim();
        if (role && !(role in UserRole)) errors.push(`Invalid role: ${role}`);
      }

      if (type === 'warehouse') {
        // warehouseCode + name required already checked
      }

      return { rowNumber, data, errors, valid: errors.length === 0 };
    });
  }

  async preview(type: ImportType, file: Express.Multer.File): Promise<PreviewResult> {
    const rows = await this.parseFile(file);
    const validated = await this.validate(type, rows);
    const valid = validated.filter((r) => r.valid).length;
    return {
      type,
      columns: IMPORT_SCHEMAS[type].columns.map((c) => c.header),
      rows: validated,
      summary: { total: validated.length, valid, invalid: validated.length - valid },
    };
  }

  // ── Commit: insert valid rows (partial import), rollback on critical error ─
  async commit(type: ImportType, file: Express.Multer.File, userId: string) {
    const rows = await this.parseFile(file);
    const validated = await this.validate(type, rows);
    const validRows = validated.filter((r) => r.valid).map((r) => r.data);
    const skipped = validated.filter((r) => !r.valid);

    if (validRows.length === 0) {
      throw new BadRequestException('No valid rows to import. Fix the highlighted errors and retry.');
    }

    let inserted = 0;
    await this.prisma.$transaction(async (tx) => {
      if (type === 'products') {
        const brands = await tx.brand.findMany({ select: { id: true, code: true } });
        const brandMap = new Map(brands.map((b) => [b.code, b.id]));
        await tx.product.createMany({
          data: validRows.map((d) => ({
            code: String(d.code).trim(),
            name: String(d.name).trim(),
            category: d.category ? String(d.category).trim() : null,
            unit: d.unit ? String(d.unit).trim() : 'unit',
            unitCost: this.num(d.unitCost) ?? 0,
            minStock: Math.trunc(this.num(d.minStock) ?? 0),
            serialControlled: String(d.serialControlled).toLowerCase() === 'true',
            brandId: d.brandCode ? brandMap.get(String(d.brandCode).trim()) ?? null : null,
          })),
          skipDuplicates: true,
        });
        inserted = validRows.length;
      } else if (type === 'users') {
        const hash = await bcrypt.hash('Welcome@123', 12);
        for (const d of validRows) {
          const pwd = d.password ? await bcrypt.hash(String(d.password), 12) : hash;
          await tx.user.create({
            data: {
              username: String(d.username).trim(),
              fullName: String(d.fullName).trim(),
              email: d.email ? String(d.email).trim() : null,
              role: String(d.role).trim() as UserRole,
              department: d.department ? String(d.department).trim() : null,
              passwordHash: pwd,
            },
          });
          inserted++;
        }
      } else if (type === 'warehouse') {
        for (const d of validRows) {
          const wh = await tx.warehouse.upsert({
            where: { code: String(d.warehouseCode).trim() },
            update: { name: String(d.warehouseName).trim(), location: d.location ? String(d.location).trim() : null },
            create: { code: String(d.warehouseCode).trim(), name: String(d.warehouseName).trim(), location: d.location ? String(d.location).trim() : null },
          });
          if (d.rackCode) {
            const rack = await tx.rack.upsert({
              where: { warehouseId_code: { warehouseId: wh.id, code: String(d.rackCode).trim() } },
              update: {},
              create: { warehouseId: wh.id, code: String(d.rackCode).trim() },
            });
            if (d.slotCode) {
              await tx.slot.upsert({
                where: { rackId_code: { rackId: rack.id, code: String(d.slotCode).trim() } },
                update: {},
                create: { rackId: rack.id, code: String(d.slotCode).trim() },
              });
            }
          }
          inserted++;
        }
      } else if (type === 'inventory' || type === 'serials') {
        const products = await tx.product.findMany({ select: { id: true, code: true } });
        const pMap = new Map(products.map((p) => [p.code, p.id]));
        const whs = await tx.warehouse.findMany({ select: { id: true, code: true } });
        const wMap = new Map(whs.map((w) => [w.code, w.id]));
        await tx.stockItem.createMany({
          data: validRows.map((d) => ({
            productId: pMap.get(String(d.productCode).trim())!,
            serialNumber: d.serialNumber ? String(d.serialNumber).trim() : null,
            batchNumber: d.batchNumber ? String(d.batchNumber).trim() : null,
            quantity: type === 'inventory' ? this.num(d.quantity) ?? 1 : 1,
            status: (d.status && String(d.status).trim() in StockStatus ? String(d.status).trim() : 'AVAILABLE') as StockStatus,
            ownershipType: (d.ownershipType && String(d.ownershipType).trim() in OwnershipType ? String(d.ownershipType).trim() : 'OWN') as OwnershipType,
            warehouseId: d.warehouseCode ? wMap.get(String(d.warehouseCode).trim()) ?? null : null,
            createdById: userId,
          })),
        });
        inserted = validRows.length;
      }

      await tx.auditLog.create({
        data: {
          userId,
          action: 'BULK_IMPORT',
          entityType: type,
          detail: `Imported ${inserted} ${type} rows (${skipped.length} skipped)`,
        },
      });
    });

    return {
      type,
      inserted,
      skipped: skipped.length,
      skippedRows: skipped.map((s) => ({ rowNumber: s.rowNumber, errors: s.errors })),
    };
  }
}
