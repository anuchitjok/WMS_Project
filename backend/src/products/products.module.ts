import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';

@Module({
  imports: [MulterModule.register({ storage: undefined })], // memory storage for import
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
