import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsNumber, IsOptional, IsPositive, IsString, MaxLength, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** PR6: one stock row the approver chose for a request line. */
export class PickDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  itemId: string;

  @ApiProperty()
  @IsString()
  @MaxLength(64)
  stockItemId: string;

  @ApiProperty()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  qty: number;
}

export class ApproveRequestDto {
  // Required: a missing flag used to fall through as a rejection.
  @ApiProperty()
  @IsBoolean()
  approved: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  rejectReason?: string;

  /** PR6: chosen pick locations. Absent = FIFO, exactly as before. */
  @ApiPropertyOptional({ type: [PickDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PickDto)
  picks?: PickDto[];
}
