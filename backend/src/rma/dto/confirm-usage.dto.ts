import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const USAGE_VALUES = ['USED', 'DOA', 'DEFECTIVE', 'WRONG_ITEM', 'UNUSED'] as const;
export type UsageValue = (typeof USAGE_VALUES)[number];

export class UnitUsageDto {
  @ApiProperty() @IsString() @MaxLength(64)
  stockItemId: string;

  @ApiProperty({ enum: USAGE_VALUES }) @IsIn(USAGE_VALUES)
  usage: UsageValue;

  @ApiPropertyOptional({ maxLength: 500 }) @IsString() @IsOptional() @MaxLength(500)
  notes?: string;
}

/**
 * Either `usage` for every issued unit not yet recorded (whole request, as
 * before), or `units` to record some units only — e.g. 3 used, 2 returned.
 */
export class ConfirmUsageDto {
  @ApiPropertyOptional({ enum: USAGE_VALUES })
  @IsIn(USAGE_VALUES)
  @IsOptional()
  usage?: UsageValue;

  @ApiPropertyOptional({ type: [UnitUsageDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => UnitUsageDto)
  @IsOptional()
  units?: UnitUsageDto[];

  @ApiPropertyOptional({ maxLength: 500 })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
