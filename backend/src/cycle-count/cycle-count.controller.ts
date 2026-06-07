import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CycleCountService } from './cycle-count.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CycleCountStatus } from '@prisma/client';

@ApiTags('Cycle Count')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cycle-count')
export class CycleCountController {
  constructor(private readonly svc: CycleCountService) {}

  @Get() findAll(@Query('warehouseId') wh?: string, @Query('status') status?: CycleCountStatus) { return this.svc.findAll(wh, status); }
  @Get(':id') findOne(@Param('id') id: string) { return this.svc.findOne(id); }

  @Post()
  @ApiOperation({ summary: 'Create count session (freezes location state)' })
  create(@Body() dto: any, @CurrentUser('id') userId: string) { return this.svc.createSession(dto, userId); }

  @Patch(':id/lines/:lineId/count')
  @ApiOperation({ summary: 'Submit count for one line' })
  countLine(@Param('id') id: string, @Param('lineId') lineId: string, @Body('countedQty') qty: number, @CurrentUser('id') userId: string) {
    return this.svc.countLine(id, lineId, qty, userId);
  }

  @Post(':id/submit')
  submitForReview(@Param('id') id: string, @CurrentUser('id') userId: string) { return this.svc.submitForReview(id, userId); }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser('id') userId: string) { return this.svc.approve(id, userId); }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser('id') userId: string) { return this.svc.cancel(id, userId); }
}
