import { Module } from '@nestjs/common';
import { WarehouseLayoutService } from './warehouse-layout.service';
import { WarehouseLayoutController } from './warehouse-layout.controller';
import { ApprovalModule } from '../approval/approval.module';

@Module({
  // RQ13: the plan's approval chain is the shared approval engine.
  imports: [ApprovalModule],
  controllers: [WarehouseLayoutController],
  providers: [WarehouseLayoutService],
  exports: [WarehouseLayoutService],
})
export class WarehouseLayoutModule {}
