import { Module } from '@nestjs/common';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';
import { BarcodeParserService } from './barcode-parser.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';

@Module({
  imports: [RealtimeModule, FulfillmentModule],
  controllers: [ScanController],
  providers: [ScanService, BarcodeParserService],
  exports: [BarcodeParserService],
})
export class ScanModule {}
