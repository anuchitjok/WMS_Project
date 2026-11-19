import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { PrismaService } from '../prisma/prisma.service';

// MDM-003 — the product family master.
//
// The rules these tests exist for: a family may sit inside a wider one, so the
// tree must never be allowed to close on itself; and a family is never
// deactivated out from under the products or sub-groups still pointing at it.

/** `tree` maps id → parentId, which is all the cycle check walks. */
function makePrisma(over: {
  tree?: Record<string, string | null>;
  counts?: { products: number; children: number };
  codes?: string[];
  isActive?: boolean;
} = {}) {
  const tree = over.tree ?? {};
  const counts = over.counts ?? { products: 0, children: 0 };
  const calls: any = { created: [], updated: [], audits: [] };
  const prisma: any = {
    productFamily: {
      findUnique: jest.fn(async ({ where, select }: any) => {
        if (where.code) return (over.codes ?? []).includes(where.code) ? { id: 'taken', code: where.code } : null;
        if (!(where.id in tree)) return null;
        const row = { id: where.id, code: 'PF-0001', name: 'Cables', description: null, parentId: tree[where.id], isActive: over.isActive ?? true };
        return select ? { parentId: row.parentId } : { ...row, _count: counts };
      }),
      findMany: jest.fn(async () => (over.codes ?? []).map((code) => ({ code }))),
      create: jest.fn(async ({ data }: any) => { calls.created.push(data); return { id: 'new', ...data }; }),
      update: jest.fn(async ({ where, data }: any) => { calls.updated.push(data); return { id: where.id, code: 'PF-0001', name: 'Cables', ...data }; }),
    },
    auditLog: { create: jest.fn(async ({ data }: any) => { calls.audits.push(data); return data; }) },
  };
  return { prisma, calls };
}

async function serviceWith(prisma: any): Promise<WarehouseService> {
  const mod = await Test.createTestingModule({
    providers: [WarehouseService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return mod.get(WarehouseService);
}

const actions = (calls: any) => calls.audits.map((a: any) => a.action);

describe('creating a product family', () => {
  it('generates the next PF code and records who made it', async () => {
    const { prisma, calls } = makePrisma({ codes: ['PF-0001', 'PF-0007'] });
    const svc = await serviceWith(prisma);

    await svc.createProductFamily({ name: '  Cables  ' }, 'u1');

    expect(calls.created[0]).toMatchObject({ code: 'PF-0008', name: 'Cables', parentId: null });
    expect(actions(calls)).toContain('PRODUCT_FAMILY_CREATED');
  });

  it('refuses a code that is already taken', async () => {
    const { prisma } = makePrisma({ codes: ['PF-0001'] });
    const svc = await serviceWith(prisma);
    await expect(svc.createProductFamily({ code: 'pf-0001', name: 'Cables' }, 'u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a parent that does not exist', async () => {
    const { prisma } = makePrisma({ tree: {} });
    const svc = await serviceWith(prisma);
    await expect(svc.createProductFamily({ name: 'Cables', parentId: 'ghost' }, 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('putting a family inside another', () => {
  it('refuses to put a family inside itself', async () => {
    const { prisma } = makePrisma({ tree: { a: null } });
    const svc = await serviceWith(prisma);
    await expect(svc.updateProductFamily('a', { parentId: 'a' }, 'u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to put a family inside one of its own sub-groups', async () => {
    // c sits in b, b sits in a. Making a sit in c would close the loop.
    const { prisma } = makePrisma({ tree: { a: null, b: 'a', c: 'b' } });
    const svc = await serviceWith(prisma);
    await expect(svc.updateProductFamily('a', { parentId: 'c' }, 'u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows a move that keeps the tree open', async () => {
    const { prisma, calls } = makePrisma({ tree: { a: null, b: null, c: 'b' } });
    const svc = await serviceWith(prisma);
    await svc.updateProductFamily('a', { parentId: 'c' }, 'u1');
    expect(calls.updated[0]).toMatchObject({ parentId: 'c' });
    expect(actions(calls)).toContain('PRODUCT_FAMILY_UPDATED');
  });
});

describe('retiring a family', () => {
  it('refuses while products still point at it', async () => {
    const { prisma } = makePrisma({ tree: { a: null }, counts: { products: 3, children: 0 } });
    const svc = await serviceWith(prisma);
    await expect(svc.deleteProductFamily('a', 'u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses while sub-groups still sit inside it', async () => {
    const { prisma } = makePrisma({ tree: { a: null }, counts: { products: 0, children: 2 } });
    const svc = await serviceWith(prisma);
    await expect(svc.deleteProductFamily('a', 'u1')).rejects.toBeInstanceOf(ConflictException);
  });

  // The master screen retires a family with a PATCH, not a DELETE, so the guard
  // has to hold on that path too — it is the one people actually use.
  it('refuses a PATCH that deactivates a family products still point at', async () => {
    const { prisma } = makePrisma({ tree: { a: null }, counts: { products: 2, children: 0 } });
    const svc = await serviceWith(prisma);
    await expect(svc.updateProductFamily('a', { isActive: false }, 'u1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.productFamily.update).not.toHaveBeenCalled();
  });

  it('refuses a PATCH that deactivates a family with sub-groups inside it', async () => {
    const { prisma } = makePrisma({ tree: { a: null }, counts: { products: 0, children: 1 } });
    const svc = await serviceWith(prisma);
    await expect(svc.updateProductFamily('a', { isActive: false }, 'u1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.productFamily.update).not.toHaveBeenCalled();
  });

  it('lets a PATCH deactivate a family nothing points at', async () => {
    const { prisma, calls } = makePrisma({ tree: { a: null } });
    const svc = await serviceWith(prisma);
    await svc.updateProductFamily('a', { isActive: false }, 'u1');
    expect(calls.updated[0]).toMatchObject({ isActive: false });
  });

  it('lets a PATCH switch a retired family back on', async () => {
    const { prisma, calls } = makePrisma({ tree: { a: null }, counts: { products: 4, children: 2 }, isActive: false });
    const svc = await serviceWith(prisma);
    await svc.updateProductFamily('a', { isActive: true }, 'u1');
    expect(calls.updated[0]).toMatchObject({ isActive: true });
  });

  it('deactivates an empty family rather than deleting it', async () => {
    const { prisma, calls } = makePrisma({ tree: { a: null } });
    const svc = await serviceWith(prisma);
    await svc.deleteProductFamily('a', 'u1');
    expect(calls.updated[0]).toEqual({ isActive: false });
    expect(actions(calls)).toContain('PRODUCT_FAMILY_DEACTIVATED');
  });
});
