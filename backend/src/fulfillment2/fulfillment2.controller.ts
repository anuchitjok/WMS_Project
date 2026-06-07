// fulfillment2.controller.ts — Backward-compatibility controller.
// Exposes the legacy /fulfillment2 routes, delegating to the unified service.
//
// @deprecated TODO_REMOVE_AFTER_MIGRATION — remove once clients use /fulfillment.
import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Fulfillment2Service } from './fulfillment2.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FulfillmentStatus } from '@prisma/client';

@ApiTags('Fulfillment v2')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fulfillment2')
export class Fulfillment2Controller {
  constructor(private readonly svc: Fulfillment2Service) {}

  @Get('board')
  @ApiOperation({ summary: 'Real-time Kanban board grouped by lane' })
  board(@Query('warehouseId') warehouseId?: string, @CurrentUser() user?: any) {
    const wh = user?.roleKey !== 'SUPER_ADMIN' && (user?.warehouseIds?.length ?? 0) === 1
      ? user.warehouseIds[0]
      : warehouseId;
    return this.svc.board(wh);
  }

  @Get()
  findAll(@Query('status') status?: FulfillmentStatus, @Query('warehouseId') warehouseId?: string) {
    return this.svc.findAll(status, warehouseId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.svc.findOne(id); }

  @Post('allocate/:requestId')
  @ApiOperation({ summary: 'Allocate a FulfillmentTask from an approved request (FIFO)' })
  allocate(@Param('requestId') requestId: string, @CurrentUser('id') userId: string) {
    return this.svc.allocate(requestId, userId);
  }

  @Patch(':id/advance')
  @ApiOperation({ summary: 'Advance status one step in the pipeline' })
  advance(
    @Param('id') id: string,
    @Body() body: { notes?: string; barcode?: string; deviceId?: string },
    @CurrentUser('id') userId: string,
  ) { return this.svc.advance(id, userId, body); }

  @Patch(':id/items/:itemId/pick')
  @ApiOperation({ summary: 'Confirm pick for one item (double-pick prevention)' })
  confirmPick(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { qty: number; barcode?: string },
    @CurrentUser('id') userId: string,
  ) { return this.svc.confirmPick(id, itemId, body.qty ?? 1, userId, body.barcode); }

  @Patch(':id/exception')
  @ApiOperation({ summary: 'Set exception status (SHORT_PICK/DAMAGED/HOLD/CANCELLED)' })
  setException(
    @Param('id') id: string,
    @Body() body: { status: FulfillmentStatus; reason?: string },
    @CurrentUser('id') userId: string,
  ) { return this.svc.setException(id, body.status, userId, body.reason); }
}
