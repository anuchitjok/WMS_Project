import { Module } from '@nestjs/common';
import { PlanningController } from './planning.controller';
import { PlanningService } from './planning.service';
import { PlanningDataService } from './planning-data.service';

@Module({
  controllers: [PlanningController],
  providers: [PlanningService, PlanningDataService],
})
export class PlanningModule {}
