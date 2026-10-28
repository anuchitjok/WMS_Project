import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ScrapService } from './scrap.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS } from '../auth/access';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ScrapStatus } from '@prisma/client';

@ApiTags('Scrap')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('scrap')
export class ScrapController {
  constructor(private readonly scrap: ScrapService) {}

  @Get()
  @ApiOperation({ summary: 'List scrap cases' })
  findAll(
    @Query('status') status?: ScrapStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @CurrentUser() user?: any,
  ) {
    return this.scrap.findAll({ status, page: page ? +page : 1, limit: limit ? +limit : 20 }, user);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.scrap.findOne(id);
  }

  @Post()
  @Access(ACCESS.scrap)
  @ApiOperation({ summary: 'Create scrap case' })
  create(
    @Body() body: { stockItemId: string; reason?: string; reasonCode?: string; description?: string; disposalMethod?: string; quantity?: number },
    @CurrentUser() user: any,
  ) {
    return this.scrap.create(body, user.id, user);
  }

  @Patch(':id/status')
  @Access(ACCESS.scrap)
  @ApiOperation({ summary: 'Advance scrap case status' })
  updateStatus(@Param('id') id: string, @Body('status') status: ScrapStatus, @CurrentUser() user: any) {
    return this.scrap.updateStatus(id, status, user.id, user);
  }
}
