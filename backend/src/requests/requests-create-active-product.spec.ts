import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { RequestsService } from './requests.service';

// RQ22 follow-up — create() must refuse a line whose product cannot be requested.
//
// create() never looked at productStatus. It was unreachable in practice only
// because the request form had ACTIVE product ids in memory and nothing else;
// now that the form deliberately loads every product (so it can show a brand
// disabled with a reason), the server is the thing that has to say no.
//
// Same rule and wording as Receive Goods (receiving.service.ts) and the
// receiving import, with the verb changed: "...and cannot be requested".

type P = { id: string; code: string; isActive: boolean; productStatus: string };

const ACTIVE = (id: string, code: string): P => ({ id, code, isActive: true, productStatus: 'ACTIVE' });
const INACTIVE = (id: string, code: string): P => ({ id, code, isActive: false, productStatus: 'INACTIVE' });
const DISCONTINUED = (id: string, code: string): P => ({ id, code, isActive: false, productStatus: 'DISCONTINUED' });

function makeService(catalogue: P[]) {
  const created = { refNumber: 'WR-2026-ABC123', items: [] };
  const prisma: any = {
    product: {
      findMany: jest.fn().mockImplementation(async ({ where }: any) =>
        catalogue.filter((p) => where.id.in.includes(p.id))),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ department: 'IT' }) },
    withdrawalRequest: { create: jest.fn().mockResolvedValue(created) },
  };
  const masterData: any = { assertDepartment: jest.fn().mockResolvedValue(null) };
  const svc = new RequestsService(
    masterData, prisma, {} as any, {} as any, {} as any, {} as any, {} as any,
  );
  return { svc, prisma, created };
}

const body = (items: { productId: string; quantity: number }[]) =>
  ({ rmaCaseNumber: 'RMA-1', items });

describe('RequestsService.create — product must be requestable (RQ22 follow-up)', () => {
  it('rejects a line for an INACTIVE product, naming the product code', async () => {
    const { svc, prisma } = makeService([INACTIVE('p2', 'ACER-OLD')]);

    await expect(svc.create(body([{ productId: 'p2', quantity: 1 }]), 'u1'))
      .rejects.toThrow(new BadRequestException('Product ACER-OLD is inactive and cannot be requested'));
    // Nothing was written.
    expect(prisma.withdrawalRequest.create).not.toHaveBeenCalled();
  });

  it('rejects a line for a DISCONTINUED product, naming the product code', async () => {
    const { svc, prisma } = makeService([DISCONTINUED('p3', 'DELL-EOL')]);

    await expect(svc.create(body([{ productId: 'p3', quantity: 2 }]), 'u1'))
      .rejects.toThrow(new BadRequestException('Product DELL-EOL is discontinued and cannot be requested'));
    expect(prisma.withdrawalRequest.create).not.toHaveBeenCalled();
  });

  it('still creates the request when every product is ACTIVE', async () => {
    const { svc, prisma, created } = makeService([ACTIVE('p1', 'ACER-1'), ACTIVE('p4', 'HP-1')]);

    const out = await svc.create(
      body([{ productId: 'p1', quantity: 1 }, { productId: 'p4', quantity: 3 }]),
      'u1',
    );

    expect(out).toBe(created);
    expect(prisma.withdrawalRequest.create).toHaveBeenCalledTimes(1);
    const lines = prisma.withdrawalRequest.create.mock.calls[0][0].data.items.create;
    expect(lines).toEqual([
      { productId: 'p1', quantityRequested: 1 },
      { productId: 'p4', quantityRequested: 3 },
    ]);
  });

  it('on a multi-line request the error names the offending product, not the first line', async () => {
    const { svc } = makeService([ACTIVE('p1', 'ACER-1'), DISCONTINUED('p3', 'DELL-EOL'), ACTIVE('p4', 'HP-1')]);

    await expect(svc.create(
      body([
        { productId: 'p1', quantity: 1 },
        { productId: 'p3', quantity: 1 },
        { productId: 'p4', quantity: 1 },
      ]),
      'u1',
    )).rejects.toThrow(/DELL-EOL is discontinued/);
  });

  it('checks every line in one query, never one query per line', async () => {
    const { svc, prisma } = makeService([ACTIVE('p1', 'ACER-1'), ACTIVE('p4', 'HP-1')]);

    await svc.create(
      body([
        { productId: 'p1', quantity: 1 },
        { productId: 'p4', quantity: 1 },
        { productId: 'p1', quantity: 2 }, // same product twice — one lookup
      ]),
      'u1',
    );

    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.product.findMany.mock.calls[0][0].where.id.in).toEqual(['p1', 'p4']);
  });

  it('rejects a product id that does not exist, as Receive Goods does', async () => {
    const { svc, prisma } = makeService([ACTIVE('p1', 'ACER-1')]);

    await expect(svc.create(body([{ productId: 'ghost', quantity: 1 }]), 'u1'))
      .rejects.toThrow(/Product ghost does not exist/);
    expect(prisma.withdrawalRequest.create).not.toHaveBeenCalled();
  });
});
