import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { RequestRefService } from './request-ref.service';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';

@Module({
  imports: [FulfillmentModule], // HandoverService — QR "confirm receipt" reuses the existing handover
  controllers: [DocumentsController],
  providers: [DocumentsService, RequestRefService],
})
export class DocumentsModule {}
