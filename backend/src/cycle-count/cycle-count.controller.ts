import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CycleCountService } from './cycle-count.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS } from '../auth/access';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CycleCountStatus } from '@prisma/client';

@ApiTags('Cycle Count')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('cycle-count')
export class CycleCountController {
  constructor(private readonly svc: CycleCountService) {}

  @Get() findAll(@Query('warehouseId') wh: string | undefined, @Query('status') status: CycleCountStatus | undefined, @CurrentUser() user: any) {
    return this.svc.findAll(wh, status, user);
  }

  @Get('schedule')
  @ApiOperation({ summary: 'Cycle-count due / overdue per warehouse (from the cycleCount.frequency setting)' })
  schedule(@CurrentUser() user: any) { return this.svc.schedule(user); }

  @Get(':id') findOne(@Param('id') id: string, @CurrentUser() user: any) { return this.svc.findOne(id, user); }

  @Post()
  @Access(ACCESS.cycleCount)
  @ApiOperation({ summary: 'Create count session (locks the counted stock rows until approval / cancel)' })
  create(@Body() dto: any, @CurrentUser() user: any) { return this.svc.createSession(dto, user.id, user); }

  @Patch(':id/lines/:lineId/count')
  @Access(ACCESS.cycleCount)
  @ApiOperation({ summary: 'Submit count for one line' })
  countLine(@Param('id') id: string, @Param('lineId') lineId: string, @Body('countedQty') qty: number, @CurrentUser() user: any) {
    return this.svc.countLine(id, lineId, qty, user.id, user);
  }

  @Post(':id/submit')
  @Access(ACCESS.cycleCount)
  submitForReview(@Param('id') id: string, @CurrentUser() user: any) { return this.svc.submitForReview(id, user.id, user); }

  @Post(':id/approve')
  @Access(ACCESS.cycleCountApprove)
  @ApiOperation({ summary: 'Apply all variances, or refuse with 409 + conflicts if counted stock changed' })
  approve(@Param('id') id: string, @CurrentUser() user: any) { return this.svc.approve(id, user.id, user); }

  @Post(':id/recount-conflicts')
  @Access(ACCESS.cycleCountApprove)
  @ApiOperation({ summary: 'Reset conflicting lines for recount (excludes lines whose stock left AVAILABLE)' })
  recountConflicts(@Param('id') id: string, @CurrentUser() user: any) { return this.svc.recountConflicts(id, user.id, user); }

  @Post(':id/cancel')
  @Access(ACCESS.cycleCountApprove)
  cancel(@Param('id') id: string, @CurrentUser() user: any) { return this.svc.cancel(id, user.id, user); }
}
