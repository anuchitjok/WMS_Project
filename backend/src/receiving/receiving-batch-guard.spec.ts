import { BadRequestException } from '@nestjs/common';
import { ReceivingImportService, ReceivingImportHeader } from './receiving-import.service';

/**
 * Decision C7 ("One") — Batch Goods Receiving.
 *
 * One imported file = exactly ONE Goods Receipt, carrying many item lines.
 * There is no Batch Receiving entity, `itemCondition` stays exactly
 * NEW | REFURBISH, and `batchNumber` keeps its existing meaning (the product
 * lot) — it is unrelated to receiving and never groups or splits a receipt.
 *
 * The import path is the one that could quietly start creating a receipt per
 * row (or per condition / per warehouse / per lot), so it is pinned here on a
 * mocked Prisma transaction client: real CSV in, counted writes out, no DB.
 */

const PRODUCTS = [
  { id: 'p1', code: 'P1', serialControlled: false, batchControlled: false, isActive: true, productStatus: 'ACTIVE' },
  { id: 'p2', code: 'P2', serialControlled: false, batchControlled: false, isActive: true, productStatus: 'ACTIVE' },
];

const COLUMNS = 'productCode,serialNumber,batchNumber,quantity,condition,ownershipType,warehouseCode,itemCondition';
const HEADER: ReceivingImportHeader = { sourceType: 'Vendor', warehouseId: 'w1' };

/** A real uploaded file — parsed by the production spreadsheet reader. */
function csvFile(rows: string[]): Express.Multer.File {
  return { originalname: 'goods-receiving.csv', buffer: Buffer.from([COLUMNS, ...rows].join('\n')) } as Express.Multer.File;
}

function makePrisma() {
  let n = 0;
  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    auditLog: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    warehouse: { findMany: jest.fn().mockResolvedValue([{ id: 'w1', code: 'WH-MAIN' }, { id: 'w2', code: 'WH-B' }]) },
    product: { findMany: jest.fn().mockResolvedValue(PRODUCTS.map((p) => ({ id: p.id, code: p.code }))) },
    stockItem: { create: jest.fn(() => ({ id: `s${++n}` })), findFirst: jest.fn().mockResolvedValue(null) },
    goodsReceiving: { create: jest.fn().mockResolvedValue({ id: 'gr1' }) },
    goodsReceivingItem: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    product: { findMany: jest.fn().mockResolvedValue(PRODUCTS) },
    warehouse: { findMany: jest.fn().mockResolvedValue([{ code: 'WH-MAIN' }, { code: 'WH-B' }]) },
    stockItem: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const realtime: any = { emitInventoryUpdate: jest.fn() };
  return { prisma, tx, realtime, svc: new ReceivingImportService(prisma, realtime) };
}

/** The item lines the import wrote, in file order. */
const lines = (tx: any) => tx.goodsReceivingItem.create.mock.calls.map((c: any[]) => c[0].data);

