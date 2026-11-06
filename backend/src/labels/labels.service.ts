import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import PDFDocument from 'pdfkit';
import * as bwipjs from 'bwip-js';
import { PrismaService } from '../prisma/prisma.service';
import { BarcodeParserService } from '../scan/barcode-parser.service';
import { assertWarehouseAccess, ScopePrincipal } from '../common/warehouse-scope';
import { buildLocationLabel, labelFromKey, LocationLabel } from './location-label';

/** What to print location labels for — any mix; at least one must resolve. */
export interface BinLabelInput {
  /** Legacy raw keys "WH|RACK|SLOT". */
  locations?: string[];
  slotIds?: string[];
  rackIds?: string[];
  warehouseIds?: string[];
}

const MAX_LOCATION_LABELS = 2000;

@Injectable()
export class LabelsService {
  constructor(
    private prisma: PrismaService,
    private parser: BarcodeParserService,
  ) {}

  private async barcodePng(text: string, type: 'code128' | 'qrcode' = 'code128'): Promise<Buffer> {
    const opts: any = { bcid: type, text, scale: 3, includetext: false, backgroundcolor: 'FFFFFF' };
    if (type === 'code128') opts.height = 12; // height is invalid for qrcode — omit it
    return bwipjs.toBuffer(opts);
  }

