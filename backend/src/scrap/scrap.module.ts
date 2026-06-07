import { Module } from '@nestjs/common';
import { ScrapService } from './scrap.service';
import { ScrapController } from './scrap.controller';

@Module({
  controllers: [ScrapController],
  providers: [ScrapService],
})
export class ScrapModule {}
