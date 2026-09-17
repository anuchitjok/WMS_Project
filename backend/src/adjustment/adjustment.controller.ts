import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AdjustmentService } from './adjustment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS } from '../auth/access';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';

@ApiTags('Stock Adjustment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('adjustment')
export class AdjustmentController {
  constructor(private readonly service: AdjustmentService) {}

  @Get()
  findAll(@Query('status') status?: string) {
    return this.service.findAll(status);
  }

  @Post()
  @Access(ACCESS.adjustment)
  create(@Body() dto: CreateAdjustmentDto, @CurrentUser('id') userId: string) {
    return this.service.create(dto, userId);
  }

  @Patch(':id/approve')
  @Access(ACCESS.adjustment)
  approve(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.service.approve(id, userId);
  }

  @Patch(':id/reject')
  @Access(ACCESS.adjustment)
  reject(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.service.reject(id, userId);
  }
}
