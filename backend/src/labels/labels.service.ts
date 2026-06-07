import { Injectable, BadRequestException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as bwipjs from 'bwip-js';
import { PrismaService } from '../prisma/prisma.service';
import { BarcodeParserService } from '../scan/barcode-parser.service';

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

  async binLabels(locationKeys: string[]): Promise<Buffer> {
    return this.render(locationKeys.map((key) => {
      const [wh, rack, slot] = key.split('|');
      return {
        title: `BIN ${[rack, slot].filter(Boolean).join('-')}`,
        lines: [`Warehouse: ${wh}`, `Rack: ${rack ?? '-'}  Slot: ${slot ?? '-'}`],
        barcodeText: this.parser.encode('location', key),
        qr: true,
      };
    }));
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
