import { Module } from '@nestjs/common';
import { CompanyProfileModule } from '../company/company-profile.module';
import { PlanningController } from './planning.controller';
import { PlanningService } from './planning.service';
import { PlanningDataService } from './planning-data.service';
import { PlanningTemplatesService } from './planning-templates.service';

@Module({
  imports: [CompanyProfileModule],
  controllers: [PlanningController],
  providers: [PlanningService, PlanningDataService, PlanningTemplatesService],
})
export class PlanningModule {}
