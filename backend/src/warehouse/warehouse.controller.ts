import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WarehouseService } from './warehouse.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RackType, SlotStatus, SlotType } from '@prisma/client';

@ApiTags('Warehouse')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @Get() findAll() { return this.warehouseService.findAll(); }
  @Get('products') findProducts() { return this.warehouseService.findProducts(); }
  @Get('brands') findBrands() { return this.warehouseService.findBrands(); }
  @Get('vendors') findVendors() { return this.warehouseService.findVendors(); }
  @Get('stats') @ApiOperation({ summary: 'KPI stats for warehouse layout' })
  getStats(@Query('warehouseId') warehouseId?: string) { return this.warehouseService.getStats(warehouseId); }
  @Get('slots/:id/detail') @ApiOperation({ summary: 'Slot detail with stock items' })
  getSlotDetail(@Param('id') id: string) { return this.warehouseService.getSlotDetail(id); }
  @Get(':id') findOne(@Param('id') id: string) { return this.warehouseService.findOne(id); }

  // ─── Rack ──────────────────────────────────────────────────────────────────

  @Post('racks')
  @ApiOperation({ summary: 'Create rack' })
  createRack(@Body() dto: { warehouseId: string; code: string; name?: string; zone?: string; rackType?: RackType; capacity?: number; levels?: number; columns?: number; description?: string }) {
    return this.warehouseService.createRack(dto);
  }

  @Patch('racks/:id')
  updateRack(@Param('id') id: string, @Body() dto: any) {
    return this.warehouseService.updateRack(id, dto);
  }

  @Delete('racks/:id')
  deleteRack(@Param('id') id: string) {
    return this.warehouseService.deleteRack(id);
  }

  // ─── Slot ──────────────────────────────────────────────────────────────────

  @Post('racks/:rackId/slots')
  @ApiOperation({ summary: 'Create single slot' })
  createSlot(@Param('rackId') rackId: string, @Body() dto: { code: string; name?: string; level?: number; column?: number; slotType?: SlotType; capacity?: number; maxWeight?: number }) {
    return this.warehouseService.createSlot(rackId, dto);
  }

  @Post('racks/:rackId/slots/bulk')
  @ApiOperation({ summary: 'Bulk generate slots for a rack' })
  bulkGenerateSlots(
    @Param('rackId') rackId: string,
    @Body() dto: { levels: number; columns: number; slotType?: SlotType; capacity?: number; maxWeight?: number; prefix?: string },
  ) {
    return this.warehouseService.bulkGenerateSlots(rackId, dto);
  }

  @Patch('slots/:id')
  updateSlot(@Param('id') id: string, @Body() dto: any) {
    return this.warehouseService.updateSlot(id, dto);
  }

  @Delete('slots/:id')
  deleteSlot(@Param('id') id: string) {
    return this.warehouseService.deleteSlot(id);
  }
}
