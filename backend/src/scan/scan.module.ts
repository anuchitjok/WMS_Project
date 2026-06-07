import { Module } from '@nestjs/common';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';
import { BarcodeParserService } from './barcode-parser.service';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [RealtimeModule],
  controllers: [ScanController],
  providers: [ScanService, BarcodeParserService],
  exports: [BarcodeParserService],
})
export class ScanModule {}
