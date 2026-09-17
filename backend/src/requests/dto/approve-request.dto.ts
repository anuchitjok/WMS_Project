import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
}
