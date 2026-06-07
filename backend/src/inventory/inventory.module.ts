import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { InventoryOrchestrationService } from './inventory-orchestration.service';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [RealtimeModule],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryOrchestrationService],
  exports: [InventoryService, InventoryOrchestrationService],
})
export class InventoryModule {}
