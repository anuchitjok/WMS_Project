import { Module } from '@nestjs/common';
import { UnusedService } from './unused.service';
import { UnusedController } from './unused.controller';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [RealtimeModule],
  controllers: [UnusedController],
  providers: [UnusedService],
})
export class UnusedModule {}
