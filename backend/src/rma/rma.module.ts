import { Module } from '@nestjs/common';
import { RmaService } from './rma.service';
import { RmaController } from './rma.controller';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [RealtimeModule],
  controllers: [RmaController],
  providers: [RmaService],
})
export class RmaModule {}
