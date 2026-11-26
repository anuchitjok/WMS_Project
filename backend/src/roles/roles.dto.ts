import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Request shapes for the role-administration endpoints.
 *
 * These exist because the controller previously took `@Body() dto: any`, which opts the
 * endpoint out of the global ValidationPipe entirely: a missing field reached the service
 * and threw a TypeError on `.trim()`, surfacing as HTTP 500 instead of 400 (WMS-01-004).
 * The shapes mirror the inline types the service already documented.
 */
export class CreateRoleDto {
  @ApiProperty({ description: 'Role key, upper-cased and underscored by the service (e.g. "STOCK_AUDITOR")' })
  @IsString()
  @IsNotEmpty({ message: 'key is required' })
  @MaxLength(60)
  key: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ type: [String], description: 'Permission codes granted to the new role' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  permissionCodes?: string[];
}

export class UpdatePermissionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  module?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class CreatePermissionDto {
  @ApiPropertyOptional({ description: 'Full code. Defaults to "<module>.<action>" when omitted.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  code?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'module is required' })
  @MaxLength(60)
  module: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'action is required' })
  @MaxLength(60)
  action: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
