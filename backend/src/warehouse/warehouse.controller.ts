import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WarehouseService } from './warehouse.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BulkSlotsDto, CreateRackDto, CreateSlotDto, UpdateRackDto, UpdateSlotDto } from './dto/rack-slot.dto';
import { UserRole } from '@prisma/client';

const MASTER_ROLES = [UserRole.SYSTEM_ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE_SUPERVISOR] as const;

// Rack and Slot writes used to carry NO @Roles at all, so any authenticated user
// — a REQUESTER, an AUDITOR, a viewer — could create or delete warehouse
// structure through this controller, while /warehouse-master guarded the very
// same tables. Two policies for one table is the bug; these constants close it.
//
// Structure (create/delete) matches warehouse-master exactly: master data.
const STRUCTURE_ROLES = [UserRole.SYSTEM_ADMIN, UserRole.WAREHOUSE_MANAGER] as const;
// Edits stay open to the floor roles, because the Operations Control Center uses
// PATCH slots/:id for the everyday block / unblock action. Restricting this to
// admins would break a working operational flow to fix a structural hole.
const OPS_ROLES = [
  UserRole.SYSTEM_ADMIN, UserRole.WAREHOUSE_MANAGER,
  UserRole.WAREHOUSE_SUPERVISOR, UserRole.WAREHOUSE_STAFF,
] as const;

