import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as bwipjs from 'bwip-js';
import { PrismaService } from '../prisma/prisma.service';
import { RequestRefService, SlipContext } from './request-ref.service';
import { DELIVERY_METHOD_LABEL, requestQrUrl, signatureBlocks, SlipRow } from './picking-slip-data';

// ─── A4 layout ────────────────────────────────────────────────────────────────
const ML = 36;          // left margin
const MR = 559;         // right margin
const CW = MR - ML;     // 523

// ─── Column x-positions (8 cols, total 523) — plan P5 5.1 ────────────────────
// #(14) SKU(78) Desc(130) Brand(55) Serial(80) Location(78) Qty(32) Cond(56)
// Status was removed; WH + BIN are one "Location" column (warehouse / bin lines).
const TC = {
  no:    ML,           // 36
  sku:   ML + 14,      // 50   w=78
  desc:  ML + 92,      // 128  w=130
  brand: ML + 222,     // 258  w=55
  ser:   ML + 277,     // 313  w=80
  loc:   ML + 357,     // 393  w=78
  qty:   ML + 435,     // 471  w=32
  cond:  ML + 467,     // 503  w=56 → 559
};

/** Rows printed in each half of the dual-copy page; the rest go on continuation pages. */
const ROWS_PER_COPY = 5;
const ROWS_PER_CONT_PAGE = 30;

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private refs: RequestRefService,
  ) {}

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
    size?: number; bold?: boolean; color?: string; width?: number; align?: string; height?: number;
  } = {}) {
    const { size = 9, bold = false, color = '#000000', width, align, height } = o;
    doc.fontSize(size).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(color);
    const opts: any = { lineBreak: false };
    if (width !== undefined) { opts.width = width; opts.lineBreak = true; opts.ellipsis = true; }
    if (height !== undefined) opts.height = height;
    if (align) opts.align = align;
    doc.text(text, x, y, opts);
  }

  /**
   * Signature block (plan 5.1/5.2): title, pre-filled printed name, then blank
   * signature and date lines for handwriting. Boxed so the two sides read apart.
   */
  private sigBlock(doc: any, title: string, name: string, x: number, y: number, w: number) {
    const H = 58;
    doc.roundedRect(x, y, w, H, 3).strokeColor('#bbbbbb').lineWidth(0.6).stroke();
    const ix = x + 8;
    const iw = w - 16;
    this.t(doc, title, ix, y + 6, { size: 8, bold: true, color: '#111111' });
    // Printed name (auto-filled; blank when unknown)
    this.t(doc, 'Name:', ix, y + 19, { size: 7, color: '#777777' });
    this.t(doc, name || ' ', ix + 26, y + 18, { size: 8.5, bold: true, width: iw - 26, height: 11 });
    this.hr(doc, y + 29, ix + 26, ix + iw, '#bbbbbb', 0.4);
    // Signature + date lines
    const sigW = Math.round(iw * 0.62);
    this.hr(doc, y + 46, ix, ix + sigW, '#888888', 0.6);
    this.t(doc, 'Signature', ix, y + 48, { size: 6, color: '#999999' });
    this.hr(doc, y + 46, ix + sigW + 10, ix + iw, '#888888', 0.6);
    this.t(doc, 'Date', ix + sigW + 10, y + 48, { size: 6, color: '#999999' });
    return y + H;
  }

  // ─── Items table ─────────────────────────────────────────────────────────────

  private drawTable(doc: any, rows: SlipRow[], yStart: number, maxRows: number, overflowNote?: string): number {
    const TH = 14;   // header height
    const RH = 20;   // row height (Location needs two lines)

    const shown = rows.slice(0, maxRows);
    const hasMore = rows.length > maxRows;
    const tblH = TH + shown.length * RH + (hasMore ? 12 : 0);
    doc.rect(ML, yStart, CW, tblH).stroke('#999999').lineWidth(0.4);

    // ─ Header
    this.hr(doc, yStart + TH, ML, MR, '#999999', 0.4);
    const hdrs: { l: string; x: number }[] = [
      { l: '#',              x: TC.no    },
      { l: 'SKU / Part#',    x: TC.sku   },
      { l: 'Description',    x: TC.desc  },
      { l: 'Brand',          x: TC.brand },
      { l: 'Serial / Batch', x: TC.ser   },
      { l: 'Location',       x: TC.loc   },
      { l: 'QTY',            x: TC.qty   },
      { l: 'Condition',      x: TC.cond  },
    ];
    hdrs.forEach(({ l, x }) => this.t(doc, l, x + 2, yStart + 4, { size: 7, bold: true, color: '#222222' }));

    const tblBottom = yStart + tblH - (hasMore ? 12 : 0);
    hdrs.slice(1).forEach(({ x }) => doc.moveTo(x, yStart).lineTo(x, tblBottom).strokeColor('#cccccc').lineWidth(0.3).stroke());

    // ─ Rows
    let y = yStart + TH;
    shown.forEach((r, i) => {
      if (i > 0) this.hr(doc, y, ML, MR, '#eeeeee', 0.3);
      this.t(doc, String(r.no), TC.no + 2, y + 6, { size: 8, bold: true });
      this.t(doc, r.sku, TC.sku + 2, y + 3, { size: 7, bold: true, width: 74, height: 9 });
      if (r.partNumber) this.t(doc, r.partNumber, TC.sku + 2, y + 12, { size: 6, color: '#666666', width: 74, height: 8 });
      this.t(doc, r.description, TC.desc + 2, y + 3, { size: 7.5, width: 126, height: 17 });
      this.t(doc, r.brand, TC.brand + 2, y + 6, { size: 7.5, width: 51, height: 9 });
      this.t(doc, r.serial, TC.ser + 2, y + 6, { size: 7, bold: r.serial !== '—', width: 76, height: 9 });
      // Location: line 1 warehouse, line 2 rack / slot (bold — what the picker walks to)
      this.t(doc, r.location.warehouse, TC.loc + 2, y + 2.5, { size: 6.5, color: '#555555', width: 74, height: 8 });
      this.t(doc, r.location.bin, TC.loc + 2, y + 10.5, { size: 8, bold: true, width: 74, height: 9 });
      this.t(doc, String(r.qty), TC.qty + 2, y + 6, { size: 9, bold: true, width: 28, height: 10 });
      this.t(doc, r.condition, TC.cond + 2, y + 6, { size: 7.5, width: 52, height: 9 });
      y += RH;
    });

    if (hasMore) {
      this.hr(doc, y, ML, MR, '#bbbbbb', 0.3);
      this.t(doc, overflowNote ?? `+ ${rows.length - maxRows} more items`, ML + 4, y + 3, { size: 6.5, color: '#555555' });
      y += 12;
    }
    return y;
  }

  // ─── Summary (plain text row) ─────────────────────────────────────────────────

  private drawSummary(doc: any, rows: SlipRow[], hasSerialControlled: boolean, y: number): number {
    const totalQty   = rows.reduce((a, r) => a + r.qty, 0);
    const serialized = rows.filter((r) => r.serial !== '—').length;
    const locations  = new Set(rows.map((r) => `${r.location.warehouse}|${r.location.bin}`)).size;
    const parts = [
      `Total Items: ${rows.length}`,
      `Total Qty: ${totalQty}`,
      `Serialized: ${serialized}`,
      `Locations: ${locations}`,
    ].join('   |   ');
    this.t(doc, parts, ML, y, { size: 7.5, color: '#333333' });
    if (hasSerialControlled) {
      this.t(doc, 'Serial verification required for each item', ML + 330, y, { size: 7, bold: true, color: '#111111' });
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
    const label = 'TEAR HERE — WAREHOUSE COPY BELOW';
    doc.fontSize(6.5).font('Helvetica');
    const lw = doc.widthOfString(label) + 12;
    const lx = ML + (CW - lw) / 2;
    doc.rect(lx, y - 5, lw, 10).fill('#ffffff');
    this.t(doc, label, lx + 6, y - 3, { size: 6.5, color: '#777777' });
  }

  // ─── One copy renderer ───────────────────────────────────────────────────────

  private renderCopy(doc: any, ctx: SlipContext, opts: {
    yStart: number;
    yLimit: number;
    copyLabel: string;
    qrBuf: Buffer | null;
    barBuf: Buffer | null;
    dateStr: string;
    nowStr: string;
    isWarehouse: boolean;
    totalPages: number;
    hasSerialControlled: boolean;
  }): number {
    const { req, rows } = ctx;
    let y = opts.yStart;
    const { copyLabel, qrBuf, barBuf, dateStr, nowStr, isWarehouse } = opts;

    // ── Title row ────────────────────────────────────────────────────────────
    this.t(doc, 'PICKING SLIP', ML, y, { size: 20, bold: true });
    this.t(doc, copyLabel, ML, y + 26, { size: 7.5, color: '#777777', bold: true });

    // QR + barcode top-right; the Ref number sits directly under them (plan 5.1 / Q8)
    const QR_W = 56; // URL QR is dense — keep it large enough for a phone camera
    const QR_X = MR - 160;
    const BC_X = QR_X + QR_W + 8;
    const BC_W = MR - BC_X;
    if (qrBuf) { try { doc.image(qrBuf, QR_X, y, { width: QR_W, height: QR_W }); } catch { /* skip */ } }
    if (barBuf) { try { doc.image(barBuf, BC_X, y + 12, { width: BC_W, height: 28 }); } catch { /* skip */ } }
    this.t(doc, req.refNumber, QR_X, y + QR_W + 3, { size: 10, bold: true, width: MR - QR_X, align: 'center' });
    y += QR_W + 16;

    // ── Date / Status / Delivery line (Ref moved under the QR) ──────────────
    this.hr(doc, y, ML, MR, '#cccccc', 0.5);
    y += 6;
    const priority = (req as any).priority ?? 'NORMAL';
    const statusStr = req.status.replace(/_/g, ' ') + (priority !== 'NORMAL' ? `  ·  Priority: ${priority}` : '');
    this.t(doc, `Date: ${dateStr}`, ML, y, { size: 8, color: '#444444' });
    this.t(doc, 'Status: ', ML + 120, y, { size: 8, color: '#666666' });
    this.t(doc, statusStr, ML + 152, y, { size: 8, bold: true });
    this.t(doc, 'Delivery: ', ML + 345, y, { size: 8, color: '#666666' });
    this.t(doc, DELIVERY_METHOD_LABEL[ctx.deliveryMethod], ML + 383, y, { size: 8, bold: true });
    y += 15;
    this.hr(doc, y, ML, MR, '#cccccc', 0.5);
    y += 8;

    // ── Request Info ─────────────────────────────────────────────────────────
    const info = (l: string, v: string, x: number, yy: number, w: number) => {
      this.t(doc, l, x, yy, { size: 8, color: '#666666' });
      const lw = doc.widthOfString(l);
      this.t(doc, v, x + lw, yy, { size: 8, width: w - lw, height: 10 });
    };
    info('Requester: ', ctx.requesterName || '—', ML, y, 170);
    info('Department: ', req.requester?.department ?? req.department ?? '—', ML + 175, y, 160);
    info('Approver: ', req.approver?.fullName ?? '—', ML + 340, y, 183);
    y += 13;
    info('RMA Case: ', req.rmaCaseNumber ?? '—', ML, y, 170);
    info('Purpose: ', req.purpose ?? '—', ML + 175, y, CW - 175);
    y += 14;
    this.hr(doc, y, ML, MR, '#cccccc', 0.5);
    y += 8;

    // ── Items table ──────────────────────────────────────────────────────────
    this.t(doc, isWarehouse ? 'Items to Pick' : 'Items to Receive', ML, y, { size: 9, bold: true });
    y += 12;
    const more = rows.length - ROWS_PER_COPY;
    const note = more > 0 ? `+ ${more} more item${more === 1 ? '' : 's'} — continued on page 2${opts.totalPages > 2 ? `–${opts.totalPages}` : ''}` : undefined;
    y = this.drawTable(doc, rows, y, ROWS_PER_COPY, note);
    y += 6;

    // ── Summary ──────────────────────────────────────────────────────────────
    y = this.drawSummary(doc, rows, opts.hasSerialControlled, y);
    y += 4;

    // ── Signatures: two blocks only (plan 5.1) — WH left, Requester right ───
    const [wh, rq] = signatureBlocks(ctx.pickerName, ctx.requesterName);
    const GAP = 18;
    const bw = (CW - GAP) / 2;
    this.sigBlock(doc, wh.title, wh.name, ML, y, bw);
    y = this.sigBlock(doc, rq.title, rq.name, ML + bw + GAP, y, bw);
    y += 6;

    // ── Notes (requester copy, when there is room above the tear line) ──────
    const notes = req.notes;
    if (!isWarehouse && notes && y + 12 < opts.yLimit) {
      this.t(doc, 'Notes: ', ML, y, { size: 8, bold: true });
      this.t(doc, notes, ML + 35, y, { size: 8, color: '#444444', width: CW - 35, height: Math.max(10, opts.yLimit - y - 2) });
      y += 12;
    }

    // ── Footer (warehouse copy) ──────────────────────────────────────────────
    if (isWarehouse) {
      this.hr(doc, y, ML, MR, '#cccccc', 0.5);
      const footer = `Printed: ${nowStr}   |   HSNT WMS   |   Page 1 of ${opts.totalPages}   |   Doc Version: 3.0`;
      this.t(doc, footer, ML, y + 3, { size: 6, color: '#aaaaaa', width: CW, align: 'center' });
      y += 12;
    }
    return y;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PICKING SLIP  (dual-copy A4 + continuation pages for long requests)
  // ─────────────────────────────────────────────────────────────────────────────

  async pickingSlip(requestId: string): Promise<Buffer> {
    const ctx = await this.refs.loadContext({ id: requestId });
    const { req, rows } = ctx;

    // QR opens the request page in the web app (plan 5.3); the barcode keeps the plain ref.
    const [qrBuf, barBuf] = await Promise.all([this.qrPng(requestQrUrl(req.refNumber)), this.barcodePng(req.refNumber)]);

    const dateStr = new Date(req.createdAt).toLocaleDateString('en-GB');
    const nowStr  = new Date().toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const hasSerialControlled = req.items.some((i) => (i.product as any)?.serialControlled);
    const rest = rows.slice(ROWS_PER_COPY);
    const contPages = Math.ceil(rest.length / ROWS_PER_CONT_PAGE);
    const totalPages = 1 + contPages;
    const tearY = 421; // A4 vertical centre

    const base = { qrBuf, barBuf, dateStr, nowStr, totalPages, hasSerialControlled };

    return this.buildPdf(async (doc) => {
      this.renderCopy(doc, ctx, { ...base, yStart: 28, yLimit: tearY - 8, copyLabel: '[ REQUESTER COPY ]', isWarehouse: false });
      this.tearOff(doc, tearY);
      this.renderCopy(doc, ctx, { ...base, yStart: tearY + 22, yLimit: 830, copyLabel: '[ WAREHOUSE COPY ]', isWarehouse: true });

      // Continuation pages: every line beyond the first five, so nothing is left off.
      for (let p = 0; p < contPages; p++) {
        doc.addPage({ size: 'A4', margin: 0 });
        let y = 36;
        this.t(doc, 'PICKING SLIP — continued', ML, y, { size: 14, bold: true });
        this.t(doc, req.refNumber, ML, y, { size: 11, bold: true, width: CW, align: 'right' });
        y += 22;
        this.t(doc, `Delivery: ${DELIVERY_METHOD_LABEL[ctx.deliveryMethod]}   |   Requester: ${ctx.requesterName || '—'}`, ML, y, { size: 8, color: '#555555' });
        y += 14;
        const chunk = rest.slice(p * ROWS_PER_CONT_PAGE, (p + 1) * ROWS_PER_CONT_PAGE);
        y = this.drawTable(doc, chunk, y, ROWS_PER_CONT_PAGE);
        this.hr(doc, 812, ML, MR, '#cccccc', 0.5);
        this.t(doc, `Printed: ${nowStr}   |   HSNT WMS   |   Page ${p + 2} of ${totalPages}`, ML, 815, { size: 6, color: '#aaaaaa', width: CW, align: 'center' });
      }
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
    const [qrBuf, barBuf] = await Promise.all([this.qrPng(requestQrUrl(req.refNumber)), this.barcodePng(req.refNumber)]);
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
