import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as bwipjs from 'bwip-js';
import { PrismaService } from '../prisma/prisma.service';

// ─── A4 layout ────────────────────────────────────────────────────────────────
const ML = 36;          // left margin
const MR = 559;         // right margin
const CW = MR - ML;     // 523

// ─── Column x-positions (10 cols, total 523) ─────────────────────────────────
// #(12) SKU(68) Desc(100) Brand(46) Serial(68) WH(26) BIN(54) Qty(22) Cond(44) Status(83)
const TC = {
  no:    ML,           // 36
  sku:   ML + 12,      // 48   w=68
  desc:  ML + 80,      // 116  w=100
  brand: ML + 180,     // 216  w=46
  ser:   ML + 226,     // 262  w=68
  wh:    ML + 294,     // 330  w=26
  bin:   ML + 320,     // 356  w=54
  qty:   ML + 374,     // 410  w=22
  cond:  ML + 396,     // 432  w=44
  stat:  ML + 440,     // 476  w=83 → 559
};

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  // ─── Barcode / QR ────────────────────────────────────────────────────────────

  private async qrPng(text: string): Promise<Buffer | null> {
    try { return await bwipjs.toBuffer({ bcid: 'qrcode', text, scale: 3, backgroundcolor: 'FFFFFF' }) as unknown as Buffer; }
    catch { return null; }
  }

  private async barcodePng(text: string): Promise<Buffer | null> {
    try { return await bwipjs.toBuffer({ bcid: 'code128', text, scale: 2, height: 10, includetext: false, backgroundcolor: 'FFFFFF' }) as unknown as Buffer; }
    catch { return null; }
  }

  // ─── PDF builder ─────────────────────────────────────────────────────────────

  private async buildPdf(fn: (doc: InstanceType<typeof PDFDocument>) => Promise<void>): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    const done = new Promise<Buffer>((res, rej) => { doc.on('end', () => res(Buffer.concat(chunks))); doc.on('error', rej); });
    try { await fn(doc); } finally { doc.end(); }
    return done;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** Thin horizontal rule */
  private hr(doc: any, y: number, x1 = ML, x2 = MR, color = '#cccccc', w = 0.5) {
    doc.moveTo(x1, y).lineTo(x2, y).strokeColor(color).lineWidth(w).stroke();
  }

  /** Absolute text, no linebreak by default */
  private t(doc: any, text: string, x: number, y: number, o: {
    size?: number; bold?: boolean; color?: string; width?: number; align?: string;
  } = {}) {
    const { size = 9, bold = false, color = '#000000', width, align } = o;
    doc.fontSize(size).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(color);
    const opts: any = { lineBreak: false };
    if (width !== undefined) { opts.width = width; opts.lineBreak = true; }
    if (align) opts.align = align;
    doc.text(text, x, y, opts);
  }

  /** Underline signature field */
  private sigLine(doc: any, label: string, x: number, y: number, w: number) {
    this.t(doc, label, x, y, { size: 8, bold: true, color: '#111111' });
    // Signature line — tall gap for writing
    this.hr(doc, y + 30, x, x + w - 8, '#888888', 0.6);
    this.t(doc, 'Signature', x, y + 32, { size: 6, color: '#aaaaaa' });
    // Name/Date line
    this.hr(doc, y + 50, x, x + w - 8, '#888888', 0.6);
    this.t(doc, 'Name / Date', x, y + 52, { size: 6, color: '#aaaaaa' });
  }

  // ─── Items table ─────────────────────────────────────────────────────────────

  private drawTable(doc: any, items: any[], yStart: number, maxRows: number): number {
    const TH = 14;   // header height
    const RH = 20;   // row height

    // Outer box
    const numRows = Math.min(items.length, maxRows);
    const tblH    = TH + numRows * RH + (items.length > maxRows ? 12 : 0);
    doc.rect(ML, yStart, CW, tblH).stroke('#999999').lineWidth(0.4);

    // ─ Header
    this.hr(doc, yStart + TH, ML, MR, '#999999', 0.4);
    const hdrs: { l: string; x: number }[] = [
      { l: '#',              x: TC.no   },
      { l: 'SKU / Part#',   x: TC.sku  },
      { l: 'Description',   x: TC.desc },
      { l: 'Brand',         x: TC.brand},
      { l: 'Serial / Batch',x: TC.ser  },
      { l: 'WH',            x: TC.wh   },
      { l: 'BIN Location',  x: TC.bin  },
      { l: 'QTY',           x: TC.qty  },
      { l: 'Condition',     x: TC.cond },
      { l: 'Status',        x: TC.stat },
    ];
    hdrs.forEach(({ l, x }) => this.t(doc, l, x + 2, yStart + 4, { size: 7, bold: true, color: '#222222' }));

    // Column vertical dividers
    const divXs = hdrs.slice(1).map(h => h.x);
    const tblBottom = yStart + tblH;
    divXs.forEach(x => doc.moveTo(x, yStart).lineTo(x, tblBottom).strokeColor('#cccccc').lineWidth(0.3).stroke());

    // ─ Rows
    let y = yStart + TH;
    items.slice(0, maxRows).forEach((item, i) => {
      if (i > 0) this.hr(doc, y, ML, MR, '#eeeeee', 0.3);

      const rack   = item.stockItem?.rack?.code  ?? '';
      const slot   = item.stockItem?.slot?.code  ?? '';
      const bin    = [rack, slot].filter(Boolean).join('-') || '—';
      const wh     = item.stockItem?.warehouse?.code ?? '—';
      const serial = item.stockItem?.serialNumber ?? item.stockItem?.batchNumber ?? '—';
      const cond   = item.condition ?? 'NEW';

      this.t(doc, String(i + 1), TC.no  + 2, y + 6, { size: 8, bold: true });
      this.t(doc, item.product?.code ?? '—',         TC.sku   + 2, y + 3,  { size: 7,   bold: true,  width: 64 });
      if (item.product?.partNumber)
        this.t(doc, item.product.partNumber,          TC.sku   + 2, y + 12, { size: 5.5, color: '#777777', width: 64 });
      this.t(doc, item.product?.name ?? '—',          TC.desc  + 2, y + 6,  { size: 7.5, width: 96 });
      this.t(doc, item.product?.brand?.name ?? '—',   TC.brand + 2, y + 6,  { size: 7.5, width: 42 });
      this.t(doc, serial,                             TC.ser   + 2, y + 6,  { size: 7,   bold: serial !== '—', width: 64 });
      this.t(doc, wh,                                 TC.wh    + 2, y + 6,  { size: 7.5, bold: true });
      // BIN — underlined for visibility
      this.t(doc, bin, TC.bin + 2, y + 6, { size: 8.5, bold: true });
      if (bin !== '—') {
        doc.moveTo(TC.bin + 2, y + 16).lineTo(TC.bin + 50, y + 16).strokeColor('#555555').lineWidth(0.5).stroke();
      }
      this.t(doc, String(item.quantityRequested ?? 1), TC.qty + 2, y + 6, { size: 9, bold: true });
      this.t(doc, cond,  TC.cond + 2, y + 6, { size: 7.5 });
      // Status checkbox
      doc.rect(TC.stat + 2, y + 5, 8, 8).stroke('#888888').lineWidth(0.4);
      this.t(doc, 'PENDING', TC.stat + 13, y + 6, { size: 7, color: '#888888' });

      y += RH;
    });

    // Overflow
    if (items.length > maxRows) {
      this.hr(doc, y, ML, MR, '#bbbbbb', 0.3);
      this.t(doc, `  + ${items.length - maxRows} more items — continued on separate sheet`, ML + 3, y + 3, { size: 6.5, color: '#555555' });
      y += 12;
    }

    return y;
  }

  // ─── Summary (plain text row) ─────────────────────────────────────────────────

  private drawSummary(doc: any, items: any[], y: number): number {
    const totalQty   = items.reduce((a, i) => a + (i.quantityRequested ?? 1), 0);
    const serialized = items.filter(i => i.stockItem?.serialNumber).length;
    const locations  = new Set(items.map(i => `${i.stockItem?.rack?.code}-${i.stockItem?.slot?.code}`)).size;
    const hasSerial  = items.some(i => i.product?.serialControlled);

    const parts = [
      `Total Items: ${items.length}`,
      `Total Qty: ${totalQty}`,
      `Serialized: ${serialized}`,
      `Locations: ${locations}`,
      `Completion: 0%`,
    ].join('   |   ');
    this.t(doc, parts, ML, y, { size: 7.5, color: '#333333' });

    if (hasSerial) {
      this.t(doc, '⚠  Serial verification required for each item', ML, y + 11, { size: 7, bold: true, color: '#111111' });
      return y + 22;
    }
    return y + 13;
  }

  // ─── Tear-off line ────────────────────────────────────────────────────────────

  private tearOff(doc: any, y: number) {
    doc.save();
    doc.dash(5, { space: 4 });
    doc.moveTo(ML - 4, y).lineTo(MR + 4, y).strokeColor('#888888').lineWidth(0.6).stroke();
    doc.undash();
    doc.restore();
    this.t(doc, '✂  TEAR HERE — WAREHOUSE COPY BELOW', ML + 132, y - 5, { size: 6.5, color: '#777777' });
  }

  // ─── One copy renderer ───────────────────────────────────────────────────────

  private async renderCopy(doc: any, req: any, items: any[], opts: {
    yStart: number;
    copyLabel: string;
    qrBuf: Buffer | null;
    barBuf: Buffer | null;
    maxRows: number;
    dateStr: string;
    priority: string;
    nowStr: string;
    isWarehouse: boolean;
  }): Promise<number> {
    let y = opts.yStart;
    const { copyLabel, qrBuf, barBuf, maxRows, dateStr, priority, nowStr, isWarehouse } = opts;

    // ── Title row ────────────────────────────────────────────────────────────
    // Title
    this.t(doc, 'PICKING SLIP', ML, y, { size: 20, bold: true });
    // Copy label (small, gray)
    this.t(doc, copyLabel, ML, y + 26, { size: 7.5, color: '#777777', bold: true });

    // QR + Barcode side-by-side, top-right
    const QR_W = 38;
    const QR_X = MR - 145;  // QR starts here
    const BC_X = QR_X + QR_W + 6;  // Barcode starts after QR + gap
    const BC_W = MR - BC_X;        // remaining width for barcode

    if (qrBuf) {
      try { doc.image(qrBuf, QR_X, y, { width: QR_W, height: QR_W }); } catch { /* skip */ }
    }
    if (barBuf) {
      try {
        doc.image(barBuf, BC_X, y + 5, { width: BC_W, height: 20 });
        this.t(doc, req.refNumber, BC_X, y + 27, { size: 6, color: '#555555', width: BC_W, align: 'center' });
      } catch { /* skip */ }
    }

    y += 38;

    // ── Ref / Date / Status line ─────────────────────────────────────────────
    this.hr(doc, y, ML, MR, '#cccccc', 0.5);
    y += 6;
    const statusStr = req.status.replace(/_/g, ' ');
    const prioStr   = priority !== 'NORMAL' ? `   Priority: ${priority}` : '';
    this.t(doc, `Ref: `, ML, y, { size: 8, color: '#666666' });
    this.t(doc, req.refNumber, ML + 22, y, { size: 8, bold: true });
    this.t(doc, `Date: ${dateStr}`, ML + 145, y, { size: 8, color: '#444444' });
    this.t(doc, `Status: `, ML + 270, y, { size: 8, color: '#666666' });
    this.t(doc, statusStr + prioStr, ML + 302, y, { size: 8, bold: true });
    y += 15;
    this.hr(doc, y, ML, MR, '#cccccc', 0.5);
    y += 8;

    // ── Request Info ─────────────────────────────────────────────────────────
    this.t(doc, 'Request Info', ML, y, { size: 9, bold: true });
    y += 13;

    // Row 1
    const r1 = [
      { l: 'Requester: ', v: req.requester?.fullName ?? '—', x: ML },
      { l: 'Department: ', v: req.requester?.department ?? '—', x: ML + 175 },
      { l: 'Approver: ', v: req.approver?.fullName ?? '—', x: ML + 340 },
    ];
    r1.forEach(({ l, v, x }) => {
      this.t(doc, l, x, y, { size: 8, color: '#666666' });
      this.t(doc, v, x + doc.widthOfString(l, { fontSize: 8 }), y, { size: 8, bold: false });
    });
    y += 13;

    // Row 2
    const rmaStr = req.rmaCaseNumber ?? '—';
    const purStr = (req as any).purpose ?? '—';
    this.t(doc, 'RMA Case: ',  ML,       y, { size: 8, color: '#666666' });
    this.t(doc, rmaStr,        ML + 45,  y, { size: 8 });
    this.t(doc, 'Purpose: ',   ML + 175, y, { size: 8, color: '#666666' });
    this.t(doc, purStr,        ML + 215, y, { size: 8 });
    y += 14;
    this.hr(doc, y, ML, MR, '#cccccc', 0.5);
    y += 8;

    // ── Items table ──────────────────────────────────────────────────────────
    this.t(doc, isWarehouse ? 'Items to Pick' : 'Picking List — Item Details', ML, y, { size: 9, bold: true });
    y += 12;
    y = this.drawTable(doc, items, y, maxRows);
    y += 8;

    // ── Summary ──────────────────────────────────────────────────────────────
    y = this.drawSummary(doc, items, y);
    y += 6;
    this.hr(doc, y, ML, MR, '#cccccc', 0.5);
    y += 8;

    // ── Signatures ───────────────────────────────────────────────────────────
    const sigLabel = isWarehouse ? 'Warehouse Confirmation' : 'Signatures & Confirmation';
    this.t(doc, sigLabel, ML, y, { size: 9, bold: true });
    y += 14;

    const sigLabels = isWarehouse
      ? ['WAREHOUSE PICKER', 'SUPERVISOR / QC', 'HANDOVER TO', 'TIMESTAMP']
      : ['PICKED BY', 'CHECKED BY', 'RECEIVED BY', 'APPROVED BY'];
    const sw = CW / 4;
    sigLabels.forEach((lbl, i) => this.sigLine(doc, lbl, ML + i * sw, y, sw));
    y += 62;

    // ── Notes (requester copy only) ──────────────────────────────────────────
    if (!isWarehouse) {
      const notes = (req as any).notes;
      if (notes) {
        this.hr(doc, y, ML, MR, '#cccccc', 0.5);
        y += 6;
        this.t(doc, 'Notes: ', ML, y, { size: 8, bold: true });
        this.t(doc, notes, ML + 35, y, { size: 8, color: '#444444', width: CW - 35 });
        y += 16;
      }
    }

    // ── Audit footer (warehouse copy) ────────────────────────────────────────
    if (isWarehouse) {
      this.hr(doc, y + 4, ML, MR, '#cccccc', 0.5);
      const footer = `Printed: ${nowStr}   |   HSNT WMS   |   Page 1 of 1   |   Doc Version: 2.0`;
      this.t(doc, footer, ML, y + 6, { size: 6, color: '#aaaaaa', width: CW, align: 'center' });
      y += 16;
    }

    return y;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PICKING SLIP  (dual-copy A4)
  // ─────────────────────────────────────────────────────────────────────────────

  async pickingSlip(requestId: string): Promise<Buffer> {
    const req = await this.prisma.withdrawalRequest.findUnique({
      where: { id: requestId },
      include: {
        requester: { select: { fullName: true, department: true, email: true } },
        approver:  { select: { fullName: true } },
        items: {
          include: {
            product: { include: { brand: true } },
            stockItem: {
              include: {
                warehouse: { select: { code: true } },
                rack:      { select: { code: true } },
                slot:      { select: { code: true } },
              },
            },
          },
        },
      },
    });
    if (!req) throw new NotFoundException('Request not found');

    const [qrBuf, barBuf] = await Promise.all([this.qrPng(req.refNumber), this.barcodePng(req.refNumber)]);

    const dateStr = new Date(req.createdAt).toLocaleDateString('en-GB');
    const nowStr  = new Date().toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const priority = (req as any).priority ?? 'NORMAL';
    const items    = req.items;

    const BASE_OPTS = { qrBuf, barBuf, dateStr, priority, nowStr };

    return this.buildPdf(async (doc) => {

      // ══ REQUESTER COPY ══════════════════════════════════════════════════════
      const y1End = await this.renderCopy(doc, req, items, {
        ...BASE_OPTS,
        yStart: 28,
        copyLabel: '[ REQUESTER COPY ]',
        maxRows: 6,
        isWarehouse: false,
      });

      // ══ TEAR-OFF  — fixed at A4 vertical center (421pt) ════════════════════
      const tearY = 421;
      this.tearOff(doc, tearY);

      // ══ WAREHOUSE COPY ══════════════════════════════════════════════════════
      await this.renderCopy(doc, req, items, {
        ...BASE_OPTS,
        yStart: tearY + 26,
        copyLabel: '[ WAREHOUSE COPY ]',
        maxRows: 5,
        isWarehouse: true,
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // COVER SHEET
  // ─────────────────────────────────────────────────────────────────────────────

  async coverSheet(requestId: string): Promise<Buffer> {
    const req = await this.prisma.withdrawalRequest.findUnique({
      where: { id: requestId },
      include: {
        requester: { select: { fullName: true, department: true, email: true } },
        items: { include: { product: true } },
      },
    });
    if (!req) throw new NotFoundException('Request not found');

    const shipment = await this.prisma.shipment.findFirst({ where: { task: { requestId } }, include: { task: true } });
    const [qrBuf, barBuf] = await Promise.all([this.qrPng(req.refNumber), this.barcodePng(req.refNumber)]);
    const nowStr = new Date().toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    return this.buildPdf(async (doc) => {
      let y = 36;

      // ── Title ────────────────────────────────────────────────────────────────
      this.t(doc, 'SHIPMENT COVER SHEET', ML, y, { size: 22, bold: true });
      this.t(doc, 'HSNT Warehouse Management System', ML, y + 28, { size: 8, color: '#666666' });
      if (qrBuf) { try { doc.image(qrBuf, MR - 50, y, { width: 50, height: 50 }); } catch { /* */ } }
      y += 54;
      this.hr(doc, y, ML, MR, '#cccccc', 0.5);
      y += 6;

      // ── Ref strip ────────────────────────────────────────────────────────────
      this.t(doc, 'Reference: ', ML, y, { size: 9, color: '#666666' });
      this.t(doc, req.refNumber, ML + 50, y, { size: 11, bold: true });
      y += 16;
      this.hr(doc, y, ML, MR, '#cccccc', 0.5);
      y += 10;

      // ── Ship To / Shipment Details ────────────────────────────────────────────
      this.t(doc, 'Ship To', ML, y, { size: 9, bold: true });
      this.t(doc, 'Shipment Details', ML + 320, y, { size: 9, bold: true });
      y += 14;

      this.t(doc, req.requester?.fullName ?? '—',  ML, y,      { size: 11, bold: true });
      this.t(doc, req.requester?.department ?? '—', ML, y + 14, { size: 9 });
      this.t(doc, req.requester?.email ?? '—',      ML, y + 26, { size: 8, color: '#555555' });

      const sh = shipment as any;
      [
        { l: 'Tracking No.:', v: sh?.trackingNumber ?? '—' },
        { l: 'Carrier:',      v: sh?.carrier ?? '—' },
        { l: 'Ship Date:',    v: sh?.shippedAt ? new Date(sh.shippedAt).toLocaleDateString('en-GB') : '—' },
        { l: 'Status:',       v: req.status.replace(/_/g, ' ') },
      ].forEach(({ l, v }, i) => {
        this.t(doc, l, ML + 320, y + i * 11, { size: 8, color: '#666666' });
        this.t(doc, v, ML + 395, y + i * 11, { size: 8, bold: true });
      });
      y += 44;
      this.hr(doc, y, ML, MR, '#cccccc', 0.5);
      y += 10;

      // ── Contents ─────────────────────────────────────────────────────────────
      this.t(doc, 'Contents Summary', ML, y, { size: 9, bold: true });
      y += 14;

      // Table header
      doc.rect(ML, y, CW, 12).stroke('#999999').lineWidth(0.4);
      ['#', 'SKU / Code', 'Description', 'Qty'].forEach((h, i) => {
        this.t(doc, h, [ML + 3, ML + 20, ML + 140, ML + 493][i], y + 3, { size: 7, bold: true });
      });
      y += 12;

      req.items.forEach((item, i) => {
        if (i > 0) this.hr(doc, y, ML, MR, '#eeeeee', 0.3);
        else doc.moveTo(ML, y).lineTo(MR, y).strokeColor('#999999').lineWidth(0.4).stroke();
        this.t(doc, String(i + 1),               ML + 3,   y + 4, { size: 8, bold: true });
        this.t(doc, item.product?.code ?? '—',   ML + 20,  y + 4, { size: 8, bold: true });
        this.t(doc, item.product?.name ?? '—',   ML + 140, y + 4, { size: 8, width: 340 });
        this.t(doc, String(item.quantityRequested ?? 1), ML + 493, y + 4, { size: 9, bold: true });
        y += 15;
      });
      doc.moveTo(ML, y).lineTo(MR, y).strokeColor('#999999').lineWidth(0.4).stroke();
      y += 8;

      if (req.rmaCaseNumber) {
        this.t(doc, `⚠  RMA Case: ${req.rmaCaseNumber}`, ML, y, { size: 9, bold: true });
        y += 14;
      }

      // ── Barcode ───────────────────────────────────────────────────────────────
      y += 8;
      if (barBuf) { try { doc.image(barBuf, ML + (CW - 240) / 2, y, { width: 240, height: 28 }); y += 30; } catch { /* */ } }
      this.t(doc, req.refNumber, ML, y, { size: 9, bold: true, width: CW, align: 'center' });
      this.t(doc, 'Scan or quote this reference for tracking', ML, y + 12, { size: 7, color: '#888888', width: CW, align: 'center' });
      y += 28;

      // ── Footer ────────────────────────────────────────────────────────────────
      this.hr(doc, y, ML, MR, '#cccccc', 0.5);
      this.t(doc, `Generated: ${nowStr}   |   HSNT WMS   |   Production   |   Page 1 of 1`, ML, y + 6, { size: 6, color: '#aaaaaa', width: CW, align: 'center' });
    });
  }
}
