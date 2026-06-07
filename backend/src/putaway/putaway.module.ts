import { Module } from '@nestjs/common';
import { PutawayService } from './putaway.service';
import { PutawayController } from './putaway.controller';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [RealtimeModule],
  controllers: [PutawayController],
  providers: [PutawayService],
})
export class PutawayModule {}
