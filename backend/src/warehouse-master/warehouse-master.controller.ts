import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, HttpCode } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WarehouseMasterService } from './warehouse-master.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import {
  CreateWarehouseDto, UpdateWarehouseDto, CreateRackTypeDto, UpdateRackTypeDto, CreateRackDto, UpdateRackDto,
  CreateSlotDto, UpdateSlotDto, BulkUpdateSlotsDto, GenerateSlotsDto, SpaceSimulateDto,
} from './warehouse-master.dto';

// Plan P1 1.7 (legacy role enum, as the sidebar uses):
//  - Warehouse create/edit/activate/deactivate + Rack Type Master: SYSTEM_ADMIN only.
//  - Rack and Slot create/edit/delete/generate: SYSTEM_ADMIN + WAREHOUSE_MANAGER.
//  - Reads: any authenticated user (space reads are warehouse-scoped).
export const STRUCTURE_ADMIN_ROLES = [UserRole.SYSTEM_ADMIN] as const;
export const LAYOUT_WRITE_ROLES = [UserRole.SYSTEM_ADMIN, UserRole.WAREHOUSE_MANAGER] as const;

@ApiTags('Warehouse Master')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('warehouse-master')
export class WarehouseMasterController {
  constructor(private readonly service: WarehouseMasterService) {}

  // ── Reads (any authenticated user) ──────────────────────────────────────────
  @Get() @ApiOperation({ summary: 'Master warehouse tree (incl. inactive, excl. deleted)' })
  getTree() { return this.service.getTree(); }

  @Get('summary') getSummary() { return this.service.getSummary(); }

  @Get('space-summary') @ApiOperation({ summary: 'Area / footprint / slot / capacity figures per warehouse (warehouse-scoped)' })
  getSpaceSummary(@Query('warehouseId') warehouseId: string | undefined, @CurrentUser() user: any) {
    return this.service.getSpaceSummary(user, warehouseId || undefined);
  }

  @Get('space-summary/:warehouseId/racks') @ApiOperation({ summary: 'Per-rack storage space (slot share × rack area) for one warehouse (warehouse-scoped)' })
  getRackSpace(@Param('warehouseId') warehouseId: string, @CurrentUser() user: any) {
    return this.service.getRackSpace(user, warehouseId);
  }

  @Get('space-planner') @ApiOperation({ summary: 'How many more racks of a template fit in a warehouse' })
  getSpacePlanner(@Query('warehouseId') warehouseId: string, @Query('rackTypeId') rackTypeId: string, @CurrentUser() user: any) {
    return this.service.planCapacity(user, warehouseId, rackTypeId);
  }

  @Post('space-simulate') @HttpCode(200) @ApiOperation({ summary: 'Space simulator — read only, nothing is saved' })
  simulate(@Body() dto: SpaceSimulateDto, @CurrentUser() user: any) {
    return this.service.simulate(user, dto);
  }

  @Get('rack-types') @ApiOperation({ summary: 'Rack Type Master (templates)' })
  listRackTypes(@Query('includeInactive') includeInactive?: string) {
    return this.service.listRackTypes(includeInactive === 'true');
  }

  @Get(':entity/:id/impact') @ApiOperation({ summary: 'Dependency / impact check for delete & deactivate' })
  getImpact(@Param('entity') entity: 'warehouse' | 'rack' | 'slot', @Param('id') id: string) {
    return this.service.getImpact(entity, id);
  }

  // ── Warehouse (SYSTEM_ADMIN) ────────────────────────────────────────────────
  @Post('warehouses') @UseGuards(RolesGuard) @Roles(...STRUCTURE_ADMIN_ROLES)
  createWarehouse(@Body() dto: CreateWarehouseDto, @CurrentUser('id') userId: string) {
    return this.service.createWarehouse(dto, userId);
  }

  @Patch('warehouses/:id') @UseGuards(RolesGuard) @Roles(...STRUCTURE_ADMIN_ROLES)
  updateWarehouse(@Param('id') id: string, @Body() dto: UpdateWarehouseDto, @CurrentUser('id') userId: string) {
    return this.service.updateWarehouse(id, dto, userId);
  }

