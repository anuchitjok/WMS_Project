import { Module } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';
import { RealtimeModule } from '../realtime/realtime.module';
import { ApprovalModule } from '../approval/approval.module';

@Module({
  imports: [RealtimeModule, ApprovalModule],
  controllers: [RequestsController],
  providers: [RequestsService],
})
export class RequestsModule {}
