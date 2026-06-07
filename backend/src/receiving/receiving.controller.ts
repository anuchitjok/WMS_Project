import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ReceivingService } from './receiving.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateReceivingDto } from './dto/create-receiving.dto';
import { UserRole } from '@prisma/client';

@ApiTags('Receiving')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('receiving')
export class ReceivingController {
  constructor(private readonly service: ReceivingService) {}

  @Get()
  findAll(@Query('status') status?: string) {
    return this.service.findAll(status);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE_SUPERVISOR, UserRole.WAREHOUSE_STAFF)
  create(@Body() dto: CreateReceivingDto, @CurrentUser('id') userId: string) {
    return this.service.create(dto, userId);
  }

  @Patch(':id/verify')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE_SUPERVISOR, UserRole.WAREHOUSE_STAFF)
  verify(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.service.verify(id, userId);
  }
}
