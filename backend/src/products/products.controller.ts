import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UseGuards, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import type { Response } from 'express';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateProductDto, UpdateProductDto } from './dto/create-product.dto';
import { UserRole, ProductType } from '@prisma/client';

@ApiTags('Product Master')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  // ─── Product Master ────────────────────────────────────────────────────────

  @Get()
  findAll(@Query('search') search?: string, @Query('productType') productType?: ProductType) {
    return this.service.findAll(search, productType);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE_SUPERVISOR)
  create(@Body() dto: CreateProductDto, @CurrentUser('id') userId: string) {
    return this.service.create(dto, userId);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE_SUPERVISOR)
  update(@Param('id') id: string, @Body() dto: UpdateProductDto, @CurrentUser('id') userId: string) {
    return this.service.update(id, dto, userId);
  }

  // ─── KPI & Enterprise ─────────────────────────────────────────────────────

  @Get('kpi')
  @ApiOperation({ summary: 'Product master KPI stats' })
  getKpi() { return this.service.getKpi(); }

  @Get('enterprise-list')
  @ApiOperation({ summary: 'Enterprise product list with inventory context' })
  getEnterpriseList(
    @Query('search') search?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('brandId') brandId?: string,
    @Query('productType') productType?: string,
    @Query('stockStatus') stockStatus?: string,
    @Query('serialOnly') serialOnly?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getEnterpriseList({
      search, warehouseId, brandId, productType, stockStatus,
      serialOnly: serialOnly === 'true',
      page: page ? +page : 1,
      limit: limit ? +limit : 50,
    });
  }

  @Get(':id/detail-full')
  @ApiOperation({ summary: 'Full product detail with inventory, serials, audit' })
  getDetailFull(@Param('id') id: string) { return this.service.getDetailFull(id); }

  // ─── Stock Register ────────────────────────────────────────────────────────

  @Get('stock-register/list')
  @ApiOperation({ summary: 'Stock register — joined StockItem + GoodsReceiving + Product' })
  stockRegister(
    @Query('search') search?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('brandId') brandId?: string,
    @Query('productType') productType?: string,
  ) {
    return this.service.stockRegister({ search, warehouseId, brandId, productType });
  }

  @Get('stock-register/export')
  @ApiOperation({ summary: 'Export stock register as xlsx or csv' })
  async exportStockRegister(
    @Query('format') format: 'xlsx' | 'csv' = 'xlsx',
    @Query('search') search?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('brandId') brandId?: string,
    @Query('productType') productType?: string,
    @Res() res?: Response,
  ) {
    const result = await this.service.exportStockRegister(format, { search, warehouseId, brandId, productType });
    res!.set({ 'Content-Type': result.mimeType, 'Content-Disposition': `attachment; filename="${result.filename}"` });
    res!.send(result.buffer);
  }

  @Get('stock-register/template')
  @ApiOperation({ summary: 'Download import template xlsx' })
  async downloadTemplate(@Res() res: Response) {
    const buffer = await this.service.downloadTemplate();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="stock-register-import-template.xlsx"',
    });
    res.send(buffer);
  }

  @Post('stock-register/import')
  @ApiOperation({ summary: 'Batch import products from xlsx or csv' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async importProducts(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
  ) {
    if (!file) throw new Error('No file uploaded');
    return this.service.importProducts(file.buffer, file.mimetype, userId);
  }
}