@ApiTags('Warehouse')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  // Warehouse tree, narrowed to the caller's assigned warehouses (common/warehouse-scope.ts).
  @Get() findAll(@CurrentUser() user: any) { return this.warehouseService.findAll(user); }
  @Get('products') findProducts() { return this.warehouseService.findProducts(); }
  @Get('brands') findBrands() { return this.warehouseService.findBrands(); }
  @Get('vendors') findVendors() { return this.warehouseService.findVendors(); }

  // ─── Brand Master ────────────────────────────────────────────────────────────
  @Get('brands/managed') @ApiOperation({ summary: 'List all brands with product counts (master view)' })
  listBrandsManaged() { return this.warehouseService.listBrandsManaged(); }

  @Post('brands') @UseGuards(RolesGuard) @Roles(...MASTER_ROLES) @ApiOperation({ summary: 'Create brand' })
  createBrand(@Body() dto: { code?: string; name: string; contact?: string }, @CurrentUser('id') userId: string) { return this.warehouseService.createBrand(dto, userId); }

  @Patch('brands/:id') @UseGuards(RolesGuard) @Roles(...MASTER_ROLES) @ApiOperation({ summary: 'Update brand' })
  updateBrand(@Param('id') id: string, @Body() dto: any, @CurrentUser('id') userId: string) { return this.warehouseService.updateBrand(id, dto, userId); }

  @Delete('brands/:id') @UseGuards(RolesGuard) @Roles(...MASTER_ROLES) @ApiOperation({ summary: 'Deactivate brand' })
  deleteBrand(@Param('id') id: string, @CurrentUser('id') userId: string) { return this.warehouseService.deleteBrand(id, userId); }

  // ─── Vendor Master ─────────────────────────────────────────────────────────
  @Get('vendors/managed') @ApiOperation({ summary: 'List all vendors with RTV counts (master view)' })
  listVendorsManaged() { return this.warehouseService.listVendorsManaged(); }

  @Post('vendors') @UseGuards(RolesGuard) @Roles(...MASTER_ROLES) @ApiOperation({ summary: 'Create vendor' })
  createVendor(@Body() dto: { code: string; name: string; contact?: string; email?: string }, @CurrentUser('id') userId: string) { return this.warehouseService.createVendor(dto, userId); }

  @Patch('vendors/:id') @UseGuards(RolesGuard) @Roles(...MASTER_ROLES) @ApiOperation({ summary: 'Update vendor' })
  updateVendor(@Param('id') id: string, @Body() dto: any, @CurrentUser('id') userId: string) { return this.warehouseService.updateVendor(id, dto, userId); }

  @Delete('vendors/:id') @UseGuards(RolesGuard) @Roles(...MASTER_ROLES) @ApiOperation({ summary: 'Deactivate vendor' })
  deleteVendor(@Param('id') id: string, @CurrentUser('id') userId: string) { return this.warehouseService.deleteVendor(id, userId); }

  // ─── Phase 2: Per-brand inventory rollup ─────────────────────────────────────
  @Get('inventory-by-brand') @ApiOperation({ summary: 'Inventory rolled up per brand' })
  inventoryByBrand() { return this.warehouseService.inventoryByBrand(); }
  @Get('stats') @ApiOperation({ summary: 'KPI stats for warehouse layout' })
  getStats(@Query('warehouseId') warehouseId: string | undefined, @CurrentUser() user: any) { return this.warehouseService.getStats(warehouseId, user); }
  @Get('slots/:id/detail') @ApiOperation({ summary: 'Slot detail with stock items' })
  getSlotDetail(@Param('id') id: string, @CurrentUser() user: any) { return this.warehouseService.getSlotDetail(id, user); }
  // Read-only aggregate for the 3D view's Stock age mode. Same audience as the
  // warehouse tree: any signed-in user, limited to their assigned warehouses.
  @Get(':id/slot-stock-age') @ApiOperation({ summary: 'Oldest received date per occupied slot (3D stock age view)' })
  getSlotStockAge(@Param('id') id: string, @CurrentUser() user: any) { return this.warehouseService.getSlotStockAge(id, user); }
  @Get(':id') findOne(@Param('id') id: string, @CurrentUser() user: any) { return this.warehouseService.findOne(id, user); }

  // ─── Rack ──────────────────────────────────────────────────────────────────

  @Post('racks') @UseGuards(RolesGuard) @Roles(...STRUCTURE_ROLES)
  @ApiOperation({ summary: 'Create rack' })
  createRack(@Body() dto: CreateRackDto, @CurrentUser() user: any) {
    return this.warehouseService.createRack(dto, user.id, user);
  }

  @Patch('racks/:id') @UseGuards(RolesGuard) @Roles(...OPS_ROLES)
  updateRack(@Param('id') id: string, @Body() dto: UpdateRackDto, @CurrentUser() user: any) {
    return this.warehouseService.updateRack(id, dto, user.id, user);
  }

  @Delete('racks/:id') @UseGuards(RolesGuard) @Roles(...STRUCTURE_ROLES)
  deleteRack(@Param('id') id: string, @CurrentUser() user: any) {
    return this.warehouseService.deleteRack(id, user.id, user);
  }

  // ─── Slot ──────────────────────────────────────────────────────────────────

  @Post('racks/:rackId/slots') @UseGuards(RolesGuard) @Roles(...STRUCTURE_ROLES)
  @ApiOperation({ summary: 'Create single slot' })
  createSlot(@Param('rackId') rackId: string, @Body() dto: CreateSlotDto, @CurrentUser() user: any) {
    return this.warehouseService.createSlot(rackId, dto, user.id, user);
  }

  @Post('racks/:rackId/slots/bulk') @UseGuards(RolesGuard) @Roles(...STRUCTURE_ROLES)
  @ApiOperation({ summary: 'Bulk generate slots for a rack' })
  bulkGenerateSlots(
    @Param('rackId') rackId: string,
    @Body() dto: BulkSlotsDto,
    @CurrentUser() user: any,
  ) {
    return this.warehouseService.bulkGenerateSlots(rackId, dto, user);
  }

  @Patch('slots/:id') @UseGuards(RolesGuard) @Roles(...OPS_ROLES)
  updateSlot(@Param('id') id: string, @Body() dto: UpdateSlotDto, @CurrentUser() user: any) {
    return this.warehouseService.updateSlot(id, dto, user.id, user);
  }

  @Delete('slots/:id') @UseGuards(RolesGuard) @Roles(...STRUCTURE_ROLES)
  deleteSlot(@Param('id') id: string, @CurrentUser() user: any) {
    return this.warehouseService.deleteSlot(id, user.id, user);
  }
}
