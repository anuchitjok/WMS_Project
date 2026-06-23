import { Type } from 'class-transformer';
import {
  IsArray, IsOptional, IsString, IsNotEmpty, IsNumber, Min,
  ValidateNested, ArrayMinSize, IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const INSPECTION_OUTCOMES = [
  'good',
  'doa',
  'damaged',
  'short_qty',
  'wrong_item',
  'missing_accessories',
] as const;

export type InspectionOutcome = typeof INSPECTION_OUTCOMES[number];

export class InspectItemDto {
  @ApiProperty({ description: 'GoodsReceivingItem id' })
  @IsString()
  @IsNotEmpty()
  itemId: string;

  @ApiProperty({ minimum: 0 })
  @IsNumber()
  @Min(0)
  inspectedQty: number;

  @ApiProperty({ enum: INSPECTION_OUTCOMES })
  @IsIn(INSPECTION_OUTCOMES)
  inspectionOutcome: InspectionOutcome;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  inspectorNotes?: string;

  @ApiPropertyOptional({ description: 'Override serial number if corrected during inspection' })
  @IsString()
  @IsOptional()
  serialNumber?: string;

  @ApiPropertyOptional({ description: 'Override batch number if corrected during inspection' })
  @IsString()
  @IsOptional()
  batchNumber?: string;
}

export class InspectReceivingDto {
  @ApiProperty({ type: [InspectItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InspectItemDto)
  items: InspectItemDto[];
}
