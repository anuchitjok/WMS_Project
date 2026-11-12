import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional,
  IsPositive, IsString, Max, MaxLength, Min, ValidateNested, IsEnum, Matches, IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RackType, SlotType } from '@prisma/client';
import { RACK_CATEGORIES, MAX_GRID, type RackCategory } from './space-math';

// All size fields are optional; null clears a value on PATCH (IsOptional skips null).

// ── Warehouse ─────────────────────────────────────────────────────────────────
export class WarehouseSizeFields {
  @ApiPropertyOptional({ description: 'cm' }) @IsOptional() @IsNumber() @IsPositive() lengthCm?: number | null;
  @ApiPropertyOptional({ description: 'cm' }) @IsOptional() @IsNumber() @IsPositive() widthCm?: number | null;
  @ApiPropertyOptional({ description: 'cm' }) @IsOptional() @IsNumber() @IsPositive() heightCm?: number | null;
  @ApiPropertyOptional({ description: '% of floor usable after aisles (blank = 100)' })
  @IsOptional() @IsNumber() @IsPositive() @Max(100) usableAreaPct?: number | null;
  @ApiPropertyOptional({ description: 'Floor shape {version:1, unit:"m", shape, points:[[x,z],...], params?}; null = rectangle. Checked in the service.' })
  @IsOptional() @IsObject() floorOutline?: Record<string, unknown> | null;
}

export class CreateWarehouseDto extends WarehouseSizeFields {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50) code: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) location?: string | null;
}

export class UpdateWarehouseDto extends WarehouseSizeFields {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) location?: string | null;
}

// ── Rack type master ──────────────────────────────────────────────────────────
export class CreateRackTypeDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50) code: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name: string;
  @ApiProperty({ enum: RACK_CATEGORIES }) @IsIn(RACK_CATEGORIES) category: RackCategory;
  @ApiProperty() @IsNumber() @IsPositive() lengthCm: number;
  @ApiProperty() @IsNumber() @IsPositive() widthCm: number;
  @ApiProperty() @IsNumber() @IsPositive() heightCm: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(MAX_GRID) levels?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(MAX_GRID) columns?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) slotCapacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() maxStackHeightCm?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string | null;
}

export class UpdateRackTypeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) name?: string;
  @ApiPropertyOptional({ enum: RACK_CATEGORIES }) @IsOptional() @IsIn(RACK_CATEGORIES) category?: RackCategory;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() lengthCm?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() widthCm?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() heightCm?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(MAX_GRID) levels?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(MAX_GRID) columns?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) slotCapacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() maxStackHeightCm?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

// ── Rack ──────────────────────────────────────────────────────────────────────
class RackFields {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) name?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) zone?: string | null;
  @ApiPropertyOptional({ description: 'Rack Type Master id (template)' }) @IsOptional() @IsString() rackTypeId?: string | null;
  @ApiPropertyOptional({ enum: RACK_CATEGORIES }) @IsOptional() @IsIn(RACK_CATEGORIES) category?: RackCategory;
  @ApiPropertyOptional({ enum: RackType, description: 'Legacy; stored as STANDARD or PALLET only' }) @IsOptional() @IsEnum(RackType) rackType?: RackType;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) capacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(MAX_GRID) levels?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(MAX_GRID) columns?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() lengthCm?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() widthCm?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() heightCm?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string | null;
}

export class CreateRackDto extends RackFields {
  @ApiProperty() @IsString() @IsNotEmpty() warehouseId: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50) code: string;
}

export class UpdateRackDto extends RackFields {}

// ── Slot ──────────────────────────────────────────────────────────────────────
class SlotEditFields {
  @ApiPropertyOptional({ enum: SlotType }) @IsOptional() @IsEnum(SlotType) slotType?: SlotType;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) capacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) maxWeight?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() lengthCm?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() widthCm?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() heightCm?: number | null;
}

export class CreateSlotDto extends SlotEditFields {
  @ApiProperty() @IsString() @IsNotEmpty() rackId: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(80) code: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) name?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) level?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) column?: number;
}

export class UpdateSlotDto extends SlotEditFields {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) name?: string | null;
}

export class BulkSlotChangesDto extends SlotEditFields {}

export class BulkUpdateSlotsDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_GRID * MAX_GRID) @IsString({ each: true }) ids: string[];
  @ApiProperty({ type: BulkSlotChangesDto }) @ValidateNested() @Type(() => BulkSlotChangesDto) changes: BulkSlotChangesDto;
}

export class BulkDeleteSlotsDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_GRID * MAX_GRID) @IsString({ each: true }) ids: string[];
  @ApiPropertyOptional({ description: 'true = only report what would be deleted' }) @IsOptional() @IsBoolean() preview?: boolean;
}

// ── Setup wizard: many racks (+ their slots) in one go ───────────────────────
export const SETUP_MAX_ZONES = 26;
export const SETUP_MAX_RACKS_PER_ZONE = 99;

export class SetupZoneDto {
  @ApiProperty({ description: 'Zone name, also the rack code prefix (letters, digits, dash)' })
  @IsString() @IsNotEmpty() @MaxLength(20) @Matches(/^[A-Za-z0-9][A-Za-z0-9-]*$/) name: string;
  @ApiProperty() @IsInt() @Min(1) @Max(SETUP_MAX_RACKS_PER_ZONE) racks: number;
}

export class SetupRacksDto {
  @ApiProperty() @IsString() @IsNotEmpty() rackTypeId: string;
  @ApiProperty({ type: [SetupZoneDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(SETUP_MAX_ZONES)
  @ValidateNested({ each: true }) @Type(() => SetupZoneDto) zones: SetupZoneDto[];
  @ApiPropertyOptional({ description: 'true = only plan, nothing is written' }) @IsOptional() @IsBoolean() preview?: boolean;
}

export class GenerateSlotsDto {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_GRID) levels: number;
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_GRID) columns: number;
  @ApiPropertyOptional({ description: 'true = only list the codes, nothing is written' }) @IsOptional() @IsBoolean() preview?: boolean;
}

// ── Space simulator ───────────────────────────────────────────────────────────
export class SimLineDto {
  @ApiPropertyOptional() @IsOptional() @IsString() productId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) label?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() lengthCm?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() widthCm?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() heightCm?: number | null;
  @ApiProperty() @IsNumber() @Min(0) @Max(10_000_000) quantity: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1000) stackLayers?: number;
}

export class SpaceSimulateDto {
  @ApiProperty({ enum: ['AREA', 'SLOTS', 'ITEMS'] }) @IsIn(['AREA', 'SLOTS', 'ITEMS']) mode: 'AREA' | 'SLOTS' | 'ITEMS';
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) warehouseIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) areaM2?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) slots?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() palletLengthCm?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() palletWidthCm?: number;
  @ApiPropertyOptional({ type: [SimLineDto] }) @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => SimLineDto) lines?: SimLineDto[];
}
