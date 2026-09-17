import { Module } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';
import { RealtimeModule } from '../realtime/realtime.module';
import { ApprovalModule } from '../approval/approval.module';
import { InventoryModule } from '../inventory/inventory.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';

@Module({
  imports: [RealtimeModule, ApprovalModule, InventoryModule, FulfillmentModule],
  controllers: [RequestsController],
  providers: [RequestsService],
})
export class RequestsModule {}
