import 'reflect-metadata';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';

// RQ22 — "Brand can only be set to ACER".
//
// The New Withdrawal Request dialog builds its Brand list from this method's
// result (`brands.filter(brand has a product here)`). The method used to filter
// `productStatus: 'ACTIVE'` in SQL, so a brand whose products were all
// INACTIVE/DISCONTINUED produced no row, dropped out of the Brand list and the
// user was told nothing. Every product is returned now; `requestable` carries
// what the status filter used to decide, so the dialog can show the brand and
// say why it cannot be picked.

interface Row {
  id: string;
  code: string;
  name: string;
  productStatus: string;
  brand: { id: string; name: string } | null;
}

const product = (id: string, productStatus: string, brand: Row['brand']): Row =>
  ({ id, code: id.toUpperCase(), name: `Product ${id}`, productStatus, brand });

const ACER = { id: 'b-acer', name: 'ACER' };
const DELL = { id: 'b-dell', name: 'DELL' };
const HP = { id: 'b-hp', name: 'HP' };

/** `stock` = AVAILABLE units per product id; anything absent has no stock rows. */
function makeService(rows: Row[], stock: Record<string, number> = {}) {
  const prisma: any = {
    product: { findMany: jest.fn().mockResolvedValue(rows) },
    // getAvailableUnitsByProduct() sums AVAILABLE quantity per product via $queryRaw.
    $queryRaw: jest.fn().mockResolvedValue(
      Object.entries(stock).map(([productId, units]) => ({ productId, units })),
    ),
  };
  const svc = new RequestsService(
    {} as any, prisma, {} as any, {} as any, {} as any, {} as any, {} as any,
  );
  return { svc, prisma };
}

describe('getProductsWithAvailableQty (RQ22)', () => {
  it('no longer filters by productStatus in SQL, so no brand can silently vanish', async () => {
    const { svc, prisma } = makeService([
      product('p1', 'ACTIVE', ACER),
      product('p2', 'DISCONTINUED', DELL),
    ]);

    const out = await svc.getProductsWithAvailableQty();

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
    expect(out.map((p) => p.brand?.name)).toEqual(['ACER', 'DELL']);
  });

  it('returns a brand whose only products are non-ACTIVE, marked not requestable', async () => {
    const { svc } = makeService([
      product('p1', 'ACTIVE', ACER),
      product('p2', 'INACTIVE', DELL),
      product('p3', 'DISCONTINUED', DELL),
    ], { p1: 5, p2: 3, p3: 1 });

    const out = await svc.getProductsWithAvailableQty();
    const dell = out.filter((p) => p.brand?.id === DELL.id);

    // The brand is representable — the dialog can list DELL and disable it.
    expect(dell).toHaveLength(2);
    expect(dell.every((p) => p.requestable === false)).toBe(true);
    expect(out.find((p) => p.id === 'p1')!.requestable).toBe(true);
  });

  it('returns a product with no brand, with brand null and still requestable', async () => {
    const { svc } = makeService([product('p9', 'ACTIVE', null)], { p9: 4 });

    const out = await svc.getProductsWithAvailableQty();

    expect(out).toHaveLength(1);
    expect(out[0].brand).toBeNull();
    expect(out[0].requestable).toBe(true);
    expect(out[0].availableQty).toBe(4);
  });

  it('returns a brand whose products have zero available stock (requestable, availableQty 0)', async () => {
    const { svc } = makeService([
      product('p1', 'ACTIVE', ACER),
      product('p4', 'ACTIVE', HP),
    ], { p1: 2 }); // HP's p4 has no AVAILABLE rows at all

    const out = await svc.getProductsWithAvailableQty();
    const hp = out.find((p) => p.brand?.id === HP.id)!;

    expect(hp.requestable).toBe(true);
    expect(hp.availableQty).toBe(0);
    expect(out.find((p) => p.id === 'p1')!.availableQty).toBe(2);
  });

  it('counts units, not rows, and never returns undefined availableQty', async () => {
    const { svc } = makeService([product('p1', 'ACTIVE', ACER)], { p1: 20 });

    const out = await svc.getProductsWithAvailableQty();

    expect(out[0].availableQty).toBe(20);
  });

  it('brandId narrows the query without re-introducing a status filter', async () => {
    const { svc, prisma } = makeService([product('p2', 'DISCONTINUED', DELL)]);

    const out = await svc.getProductsWithAvailableQty(DELL.id);

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { brandId: DELL.id } }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].requestable).toBe(false);
  });

  it('skips the stock query when there are no products', async () => {
    const { svc, prisma } = makeService([]);

    await expect(svc.getProductsWithAvailableQty()).resolves.toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('GET /requests/products-available (RQ22)', () => {
  it('passes the optional brandId straight through to the service', async () => {
    const svc: any = { getProductsWithAvailableQty: jest.fn().mockResolvedValue([]) };
    const controller = new RequestsController(svc);

    await controller.getProductsWithAvailableQty('b-dell');
    await controller.getProductsWithAvailableQty();

    expect(svc.getProductsWithAvailableQty).toHaveBeenNthCalledWith(1, 'b-dell');
    expect(svc.getProductsWithAvailableQty).toHaveBeenNthCalledWith(2, undefined);
  });
});
