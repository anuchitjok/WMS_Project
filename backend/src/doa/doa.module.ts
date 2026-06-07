import { Module } from '@nestjs/common';
import { DoaService } from './doa.service';
import { DoaController } from './doa.controller';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [RealtimeModule],
  controllers: [DoaController],
  providers: [DoaService],
})
export class DoaModule {}
