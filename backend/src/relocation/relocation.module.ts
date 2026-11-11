import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { RelocationController } from './relocation.controller';
import { RelocationService } from './relocation.service';

@Module({
  imports: [RealtimeModule],
  controllers: [RelocationController],
  providers: [RelocationService],
})
export class RelocationModule {}
