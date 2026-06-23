import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WarehouseService } from './warehouse.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RackType, SlotStatus, SlotType, UserRole } from '@prisma/client';

const MASTER_ROLES = [UserRole.SYSTEM_ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE_SUPERVISOR] as const;

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

  // ─── Brand Master ────────────────────────────────────────────────────────────
  @Get('brands/managed') @ApiOperation({ summary: 'List all brands with product counts (master view)' })
  listBrandsManaged() { return this.warehouseService.listBrandsManaged(); }

  @Post('brands') @UseGuards(RolesGuard) @Roles(...MASTER_ROLES) @ApiOperation({ summary: 'Create brand' })
  createBrand(@Body() dto: { code?: string; name: string; contact?: string }) { return this.warehouseService.createBrand(dto); }

  @Patch('brands/:id') @UseGuards(RolesGuard) @Roles(...MASTER_ROLES) @ApiOperation({ summary: 'Update brand' })
  updateBrand(@Param('id') id: string, @Body() dto: any) { return this.warehouseService.updateBrand(id, dto); }

  @Delete('brands/:id') @UseGuards(RolesGuard) @Roles(...MASTER_ROLES) @ApiOperation({ summary: 'Deactivate brand' })
  deleteBrand(@Param('id') id: string) { return this.warehouseService.deleteBrand(id); }

  // ─── Vendor Master ─────────────────────────────────────────────────────────
  @Get('vendors/managed') @ApiOperation({ summary: 'List all vendors with RTV counts (master view)' })
  listVendorsManaged() { return this.warehouseService.listVendorsManaged(); }

  @Post('vendors') @UseGuards(RolesGuard) @Roles(...MASTER_ROLES) @ApiOperation({ summary: 'Create vendor' })
  createVendor(@Body() dto: { code: string; name: string; contact?: string; email?: string }) { return this.warehouseService.createVendor(dto); }

  @Patch('vendors/:id') @UseGuards(RolesGuard) @Roles(...MASTER_ROLES) @ApiOperation({ summary: 'Update vendor' })
  updateVendor(@Param('id') id: string, @Body() dto: any) { return this.warehouseService.updateVendor(id, dto); }

  @Delete('vendors/:id') @UseGuards(RolesGuard) @Roles(...MASTER_ROLES) @ApiOperation({ summary: 'Deactivate vendor' })
  deleteVendor(@Param('id') id: string) { return this.warehouseService.deleteVendor(id); }

  // ─── Phase 2: Per-brand inventory rollup ─────────────────────────────────────
  @Get('inventory-by-brand') @ApiOperation({ summary: 'Inventory rolled up per brand' })
  inventoryByBrand() { return this.warehouseService.inventoryByBrand(); }
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
