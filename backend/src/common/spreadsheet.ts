import { BadRequestException } from '@nestjs/common';
import { Readable } from 'stream';
import * as ExcelJS from 'exceljs';

export const DEFAULT_MAX_ROWS = 5000; // guard against oversized files

/**
 * Parse an uploaded .xlsx or .csv file into an array of row objects keyed by the
 * header row. Each row carries a `__row` field with its 1-based spreadsheet line
 * number for error reporting. Empty rows are skipped.
 *
 * Shared by all bulk-import flows (generic Data I/O and Goods Receiving import).
 */
export async function parseSpreadsheet(
  file: Express.Multer.File,
  maxRows: number = DEFAULT_MAX_ROWS,
): Promise<Record<string, any>[]> {
  if (!file) throw new BadRequestException('No file uploaded');
  const wb = new ExcelJS.Workbook();
  const name = (file.originalname || '').toLowerCase();

  let ws: ExcelJS.Worksheet | undefined;
  if (name.endsWith('.csv')) {
    ws = await wb.csv.read(Readable.from(file.buffer));
  } else if (name.endsWith('.xlsx')) {
    await wb.xlsx.load(file.buffer as any);
    ws = wb.worksheets[0];
  } else {
    throw new BadRequestException('Unsupported file format. Use .xlsx or .csv');
  }
  if (!ws) throw new BadRequestException('Could not read worksheet');

  const headers: string[] = [];
  ws.getRow(1).eachCell((cell, col) => { headers[col] = String(cell.value ?? '').trim(); });

  const rows: Record<string, any>[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const obj: Record<string, any> = { __row: rowNumber };
    let hasData = false;
    row.eachCell((cell, col) => {
      const key = headers[col];
      if (!key) return;
      let v: any = cell.value;
      if (v && typeof v === 'object' && 'text' in v) v = (v as any).text; // rich text / hyperlink
      if (v !== null && v !== undefined && String(v).trim() !== '') hasData = true;
      obj[key] = typeof v === 'string' ? v.trim() : v;
    });
    if (hasData) rows.push(obj);
  });

  if (rows.length > maxRows) {
    throw new BadRequestException(`File too large: ${rows.length} rows (max ${maxRows})`);
  }
  return rows;
}
