import { Module } from '@nestjs/common';
import { FulfillmentController } from './fulfillment.controller';
import { FulfillmentService }    from './fulfillment.service';
import { AllocationService }     from './services/allocation.service';
import { PickingService }        from './services/picking.service';
import { PackingService }        from './services/packing.service';
import { DispatchService }       from './services/dispatch.service';
import { HandoverService }       from './services/handover.service';
import { InventoryModule }       from '../inventory/inventory.module';
import { RealtimeModule }        from '../realtime/realtime.module';

@Module({
  imports: [RealtimeModule, InventoryModule],
  controllers: [FulfillmentController],
  providers: [
    FulfillmentService,
    AllocationService,
    PickingService,
    PackingService,
    DispatchService,
    HandoverService,
  ],
  exports: [
    FulfillmentService,
    AllocationService,
    PickingService,
    PackingService,
    DispatchService,
    HandoverService,
  ],
})
export class FulfillmentModule {}
