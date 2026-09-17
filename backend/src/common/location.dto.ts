import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body for endpoints that only move stock (putaway confirm, transfer complete,
 * inventory relocate). A class — not an inline type — so the global
 * ValidationPipe whitelists it and rejects any other stock field.
 */
export class LocationDto {
  @ApiPropertyOptional() @IsString() @IsOptional() warehouseId?: string | null;
  @ApiPropertyOptional() @IsString() @IsOptional() rackId?: string | null;
  @ApiPropertyOptional() @IsString() @IsOptional() slotId?: string | null;
}
