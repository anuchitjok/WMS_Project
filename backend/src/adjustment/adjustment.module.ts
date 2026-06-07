import { Module } from '@nestjs/common';
import { AdjustmentService } from './adjustment.service';
import { AdjustmentController } from './adjustment.controller';

@Module({
  controllers: [AdjustmentController],
  providers: [AdjustmentService],
})
export class AdjustmentModule {}
