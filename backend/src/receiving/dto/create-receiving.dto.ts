import { Type } from 'class-transformer';
import {
  IsArray, IsOptional, IsString, IsNotEmpty, IsNumber, Min,
  ValidateNested, ArrayMinSize, IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OwnershipType } from '@prisma/client';

export class ReceivingItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  productId: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  serialNumber?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  batchNumber?: string;

  @ApiPropertyOptional({ description: 'ISO date — lot expiry (FEFO)' })
  @IsString()
  @IsOptional()
  expiryDate?: string;

  @ApiPropertyOptional({ description: 'ISO date — manufacture date' })
  @IsString()
  @IsOptional()
  manufactureDate?: string;

  @ApiProperty({ minimum: 1 })
  @IsNumber()
  @Min(1, { message: 'quantity must be at least 1' })
  quantity: number;

  @ApiPropertyOptional({ enum: ['good', 'damaged', 'doa'] })
  @IsString()
  @IsOptional()
  condition?: string;

  @ApiPropertyOptional({ enum: OwnershipType })
  @IsEnum(OwnershipType)
  @IsOptional()
  ownershipType?: OwnershipType;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  warehouseId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  rackId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  slotId?: string;
}

export class CreateReceivingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  sourceType: string;

  @ApiPropertyOptional({ description: 'RMA reference / case no. (free text, user-entered)' })
  @IsString()
  @IsOptional()
  sourceRef?: string;

  @ApiPropertyOptional({ description: 'Air waybill number' })
  @IsString()
  @IsOptional()
  awbNumber?: string;

  @ApiPropertyOptional({ description: 'Invoice number' })
  @IsString()
  @IsOptional()
  invoiceNumber?: string;

  @ApiPropertyOptional({ description: 'Purchase order reference' })
  @IsString()
  @IsOptional()
  poNumber?: string;

  @ApiPropertyOptional({ description: 'Supplier (Vendor) id' })
  @IsString()
  @IsOptional()
  supplierId?: string;

  @ApiPropertyOptional({ description: 'ISO date — expected receipt date' })
  @IsString()
  @IsOptional()
  expectedDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ type: [ReceivingItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'at least one item is required' })
  @ValidateNested({ each: true })
  @Type(() => ReceivingItemDto)
  items: ReceivingItemDto[];
}
