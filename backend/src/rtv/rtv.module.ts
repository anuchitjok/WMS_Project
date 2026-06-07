import { Module } from '@nestjs/common';
import { RtvService } from './rtv.service';
import { RtvController } from './rtv.controller';

@Module({
  controllers: [RtvController],
  providers: [RtvService],
})
export class RtvModule {}