  @Patch('warehouses/:id/activate') @UseGuards(RolesGuard) @Roles(...STRUCTURE_ADMIN_ROLES)
  activate(@Param('id') id: string, @CurrentUser('id') userId: string) { return this.service.activateWarehouse(id, userId); }

  @Patch('warehouses/:id/deactivate') @UseGuards(RolesGuard) @Roles(...STRUCTURE_ADMIN_ROLES)
  deactivate(@Param('id') id: string, @CurrentUser('id') userId: string) { return this.service.deactivateWarehouse(id, userId); }

  // ── Rack Type Master (SYSTEM_ADMIN) ─────────────────────────────────────────
  @Post('rack-types') @UseGuards(RolesGuard) @Roles(...STRUCTURE_ADMIN_ROLES)
  createRackType(@Body() dto: CreateRackTypeDto, @CurrentUser('id') userId: string) {
    return this.service.createRackType(dto, userId);
  }

  @Patch('rack-types/:id') @UseGuards(RolesGuard) @Roles(...STRUCTURE_ADMIN_ROLES)
  updateRackType(@Param('id') id: string, @Body() dto: UpdateRackTypeDto, @CurrentUser('id') userId: string) {
    return this.service.updateRackType(id, dto, userId);
  }

  // ── Rack (SYSTEM_ADMIN + WAREHOUSE_MANAGER) ─────────────────────────────────
  @Post('racks') @UseGuards(RolesGuard) @Roles(...LAYOUT_WRITE_ROLES)
  createRack(@Body() dto: CreateRackDto, @CurrentUser('id') userId: string) {
    return this.service.createRack(dto, userId);
  }

  @Patch('racks/:id') @UseGuards(RolesGuard) @Roles(...LAYOUT_WRITE_ROLES)
  updateRack(@Param('id') id: string, @Body() dto: UpdateRackDto, @CurrentUser('id') userId: string) {
    return this.service.updateRack(id, dto, userId);
  }

  @Delete('racks/:id') @UseGuards(RolesGuard) @Roles(...LAYOUT_WRITE_ROLES)
  deleteRack(@Param('id') id: string, @CurrentUser('id') userId: string) { return this.service.deleteRack(id, userId); }

  @Post('racks/:id/generate-slots') @HttpCode(200) @UseGuards(RolesGuard) @Roles(...LAYOUT_WRITE_ROLES)
  @ApiOperation({ summary: 'Preview or create <Rack>-<LL>-<CC> slots; existing slots are skipped' })
  generateSlots(@Param('id') id: string, @Body() dto: GenerateSlotsDto, @CurrentUser('id') userId: string) {
    return this.service.generateSlots(id, dto, userId);
  }

  // ── Slot (SYSTEM_ADMIN + WAREHOUSE_MANAGER) ─────────────────────────────────
  @Post('slots') @UseGuards(RolesGuard) @Roles(...LAYOUT_WRITE_ROLES)
  createSlot(@Body() dto: CreateSlotDto, @CurrentUser('id') userId: string) {
    return this.service.createSlot(dto, userId);
  }

  // Declared before slots/:id so "bulk" is never read as an id.
  @Patch('slots/bulk') @UseGuards(RolesGuard) @Roles(...LAYOUT_WRITE_ROLES)
  bulkUpdateSlots(@Body() dto: BulkUpdateSlotsDto, @CurrentUser('id') userId: string) {
    return this.service.bulkUpdateSlots(dto.ids, dto.changes, userId);
  }

  @Patch('slots/:id') @UseGuards(RolesGuard) @Roles(...LAYOUT_WRITE_ROLES)
  updateSlot(@Param('id') id: string, @Body() dto: UpdateSlotDto, @CurrentUser('id') userId: string) {
    return this.service.updateSlot(id, dto, userId);
  }

  @Delete('slots/:id') @UseGuards(RolesGuard) @Roles(...LAYOUT_WRITE_ROLES)
  deleteSlot(@Param('id') id: string, @CurrentUser('id') userId: string) { return this.service.deleteSlot(id, userId); }
}
