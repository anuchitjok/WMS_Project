import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ThaiAddressController } from './thai-address.controller';
import { ThaiAddressService } from './thai-address.service';

@Module({
  imports: [PrismaModule],
  controllers: [ThaiAddressController],
  providers: [ThaiAddressService],
  exports: [ThaiAddressService],
})
export class ThaiAddressModule {}
