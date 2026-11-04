import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { WorkQueueService } from './work-queue.service';
import { ControlTowerService } from './control-tower.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, WorkQueueService, ControlTowerService],
})
export class DashboardModule {}
