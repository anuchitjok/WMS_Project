import { Type } from 'class-transformer';
import {
  IsArray, IsOptional, IsString, IsNotEmpty, IsNumber, Min,
  ValidateNested, ArrayMinSize, IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RequestItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  productId: string;

  @ApiProperty({ minimum: 1 })
  @IsNumber()
  @Min(1, { message: 'quantity must be at least 1' })
  quantity: number;
}

export class CreateRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  department: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  purpose?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  requiredDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  rmaCaseNumber?: string;

  @ApiProperty({ type: [RequestItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'at least one item is required' })
  @ValidateNested({ each: true })
  @Type(() => RequestItemDto)
  items: RequestItemDto[];
}
