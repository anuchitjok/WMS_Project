import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FulfillmentStatus } from '@prisma/client';

import { FulfillmentService }  from './fulfillment.service';
import { AllocationService }   from './services/allocation.service';
import { PickingService }      from './services/picking.service';
import { PackingService }      from './services/packing.service';
import { DispatchService }     from './services/dispatch.service';
import { HandoverService }     from './services/handover.service';

@ApiTags('Fulfillment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fulfillment')
export class FulfillmentController {
  constructor(
    private readonly svc:       FulfillmentService,
    private readonly allocation: AllocationService,
    private readonly picking:    PickingService,
    private readonly packing:    PackingService,
    private readonly dispatch:   DispatchService,
    private readonly handover:   HandoverService,
  ) {}

  // ── BOARD & VISIBILITY ──────────────────────────────────────────────────────

  @Get('board')
  @ApiOperation({ summary: 'Real-time Kanban board grouped by lane' })
  board(@Query('warehouseId') warehouseId?: string, @CurrentUser() user?: any) {
    const wh =
      user?.roleKey !== 'SUPER_ADMIN' && (user?.warehouseIds?.length ?? 0) === 1
        ? user.warehouseIds[0]
        : warehouseId;
    return this.svc.board(wh);
  }

  @Get()
  @ApiOperation({ summary: 'List fulfillment tasks' })
  findAll(
    @Query('status') status?: FulfillmentStatus,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.svc.findAll(status, warehouseId);
  }

  @Get('handover-queue')
  @ApiOperation({ summary: 'Tasks ready for handover / RMA' })
  handoverQueue(@Query('warehouseId') warehouseId?: string) {
    return this.handover.getHandoverQueue(warehouseId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single fulfillment task with full detail' })
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  // ── ORCHESTRATION ───────────────────────────────────────────────────────────

  @Post('allocate/:requestId')
  @ApiOperation({ summary: 'Allocate FulfillmentTask from approved request (FIFO + stock reservation)' })
  allocate(
    @Param('requestId') requestId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.allocation.allocate(requestId, userId);
  }

  @Patch(':id/advance')
  @ApiOperation({ summary: 'Advance status one step in the pipeline' })
  advance(
    @Param('id') id: string,
    @Body() body: { notes?: string; barcode?: string; deviceId?: string },
    @CurrentUser('id') userId: string,
  ) {
    return this.svc.advance(id, userId, body);
  }

  @Patch(':id/exception')
  @ApiOperation({ summary: 'Set exception status (SHORT_PICK / DAMAGED / HOLD / CANCELLED)' })
  setException(
    @Param('id') id: string,
    @Body() body: { status: FulfillmentStatus; reason?: string },
    @CurrentUser('id') userId: string,
  ) {
    return this.svc.setException(id, body.status, userId, body.reason);
  }

  // ── PICKING EXECUTION ───────────────────────────────────────────────────────

  @Patch(':id/items/:itemId/pick')
  @ApiOperation({ summary: 'Confirm pick for one item (double-pick prevention + inventory transaction)' })
  confirmPick(
    @Param('id') taskId: string,
    @Param('itemId') itemId: string,
    @Body() body: { qty: number; barcode?: string },
    @CurrentUser('id') userId: string,
  ) {
    return this.picking.confirmPick(taskId, itemId, body.qty ?? 1, userId, body.barcode);
  }

  // ── PACKING EXECUTION ───────────────────────────────────────────────────────

  @Post(':id/packing/start')
  @ApiOperation({ summary: 'Start packing session' })
  startPacking(@Param('id') taskId: string, @CurrentUser('id') userId: string) {
    return this.packing.startPacking(taskId, userId);
  }

  @Patch(':id/packing')
  @ApiOperation({ summary: 'Update packing session (cartons, weight, notes)' })
  updatePacking(
    @Param('id') taskId: string,
    @Body() dto: { cartonCount?: number; totalWeight?: number; notes?: string },
    @CurrentUser('id') userId: string,
  ) {
    return this.packing.updatePacking(taskId, dto, userId);
  }

  @Post(':id/packing/complete')
  @ApiOperation({ summary: 'Complete packing → status PACKED' })
  completePacking(@Param('id') taskId: string, @CurrentUser('id') userId: string) {
    return this.packing.completePacking(taskId, userId);
  }

  // ── DISPATCH (GOODS ISSUE) ──────────────────────────────────────────────────

  @Post(':id/shipment')
  @ApiOperation({ summary: 'Create shipment for a PACKED task' })
  createShipment(
    @Param('id') taskId: string,
    @Body() dto: { carrier?: string; trackingNumber?: string; receiverName?: string; notes?: string },
    @CurrentUser('id') userId: string,
  ) {
    return this.dispatch.createShipment(taskId, dto, userId);
  }

  @Post('shipments/:shipmentId/dispatch')
  @ApiOperation({ summary: 'Confirm dispatch — triggers Goods Issue (stock deduction)' })
  confirmDispatch(
    @Param('shipmentId') shipmentId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.dispatch.confirmDispatch(shipmentId, userId);
  }

  // ── HANDOVER & DELIVERY ─────────────────────────────────────────────────────

  @Post('shipments/:shipmentId/deliver')
  @ApiOperation({ summary: 'Confirm delivery with optional POD reference' })
  confirmDelivery(
    @Param('shipmentId') shipmentId: string,
    @Body() dto: { receiverName?: string; podReference?: string; notes?: string },
    @CurrentUser('id') userId: string,
  ) {
    return this.handover.confirmDelivery(shipmentId, dto, userId);
  }

  @Post(':id/handover/rma')
  @ApiOperation({ summary: 'Issue to RMA — confirms physical handover to requester' })
  issueToRma(
    @Param('id') taskId: string,
    @Body() body: { receiver: string; rmaId?: string },
    @CurrentUser('id') userId: string,
  ) {
    return this.handover.issueToRma(taskId, body, userId);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel task and release stock reservations' })
  cancel(
    @Param('id') taskId: string,
    @Body() body: { reason?: string },
    @CurrentUser('id') userId: string,
  ) {
    return this.handover.releaseAndCancel(taskId, userId, body.reason);
  }
}
