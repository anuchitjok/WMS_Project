import { IsString, IsNotEmpty, IsOptional, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAdjustmentDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  stockItemId?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'productLabel is required' })
  productLabel: string;

  @ApiProperty()
  @IsString()
  @IsOptional()
  reason?: string;

  /** Managed reason code (category ADJUSTMENT). Required once codes are configured. */
  @IsString()
  @IsOptional()
  reasonCode?: string;

  @ApiProperty({ minimum: 0 })
  @IsNumber()
  @Min(0)
  quantityBefore: number;

  @ApiProperty({ minimum: 0 })
  @IsNumber()
  @Min(0)
  quantityAfter: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;
}
