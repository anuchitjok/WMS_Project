import { Type } from 'class-transformer';
import {
  IsArray, IsOptional, IsString, IsNotEmpty, IsNumber, Min, MaxLength,
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
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  department?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  purpose?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  requiredDate?: string;

  @ApiProperty({ description: 'RMA Case reference number' })
  @IsString()
  @IsNotEmpty({ message: 'RMA Case Number is required' })
  rmaCaseNumber: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  remark?: string;

  @ApiProperty({ type: [RequestItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'at least one item is required' })
  @ValidateNested({ each: true })
  @Type(() => RequestItemDto)
  items: RequestItemDto[];
}
