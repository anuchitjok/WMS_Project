import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { WarehouseLayoutService } from './warehouse-layout.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import type { LayoutScope } from './warehouse-layout.service';
import {
  CreateLayoutDto, UpdateLayoutCanvasDto, CreateLayoutObjectDto, UpdateLayoutObjectDto,
  BatchSaveDto, DuplicateObjectDto, LinkObjectDto,
} from './dto/layout.dto';

// Write access: SYSTEM_ADMIN + WAREHOUSE_MANAGER — identical to warehouse-master.
// Reads are open to any authenticated user, matching GET /warehouse-master.
const WRITE_ROLES = [UserRole.SYSTEM_ADMIN, UserRole.WAREHOUSE_MANAGER] as const;

// Sprint 7: every endpoint is scoped to the caller's assigned warehouses, using
// the same semantics as inventory.service (SUPER_ADMIN bypasses; no assignment
// means unrestricted). Resolving it here keeps the service free of req details.
const scopeOf = (user: any): LayoutScope => ({
  roleKey: user?.roleKey,
  warehouseIds: user?.warehouseIds ?? [],
});

@ApiTags('Warehouse Layout')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('warehouse-layout')
export class WarehouseLayoutController {
  constructor(private readonly service: WarehouseLayoutService) {}

  // ── Object routes first: literal "objects" must not be shadowed by :warehouseId ──

  @Patch('objects/:id') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Update a single layout object' })
  updateObject(@Param('id') id: string, @Body() dto: UpdateLayoutObjectDto, @CurrentUser('id') userId: string, @CurrentUser() user: any) {
    return this.service.updateObject(id, dto, userId, scopeOf(user));
  }

  @Patch('objects/:id/link') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Link a drawn object to a WMS Slot or Rack (same warehouse, type-compatible)' })
  linkObject(@Param('id') id: string, @Body() dto: LinkObjectDto, @CurrentUser('id') userId: string, @CurrentUser() user: any) {
    return this.service.linkObject(id, dto, userId, scopeOf(user));
  }

  @Delete('objects/:id/link') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Unlink an object. Never modifies the Slot or Rack itself.' })
  unlinkObject(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser() user: any) {
    return this.service.unlinkObject(id, userId, scopeOf(user));
  }

  @Post('objects/:id/generate-bins') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: "Draw one bin per active slot of this object's linked rack. Creates drawings only." })
  generateBins(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser() user: any) {
    return this.service.generateBinsFromRack(id, userId, scopeOf(user));
  }

  @Post('objects/:id/duplicate') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Duplicate an object (and optionally its subtree); copies never inherit a WMS link' })
  duplicateObject(@Param('id') id: string, @Body() dto: DuplicateObjectDto, @CurrentUser('id') userId: string, @CurrentUser() user: any) {
    return this.service.duplicateObject(id, dto, userId, scopeOf(user));
  }

  @Delete('objects/:id') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Soft-delete a layout object (refused if it has children unless cascade=true)' })
  @ApiQuery({ name: 'cascade', required: false, type: Boolean })
  deleteObject(@Param('id') id: string, @Query('cascade') cascade: string, @CurrentUser('id') userId: string, @CurrentUser() user: any) {
    return this.service.deleteObject(id, cascade === 'true', userId, scopeOf(user));
  }

  // ── Layout (canvas) ─────────────────────────────────────────────────────────

  @Get(':warehouseId/occupancy')
  @ApiOperation({ summary: 'Live per-bin rollup derived from StockItem. Reads only — never writes inventory.' })
  occupancy(@Param('warehouseId') warehouseId: string, @CurrentUser() user: any) {
    return this.service.occupancy(warehouseId, scopeOf(user));
  }

  @Get(':warehouseId')
  @ApiOperation({ summary: 'Layout canvas + flat object list for a warehouse (layout: null when none exists yet)' })
  getByWarehouse(@Param('warehouseId') warehouseId: string, @CurrentUser() user: any) {
    return this.service.getByWarehouse(warehouseId, scopeOf(user));
  }

  @Post(':warehouseId') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Create the layout for a warehouse' })
  createLayout(@Param('warehouseId') warehouseId: string, @Body() dto: CreateLayoutDto, @CurrentUser('id') userId: string, @CurrentUser() user: any) {
    return this.service.createLayout(warehouseId, dto, userId, scopeOf(user));
  }

  @Patch(':layoutId/canvas') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Update canvas settings (extent, grid, unit label, notes)' })
  updateCanvas(@Param('layoutId') layoutId: string, @Body() dto: UpdateLayoutCanvasDto, @CurrentUser('id') userId: string, @CurrentUser() user: any) {
    return this.service.updateCanvas(layoutId, dto, userId, scopeOf(user));
  }

  @Post(':layoutId/objects') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Create a layout object' })
  createObject(@Param('layoutId') layoutId: string, @Body() dto: CreateLayoutObjectDto, @CurrentUser('id') userId: string, @CurrentUser() user: any) {
    return this.service.createObject(layoutId, dto, userId, scopeOf(user));
  }

  @Patch(':layoutId/objects/batch') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Apply a whole editing flush in one transaction, guarded by the layout version' })
  batchSave(@Param('layoutId') layoutId: string, @Body() dto: BatchSaveDto, @CurrentUser('id') userId: string, @CurrentUser() user: any) {
    return this.service.batchSave(layoutId, dto, userId, scopeOf(user));
  }
}
