import { Type } from 'class-transformer';
import {
  IsArray, IsOptional, IsString, IsNotEmpty, IsNumber, Min, MaxLength,
  ValidateNested, ArrayMinSize, IsDateString, IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** P4 4.7 — how the requester receives the goods. Null/absent on older rows = COLLECT. */
export const DELIVERY_METHODS = ['COLLECT', 'SHIP'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

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

  @ApiPropertyOptional({ enum: DELIVERY_METHODS, default: 'COLLECT' })
  @IsOptional()
  @IsIn(DELIVERY_METHODS as unknown as string[], { message: 'deliveryMethod must be COLLECT or SHIP' })
  deliveryMethod?: DeliveryMethod;

  @ApiProperty({ type: [RequestItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'at least one item is required' })
  @ValidateNested({ each: true })
  @Type(() => RequestItemDto)
  items: RequestItemDto[];
}
