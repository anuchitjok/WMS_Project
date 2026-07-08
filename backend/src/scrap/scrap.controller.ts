import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ScrapService } from './scrap.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ScrapStatus } from '@prisma/client';

@ApiTags('Scrap')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('scrap')
export class ScrapController {
  constructor(private readonly scrap: ScrapService) {}

  @Get()
  @ApiOperation({ summary: 'List scrap cases' })
  findAll(
    @Query('status') status?: ScrapStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.scrap.findAll({ status, page: page ? +page : 1, limit: limit ? +limit : 20 });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.scrap.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create scrap case' })
  create(
    @Body() body: { stockItemId: string; reason: string; description?: string; disposalMethod?: string; quantity?: number },
    @CurrentUser('id') userId: string,
  ) {
    return this.scrap.create(body, userId);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Advance scrap case status' })
  updateStatus(@Param('id') id: string, @Body('status') status: ScrapStatus, @CurrentUser('id') userId: string) {
    return this.scrap.updateStatus(id, status, userId);
  }
}
