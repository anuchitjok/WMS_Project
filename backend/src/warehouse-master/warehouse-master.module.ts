import { Module } from '@nestjs/common';
import { WarehouseMasterService } from './warehouse-master.service';
import { WarehouseMasterController } from './warehouse-master.controller';

@Module({
  controllers: [WarehouseMasterController],
  providers: [WarehouseMasterService],
  exports: [WarehouseMasterService],
})
export class WarehouseMasterModule {}
