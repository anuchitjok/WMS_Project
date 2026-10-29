import { Module } from '@nestjs/common';
import { PlanningController } from './planning.controller';
import { PlanningService } from './planning.service';
import { PlanningDataService } from './planning-data.service';
import { PlanningTemplatesService } from './planning-templates.service';

@Module({
  controllers: [PlanningController],
  providers: [PlanningService, PlanningDataService, PlanningTemplatesService],
})
export class PlanningModule {}
