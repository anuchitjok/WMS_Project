// Shared DEMO-data reset. Deletes ONLY DEMO- tagged records, FK-safe order.
// Never touches non-demo (production) rows. Audit logs are NOT deleted.
import type { PrismaClient } from '@prisma/client';
import { DEMO_USERS } from './demo-data';

export async function resetDemoData(prisma: PrismaClient) {
  const demoUsernames = DEMO_USERS.map((u) => u.username);

  // Resolve anchors
  const products = await prisma.product.findMany({ where: { code: { startsWith: 'DEMO-' } }, select: { id: true } });
  const warehouses = await prisma.warehouse.findMany({ where: { code: { startsWith: 'DEMO-' } }, select: { id: true } });
  const users = await prisma.user.findMany({ where: { username: { in: demoUsernames } }, select: { id: true } });
  const productIds = products.map((p) => p.id);
  const warehouseId_s = warehouses.map((w) => w.id);
  const userIds = users.map((u) => u.id);

  const racks = warehouseId_s.length ? await prisma.rack.findMany({ where: { warehouseId: { in: warehouseId_s } }, select: { id: true } }) : [];
  const rackIds = racks.map((r) => r.id);
  const stock = await prisma.stockItem.findMany({
    where: { OR: [{ productId: { in: productIds } }, { warehouseId: { in: warehouseId_s } }] },
    select: { id: true },
  });
  const stockIds = stock.map((s) => s.id);
  const tasks = await prisma.fulfillmentTask.findMany({ where: { refNumber: { startsWith: 'DEMO-' } }, select: { id: true } });
  const taskIds = tasks.map((t) => t.id);
  const ships = await prisma.shipment.findMany({ where: { refNumber: { startsWith: 'DEMO-' } }, select: { id: true } });
  const shipIds = ships.map((s) => s.id);
  const reqs = await prisma.withdrawalRequest.findMany({ where: { refNumber: { startsWith: 'DEMO-' } }, select: { id: true } });
  const reqIds = reqs.map((r) => r.id);
  const recvs = await prisma.goodsReceiving.findMany({ where: { refNumber: { startsWith: 'DEMO-' } }, select: { id: true } });
  const recvIds = recvs.map((r) => r.id);
  const insts = reqIds.length ? await prisma.approvalInstance.findMany({ where: { entityId: { in: reqIds } }, select: { id: true } }) : [];
  const instIds = insts.map((i) => i.id);
  const packs = taskIds.length ? await prisma.packingSession.findMany({ where: { taskId: { in: taskIds } }, select: { id: true } }) : [];
  const packIds = packs.map((p) => p.id);

  const report: Record<string, number> = {};
  const d = async (name: string, fn: () => Promise<{ count: number }>) => { report[name] = (await fn()).count; };

  // FK-safe order
  if (shipIds.length) await d('shipmentTimeline', () => prisma.shipmentTimeline.deleteMany({ where: { shipmentId: { in: shipIds } } }));
  if (shipIds.length) await d('shipment', () => prisma.shipment.deleteMany({ where: { id: { in: shipIds } } }));
  if (packIds.length) await d('carton', () => prisma.carton.deleteMany({ where: { sessionId: { in: packIds } } }));
  if (taskIds.length) await d('packingSession', () => prisma.packingSession.deleteMany({ where: { taskId: { in: taskIds } } }));
  if (taskIds.length) await d('fulfillmentTimeline', () => prisma.fulfillmentTimeline.deleteMany({ where: { taskId: { in: taskIds } } }));
  if (taskIds.length) await d('fulfillmentTaskItem', () => prisma.fulfillmentTaskItem.deleteMany({ where: { taskId: { in: taskIds } } }));
  if (taskIds.length) await d('fulfillmentTask', () => prisma.fulfillmentTask.deleteMany({ where: { id: { in: taskIds } } }));
  if (instIds.length) await d('approvalStep', () => prisma.approvalInstanceStep.deleteMany({ where: { instanceId: { in: instIds } } }));
  if (instIds.length) await d('approvalInstance', () => prisma.approvalInstance.deleteMany({ where: { id: { in: instIds } } }));
  if (reqIds.length) await d('requestItem', () => prisma.withdrawalRequestItem.deleteMany({ where: { requestId: { in: reqIds } } }));
  if (reqIds.length) await d('request', () => prisma.withdrawalRequest.deleteMany({ where: { id: { in: reqIds } } }));
  if (recvIds.length) await d('receivingItem', () => prisma.goodsReceivingItem.deleteMany({ where: { receivingId: { in: recvIds } } }));
  if (recvIds.length) await d('receiving', () => prisma.goodsReceiving.deleteMany({ where: { id: { in: recvIds } } }));
  await d('rtvCase', () => prisma.rTVCase.deleteMany({ where: { OR: [{ refNumber: { startsWith: 'DEMO-' } }, ...(stockIds.length ? [{ stockItemId: { in: stockIds } }] : [])] } }));
  if (stockIds.length) await d('stockItem', () => prisma.stockItem.deleteMany({ where: { id: { in: stockIds } } }));
  if (productIds.length) await d('product', () => prisma.product.deleteMany({ where: { id: { in: productIds } } }));
  if (rackIds.length) await d('slot', () => prisma.slot.deleteMany({ where: { rackId: { in: rackIds } } }));
  if (warehouseId_s.length) await d('rack', () => prisma.rack.deleteMany({ where: { warehouseId: { in: warehouseId_s } } }));
  if (warehouseId_s.length) await d('warehouse', () => prisma.warehouse.deleteMany({ where: { id: { in: warehouseId_s } } }));
  await d('brand', () => prisma.brand.deleteMany({ where: { code: { startsWith: 'DEMO-' } } }));
  await d('vendor', () => prisma.vendor.deleteMany({ where: { code: { startsWith: 'DEMO-' } } }));
  if (userIds.length) {
    await d('loginHistory', () => prisma.loginHistory.deleteMany({ where: { userId: { in: userIds } } }));
    await d('notification', () => prisma.notification.deleteMany({ where: { userId: { in: userIds } } }));
    // Detach (keep) any audit rows referencing demo users, then delete users.
    await prisma.auditLog.updateMany({ where: { userId: { in: userIds } }, data: { userId: null } });
    await d('user', () => prisma.user.deleteMany({ where: { id: { in: userIds } } }));
  }

  return report;
}
