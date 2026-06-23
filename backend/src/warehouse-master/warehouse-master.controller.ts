import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WarehouseMasterService } from './warehouse-master.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RackType, SlotType, UserRole } from '@prisma/client';

// Write access: SYSTEM_ADMIN + WAREHOUSE_MANAGER. All other roles are read-only.
const WRITE_ROLES = [UserRole.SYSTEM_ADMIN, UserRole.WAREHOUSE_MANAGER] as const;

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

  @Get(':entity/:id/impact') @ApiOperation({ summary: 'Dependency / impact check for delete & deactivate' })
  getImpact(@Param('entity') entity: 'warehouse' | 'rack' | 'slot', @Param('id') id: string) {
    return this.service.getImpact(entity, id);
  }

  // ── Warehouse (write — RBAC enforced) ───────────────────────────────────────
  @Post('warehouses') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createWarehouse(@Body() dto: { code: string; name: string; location?: string }, @CurrentUser('id') userId: string) {
    return this.service.createWarehouse(dto, userId);
  }

  @Patch('warehouses/:id') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateWarehouse(@Param('id') id: string, @Body() dto: { name?: string; location?: string }, @CurrentUser('id') userId: string) {
    return this.service.updateWarehouse(id, dto, userId);
  }

  @Patch('warehouses/:id/activate') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  activate(@Param('id') id: string, @CurrentUser('id') userId: string) { return this.service.activateWarehouse(id, userId); }

  @Patch('warehouses/:id/deactivate') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deactivate(@Param('id') id: string, @CurrentUser('id') userId: string) { return this.service.deactivateWarehouse(id, userId); }

  // ── Rack (write — RBAC enforced) ────────────────────────────────────────────
  @Post('racks') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createRack(@Body() dto: { warehouseId: string; code: string; name?: string; zone?: string; rackType?: RackType; capacity?: number; levels?: number; columns?: number; description?: string }, @CurrentUser('id') userId: string) {
    return this.service.createRack(dto, userId);
  }

  @Patch('racks/:id') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateRack(@Param('id') id: string, @Body() dto: any, @CurrentUser('id') userId: string) {
    return this.service.updateRack(id, dto, userId);
  }

  @Delete('racks/:id') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deleteRack(@Param('id') id: string, @CurrentUser('id') userId: string) { return this.service.deleteRack(id, userId); }

  // ── Slot (write — RBAC enforced) ────────────────────────────────────────────
  @Post('slots') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createSlot(@Body() dto: { rackId: string; code: string; name?: string; level?: number; column?: number; slotType?: SlotType; capacity?: number; maxWeight?: number }, @CurrentUser('id') userId: string) {
    return this.service.createSlot(dto, userId);
  }

  @Patch('slots/:id') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateSlot(@Param('id') id: string, @Body() dto: any, @CurrentUser('id') userId: string) {
    return this.service.updateSlot(id, dto, userId);
  }

  @Delete('slots/:id') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deleteSlot(@Param('id') id: string, @CurrentUser('id') userId: string) { return this.service.deleteSlot(id, userId); }
}
