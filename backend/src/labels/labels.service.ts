import * as path from 'path';
import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import PDFDocument from 'pdfkit';
import * as bwipjs from 'bwip-js';
import { PrismaService } from '../prisma/prisma.service';
import { BarcodeParserService } from '../scan/barcode-parser.service';
import { assertWarehouseAccess, ScopePrincipal } from '../common/warehouse-scope';
import { buildLocationLabel, labelFromKey, LocationLabel } from './location-label';
import { containerPayload } from '../containers/container-code';

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

  /**
   * The pixel size of a PNG, read from its IHDR header (width and height are
   * two big-endian 32-bit numbers at offsets 16 and 20). pdfkit can measure an
   * image too, but only through `openImage`, which its type definitions do not
   * declare; this is eight bytes of a format that cannot change.
   */
  /**
   * Sarabun, registered on a document under the names the shipping label draws
   * with.
   *
   * PDFKit's built-in Helvetica and Courier have no Thai glyphs at all: the
   * text goes out in WinAnsi, so every Thai code point lands on whatever Latin
   * character shares its byte and an address reads as accented nonsense. A
   * delivery address is Thai in the ordinary case, so the font has to be a real
   * one embedded in the file.
   *
   * nest-cli copies `assets/` into `dist/`, and this resolves from __dirname,
   * so the same two lines work under ts-node and in production. Only the
   * shipping label uses it; the other labels are ASCII codes and keep
   * Helvetica, which is lighter and already proven on those stickers.
   */
  private useThaiFonts(doc: PDFKit.PDFDocument): void {
    const dir = path.join(__dirname, '..', '..', 'assets', 'fonts');
    doc.registerFont('body', path.join(dir, 'Sarabun-Regular.ttf'));
    doc.registerFont('body-bold', path.join(dir, 'Sarabun-Bold.ttf'));
  }

  private pngSize(png: Buffer): { width: number; height: number } {
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  }

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

  /**
   * RQ17 — the sticker for a box: its code big, what it is and where it stands,
   * and a QR holding BOX|<code>, which the scanner already understands.
   */
  async containerLabels(containerIds: string[]): Promise<Buffer> {
    const boxes = await this.prisma.container.findMany({
      where: { id: { in: containerIds }, isDeleted: false },
      include: {
        warehouse: { select: { code: true } },
        rack: { select: { code: true } },
        slot: { select: { code: true } },
        _count: { select: { stockItems: true } },
      },
      orderBy: { code: 'asc' },
    });
    if (!boxes.length) throw new BadRequestException('No boxes found');
    return this.render(boxes.map((b) => ({
      title: b.code,
      lines: [
        [b.name, b.type].filter(Boolean).join(' · '),
        [b.warehouse?.code, b.rack?.code, b.slot?.code].filter(Boolean).join(' > ') || 'Not placed yet',
        `${b._count.stockItems} stock row(s)${b.status === 'CLOSED' ? ' · sealed' : ''}`,
      ],
      barcodeText: containerPayload(b.code),
      qr: true,
    })));
  }

  /**
   * LOG-002 - the shipping label.
   *
   * A draft, deliberately: the owner asked to see one before settling the
   * format. It is 100 x 150 mm, the size thermal printers and courier pouches
   * are built around, and it carries only what someone handling the parcel or
   * arguing about it later needs:
   *
   *   who it is from (the company profile), who it goes to,
   *   the carrier and its brand, the tracking number as a CODE128 barcode,
   *   the air waybill and the carrier's warehouse number,
   *   the request it came from, so a parcel traces back to the paperwork,
   *   and a QR holding SHP|<ref>, which this system's scanner already reads.
   *
   * Nothing on it is computed or guessed: a field with no value prints as a
   * dash, so a half-filled label is visibly half-filled rather than quietly
   * wrong.
   */
  async logisticsLabels(shipmentIds: string[]): Promise<Buffer> {
    const shipments = await this.prisma.shipment.findMany({
      where: { id: { in: shipmentIds } },
      include: {
        // FulfillmentTask keeps the request as an id plus a denormalised ref, and
        // the warehouse as an id — neither is a relation, so both are read here.
        task: { select: { refNumber: true, requestId: true, requestRef: true, warehouseId: true } },
      },
      orderBy: { refNumber: 'asc' },
    });
    if (!shipments.length) throw new BadRequestException('No shipments found');

    const [company, warehouses, requests] = await Promise.all([
      this.prisma.companyProfile.findUnique({ where: { id: 'default' } }),
      this.prisma.warehouse.findMany({
        where: { id: { in: shipments.map((s) => s.task?.warehouseId).filter((x): x is string => !!x) } },
        select: { id: true, code: true },
      }),
      this.prisma.withdrawalRequest.findMany({
        where: { id: { in: shipments.map((s) => s.task?.requestId).filter((x): x is string => !!x) } },
        select: {
          id: true, department: true,
          // Migration 44 — the delivery address the requester gave when they
          // chose Ship. Read here so the label can print it; a COLLECT request
          // never has one.
          shipToName: true, shipToPhone: true, shipToAddress: true,
          shipToTambon: true, shipToDistrict: true, shipToProvince: true,
          shipToPostCode: true, shipToNote: true,
        },
      }),
    ]);
    const whOf = new Map(warehouses.map((w) => [w.id, w.code]));
    const deptOf = new Map(requests.map((r) => [r.id, r.department]));
    const shipToOf = new Map(requests.map((r) => [r.id, r]));
    return this.renderLogisticsLabels(
      shipments.map((s) => ({
        ...s,
        warehouseCode: s.task?.warehouseId ? (whOf.get(s.task.warehouseId) ?? null) : null,
        department: s.task?.requestId ? (deptOf.get(s.task.requestId) ?? null) : null,
        shipTo: s.task?.requestId ? (shipToOf.get(s.task.requestId) ?? null) : null,
      })),
      company,
    );
  }

  private async renderLogisticsLabels(
    shipments: any[],
    company: { displayName: string | null; legalName: string | null; address: string | null; phone: string | null } | null,
  ): Promise<Buffer> {
    // 100 x 150 mm in points, the usual courier sticker.
    const W = 283, H = 425, PAD = 14;
    // A ceiling for the tracking barcode, so a long number cannot push the rest
    // of the label down the sticker. Scanners read it well below this height.
    const BARCODE_MAX_H = 46;
    const QR = 72;
    const innerW = W - PAD * 2;
    const footerTop = H - PAD - QR;
    const dash = (v?: string | null) => (v && String(v).trim() ? String(v).trim() : '-');

    const doc = new PDFDocument({ size: [W, H], margin: 0 });
    this.useThaiFonts(doc);
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    /**
     * Everything above the footer. `extra` is added at each dividing rule, so
     * the same layout can be drawn tight or spread out. Returns where the
     * content ended.
     */
    const drawBody = (d: PDFKit.PDFDocument, s: any, bar: Buffer | null, extra: number): number => {
      let y = PAD;
      const text = (
        v: string, size: number, bold = false, color = '#000000', gap = 2, width = innerW, x = PAD,
      ) => {
        d.font(bold ? 'body-bold' : 'body').fontSize(size).fillColor(color)
          .text(v, x, y, { width, lineBreak: true, ellipsis: true });
        y = d.y + gap;
      };
      const rule = (gap = 6) => {
        d.moveTo(PAD, y).lineTo(W - PAD, y).lineWidth(0.6).strokeColor('#cccccc').stroke();
        y += gap + extra;
      };
      const field = (label: string, value?: string | null, big = false) => {
        text(label.toUpperCase(), 6, true, '#777777', 1);
        text(dash(value), big ? 13 : 9, big, '#000000', 5);
      };
      const half = (innerW - 10) / 2;
      const pair = (
        leftLabel: string, leftValue: string, rightLabel: string, rightValue: string, mono = false,
      ) => {
        const top = y;
        d.font('body-bold').fontSize(6).fillColor('#777777').text(leftLabel, PAD, top, { width: half });
        d.font(mono ? 'Courier' : 'body').fontSize(mono ? 8 : 9).fillColor('#000000')
          .text(leftValue, PAD, top + 8, { width: half });
        d.font('body-bold').fontSize(6).fillColor('#777777').text(rightLabel, PAD + half + 10, top, { width: half });
        d.font('body').fontSize(mono ? 8 : 9).fillColor('#000000')
          .text(rightValue, PAD + half + 10, top + 8, { width: half });
        y = top + 24;
      };

      // -- who it is from --------------------------------------------------
      text(dash(company?.displayName || company?.legalName), 9, true, '#000000', 1);
      text([company?.address, company?.phone].filter(Boolean).join(' · ') || ' ', 6, false, '#666666', 4);
      rule();

      // -- carrier, the loudest thing on the label -------------------------
      text('SHIP VIA', 6, true, '#777777', 1);
      text(dash(s.carrierBrand || s.carrier), 16, true, '#000000', 1);
      if (s.carrierBrand && s.carrier) text(s.carrier, 7, false, '#666666', 4);
      else y += 3;

      // -- tracking, as a barcode anyone's scanner can read ----------------
      text('TRACKING', 6, true, '#777777', 2);
      if (bar) {
        // How tall the barcode ends up depends on how WIDE it is drawn, and
        // its width depends on how many characters the tracking number has, so
        // a fixed step down the page is a guess - and a wrong one printed the
        // number on top of the bars. Measure the image and step past it.
        const img = this.pngSize(bar);
        const drawnH = Math.min((innerW * img.height) / img.width, BARCODE_MAX_H);
        const drawnW = (drawnH * img.width) / img.height;
        d.image(bar, PAD + (innerW - drawnW) / 2, y, { width: drawnW, height: drawnH });
        y += drawnH + 5;
        d.font('Courier-Bold').fontSize(9).fillColor('#000000')
          .text(String(s.trackingNumber), PAD, y, { width: innerW, align: 'center' });
        y = d.y + 6;
      } else {
        text('-', 11, true, '#000000', 6);
      }
      rule();

      // -- the numbers a claim is argued over ------------------------------
      pair('AIR WAYBILL', dash(s.awbNumber), 'WAREHOUSE NO.', dash(s.warehouseNumber));
      rule();

      // -- who it goes to --------------------------------------------------
      // The receiver's name may be on the shipment, the address only on the
      // request (migration 44). Whoever is named on the shipment wins, since
      // that is the later and more specific answer.
      const to = s.shipTo ?? {};
      field('deliver to', s.receiverName || to.shipToName, true);
      if (to.shipToPhone) text(String(to.shipToPhone), 9, false, '#000000', 4);
      const where = [to.shipToAddress, to.shipToTambon, to.shipToDistrict, to.shipToProvince]
        .map((p: unknown) => (typeof p === 'string' ? p.trim() : ''))
        .filter(Boolean)
        .join(' ');
      if (where || to.shipToPostCode) {
        text([where, to.shipToPostCode].filter(Boolean).join(' '), 9, false, '#000000', 4);
      }
      field('department', s.department);
      if (to.shipToNote) text(String(to.shipToNote), 7, false, '#666666', 4);
      rule();

      // -- back to the paperwork -------------------------------------------
      pair('REQUEST', dash(s.task?.requestRef), 'FROM WAREHOUSE', dash(s.warehouseCode), true);
      return y;
    };

    /** Dividing rules in `drawBody`; the leftover room is shared between them. */
    const RULES = 4;

    for (let i = 0; i < shipments.length; i++) {
      if (i > 0) doc.addPage({ size: [W, H], margin: 0 });
      const s = shipments[i];
      const bar = s.trackingNumber ? await this.barcodePng(String(s.trackingNumber), 'code128') : null;

      // The content is shorter than the sticker and the QR has to stay at the
      // foot, where whoever scans it is already looking, so without this the
      // label had a hole in its middle. Draw it once on a document nobody
      // keeps to learn how much room is left, then share that room out.
      const scratch = new PDFDocument({ size: [W, H], margin: 0 });
      // The same fonts, or the measuring pass sizes the text with Helvetica's
      // metrics and shares out the wrong amount of room.
      this.useThaiFonts(scratch);
      scratch.on('data', () => undefined);
      const used = drawBody(scratch, s, bar, 0);
      scratch.end();
      const extra = Math.max(0, Math.min((footerTop - 10 - used) / RULES, 16));

      drawBody(doc, s, bar, extra);

      // -- the shipment's own QR, at the foot --------------------------------
      const qr = await this.barcodePng(this.parser.encode('shipment', s.refNumber), 'qrcode');
      doc.image(qr, PAD, footerTop, { width: QR });
      doc.font('body-bold').fontSize(11).fillColor('#000000')
        .text(s.refNumber, PAD + QR + 10, footerTop + 4, { width: innerW - QR - 10 });
      doc.font('body').fontSize(7).fillColor('#666666')
        .text(`Task ${dash(s.task?.refNumber)}`, PAD + QR + 10, footerTop + 20, { width: innerW - QR - 10 });
      doc.font('body').fontSize(7).fillColor('#666666')
        .text(
          s.shippedAt ? `Shipped ${new Date(s.shippedAt).toISOString().slice(0, 10)}` : 'Not dispatched yet',
          PAD + QR + 10, footerTop + 32, { width: innerW - QR - 10 },
        );
    }
    doc.end();
    return done;
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
