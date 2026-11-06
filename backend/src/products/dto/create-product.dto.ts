import { IsString, IsOptional, IsNumber, IsBoolean, IsEnum, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductType, ProductStatus } from '@prisma/client';

export class CreateProductDto {
  @ApiPropertyOptional({ description: 'Internal code. When omitted it is generated from the SKU (partNumber).' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ description: 'Product name. When omitted the Description is used (Acumatica: Description is the name).' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  manufacturer?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  model?: string;

  @ApiPropertyOptional({ description: 'Globally unique part number' })
  @IsString()
  @IsOptional()
  partNumber?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  vendorPartNumber?: string;

  @ApiPropertyOptional({ enum: ProductType, default: 'SPARE_PART' })
  @IsEnum(ProductType)
  @IsOptional()
  productType?: ProductType;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  brandId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  unit?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  unitCost?: number;

  @ApiPropertyOptional({ description: 'If true, serial number mandatory on receiving' })
  @IsBoolean()
  @IsOptional()
  serialControlled?: boolean;

  @ApiPropertyOptional({ description: 'If true, batch/lot number mandatory on receiving' })
  @IsBoolean()
  @IsOptional()
  batchControlled?: boolean;

  @ApiPropertyOptional({ minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  minStock?: number;

  @ApiPropertyOptional({ enum: ProductStatus, default: 'ACTIVE' })
  @IsEnum(ProductStatus)
  @IsOptional()
  productStatus?: ProductStatus;

  @ApiPropertyOptional({ description: 'Part Type, free text (e.g. Panel, Mainboard)' })
  @IsString()
  @IsOptional()
  partType?: string;

  @ApiPropertyOptional({ minimum: 0, description: 'Default selling price' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  defaultPrice?: number | null;

  @ApiPropertyOptional({ minimum: 0, description: 'Box length (cm)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  lengthCm?: number | null;

  @ApiPropertyOptional({ minimum: 0, description: 'Box width (cm)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  widthCm?: number | null;

  @ApiPropertyOptional({ minimum: 0, description: 'Box height (cm)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  heightCm?: number | null;
}

export class UpdateProductDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  manufacturer?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  model?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  partNumber?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  vendorPartNumber?: string;

  @ApiPropertyOptional({ enum: ProductType })
  @IsEnum(ProductType)
  @IsOptional()
  productType?: ProductType;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  brandId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  unit?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  unitCost?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  serialControlled?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  batchControlled?: boolean;

  @ApiPropertyOptional({ minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  minStock?: number;

  @ApiPropertyOptional({ enum: ProductStatus })
  @IsEnum(ProductStatus)
  @IsOptional()
  productStatus?: ProductStatus;

  @ApiPropertyOptional({ description: 'Part Type, free text (e.g. Panel, Mainboard)' })
  @IsString()
  @IsOptional()
  partType?: string;

  @ApiPropertyOptional({ minimum: 0, description: 'Default selling price' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  defaultPrice?: number | null;

  @ApiPropertyOptional({ minimum: 0, description: 'Box length (cm)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  lengthCm?: number | null;

  @ApiPropertyOptional({ minimum: 0, description: 'Box width (cm)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  widthCm?: number | null;

  @ApiPropertyOptional({ minimum: 0, description: 'Box height (cm)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  heightCm?: number | null;
}

export class ChangeProductStatusDto {
  @ApiProperty({ enum: ProductStatus })
  @IsEnum(ProductStatus)
  productStatus: ProductStatus;
}
