import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  RequestsService, buildRequestSearchWhere, normalizeDeliveryMethod, displayDeliveryMethod,
} from './requests.service';
import { RequestsController } from './requests.controller';
import { CreateRequestDto } from './dto/create-request.dto';
import { BulkApproveDto, BULK_APPROVE_MAX } from './dto/bulk-approve.dto';
import { ACCESS_KEY } from '../auth/decorators/access.decorator';
import { ACCESS } from '../auth/access';

// P4 4.1 / 4.4 / 4.7 — request list search, bulk approve, delivery method.

function makeService(refs: { id: string; refNumber: string }[] = []) {
  const prisma: any = { withdrawalRequest: { findMany: jest.fn().mockResolvedValue(refs) } };
  const svc = new RequestsService({} as any, prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { svc, prisma };
}

describe('buildRequestSearchWhere (4.1)', () => {
  it('returns null for blank input so nothing is added to the filter', () => {
    expect(buildRequestSearchWhere(undefined)).toBeNull();
    expect(buildRequestSearchWhere('')).toBeNull();
    expect(buildRequestSearchWhere('   ')).toBeNull();
  });

  it('searches ref, RMA, creator name/username and SKU case-insensitively', () => {
    const w: any = buildRequestSearchWhere('  wr-2026 ');
    const c = { contains: 'wr-2026', mode: 'insensitive' };
    expect(w.OR).toEqual(expect.arrayContaining([
      { refNumber: c },
      { rmaCaseNumber: c },
      { requester: { is: { fullName: c } } },
      { requester: { is: { username: c } } },
    ]));
    const productClause = w.OR.find((o: any) => o.items);
    expect(productClause.items.some.product.is.OR).toEqual([{ code: c }, { partNumber: c }, { name: c }]);
  });

  it('caps the term length', () => {
    const w: any = buildRequestSearchWhere('x'.repeat(500));
    expect(w.OR[0].refNumber.contains).toHaveLength(100);
  });
});

describe('deliveryMethod (4.7)', () => {
  it('null / absent is stored as COLLECT; SHIP kept; anything else rejected', () => {
    expect(normalizeDeliveryMethod(undefined)).toBe('COLLECT');
    expect(normalizeDeliveryMethod(null)).toBe('COLLECT');
    expect(normalizeDeliveryMethod('SHIP')).toBe('SHIP');
    expect(normalizeDeliveryMethod('COLLECT')).toBe('COLLECT');
    expect(() => normalizeDeliveryMethod('DRONE')).toThrow(BadRequestException);
  });

  it('read side never throws and shows older rows as COLLECT', () => {
    expect(displayDeliveryMethod(null)).toBe('COLLECT');
    expect(displayDeliveryMethod('weird')).toBe('COLLECT');
    expect(displayDeliveryMethod('SHIP')).toBe('SHIP');
  });

  const base = { rmaCaseNumber: 'RMA-1', items: [{ productId: 'p1', quantity: 1 }] };
  it('DTO accepts COLLECT, SHIP or nothing', async () => {
    for (const v of [undefined, 'COLLECT', 'SHIP']) {
      const errs = await validate(plainToInstance(CreateRequestDto, { ...base, deliveryMethod: v }));
      expect(errs).toHaveLength(0);
    }
  });
  it('DTO rejects other values', async () => {
    const errs = await validate(plainToInstance(CreateRequestDto, { ...base, deliveryMethod: 'ship' }));
    expect(errs.map((e) => e.property)).toContain('deliveryMethod');
  });
});

describe('bulkApprove (4.4)', () => {
  it('runs the single-approve path once per id and isolates failures', async () => {
    const { svc } = makeService([{ id: 'a', refNumber: 'WR-A' }, { id: 'b', refNumber: 'WR-B' }, { id: 'c', refNumber: 'WR-C' }]);
    const approve = jest.spyOn(svc, 'approve').mockImplementation(async (id: string) => {
      if (id === 'b') throw new ConflictException('Request was already decided');
      return { id, refNumber: `WR-${id.toUpperCase()}`, status: 'APPROVED' } as any;
    });
    const res = await svc.bulkApprove(['a', 'b', 'c'], 'boss', true);
    expect(approve).toHaveBeenCalledTimes(3);
    expect(approve).toHaveBeenNthCalledWith(1, 'a', 'boss', true, undefined);
    expect(approve).toHaveBeenNthCalledWith(3, 'c', 'boss', true, undefined);
    expect(res.approved).toBe(2);
    expect(res.failed).toBe(1);
    expect(res.results).toEqual([
      { id: 'a', refNumber: 'WR-A', ok: true, status: 'APPROVED' },
      { id: 'b', refNumber: 'WR-B', ok: false, error: 'Request was already decided' },
      { id: 'c', refNumber: 'WR-C', ok: true, status: 'APPROVED' },
    ]);
  });

  it('runs the ids one after another (no overlapping transactions)', async () => {
    const { svc } = makeService();
    let running = 0; let maxRunning = 0;
    jest.spyOn(svc, 'approve').mockImplementation(async (id: string) => {
      running++; maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 2));
      running--;
      return { id, status: 'APPROVED' } as any;
    });
    await svc.bulkApprove(['a', 'b', 'c'], 'boss', true);
    expect(maxRunning).toBe(1);
  });

  it('de-duplicates ids', async () => {
    const { svc } = makeService();
    const approve = jest.spyOn(svc, 'approve').mockResolvedValue({ status: 'APPROVED' } as any);
    await svc.bulkApprove(['a', 'a', 'b'], 'boss', true);
    expect(approve).toHaveBeenCalledTimes(2);
  });

  it('reject requires a reason and passes the same reason to every id', async () => {
    const { svc } = makeService();
    const approve = jest.spyOn(svc, 'approve').mockResolvedValue({ status: 'REJECTED' } as any);
    await expect(svc.bulkApprove(['a'], 'boss', false)).rejects.toThrow(BadRequestException);
    await expect(svc.bulkApprove(['a'], 'boss', false, '   ')).rejects.toThrow(BadRequestException);
    expect(approve).not.toHaveBeenCalled();
    const res = await svc.bulkApprove(['a', 'b'], 'boss', false, ' duplicate ');
    expect(approve).toHaveBeenCalledWith('a', 'boss', false, 'duplicate');
    expect(approve).toHaveBeenCalledWith('b', 'boss', false, 'duplicate');
    expect(res.rejected).toBe(2);
  });

  it('enforces the max size and a non-empty list', async () => {
    const { svc } = makeService();
    const approve = jest.spyOn(svc, 'approve');
    const tooMany = Array.from({ length: BULK_APPROVE_MAX + 1 }, (_, i) => `id${i}`);
    await expect(svc.bulkApprove(tooMany, 'boss', true)).rejects.toThrow(BadRequestException);
    await expect(svc.bulkApprove([], 'boss', true)).rejects.toThrow(BadRequestException);
    expect(approve).not.toHaveBeenCalled();
  });

  it('DTO enforces 1..100 string ids and a boolean decision', async () => {
    const ok = await validate(plainToInstance(BulkApproveDto, { ids: ['a'], approve: true }));
    expect(ok).toHaveLength(0);
    const big = await validate(plainToInstance(BulkApproveDto, { ids: Array.from({ length: 101 }, (_, i) => `x${i}`), approve: true }));
    expect(big.map((e) => e.property)).toContain('ids');
    const empty = await validate(plainToInstance(BulkApproveDto, { ids: [], approve: true }));
    expect(empty.map((e) => e.property)).toContain('ids');
    const noFlag = await validate(plainToInstance(BulkApproveDto, { ids: ['a'] }));
    expect(noFlag.map((e) => e.property)).toContain('approve');
  });

  it('endpoint carries the same access rule as the single approve', () => {
    const proto = RequestsController.prototype as any;
    const bulk = Reflect.getMetadata(ACCESS_KEY, proto.bulkApprove);
    const single = Reflect.getMetadata(ACCESS_KEY, proto.approve);
    expect(bulk).toBe(ACCESS.requestApprove);
    expect(bulk).toBe(single);
  });
});
