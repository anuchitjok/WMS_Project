// fulfillment2.service.ts — Backward-compatibility proxy.
// All logic has been consolidated into FulfillmentModule (fulfillment/).
// This service delegates to the canonical services to avoid duplication.
//
// @deprecated TODO_REMOVE_AFTER_MIGRATION — delete this proxy once all clients
// have migrated from /fulfillment2 to /fulfillment. No new logic should be added here.
import { Injectable } from '@nestjs/common';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { AllocationService }  from '../fulfillment/services/allocation.service';
import { PickingService }     from '../fulfillment/services/picking.service';
import { FulfillmentStatus }  from '@prisma/client';

@Injectable()
export class Fulfillment2Service {
  constructor(
    private readonly fulfillment: FulfillmentService,
    private readonly allocation: AllocationService,
    private readonly picking: PickingService,
  ) {}

  board(warehouseId?: string)               { return this.fulfillment.board(warehouseId); }
  findAll(status?: FulfillmentStatus, wh?: string) { return this.fulfillment.findAll(status, wh); }
  findOne(id: string)                       { return this.fulfillment.findOne(id); }
  allocate(requestId: string, userId: string) { return this.allocation.allocate(requestId, userId); }
  advance(id: string, userId: string, data?: any) { return this.fulfillment.advance(id, userId, data); }
  confirmPick(taskId: string, itemId: string, qty: number, userId: string, barcode?: string) {
    return this.picking.confirmPick(taskId, itemId, qty, userId, barcode);
  }
  setException(id: string, status: FulfillmentStatus, userId: string, reason?: string) {
    return this.fulfillment.setException(id, status, userId, reason);
  }
}
