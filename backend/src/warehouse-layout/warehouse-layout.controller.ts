import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { WarehouseLayoutService } from './warehouse-layout.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import {
  CreateLayoutDto, UpdateLayoutCanvasDto, CreateLayoutObjectDto, UpdateLayoutObjectDto,
  BatchSaveDto, DuplicateObjectDto,
} from './dto/layout.dto';

// Write access: SYSTEM_ADMIN + WAREHOUSE_MANAGER — identical to warehouse-master.
// Reads are open to any authenticated user, matching GET /warehouse-master.
const WRITE_ROLES = [UserRole.SYSTEM_ADMIN, UserRole.WAREHOUSE_MANAGER] as const;

@ApiTags('Warehouse Layout')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('warehouse-layout')
export class WarehouseLayoutController {
  constructor(private readonly service: WarehouseLayoutService) {}

  // ── Object routes first: literal "objects" must not be shadowed by :warehouseId ──

  @Patch('objects/:id') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Update a single layout object' })
  updateObject(@Param('id') id: string, @Body() dto: UpdateLayoutObjectDto, @CurrentUser('id') userId: string) {
    return this.service.updateObject(id, dto, userId);
  }

  @Post('objects/:id/duplicate') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Duplicate an object (and optionally its subtree); copies never inherit a WMS link' })
  duplicateObject(@Param('id') id: string, @Body() dto: DuplicateObjectDto, @CurrentUser('id') userId: string) {
    return this.service.duplicateObject(id, dto, userId);
  }

  @Delete('objects/:id') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Soft-delete a layout object (refused if it has children unless cascade=true)' })
  @ApiQuery({ name: 'cascade', required: false, type: Boolean })
  deleteObject(@Param('id') id: string, @Query('cascade') cascade: string, @CurrentUser('id') userId: string) {
    return this.service.deleteObject(id, cascade === 'true', userId);
  }

  // ── Layout (canvas) ─────────────────────────────────────────────────────────

  @Get(':warehouseId')
  @ApiOperation({ summary: 'Layout canvas + flat object list for a warehouse (layout: null when none exists yet)' })
  getByWarehouse(@Param('warehouseId') warehouseId: string) {
    return this.service.getByWarehouse(warehouseId);
  }

  @Post(':warehouseId') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Create the layout for a warehouse' })
  createLayout(@Param('warehouseId') warehouseId: string, @Body() dto: CreateLayoutDto, @CurrentUser('id') userId: string) {
    return this.service.createLayout(warehouseId, dto, userId);
  }

  @Patch(':layoutId/canvas') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Update canvas settings (extent, grid, unit label, notes)' })
  updateCanvas(@Param('layoutId') layoutId: string, @Body() dto: UpdateLayoutCanvasDto, @CurrentUser('id') userId: string) {
    return this.service.updateCanvas(layoutId, dto, userId);
  }

  @Post(':layoutId/objects') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Create a layout object' })
  createObject(@Param('layoutId') layoutId: string, @Body() dto: CreateLayoutObjectDto, @CurrentUser('id') userId: string) {
    return this.service.createObject(layoutId, dto, userId);
  }

  @Patch(':layoutId/objects/batch') @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Apply a whole editing flush in one transaction, guarded by the layout version' })
  batchSave(@Param('layoutId') layoutId: string, @Body() dto: BatchSaveDto, @CurrentUser('id') userId: string) {
    return this.service.batchSave(layoutId, dto, userId);
  }
}
