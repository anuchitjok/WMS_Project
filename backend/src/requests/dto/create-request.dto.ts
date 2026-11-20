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

  /**
   * Migration 44 — where a SHIP request is going. Everything is optional: the
   * owner's rule is that a half-filled address warns the requester and still
   * goes through, because the person raising the request often does not have
   * the full address to hand. The server stores these only for SHIP.
   */
  @ApiPropertyOptional({ maxLength: 120 })
  @IsString() @IsOptional() @MaxLength(120)
  shipToName?: string;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsString() @IsOptional() @MaxLength(40)
  shipToPhone?: string;

  @ApiPropertyOptional({ maxLength: 300, description: 'House number, street, building' })
  @IsString() @IsOptional() @MaxLength(300)
  shipToAddress?: string;

  @ApiPropertyOptional({ maxLength: 6, description: 'ThaiTambon id as picked' })
  @IsString() @IsOptional() @MaxLength(6)
  shipToTambonId?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsString() @IsOptional() @MaxLength(120)
  shipToTambon?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsString() @IsOptional() @MaxLength(120)
  shipToDistrict?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsString() @IsOptional() @MaxLength(120)
  shipToProvince?: string;

  @ApiPropertyOptional({ maxLength: 5 })
  @IsString() @IsOptional() @MaxLength(5)
  shipToPostCode?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsString() @IsOptional() @MaxLength(300)
  shipToNote?: string;

  @ApiProperty({ type: [RequestItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'at least one item is required' })
  @ValidateNested({ each: true })
  @Type(() => RequestItemDto)
  items: RequestItemDto[];
}
