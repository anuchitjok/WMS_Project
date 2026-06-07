import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { RtvService } from './rtv.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole, RTVStatus } from '@prisma/client';

@ApiTags('RTV')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SYSTEM_ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.RTV_OFFICER)
@Controller('rtv')
export class RtvController {
  constructor(private readonly rtvService: RtvService) {}

  @Get()
  findAll(@Query('status') status?: RTVStatus, @Query('page') page?: number, @Query('limit') limit?: number) {
    return this.rtvService.findAll({ status, page, limit });
  }

  @Get(':id') findOne(@Param('id') id: string) { return this.rtvService.findOne(id); }

  @Post()
  create(
    @Body() body: { stockItemId: string; reason: string; description?: string; vendorId?: string },
    @CurrentUser('id') userId: string,
  ) {
    return this.rtvService.create(body, userId);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: RTVStatus) {
    return this.rtvService.updateStatus(id, status);
  }
}
