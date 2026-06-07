// shipment.controller.ts — Read-only shipment tracker.
// Packing and dispatch endpoints have moved to /fulfillment.
// Use /fulfillment/:id/packing/* and /fulfillment/shipments/:id/dispatch instead.
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ShipmentService } from './shipment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Shipments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('shipments')
export class ShipmentController {
  constructor(private readonly svc: ShipmentService) {}

  @Get()
  @ApiOperation({ summary: 'List all shipments (read-only tracker)' })
  findAll(@Query('status') status?: string) {
    return this.svc.findAll(status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get shipment detail with task and timeline' })
  findOne(@Param('id') id: string) {
    return this.svc.findShipment(id);
  }

  @Get('track/:trackingNumber')
  @ApiOperation({ summary: 'Find shipment by carrier tracking number' })
  findByTracking(@Param('trackingNumber') trackingNumber: string) {
    return this.svc.findByTrackingNumber(trackingNumber);
  }
}
