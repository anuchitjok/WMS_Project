import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DoaService } from './doa.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS } from '../auth/access';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('DOA')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('doa')
export class DoaController {
  constructor(private readonly service: DoaService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Access(ACCESS.doa)
  @Patch(':stockItemId/declare')
  declare(
    @Param('stockItemId') stockItemId: string,
    @Body('reason') reason: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.declare(stockItemId, reason ?? 'DOA declared', userId);
  }

  @Access(ACCESS.doa)
  @Post(':stockItemId/rtv')
  createRtv(
    @Param('stockItemId') stockItemId: string,
    @Body('vendorId') vendorId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.createRtv(stockItemId, vendorId, userId);
  }
}
