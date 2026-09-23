import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { CreateStockItemDto } from './dto/create-stock-item.dto';
import { StockFilterDto } from './dto/stock-filter.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS } from '../auth/access';
import { LocationDto } from '../common/location.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { StockStatus } from '@prisma/client';

@ApiTags('Inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @ApiOperation({ summary: 'List all stock items with filters' })
  findAll(@Query() filter: StockFilterDto, @CurrentUser() user: any) {
    return this.inventoryService.findAll(filter, { roleKey: user?.roleKey, warehouseIds: user?.warehouseIds ?? [] });
  }

  @Get('kpi')
  @ApiOperation({ summary: 'Enterprise inventory KPI stats' })
  getKpi(@Query('warehouseId') warehouseId?: string) { return this.inventoryService.getKpi(warehouseId); }

  @Get('enterprise-list')
  @ApiOperation({ summary: 'Enterprise inventory list with traceability' })
  findEnterpriseList(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('brandId') brandId?: string,
    @Query('itemType') itemType?: string,
    @Query('serialOnly') serialOnly?: string,
    @Query('aging') aging?: string,
    @Query('aging365') aging365?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.inventoryService.findEnterpriseList({
      search, status: status as any, warehouseId, brandId, itemType,
      serialOnly: serialOnly === 'true', aging: aging === 'true', aging365: aging365 === 'true',
      page: page ? +page : 1, limit: limit ? +limit : 50,
    } as any);
  }

  @Get(':id/detail-full')
  @ApiOperation({ summary: 'Full stock item detail with audit, RTV, RMA' })
  getDetailFull(@Param('id') id: string) { return this.inventoryService.getItemDetailFull(id); }

  @Get('summary')
  @ApiOperation({ summary: 'Inventory summary by status' })
  getSummary() { return this.inventoryService.getSummary(); }

  @Get('barcode/:barcode')
  @ApiOperation({ summary: 'Lookup stock item by barcode / serial number' })
  findByBarcode(@Param('barcode') barcode: string) {
    return this.inventoryService.findByBarcode(barcode);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single stock item' })
  findOne(@Param('id') id: string) {
    return this.inventoryService.findOne(id);
  }

  @Post()
  @UseGuards(AccessGuard)
  @Access(ACCESS.stockCreate)
  @ApiOperation({ summary: 'Create stock item' })
  create(@Body() dto: CreateStockItemDto, @CurrentUser('id') userId: string) {
    return this.inventoryService.create(dto, userId);
  }

  @Patch(':id/status')
  @UseGuards(AccessGuard)
  @Access(ACCESS.stockStatus)
  @ApiOperation({ summary: 'Update stock item status' })
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: StockStatus,
    @CurrentUser('id') userId: string,
  ) {
    return this.inventoryService.updateStatus(id, status, userId);
  }

  @Patch(':id/release-reservation')
  @UseGuards(AccessGuard)
  @Access(ACCESS.reservationRelease)
  @ApiOperation({ summary: 'Release a reservation left behind by a finished request/task' })
  releaseStuckReservation(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.inventoryService.releaseStuckReservation(id, userId);
  }

  @Patch(':id/location')
  @UseGuards(AccessGuard)
  @Access(ACCESS.stockRelocate)
  @ApiOperation({ summary: 'Update stock item location' })
  updateLocation(
    @Param('id') id: string,
    @Body() location: LocationDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.inventoryService.updateLocation(id, location, userId);
  }
}