  // Render one label per page (100mm x 60mm ≈ 283x170pt)
  private async render(labels: { title: string; lines: string[]; barcodeText: string; qr?: boolean }[]): Promise<Buffer> {
    if (labels.length === 0) throw new BadRequestException('Nothing to print');
    const doc = new PDFDocument({ size: [283, 170], margin: 12 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    for (let i = 0; i < labels.length; i++) {
      if (i > 0) doc.addPage();
      const l = labels[i];
      doc.fontSize(11).font('Helvetica-Bold').text(l.title, { width: 259 });
      doc.moveDown(0.2);
      doc.fontSize(8).font('Helvetica');
      l.lines.forEach((line) => doc.text(line, { width: 259 }));

      const png = await this.barcodePng(l.barcodeText, l.qr ? 'qrcode' : 'code128');
      const imgW = l.qr ? 70 : 230;
      doc.image(png, (283 - imgW) / 2, 95, { width: imgW });
      doc.fontSize(7).font('Courier').text(l.barcodeText, 12, 152, { width: 259, align: 'center' });
    }
    doc.end();
    return done;
  }

  async productLabels(productIds: string[]): Promise<Buffer> {
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds } }, include: { brand: true } });
    if (!products.length) throw new BadRequestException('No products found');
    return this.render(products.map((p) => ({
      title: p.name,
      lines: [`Code: ${p.code}`, `Brand: ${p.brand?.name ?? '-'}  ·  ${p.category ?? ''}`],
      barcodeText: this.parser.encode('product', p.code),
    })));
  }

  // ── Location labels (plan P5 5.4) ───────────────────────────────────────────
  // Per slot, per rack or per warehouse. The QR is the scanner's location key
  // (LOC|WH|RACK|SLOT), so putaway / lookup accept it unchanged.
  async binLabels(input: BinLabelInput, actor?: ScopePrincipal): Promise<Buffer> {
    const labels = await this.resolveLocationLabels(input, actor);
    return this.renderLocationLabels(labels);
  }

  async resolveLocationLabels(input: BinLabelInput, actor?: ScopePrincipal): Promise<LocationLabel[]> {
    const include = { rack: { include: { warehouse: true, rackTypeMaster: true } } } as const;
    const live = { isDeleted: false, rack: { isDeleted: false } };
    const or: Prisma.SlotWhereInput[] = [];
    if (input.slotIds?.length) or.push({ id: { in: input.slotIds } });
    if (input.rackIds?.length) or.push({ rackId: { in: input.rackIds } });
    if (input.warehouseIds?.length) {
      input.warehouseIds.forEach((id) => assertWarehouseAccess(actor, id));
      or.push({ rack: { warehouseId: { in: input.warehouseIds }, isDeleted: false } });
    }
    const slots = or.length
      ? await this.prisma.slot.findMany({ where: { ...live, OR: or }, include, take: MAX_LOCATION_LABELS + 1 })
      : [];

    // Legacy callers post raw keys "WH|RACK|SLOT": use the slot row when it exists.
    const fromKeys: LocationLabel[] = [];
    for (const key of input.locations ?? []) {
      const [whCode, rackCode, slotCode] = key.split('|');
      const slot = whCode && rackCode && slotCode
        ? await this.prisma.slot.findFirst({
            where: { isDeleted: false, code: slotCode, rack: { code: rackCode, isDeleted: false, warehouse: { code: whCode } } },
            include,
          })
        : null;
      if (slot) slots.push(slot);
      else {
        const wh = whCode ? await this.prisma.warehouse.findFirst({ where: { code: whCode }, select: { id: true } }) : null;
        assertWarehouseAccess(actor, wh?.id ?? null, `warehouse ${whCode}`);
        fromKeys.push(labelFromKey(key));
      }
    }

    for (const s of slots) assertWarehouseAccess(actor, s.rack.warehouseId, `warehouse ${s.rack.warehouse.code}`);
    const seen = new Set<string>();
    const unique = slots.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
    unique.sort((a, b) =>
      a.rack.warehouse.code.localeCompare(b.rack.warehouse.code) ||
      a.rack.code.localeCompare(b.rack.code) ||
      (a.level - b.level) || (a.column - b.column) || a.code.localeCompare(b.code));

    const labels = [...unique.map((s) => buildLocationLabel(s)), ...fromKeys];
    if (labels.length === 0) throw new BadRequestException('Nothing to print');
    if (labels.length > MAX_LOCATION_LABELS) {
      throw new BadRequestException(`Too many labels (${labels.length}) — print up to ${MAX_LOCATION_LABELS} at a time (per rack or per warehouse)`);
    }
    return labels;
  }

  /** One 100 × 60 mm label per page: big code + details on the left, QR on the right. */
  private async renderLocationLabels(labels: LocationLabel[]): Promise<Buffer> {
    const W = 283, H = 170, PAD = 12, QR = 92;
    const doc = new PDFDocument({ size: [W, H], margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
    const textW = W - PAD * 2 - QR - 8;

    for (let i = 0; i < labels.length; i++) {
      if (i > 0) doc.addPage({ size: [W, H], margin: 0 });
      const l = labels[i];
      const line = (text: string, y: number, size: number, bold = false, color = '#000000') => {
        if (!text) return;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color)
          .text(text, PAD, y, { width: textW, height: size + 3, lineBreak: true, ellipsis: true });
      };

      line('LOCATION', PAD, 7, true, '#666666');
      // Biggest size that fits the code on one line
      let size = 30;
      doc.font('Helvetica-Bold');
      while (size > 12 && doc.fontSize(size).widthOfString(l.code) > textW) size -= 1;
      line(l.code, PAD + 11, size, true);
      let y = PAD + 15 + size;
      line(l.warehouseLine, y, 9, false, '#333333'); y += 13;
      line(l.rackLine, y, 9, true); y += 13;
      line(l.positionLine, y, 8, false, '#333333'); if (l.positionLine) y += 11;
      line(l.capacityLine, y, 8, false, '#333333');

      const png = await this.barcodePng(l.payload, 'qrcode');
      doc.image(png, W - PAD - QR, PAD, { width: QR, height: QR });
      doc.font('Helvetica').fontSize(6.5).fillColor('#666666')
        .text('Scan for putaway / lookup', W - PAD - QR, PAD + QR + 3, { width: QR, align: 'center', lineBreak: false });

      doc.moveTo(PAD, H - 26).lineTo(W - PAD, H - 26).strokeColor('#cccccc').lineWidth(0.5).stroke();
      doc.font('Courier').fontSize(7).fillColor('#444444')
        .text(l.payload, PAD, H - 20, { width: W - PAD * 2, align: 'center', lineBreak: false, ellipsis: true });
    }
    doc.end();
    return done;
  }

  async serialLabels(stockItemIds: string[]): Promise<Buffer> {
    const items = await this.prisma.stockItem.findMany({ where: { id: { in: stockItemIds } }, include: { product: true } });
    if (!items.length) throw new BadRequestException('No stock items found');
    return this.render(items.map((s) => ({
      title: s.product.name,
      lines: [`SKU: ${s.product.code}`, `Serial: ${s.serialNumber ?? s.batchNumber ?? s.id.slice(-8)}`],
      barcodeText: s.serialNumber ? this.parser.encode('serial', s.serialNumber) : this.parser.encode('stockItem', s.id),
    })));
  }
}
