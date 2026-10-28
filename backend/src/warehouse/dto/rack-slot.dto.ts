import { IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RackType, SlotStatus, SlotType } from '@prisma/client';

// Rack / slot payloads for /warehouse. The global ValidationPipe runs with
// whitelist + forbidNonWhitelisted, so any property not declared here (e.g.
// isActive, rackId, warehouseId on an update) is refused with 400 instead of
// being written straight to the database. Field sets match what the service
// signatures already declared and what the Control Center sends.

export class CreateRackDto {
  @ApiProperty() @IsString() @IsNotEmpty() warehouseId: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(40) code: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) zone?: string;
  @ApiPropertyOptional({ enum: RackType }) @IsOptional() @IsEnum(RackType) rackType?: RackType;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) capacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100) levels?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(200) columns?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class UpdateRackDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) zone?: string;
  @ApiPropertyOptional({ enum: RackType }) @IsOptional() @IsEnum(RackType) rackType?: RackType;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) capacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100) levels?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(200) columns?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class CreateSlotDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(40) code: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) level?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) column?: number;
  @ApiPropertyOptional({ enum: SlotType }) @IsOptional() @IsEnum(SlotType) slotType?: SlotType;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) capacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) maxWeight?: number;
}

export class BulkSlotsDto {
  // Level codes are letters A–Z, so 26 levels at most.
  @ApiProperty() @IsInt() @Min(1) @Max(26) levels: number;
  @ApiProperty() @IsInt() @Min(1) @Max(99) columns: number;
  @ApiPropertyOptional({ enum: SlotType }) @IsOptional() @IsEnum(SlotType) slotType?: SlotType;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) capacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) maxWeight?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) prefix?: string;
}

export class UpdateSlotDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional({ enum: SlotType }) @IsOptional() @IsEnum(SlotType) slotType?: SlotType;
  @ApiPropertyOptional({ enum: SlotStatus }) @IsOptional() @IsEnum(SlotStatus) status?: SlotStatus;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) capacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) maxWeight?: number;
}