describe('C7 — one imported file = one Goods Receipt', () => {
  it('C7-G1: one imported file creates exactly one GoodsReceiving and N GoodsReceivingItem', async () => {
    const { tx, svc, prisma } = makePrisma();
    const file = csvFile([
      'P1,,,1,,,,',
      'P1,,,5,,,,',
      'P2,,,2,,,,',
      'P2,,,7,,,,',
    ]);

    const r = await svc.commit(HEADER, file, 'u1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.goodsReceiving.create).toHaveBeenCalledTimes(1);
    expect(tx.goodsReceivingItem.create).toHaveBeenCalledTimes(4);
    expect(r).toMatchObject({ receivingId: 'gr1', inserted: 4, skipped: 0 });
    // Every line hangs off that single receipt — no second receipt anywhere.
    expect(lines(tx).map((d: any) => d.receivingId)).toEqual(['gr1', 'gr1', 'gr1', 'gr1']);
  });

  it('C7-G1: a file whose rows differ in condition, warehouse and lot is still ONE receipt', async () => {
    const { tx, svc } = makePrisma();
    const file = csvFile([
      'P1,,LOT-A,1,good,OWN,WH-MAIN,NEW',
      'P1,,LOT-B,1,damaged,RMA,WH-B,REFURBISH',
      'P2,,,3,doa,CONSIGNMENT,WH-B,',
    ]);

    await svc.commit(HEADER, file, 'u1');

    // Nothing about a row may fan out into its own receipt.
    expect(tx.goodsReceiving.create).toHaveBeenCalledTimes(1);
    expect(tx.goodsReceivingItem.create).toHaveBeenCalledTimes(3);
    expect(new Set(lines(tx).map((d: any) => d.receivingId))).toEqual(new Set(['gr1']));
  });

  it('C7-G1: batchNumber stays the product lot on the line — it does not group or split receipts', async () => {
    const { tx, svc } = makePrisma();
    const file = csvFile(['P1,,LOT-2026-001,1,,,,', 'P1,,LOT-2026-002,1,,,,']);

    await svc.commit(HEADER, file, 'u1');

    expect(tx.goodsReceiving.create).toHaveBeenCalledTimes(1);
    expect(lines(tx).map((d: any) => d.batchNumber)).toEqual(['LOT-2026-001', 'LOT-2026-002']);
    // The lot is a property of the goods, not of the receipt.
    expect(tx.goodsReceiving.create.mock.calls[0][0].data).not.toHaveProperty('batchNumber');
  });

  it('C7-G1: skipped rows do not create a second receipt — the valid rows share the one receipt', async () => {
    const { tx, svc } = makePrisma();
    const file = csvFile([
      'P1,,,1,,,,',
      'NOPE,,,1,,,,',        // unknown productCode
      'P2,,,0,,,,',          // quantity < 1
      'P2,,,4,,,,',
    ]);

    const r = await svc.commit(HEADER, file, 'u1');

    expect(tx.goodsReceiving.create).toHaveBeenCalledTimes(1);
    expect(tx.goodsReceivingItem.create).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ inserted: 2, skipped: 2 });
    expect(r.skippedRows).toHaveLength(2);
  });

  it('C7-G1: a file with no valid row creates no receipt at all', async () => {
    const { tx, svc, prisma } = makePrisma();

    await expect(svc.commit(HEADER, csvFile(['NOPE,,,1,,,,']), 'u1')).rejects.toThrow(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.goodsReceiving.create).not.toHaveBeenCalled();
    expect(tx.goodsReceivingItem.create).not.toHaveBeenCalled();
  });
});

describe('C7-G2 — itemCondition through the IMPORT path is only NEW | REFURBISH', () => {
  it('C7-G2: the import stores NEW / REFURBISH (or nothing), whatever spelling the file used', async () => {
    const { tx, svc } = makePrisma();
    const file = csvFile([
      'P1,,,1,,,,NEW',
      'P1,,,1,,,,new',
      'P1,,,1,,,,REFURBISH',
      'P1,,,1,,,,Refurbished',
      'P1,,,1,,,,',
    ]);

    const r = await svc.commit(HEADER, file, 'u1');

    expect(r).toMatchObject({ inserted: 5, skipped: 0 });
    expect(lines(tx).map((d: any) => d.itemCondition)).toEqual(['NEW', 'NEW', 'REFURBISH', 'REFURBISH', null]);
    // Only these two values may ever be persisted by an import.
    for (const d of lines(tx)) expect([null, 'NEW', 'REFURBISH']).toContain(d.itemCondition);
  });

  it('C7-G2: a third condition in the file is skipped and never written', async () => {
    const { tx, svc } = makePrisma();
    const file = csvFile([
      'P1,,,1,,,,NEW',
      'P1,,,1,,,,USED',
      'P1,,,1,,,,DOA',
      'P1,,,1,,,,BROKEN',
    ]);

    const r = await svc.commit(HEADER, file, 'u1');

    expect(r.inserted).toBe(1);
    expect(r.skipped).toBe(3);
    expect(r.skippedRows.map((s) => s.errors.join())).toEqual([
      expect.stringContaining('Invalid itemCondition'),
      expect.stringContaining('Invalid itemCondition'),
      expect.stringContaining('Invalid itemCondition'),
    ]);
    expect(lines(tx).map((d: any) => d.itemCondition)).toEqual(['NEW']);
  });

  it('C7-G2: itemCondition is independent of the QC condition column', async () => {
    const { tx, svc } = makePrisma();
    const file = csvFile(['P1,,,1,damaged,,,NEW', 'P1,,,1,good,,,REFURBISH']);

    await svc.commit(HEADER, file, 'u1');

    expect(lines(tx).map((d: any) => ({ condition: d.condition, itemCondition: d.itemCondition }))).toEqual([
      { condition: 'damaged', itemCondition: 'NEW' },
      { condition: 'good', itemCondition: 'REFURBISH' },
    ]);
  });
});
