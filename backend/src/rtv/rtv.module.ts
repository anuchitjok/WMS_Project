import { Module } from '@nestjs/common';
import { RtvService } from './rtv.service';
import { RtvController } from './rtv.controller';
import { ReceivingModule } from '../receiving/receiving.module';

@Module({
  imports: [ReceivingModule],
  controllers: [RtvController],
  providers: [RtvService],
})
export class RtvModule {}
