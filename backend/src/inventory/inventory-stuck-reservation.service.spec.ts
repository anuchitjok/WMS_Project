import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { FulfillmentStatus, RequestStatus, StockStatus } from '@prisma/client';
import { InventoryService } from './inventory.service';
import { InventoryOrchestrationService } from './inventory-orchestration.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

// Releasing a reservation the workflow can no longer reach (a request whose task
// finished without ever issuing goods). THE GATE: anything still in play must be
// refused — a live task, or a unit that actually left the warehouse.

const STOCK_ID = 'stock_1';
const REQ = { id: 'req_1', refNumber: 'WR-2026-HAVVDQ', status: RequestStatus.PICKING };
const LINK = {
  id: 'wri_1', requestId: REQ.id, quantityIssued: 0, shippedStockItemId: null, request: REQ,
};
const CLOSED_TASK = {
  id: 'task_1', refNumber: 'FT-2026-1OTILS', status: FulfillmentStatus.CLOSED,
  shipment: null, items: [{ qtyPicked: 0 }],
};

function makePrisma(item: Partial<{ status: StockStatus }> = {}) {
  const p: any = {
    stockItem: {
      findUnique: jest.fn().mockResolvedValue({ id: STOCK_ID, status: StockStatus.RESERVED, ...item }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: STOCK_ID, status: StockStatus.AVAILABLE }),
    },
    withdrawalRequestItem: {
      findMany: jest.fn().mockResolvedValue([LINK]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
    fulfillmentTask: { findFirst: jest.fn().mockResolvedValue(CLOSED_TASK) },
    withdrawalRequest: { update: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  p.$transaction = jest.fn((arg: any) => (typeof arg === 'function' ? arg(p) : Promise.all(arg)));
  return p;
}

describe('InventoryService — releaseStuckReservation', () => {
  let service: InventoryService;
  let prisma: ReturnType<typeof makePrisma>;
  let orchestration: { releaseReservation: jest.Mock };

  async function build(item?: Partial<{ status: StockStatus }>) {
    prisma = makePrisma(item);
    orchestration = { releaseReservation: jest.fn().mockResolvedValue(undefined) };
    const mod = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: prisma },
        { provide: RealtimeGateway, useValue: { emitInventoryUpdate: jest.fn(), emitRequestUpdate: jest.fn() } },
        { provide: InventoryOrchestrationService, useValue: orchestration },
      ],
    }).compile();
    service = mod.get(InventoryService);
  }

  beforeEach(() => build());

  it('releases the unit, unlinks the request item and closes the dead request', async () => {
    await service.releaseStuckReservation(STOCK_ID, 'user_1');

    expect(orchestration.releaseReservation).toHaveBeenCalledWith(
      expect.anything(), [{ stockItemId: STOCK_ID }], expect.stringContaining('WR-2026-HAVVDQ'), 'user_1',
    );
    expect(prisma.withdrawalRequestItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['wri_1'] } }, data: { stockItemId: null },
    });
    expect(prisma.withdrawalRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: REQ.id },
      data: expect.objectContaining({ status: RequestStatus.CANCELLED }),
    }));
  });

  it('refuses stock that is not RESERVED', async () => {
    await build({ status: StockStatus.AVAILABLE });
    await expect(service.releaseStuckReservation(STOCK_ID, 'user_1')).rejects.toThrow(BadRequestException);
    expect(orchestration.releaseReservation).not.toHaveBeenCalled();
  });

  it('refuses while the task can still be cancelled through the workflow', async () => {
    prisma.fulfillmentTask.findFirst.mockResolvedValue({ ...CLOSED_TASK, status: FulfillmentStatus.ALLOCATED });
    await expect(service.releaseStuckReservation(STOCK_ID, 'user_1')).rejects.toThrow(ConflictException);
    expect(orchestration.releaseReservation).not.toHaveBeenCalled();
  });

  it('refuses when the goods actually shipped', async () => {
    prisma.fulfillmentTask.findFirst.mockResolvedValue({ ...CLOSED_TASK, shipment: { shippedAt: new Date() } });
    await expect(service.releaseStuckReservation(STOCK_ID, 'user_1')).rejects.toThrow(ConflictException);
    expect(orchestration.releaseReservation).not.toHaveBeenCalled();
  });

  it('refuses when the task item records a real pick', async () => {
    prisma.fulfillmentTask.findFirst.mockResolvedValue({ ...CLOSED_TASK, items: [{ qtyPicked: 1 }] });
    await expect(service.releaseStuckReservation(STOCK_ID, 'user_1')).rejects.toThrow(ConflictException);
  });

  it('refuses when the request item was already issued', async () => {
    prisma.withdrawalRequestItem.findMany.mockResolvedValue([{ ...LINK, quantityIssued: 1 }]);
    await expect(service.releaseStuckReservation(STOCK_ID, 'user_1')).rejects.toThrow(ConflictException);
  });

  it('refuses an approved request with no task — that one cancels normally', async () => {
    prisma.fulfillmentTask.findFirst.mockResolvedValue(null);
    prisma.withdrawalRequestItem.findMany.mockResolvedValue([
      { ...LINK, request: { ...REQ, status: RequestStatus.APPROVED } },
    ]);
    await expect(service.releaseStuckReservation(STOCK_ID, 'user_1')).rejects.toThrow(ConflictException);
  });

  it('leaves the request open while another of its items still holds stock', async () => {
    prisma.withdrawalRequestItem.count.mockResolvedValue(1);
    await service.releaseStuckReservation(STOCK_ID, 'user_1');
    expect(orchestration.releaseReservation).toHaveBeenCalled();
    expect(prisma.withdrawalRequest.update).not.toHaveBeenCalled();
  });

  it('releases a reservation no request points at any more', async () => {
    prisma.withdrawalRequestItem.findMany.mockResolvedValue([]);
    await service.releaseStuckReservation(STOCK_ID, 'user_1');
    expect(orchestration.releaseReservation).toHaveBeenCalledWith(
      expect.anything(), [{ stockItemId: STOCK_ID }], 'stuck reservation on no request', 'user_1',
    );
    expect(prisma.withdrawalRequestItem.updateMany).not.toHaveBeenCalled();
  });
});
