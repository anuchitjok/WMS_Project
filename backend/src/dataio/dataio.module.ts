import { Module } from '@nestjs/common';
import { DataioController } from './dataio.controller';
import { DataioService } from './dataio.service';
import { ImportService } from './import.service';

@Module({
  controllers: [DataioController],
  providers: [DataioService, ImportService],
})
export class DataioModule {}
