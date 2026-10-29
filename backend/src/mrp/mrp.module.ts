import { Module } from '@nestjs/common';
import { MrpController } from './mrp.controller';
import { MrpDataService } from './mrp-data.service';
import { MrpMasterService } from './mrp-master.service';
import { MrpService } from './mrp.service';

@Module({
  controllers: [MrpController],
  providers: [MrpDataService, MrpService, MrpMasterService],
  exports: [MrpService],
})
export class MrpModule {}
