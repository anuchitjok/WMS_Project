import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { WorkQueueService } from './work-queue.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, WorkQueueService],
})
export class DashboardModule {}
