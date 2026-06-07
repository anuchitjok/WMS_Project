import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductType } from '@prisma/client';
import * as ExcelJS from 'exceljs';

// Column definitions shared between export & template
const STOCK_REGISTER_COLS = [
  { key: 'receiveDate',      header: 'Date',           width: 14 },
  { key: 'brand',            header: 'Brand',          width: 16 },
  { key: 'awbNumber',        header: 'AWB',            width: 18 },
  { key: 'invoiceNumber',    header: 'Invoice No.',    width: 18 },
  { key: 'gswNumber',        header: 'GSW No.',        width: 14 },
  { key: 'productType',      header: 'Type',           width: 14 },
  { key: 'productName',      header: 'Product',        width: 26 },
  { key: 'model',            header: 'Model',          width: 16 },
  { key: 'vendorPartNumber', header: 'Vendor P/N',     width: 18 },
  { key: 'partNumber',       header: 'Part',           width: 18 },
  { key: 'serialNumber',     header: 'Serial Number',  width: 22 },
  { key: 'description',      header: 'Description',    width: 36 },
  { key: 'warehouse',        header: 'WH',             width: 16 },
  { key: 'qty',              header: 'Qty',            width: 8 },
];

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  // ─── Product Master ────────────────────────────────────────────────────────

  findAll(search?: string, productType?: ProductType) {
    return this.prisma.product.findMany({
      where: {
        ...(productType ? { productType } : {}),
        ...(search ? {
          OR: [
            { code: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
            { manufacturer: { contains: search, mode: 'insensitive' } },
            { model: { contains: search, mode: 'insensitive' } },
            { partNumber: { contains: search, mode: 'insensitive' } },
            { vendorPartNumber: { contains: search, mode: 'insensitive' } },
            { category: { contains: search, mode: 'insensitive' } },
          ],
        } : {}),
      },
      include: { brand: true, _count: { select: { stockItems: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const p = await this.prisma.product.findUnique({ where: { id }, include: { brand: true } });
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  async create(dto: any, userId: string) {
    if (dto.partNumber) {
      const exists = await this.prisma.product.findUnique({ where: { partNumber: dto.partNumber } });
      if (exists) throw new ConflictException(`Part number already exists: ${dto.partNumber}`);
    }
    const p = await this.prisma.product.create({
      data: {
        code: dto.code, name: dto.name, description: dto.description ?? null,
        manufacturer: dto.manufacturer ?? null, model: dto.model ?? null,
        partNumber: dto.partNumber ?? null, vendorPartNumber: dto.vendorPartNumber ?? null,
        productType: dto.productType ?? ProductType.SPARE_PART,
        brandId: dto.brandId || undefined, category: dto.category,
        unit: dto.unit ?? 'unit', unitCost: dto.unitCost ?? 0,
        serialControlled: dto.serialControlled ?? false, minStock: dto.minStock ?? 0,
      },
      include: { brand: true },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'PRODUCT_CREATED', entityType: 'Product', entityId: p.id, detail: `${p.code} (${p.productType})` },
    });
    return p;
  }

  async update(id: string, dto: any, userId: string) {
    await this.findOne(id);
    if (dto.partNumber) {
      const clash = await this.prisma.product.findFirst({ where: { partNumber: dto.partNumber, NOT: { id } } });
      if (clash) throw new ConflictException(`Part number already exists: ${dto.partNumber}`);
    }
    const p = await this.prisma.product.update({
      where: { id },
      data: {
        name: dto.name, description: dto.description, manufacturer: dto.manufacturer,
        model: dto.model, partNumber: dto.partNumber, vendorPartNumber: dto.vendorPartNumber ?? null,
        productType: dto.productType, category: dto.category, unit: dto.unit,
        unitCost: dto.unitCost, serialControlled: dto.serialControlled,
        minStock: dto.minStock, brandId: dto.brandId || undefined,
      },
      include: { brand: true },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'PRODUCT_UPDATED', entityType: 'Product', entityId: id, detail: p.code },
    });
    return p;
  }

  // ─── KPI ──────────────────────────────────────────────────────────────────

  async getKpi() {
    const [
      totalSku,
      serializedItems,
      quarantineCount,
      rtvPendingCount,
      doaCount,
      totalWarehouses,
      lowStockProds,
      inventoryAgg,
    ] = await Promise.all([
      this.prisma.product.count({ where: { isActive: true } }),
      this.prisma.stockItem.count({ where: { serialNumber: { not: null } } }),
      this.prisma.stockItem.count({ where: { status: 'QUARANTINE' } }),
      this.prisma.stockItem.count({ where: { status: 'RTV_PENDING' } }),
      this.prisma.stockItem.count({ where: { status: 'DOA' } }),
      this.prisma.warehouse.count({ where: { isActive: true } }),
      this.prisma.product.findMany({
        where: { isActive: true, minStock: { gt: 0 } },
        select: { id: true, minStock: true, _count: { select: { stockItems: true } } },
      }),
      this.prisma.stockItem.aggregate({ _sum: { quantity: true } }),
    ]);

    const lowStock = lowStockProds.filter((p) => (p._count.stockItems) < p.minStock).length;
    const totalQty = inventoryAgg._sum.quantity ?? 0;

    return { totalSku, serializedItems, lowStock, quarantineCount, rtvPendingCount, doaCount, totalWarehouses, totalQty };
  }

  // ─── Enterprise List ───────────────────────────────────────────────────────

  async getEnterpriseList(filter: {
    search?: string; warehouseId?: string; brandId?: string;
    productType?: string; stockStatus?: string; serialOnly?: boolean;
    page?: number; limit?: number;
  }) {
    const { search, warehouseId, brandId, productType, stockStatus, serialOnly, page = 1, limit = 50 } = filter;
    const skip = (page - 1) * limit;

    const where: any = { isActive: true };
    if (productType) where.productType = productType;
    if (brandId) where.brandId = brandId;
    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { manufacturer: { contains: search, mode: 'insensitive' } },
        { model: { contains: search, mode: 'insensitive' } },
        { partNumber: { contains: search, mode: 'insensitive' } },
        { vendorPartNumber: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { stockItems: { some: { serialNumber: { contains: search, mode: 'insensitive' } } } },
        { stockItems: { some: { goodsReceivingItems: { some: { receiving: { awbNumber: { contains: search, mode: 'insensitive' } } } } } } },
        { stockItems: { some: { goodsReceivingItems: { some: { receiving: { invoiceNumber: { contains: search, mode: 'insensitive' } } } } } } },
      ];
    }

    const siWhere: any = {};
    if (warehouseId) siWhere.warehouseId = warehouseId;
    if (stockStatus) siWhere.status = stockStatus;
    if (serialOnly) siWhere.serialNumber = { not: null };

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          brand: true,
          _count: { select: { stockItems: true } },
          stockItems: {
            where: siWhere,
            include: {
              warehouse: { select: { code: true, name: true } },
              rack: { select: { code: true } },
              slot: { select: { code: true } },
              goodsReceivingItems: {
                include: { receiving: { select: { awbNumber: true, invoiceNumber: true, gswNumber: true, receivedDate: true, sourceType: true, refNumber: true } } },
                take: 1,
              },
            },
            orderBy: { receivedDate: 'desc' },
            take: 100,
          },
          withdrawalRequestItems: {
            include: { request: { select: { rmaCaseNumber: true, refNumber: true } } },
            where: { request: { rmaCaseNumber: { not: null } } },
            orderBy: { request: { createdAt: 'desc' } },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    const rows = products.map((p) => {
      const items = p.stockItems;
      const totalQty = items.reduce((a, i) => a + i.quantity, 0);
      const statusCounts: Record<string, number> = {};
      items.forEach((i) => { statusCounts[i.status] = (statusCounts[i.status] ?? 0) + 1; });
      const primaryWh = items[0]?.warehouse?.code ?? '';
      const primaryRack = items[0]?.rack?.code ?? '';
      const primarySlot = items[0]?.slot?.code ?? '';
      const latestRcv = items[0]?.goodsReceivingItems[0]?.receiving;
      const serialCount = items.filter((i) => i.serialNumber).length;
      const latestRmaRef = p.withdrawalRequestItems[0]?.request?.rmaCaseNumber ?? '';
      const latestReceiveDate = items[0]?.receivedDate ?? null;
      const ownershipTypes = [...new Set(items.map((i) => i.ownershipType))];

      return {
        id: p.id, code: p.code, name: p.name, description: p.description,
        manufacturer: p.manufacturer, model: p.model,
        partNumber: p.partNumber, vendorPartNumber: p.vendorPartNumber,
        productType: p.productType, category: p.category,
        unit: p.unit, unitCost: p.unitCost, minStock: p.minStock,
        serialControlled: p.serialControlled,
        brandName: p.brand?.name ?? '',
        totalQty,
        stockItemCount: p._count.stockItems,
        serialCount,
        primaryWarehouse: primaryWh,
        primaryRack, primarySlot,
        statusCounts,
        ownershipTypes,
        sourceType: latestRcv?.sourceType ?? '',
        awbNumber: latestRcv?.awbNumber ?? '',
        invoiceNumber: latestRcv?.invoiceNumber ?? '',
        gswNumber: latestRcv?.gswNumber ?? '',
        rmaRef: latestRmaRef,
        latestReceiveDate,
        createdAt: p.createdAt,
        isLowStock: p.minStock > 0 && p._count.stockItems < p.minStock,
        hasQuarantine: !!statusCounts['QUARANTINE'],
        hasDoa: !!statusCounts['DOA'],
        hasRtv: !!statusCounts['RTV_PENDING'],
        inventoryValue: totalQty * p.unitCost,
      };
    });

    return { data: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ─── Product Full Detail ───────────────────────────────────────────────────

  async getDetailFull(id: string) {
    const [product, auditLogs] = await Promise.all([
      this.prisma.product.findUnique({
        where: { id },
        include: {
          brand: true,
          stockItems: {
            include: {
              warehouse: { select: { code: true, name: true } },
              rack: { select: { code: true } },
              slot: { select: { code: true } },
              goodsReceivingItems: {
                include: {
                  receiving: { select: { refNumber: true, receivedDate: true, awbNumber: true, invoiceNumber: true, gswNumber: true, sourceType: true } },
                },
                take: 1,
              },
            },
            orderBy: { receivedDate: 'desc' },
          },
          withdrawalRequestItems: {
            include: { request: { select: { refNumber: true, rmaCaseNumber: true, status: true, createdAt: true, department: true } } },
            orderBy: { request: { createdAt: 'desc' } },
            take: 20,
          },
          _count: { select: { stockItems: true } },
        },
      }),
      this.prisma.auditLog.findMany({
        where: { entityType: 'Product', entityId: id },
        include: { user: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);

    if (!product) throw new NotFoundException('Product not found');
    return { ...product, auditLogs };
  }

  // ─── Stock Register ────────────────────────────────────────────────────────

  async stockRegister(filter: { search?: string; warehouseId?: string; brandId?: string; productType?: string }) {
    const { search, warehouseId, brandId, productType } = filter;
    const items = await this.prisma.stockItem.findMany({
      where: {
        ...(warehouseId ? { warehouseId } : {}),
        ...(search ? {
          OR: [
            { serialNumber: { contains: search, mode: 'insensitive' } },
            { batchNumber: { contains: search, mode: 'insensitive' } },
            { product: { name: { contains: search, mode: 'insensitive' } } },
            { product: { code: { contains: search, mode: 'insensitive' } } },
            { product: { partNumber: { contains: search, mode: 'insensitive' } } },
          ],
        } : {}),
        ...(productType ? { product: { productType: productType as ProductType } } : {}),
        ...(brandId ? { product: { brandId } } : {}),
      },
      include: {
        product: { include: { brand: true } },
        warehouse: { select: { code: true, name: true } },
        rack: { select: { code: true } },
        slot: { select: { code: true } },
        goodsReceivingItems: {
          include: {
            receiving: {
              select: { receivedDate: true, awbNumber: true, invoiceNumber: true, gswNumber: true, refNumber: true },
            },
          },
          take: 1,
        },
      },
      orderBy: { receivedDate: 'desc' },
    });

    return items.map((item: any) => {
      const rcv = item.goodsReceivingItems?.[0]?.receiving;
      return {
        id: item.id,
        receiveDate: rcv?.receivedDate ?? item.receivedDate,
        brand: item.product?.brand?.name ?? '',
        awbNumber: rcv?.awbNumber ?? '',
        invoiceNumber: rcv?.invoiceNumber ?? '',
        gswNumber: rcv?.gswNumber ?? '',
        productType: item.product?.productType ?? '',
        productName: item.product?.name ?? '',
        productCode: item.product?.code ?? '',
        model: item.product?.model ?? '',
        vendorPartNumber: item.product?.vendorPartNumber ?? '',
        partNumber: item.product?.partNumber ?? '',
        serialNumber: item.serialNumber ?? item.batchNumber ?? '',
        description: item.product?.description ?? '',
        warehouse: item.warehouse?.code ?? '',
        warehouseName: item.warehouse?.name ?? '',
        rack: item.rack?.code ?? '',
        slot: item.slot?.code ?? '',
        qty: item.quantity,
        status: item.status,
        receivingRef: rcv?.refNumber ?? '',
        productId: item.product?.id ?? '',
        warehouseId: item.warehouseId ?? '',
      };
    });
  }

  // ─── Export ────────────────────────────────────────────────────────────────

  async exportStockRegister(format: 'xlsx' | 'csv', filter: any): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const rows = await this.stockRegister(filter);
    const date = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      const header = STOCK_REGISTER_COLS.map((c) => c.header).join(',');
      const lines = rows.map((r) =>
        STOCK_REGISTER_COLS.map((c) => {
          const v = (r as any)[c.key] ?? '';
          const s = String(v instanceof Date ? v.toISOString().slice(0, 10) : v);
          return s.includes(',') ? `"${s}"` : s;
        }).join(','),
      );
      return {
        buffer: Buffer.from([header, ...lines].join('\n'), 'utf-8'),
        mimeType: 'text/csv',
        filename: `stock-register-${date}.csv`,
      };
    }

    // XLSX
    const wb = new ExcelJS.Workbook();
    wb.creator = 'HSNT WMS';
    const ws = wb.addWorksheet('Stock Register');
    ws.columns = STOCK_REGISTER_COLS.map((c) => ({ ...c, style: { alignment: { wrapText: false } } }));

    // Header style
    ws.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    ws.getRow(1).height = 20;

    rows.forEach((r, i) => {
      const row = ws.addRow(STOCK_REGISTER_COLS.map((c) => {
        const v = (r as any)[c.key];
        return v instanceof Date ? v.toISOString().slice(0, 10) : (v ?? '');
      }));
      if (i % 2 === 1) {
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F7FA' } };
        });
      }
    });

    ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + STOCK_REGISTER_COLS.length)}1` };
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const buffer = Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
    return { buffer, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `stock-register-${date}.xlsx` };
  }

  async downloadTemplate(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'HSNT WMS';
    const ws = wb.addWorksheet('Import Template');

    ws.columns = STOCK_REGISTER_COLS.map((c) => ({ ...c }));
    ws.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    ws.getRow(1).height = 20;

    // Example row
    ws.addRow(['2026-06-01', 'Zebra', 'DHL-TH-001', 'INV-2026-001', 'GSW-001', 'SPARE_PART', 'TC52 Battery Pack', 'TC52', 'ZB-BATT-VND', 'ZB-BATT-TC52', 'SN-00001', 'Standard battery 4000mAh', 'Tower B1FL', 1]);

    const exRow = ws.getRow(2);
    exRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFDE7' } };
      cell.font = { italic: true, color: { argb: 'FF666666' } };
    });

    // Notes row
    ws.addRow(['← Date YYYY-MM-DD', 'Brand name', 'Air Waybill No.', 'Invoice number', 'GSW number', 'SPARE_PART or FINISHED_GOODS', 'Product name', 'Model name', 'Vendor P/N', 'Internal Part No.', 'Serial or batch', 'Product description', 'WH code', 'Quantity']);

    return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
  }

  // ─── Import ────────────────────────────────────────────────────────────────

  async importProducts(buffer: Buffer, mimeType: string, userId: string): Promise<{ created: number; updated: number; errors: string[] }> {
    const rows = await this.parseFile(buffer, mimeType);
    let created = 0; let updated = 0; const errors: string[] = [];

    for (const [i, row] of rows.entries()) {
      const rowNum = i + 2;
      try {
        const productName = String(row['Product'] ?? row['product'] ?? '').trim();
        const productType = String(row['Type'] ?? row['type'] ?? 'SPARE_PART').trim().toUpperCase();
        const brandName = String(row['Brand'] ?? row['brand'] ?? '').trim();
        const model = String(row['Model'] ?? row['model'] ?? '').trim();
        const vendorPartNumber = String(row['Vendor P/N'] ?? row['vendorPartNumber'] ?? '').trim() || null;
        const partNumber = String(row['Part'] ?? row['partNumber'] ?? '').trim() || null;
        const serialNumber = String(row['Serial Number'] ?? row['serialNumber'] ?? '').trim() || null;
        const description = String(row['Description'] ?? row['description'] ?? '').trim() || null;
        const qty = Number(row['Qty'] ?? row['qty'] ?? 1);

        if (!productName) { errors.push(`Row ${rowNum}: Product name is required`); continue; }

        // Resolve or skip brand
        let brandId: string | undefined;
        if (brandName) {
          const brand = await this.prisma.brand.findFirst({ where: { name: { equals: brandName, mode: 'insensitive' } } });
          if (brand) brandId = brand.id;
        }

        // Build unique product code from part number or name+model
        const code = partNumber ?? `${productName.replace(/\s+/g, '-').toUpperCase().slice(0, 20)}-${Date.now()}`.slice(0, 32);

        // Upsert product
        const existing = partNumber
          ? await this.prisma.product.findUnique({ where: { partNumber } })
          : null;

        let product: any;
        if (existing) {
          product = await this.prisma.product.update({
            where: { id: existing.id },
            data: { name: productName, model: model || null, vendorPartNumber, description, brandId, productType: (productType as any) ?? 'SPARE_PART' },
          });
          updated++;
        } else {
          product = await this.prisma.product.create({
            data: {
              code, name: productName, model: model || null, partNumber: partNumber || null,
              vendorPartNumber, description, brandId,
              productType: (productType as any) ?? 'SPARE_PART', unit: 'unit',
            },
          });
          created++;
        }

        await this.prisma.auditLog.create({
          data: { userId, action: existing ? 'PRODUCT_IMPORT_UPDATE' : 'PRODUCT_IMPORT_CREATE', entityType: 'Product', entityId: product.id, detail: productName },
        });

        void serialNumber; void qty; // reserved for future stock item creation
      } catch (e: any) {
        errors.push(`Row ${rowNum}: ${e.message}`);
      }
    }

    return { created, updated, errors };
  }

  private async parseFile(buffer: Buffer, mimeType: string): Promise<Record<string, any>[]> {
    if (mimeType === 'text/csv' || mimeType === 'application/csv') {
      const text = buffer.toString('utf-8');
      const lines = text.split('\n').filter((l) => l.trim());
      if (lines.length < 2) throw new BadRequestException('CSV has no data rows');
      const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
      return lines.slice(1).map((line) => {
        const vals = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
        return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
      });
    }

    // XLSX
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer.buffer as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('Empty workbook');
    const rows: Record<string, any>[] = [];
    const headers: string[] = [];
    ws.eachRow((row, i) => {
      if (i === 1) { row.eachCell((c) => headers.push(String(c.value ?? '').trim())); return; }
      const obj: Record<string, any> = {};
      row.eachCell((c, ci) => { if (headers[ci - 1]) obj[headers[ci - 1]] = c.value; });
      if (Object.values(obj).some((v) => v !== '' && v != null)) rows.push(obj);
    });
    return rows;
  }
}
