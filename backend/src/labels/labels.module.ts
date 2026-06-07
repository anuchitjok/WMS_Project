import { Module } from '@nestjs/common';
import { LabelsController } from './labels.controller';
import { LabelsService } from './labels.service';
import { ScanModule } from '../scan/scan.module';

@Module({
  imports: [ScanModule], // for BarcodeParserService
  controllers: [LabelsController],
  providers: [LabelsService],
})
export class LabelsModule {}
