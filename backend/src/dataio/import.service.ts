import { assertSerialsFree } from '../common/serial-guard';
import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { PrismaService } from '../prisma/prisma.service';
import { IMPORT_SCHEMAS, ImportType } from './import-schemas';
import { assertNotRetired } from '../common/retired';
import { parseSpreadsheet } from '../common/spreadsheet';
import { UserRole, StockStatus, OwnershipType, ProductType } from '@prisma/client';
import { GrantActor, isPrivilegedActor } from '../auth/role-grant';
import { MasterDataService } from '../master-data/master-data.service';
import { passwordPolicyErrors } from '../common/password-policy';
import { detectProductDuplicates, norm, DuplicateHit } from './product-dedupe';
import { resolveProductName } from '../products/product-audit-names';

export interface ValidatedRow {
  rowNumber: number;
  data: Record<string, any>;
  errors: string[];
  /** Phase 6: what the row will change on existing data (shown in preview, kept in the audit). */
  notes?: string[];
  valid: boolean;
  /** Products: Brand + SKU duplicate — 'db' rows are skipped, 'file' rows are errors. */
  duplicate?: DuplicateHit | null;
}
export interface ImportOptions {
  /** Products: create brands whose brandCode does not exist yet (default off). */
  createMissingBrands?: boolean;
}
export interface PriorImport { batch: string | null; at: Date; by: string | null }
export interface PreviewResult {
  type: ImportType;
  columns: string[];
  rows: ValidatedRow[];
  summary: { total: number; valid: number; invalid: number; duplicatesDb?: number; duplicatesFile?: number; newBrands?: string[] };
  /** Phase 6: the same file (same content) was already imported. */
  alreadyImported: PriorImport | null;
  fileHash: string;
}

