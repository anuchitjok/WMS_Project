import { Module } from '@nestjs/common';
import { WarehouseLayoutService } from './warehouse-layout.service';
import { WarehouseLayoutController } from './warehouse-layout.controller';

@Module({
  controllers: [WarehouseLayoutController],
  providers: [WarehouseLayoutService],
  exports: [WarehouseLayoutService],
})
export class WarehouseLayoutModule {}
