import { PrismaService } from '../prisma/prisma.service';
import { StockStatus } from '@prisma/client';

export interface LowStockProduct {
  id: string;
  code: string;
  name: string;
  available: number; // AVAILABLE units only (not historical/shipped/consumed)
  minStock: number;
}

/**
 * Single shared low-stock metric used by both dashboard and reports.
 * A product is "low" when its AVAILABLE stock is below minStock.
 * Counts ONLY status=AVAILABLE (fixes the prior bug that counted all stock items
 * including shipped/consumed). Active products with minStock > 0 only.
 */
export async function getLowStockProducts(prisma: PrismaService): Promise<LowStockProduct[]> {
  const products = await prisma.product.findMany({
    where: { isActive: true, minStock: { gt: 0 } },
    include: { _count: { select: { stockItems: { where: { status: StockStatus.AVAILABLE } } } } },
    orderBy: { minStock: 'desc' },
  });
  return products
    .map((p) => ({ id: p.id, code: p.code, name: p.name, available: p._count.stockItems, minStock: p.minStock }))
    .filter((p) => p.available < p.minStock);
}