/** Brand codes that valid product rows reference but that do not exist yet (first spelling wins). */
export function missingBrandCodes(rows: Record<string, any>[], existing: { code: string }[]): string[] {
  const have = new Set(existing.map((b) => norm(b.code)));
  const out = new Map<string, string>();
  for (const r of rows) {
    const c = String(r.brandCode ?? '').trim();
    if (c && !have.has(norm(c)) && !out.has(norm(c))) out.set(norm(c), c);
  }
  return [...out.values()];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BOOL = ['true', 'false', ''];

@Injectable()
export class ImportService {
  constructor(private prisma: PrismaService, private masterData: MasterDataService) {}

  /** Content fingerprint — the same file renamed is still the same file. */
  private fingerprint(file: Express.Multer.File): string {
    return createHash('sha256').update(file?.buffer ?? Buffer.alloc(0)).digest('hex');
  }

  private async priorImport(db: Pick<PrismaService, 'auditLog'>, type: ImportType, fileHash: string): Promise<PriorImport | null> {
    const prev = await db.auditLog.findFirst({
      where: { action: 'BULK_IMPORT', entityType: type, changes: { path: ['fileHash'], equals: fileHash } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, changes: true, user: { select: { fullName: true, username: true } } },
    });
    if (!prev) return null;
    const c = (prev.changes ?? {}) as Record<string, unknown>;
    return { batch: typeof c.batch === 'string' ? c.batch : null, at: prev.createdAt, by: prev.user?.fullName ?? prev.user?.username ?? null };
  }

  // ── Parse .xlsx or .csv into array of row objects keyed by header ─────────
  private parseFile(file: Express.Multer.File): Promise<Record<string, any>[]> {
    return parseSpreadsheet(file);
  }

  /**
   * Stock imports wrote StockItems directly (any status, no receiving document) —
   * the independent stock override retired with Step 5. Opening stock is now
   * received through Goods Receiving so every unit has a source document.
   */
  private assertImportable(type: ImportType) {
    if (type === 'inventory' || type === 'serials') assertNotRetired('Stock import (Inventory / Serials)');
  }

  private num(v: any): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // ── Validate parsed rows for a given type (with duplicate detection) ──────
  async validate(type: ImportType, rows: Record<string, any>[], actor?: GrantActor, opts: ImportOptions = {}): Promise<ValidatedRow[]> {
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
    const existingUsers = type === 'users' ? await this.prisma.user.findMany({ select: { username: true, email: true } }) : [];
    const existingUsernames = new Set(existingUsers.map((u) => u.username));
    const existingEmails = new Set(existingUsers.map((u) => u.email?.toLowerCase()).filter(Boolean) as string[]);
    // Phase 6: imports follow the same rules as the screens.
    // Brand + SKU duplicates (products): against the database and within the file.
    const dupes: (DuplicateHit | null)[] = type === 'products'
      ? detectProductDuplicates(rows, await this.prisma.product.findMany({ select: { code: true, partNumber: true, brand: { select: { code: true } } } }))
      : [];
    const existingPartNumbers = type === 'products'
      ? new Set((await this.prisma.product.findMany({ where: { partNumber: { not: null } }, select: { partNumber: true } })).map((p) => p.partNumber as string))
      : new Set<string>();
    const brandByNorm = new Map(brands.map((b) => [norm(b.code), b.code]));
    const seenPartNumber = new Set<string>();
    const uoms = type === 'products' ? (await this.prisma.unitOfMeasure.findMany({ where: { isActive: true }, select: { code: true } })).map((u) => u.code) : [];
    const departments = new Map<string, string | Error>();
    if (type === 'users') {
      for (const d of new Set(rows.map((r) => String(r.department ?? '').trim()).filter(Boolean))) {
        try { departments.set(d, (await this.masterData.assertDepartment(d)) ?? d); } catch (e) { departments.set(d, e as Error); }
      }
    }
    const existingWarehouses = type === 'warehouse' ? new Map((await this.prisma.warehouse.findMany({ select: { code: true, name: true, location: true } })).map((w) => [w.code, w])) : new Map();

    // within-file duplicate trackers
    const seenSku = new Set<string>();
    const seenSerial = new Set<string>();
    const seenUsername = new Set<string>();
    const seenEmail = new Set<string>();

    return rows.map((data, idx) => {
      const errors: string[] = [];
      let duplicate: DuplicateHit | null = null;
      const notes: string[] = [];
      const rowNumber = data.__row as number;

      for (const r of required) {
        if (data[r] === null || data[r] === undefined || String(data[r]).trim() === '') {
          errors.push(`Missing required field: ${r}`);
        }
      }

      if (type === 'products') {
        const code = String(data.code ?? '').trim();
        const partNumber = String(data.partNumber ?? '').trim();
        duplicate = dupes[idx] ?? null;
        if (duplicate?.kind === 'db') {
          // Same Brand + SKU already in the Product Master: reported and skipped, never overwritten.
          errors.push(`Skipped — Brand + SKU already exists (${duplicate.brandCode || 'no brand'} / ${duplicate.sku}) as product ${duplicate.existingCode}`);
        } else {
          if (duplicate?.kind === 'file') {
            const first = rows[duplicate.firstRowIndex]?.__row ?? duplicate.firstRowIndex + 2;
            errors.push(`Duplicate Brand + SKU within file (${duplicate.brandCode || 'no brand'} / ${duplicate.sku}) — same as row ${first}`);
          }
          // Existing uniqueness rules: product code and part number are unique.
          if (code && existingProductCodes.has(code)) errors.push(`Duplicate SKU already exists: ${code}`);
          if (code && seenSku.has(code) && duplicate?.kind !== 'file') errors.push(`Duplicate SKU within file: ${code}`);
          if (partNumber && existingPartNumbers.has(partNumber)) errors.push(`Part number already exists: ${partNumber}`);
          if (partNumber && seenPartNumber.has(partNumber) && duplicate?.kind !== 'file') errors.push(`Duplicate part number within file: ${partNumber}`);
        }
        if (code) seenSku.add(code);
        if (partNumber) seenPartNumber.add(partNumber);
        if (!resolveProductName(data.name, data.description)) errors.push('Missing required field: name (or description)');
        for (const k of ['defaultPrice', 'lengthCm', 'widthCm', 'heightCm']) {
          if (data[k] === undefined || data[k] === null || data[k] === '') continue;
          const n = this.num(data[k]);
          if (n === null) errors.push(`${k} must be a number`);
          else if (n < 0) errors.push(`${k} must be 0 or more`);
        }
        const pType = String(data.productType ?? '').trim().toUpperCase();
        if (pType && !(pType in ProductType)) errors.push(`Invalid productType: ${data.productType} — use SPARE_PART or FINISHED_GOODS`);
        if (data.unitCost !== undefined && data.unitCost !== '' && this.num(data.unitCost) === null) errors.push('unitCost must be a number');
        else if ((this.num(data.unitCost) ?? 0) < 0) errors.push('unitCost must be 0 or more');
        if (data.minStock !== undefined && data.minStock !== '' && this.num(data.minStock) === null) errors.push('minStock must be a number');
        else if ((this.num(data.minStock) ?? 0) < 0) errors.push('minStock must be 0 or more');
        const brandCode = String(data.brandCode ?? '').trim();
        if (brandCode && !brandByNorm.has(norm(brandCode))) {
          if (opts.createMissingBrands) notes.push(`New brand ${brandCode} will be created`);
          else errors.push(`Unknown brandCode: ${data.brandCode}`);
        }
        if (!BOOL.includes(String(data.serialControlled ?? '').trim().toLowerCase())) errors.push('serialControlled must be true or false');
        // Same rule as the Product form: the unit must be one of the managed Units of Measure.
        if (uoms.length) {
          const unit = String(data.unit ?? '').trim();
          if (!unit) errors.push(`unit is required — use one of: ${uoms.join(', ')}`);
          else if (!uoms.includes(unit)) errors.push(`Unknown unit: ${unit} — use one of: ${uoms.join(', ')}`);
        }
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
        // Same rules as the Users screen.
        if (role === UserRole.SYSTEM_ADMIN && !isPrivilegedActor(actor)) errors.push('Only a system administrator can grant the SYSTEM_ADMIN role');
        const email = String(data.email ?? '').trim().toLowerCase();
        if (email) {
          if (!EMAIL.test(email)) errors.push(`Invalid email: ${data.email}`);
          else if (existingEmails.has(email)) errors.push(`Email already used: ${data.email}`);
          else if (seenEmail.has(email)) errors.push(`Duplicate email within file: ${data.email}`);
          seenEmail.add(email);
        }
        const dept = String(data.department ?? '').trim();
        const resolved = dept ? departments.get(dept) : undefined;
        if (resolved instanceof Error) errors.push(resolved.message);
        if (data.password !== undefined && String(data.password) !== '') {
          const missing = passwordPolicyErrors(String(data.password));
          if (missing.length) errors.push(`Password must contain: ${missing.join(', ')}`);
        } else {
          notes.push('No password given — a temporary password is set and must be changed at first sign-in');
        }
      }

      if (type === 'warehouse') {
        const code = String(data.warehouseCode ?? '').trim();
        const prev = existingWarehouses.get(code);
        const name = String(data.warehouseName ?? '').trim();
        if (prev && name && prev.name !== name) notes.push(`Updates warehouse ${code} name: ${prev.name} → ${name}`);
        const loc = data.location ? String(data.location).trim() : null;
        if (prev && (prev.location ?? null) !== loc) notes.push(`Updates warehouse ${code} location: ${prev.location ?? '—'} → ${loc ?? '—'}`);
      }

      return { rowNumber, data, errors, notes, valid: errors.length === 0, ...(type === 'products' ? { duplicate } : {}) };
    });
  }

  async preview(type: ImportType, file: Express.Multer.File, actor?: GrantActor, opts: ImportOptions = {}): Promise<PreviewResult> {
    this.assertImportable(type);
    const rows = await this.parseFile(file);
    const validated = await this.validate(type, rows, actor, opts);
    const valid = validated.filter((r) => r.valid).length;
    const fileHash = this.fingerprint(file);
    const productExtras = type === 'products'
      ? {
          duplicatesDb: validated.filter((r) => r.duplicate?.kind === 'db').length,
          duplicatesFile: validated.filter((r) => r.duplicate?.kind === 'file').length,
          newBrands: opts.createMissingBrands
            ? missingBrandCodes(validated.filter((r) => r.valid).map((r) => r.data), await this.prisma.brand.findMany({ select: { code: true } }))
            : [],
        }
      : {};
    return {
      type,
      columns: IMPORT_SCHEMAS[type].columns.map((c) => c.header),
      rows: validated,
      summary: { total: validated.length, valid, invalid: validated.length - valid, ...productExtras },
      alreadyImported: await this.priorImport(this.prisma, type, fileHash),
      fileHash,
    };
  }

  // ── Commit: insert valid rows (partial import), rollback on critical error ─
  async commit(type: ImportType, file: Express.Multer.File, actor: GrantActor, opts: { allowReimport?: boolean } & ImportOptions = {}) {
    const userId = actor.id;
    this.assertImportable(type);
    const rows = await this.parseFile(file);
    const validated = await this.validate(type, rows, actor, opts);
    const validRows = validated.filter((r) => r.valid).map((r) => r.data);
    const skipped = validated.filter((r) => !r.valid);
    const notes = validated.filter((r) => r.valid && r.notes?.length).flatMap((r) => r.notes!.map((n) => `row ${r.rowNumber}: ${n}`));

    if (validRows.length === 0) {
      throw new BadRequestException('No valid rows to import. Fix the highlighted errors and retry.');
    }

    const fileHash = this.fingerprint(file);
    // Department codes resolved before the write transaction (validated above).
    const deptCode = new Map<string, string>();
    if (type === 'users') {
      for (const d of new Set(validRows.map((r) => String(r.department ?? '').trim()).filter(Boolean))) {
        deptCode.set(d, (await this.masterData.assertDepartment(d)) ?? d);
      }
    }
    const batch = `IMP-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;
    let inserted = 0;
    const brandsCreated: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      // Phase 6: the same file is imported once. The lock makes two simultaneous
      // uploads of one file wait for each other, so the second sees the first.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`import:${type}:${fileHash}`}))`;
      const prior = await this.priorImport(tx, type, fileHash);
      if (prior && !opts.allowReimport) {
        throw new ConflictException(
          `This file was already imported${prior.batch ? ` as ${prior.batch}` : ''} on ${prior.at.toISOString().slice(0, 16).replace('T', ' ')}${prior.by ? ` by ${prior.by}` : ''}. Upload a corrected file, or confirm re-import.`,
        );
      }
      // Serials re-checked under per-serial locks (preview data can be stale or raced).
      if (type === 'inventory' || type === 'serials') {
        await assertSerialsFree(tx, validRows.map((d) => (d.serialNumber ? String(d.serialNumber).trim() : null)));
      }
      if (type === 'products') {
        let brands = await tx.brand.findMany({ select: { id: true, code: true } });
        if (opts.createMissingBrands) {
          // Opt-in: brands named in the file but missing are created (code = name = the file's brandCode).
          for (const code of missingBrandCodes(validRows, brands)) {
            const b = await tx.brand.create({ data: { code, name: code } });
            await tx.auditLog.create({ data: { userId, action: 'BRAND_CREATED', entityType: 'Brand', entityId: b.id, detail: `${b.code} · ${b.name} (product import ${batch})` } });
            brandsCreated.push(code);
          }
          if (brandsCreated.length) brands = await tx.brand.findMany({ select: { id: true, code: true } });
        }
        const brandMap = new Map(brands.map((b) => [norm(b.code), b.id]));
        const text = (v: unknown) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
        const res = await tx.product.createMany({
          data: validRows.map((d) => {
            const pType = String(d.productType ?? '').trim().toUpperCase();
            return {
              code: String(d.code).trim(),
              name: resolveProductName(d.name, d.description),
              description: text(d.description),
              model: text(d.model),
              partNumber: text(d.partNumber),
              productType: (pType in ProductType ? pType : ProductType.SPARE_PART) as ProductType,
              category: d.category ? String(d.category).trim() : null,
              unit: d.unit ? String(d.unit).trim() : 'unit',
              unitCost: this.num(d.unitCost) ?? 0,
              minStock: Math.trunc(this.num(d.minStock) ?? 0),
              serialControlled: String(d.serialControlled).toLowerCase() === 'true',
              brandId: d.brandCode ? brandMap.get(norm(d.brandCode)) ?? null : null,
              partType: text(d.partType),
              defaultPrice: this.num(d.defaultPrice),
              lengthCm: this.num(d.lengthCm),
              widthCm: this.num(d.widthCm),
              heightCm: this.num(d.heightCm),
              createdById: userId ?? null,
              updatedById: userId ?? null,
            };
          }),
          skipDuplicates: true,
        });
        inserted = res.count;
      } else if (type === 'users') {
        const hash = await bcrypt.hash('Welcome@123', 12);
        for (const d of validRows) {
          const pwd = d.password ? await bcrypt.hash(String(d.password), 12) : hash;
          const dept = d.department ? String(d.department).trim() : '';
          await tx.user.create({
            data: {
              username: String(d.username).trim(),
              fullName: String(d.fullName).trim(),
              email: d.email ? String(d.email).trim() : null,
              role: String(d.role).trim() as UserRole,
              department: dept ? deptCode.get(dept) ?? dept : null,
              passwordHash: pwd,
              // Same as the Users screen: a temporary password must be changed at first sign-in.
              forcePasswordChange: !d.password,
              passwordChangedAt: new Date(),
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
          entityId: batch,
          detail: `${batch}: imported ${inserted} ${type} rows (${skipped.length} skipped) from ${file?.originalname ?? 'upload'}${prior ? ' — re-import confirmed' : ''}`,
          changes: {
            batch, fileHash, fileName: file?.originalname ?? null, inserted, skipped: skipped.length,
            ...(brandsCreated.length ? { brandsCreated } : {}),
            ...(notes.length ? { updates: notes.slice(0, 200) } : {}),
            ...(prior ? { reimportOf: prior.batch } : {}),
          },
        },
      });
    });

    return {
      type,
      batch,
      inserted,
      skipped: skipped.length,
      skippedRows: skipped.map((s) => ({ rowNumber: s.rowNumber, errors: s.errors, ...(s.duplicate ? { duplicate: s.duplicate.kind } : {}) })),
      updates: notes,
      ...(type === 'products' ? { brandsCreated } : {}),
    };
  }
}
