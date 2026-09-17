import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const USAGE_VALUES = ['USED', 'DOA', 'DEFECTIVE', 'WRONG_ITEM', 'UNUSED'] as const;

export class ConfirmUsageDto {
  @ApiProperty({ enum: USAGE_VALUES })
  @IsIn(USAGE_VALUES)
  usage: (typeof USAGE_VALUES)[number];

  @ApiPropertyOptional({ maxLength: 500 })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
