import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DoaService } from './doa.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('DOA')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('doa')
export class DoaController {
  constructor(private readonly service: DoaService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Patch(':stockItemId/declare')
  declare(
    @Param('stockItemId') stockItemId: string,
    @Body('reason') reason: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.declare(stockItemId, reason ?? 'DOA declared', userId);
  }

  @Post(':stockItemId/rtv')
  createRtv(
    @Param('stockItemId') stockItemId: string,
    @Body('vendorId') vendorId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.createRtv(stockItemId, vendorId, userId);
  }
}
