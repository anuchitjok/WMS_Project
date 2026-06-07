import { Module } from '@nestjs/common';
import { CycleCountService } from './cycle-count.service';
import { CycleCountController } from './cycle-count.controller';

@Module({
  controllers: [CycleCountController],
  providers: [CycleCountService],
  exports: [CycleCountService],
})
export class CycleCountModule {}
