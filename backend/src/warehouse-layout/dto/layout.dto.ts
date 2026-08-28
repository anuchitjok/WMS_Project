import {
  IsString, IsOptional, IsInt, IsNumber, IsEnum, Min, Max, MaxLength, IsNotEmpty, Matches,
  IsArray, IsBoolean, ArrayMaxSize, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LayoutObjectType, LayoutObjectStatus } from '@prisma/client';

// NB: the global ValidationPipe runs with `forbidNonWhitelisted: true`, so any
// property absent from these DTOs is rejected with 400. That is deliberate —
// `slotId` / `rackId` are intentionally NOT accepted here. Linking a layout
// object to a WMS Slot/Rack is Sprint 6 and gets its own endpoint + validation.

const HEX = /^#[0-9a-fA-F]{6}$/;

// ─── Layout (canvas) ─────────────────────────────────────────────────────────

export class CreateLayoutDto {
  @ApiPropertyOptional({ default: 'Default Layout' })
  @IsOptional() @IsString() @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ default: 100, description: 'Canvas width in grid units' })
  @IsOptional() @IsInt() @Min(1) @Max(10_000)
  widthUnits?: number;

  @ApiPropertyOptional({ default: 60, description: 'Canvas height in grid units' })
  @IsOptional() @IsInt() @Min(1) @Max(10_000)
  heightUnits?: number;

  @ApiPropertyOptional({ default: 10, description: 'Pixels per grid unit at zoom 1' })
  @IsOptional() @IsInt() @Min(1) @Max(500)
  gridSize?: number;

  @ApiPropertyOptional({ default: 'm', description: 'Display-only unit label' })
  @IsOptional() @IsString() @MaxLength(8)
  unitLabel?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(2_000)
  notes?: string;
}

export class UpdateLayoutCanvasDto extends CreateLayoutDto {}

// ─── Layout object ───────────────────────────────────────────────────────────

export class CreateLayoutObjectDto {
  @ApiProperty({ enum: LayoutObjectType })
  @IsEnum(LayoutObjectType)
  objectType: LayoutObjectType;

  @ApiProperty()
  @IsString() @IsNotEmpty() @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ description: 'Operator-facing label, e.g. "A-01-01"' })
  @IsOptional() @IsString() @MaxLength(60)
  code?: string;

  @ApiPropertyOptional({ description: 'Parent object; must belong to the same layout' })
  @IsOptional() @IsString()
  parentObjectId?: string;

  @ApiProperty({ description: 'Grid units from the top-left origin' })
  @IsNumber() @Min(0)
  x: number;

  @ApiProperty()
  @IsNumber() @Min(0)
  y: number;

  @ApiProperty({ description: 'Grid units; must be greater than 0' })
  @IsNumber() @Min(0.01)
  width: number;

  @ApiProperty()
  @IsNumber() @Min(0.01)
  height: number;

  @ApiPropertyOptional({ default: 0, description: 'Degrees, 0–360' })
  @IsOptional() @IsNumber() @Min(0) @Max(360)
  rotation?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional() @IsInt()
  zIndex?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional() @IsInt()
  displayOrder?: number;

  @ApiPropertyOptional({ description: 'Physical/planning capacity — NOT a stock quantity' })
  @IsOptional() @IsInt() @Min(0)
  capacity?: number;

  @ApiPropertyOptional({ example: '#15803D' })
  @IsOptional() @IsString() @Matches(HEX, { message: 'color must be a 6-digit hex value such as #15803D' })
  color?: string;

  @ApiPropertyOptional({ enum: LayoutObjectStatus, default: LayoutObjectStatus.ACTIVE })
  @IsOptional() @IsEnum(LayoutObjectStatus)
  status?: LayoutObjectStatus;

  @ApiPropertyOptional({ description: 'JSON string (house convention — see ApprovalRule.conditions)' })
  @IsOptional() @IsString() @MaxLength(20_000)
  metadata?: string;
}

// Every field optional. `parentObjectId: null` detaches the object to the root;
// the service rejects any reassignment that would create a cycle.
export class UpdateLayoutObjectDto {
  @ApiPropertyOptional({ enum: LayoutObjectType })
  @IsOptional() @IsEnum(LayoutObjectType)
  objectType?: LayoutObjectType;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(60)
  code?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'null detaches to root' })
  @IsOptional() @IsString()
  parentObjectId?: string | null;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber() @Min(0)
  x?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber() @Min(0)
  y?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber() @Min(0.01)
  width?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber() @Min(0.01)
  height?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber() @Min(0) @Max(360)
  rotation?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsInt()
  zIndex?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsInt()
  displayOrder?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsInt() @Min(0)
  capacity?: number | null;

  @ApiPropertyOptional({ example: '#15803D' })
  @IsOptional() @IsString() @Matches(HEX, { message: 'color must be a 6-digit hex value such as #15803D' })
  color?: string | null;

  @ApiPropertyOptional({ enum: LayoutObjectStatus })
  @IsOptional() @IsEnum(LayoutObjectStatus)
  status?: LayoutObjectStatus;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(20_000)
  metadata?: string | null;
}

// ─── Sprint 5: batch save + duplicate ────────────────────────────────────────

// One entry in a batch save. An `id` means "update this object"; no `id` means
// "create it". Every other field is required either way: an upsert carries the
// COMPLETE desired state of the object, which keeps the operation idempotent and
// lets the editor replay a failed flush without reconstructing a partial diff.
export class BatchUpsertDto extends CreateLayoutObjectDto {
  @ApiPropertyOptional({ description: 'Omit to create; supply to update' })
  @IsOptional() @IsString()
  id?: string;
}

export class BatchSaveDto {
  @ApiProperty({ description: 'Layout version the client last read; rejected with 409 if stale' })
  @IsInt() @Min(0)
  version: number;

  @ApiPropertyOptional({ type: [BatchUpsertDto] })
  @IsOptional() @IsArray() @ArrayMaxSize(500)
  @ValidateNested({ each: true }) @Type(() => BatchUpsertDto)
  upserts?: BatchUpsertDto[];

  @ApiPropertyOptional({ description: 'Object ids to soft-delete, with their descendants' })
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true })
  deletes?: string[];
}

export class DuplicateObjectDto {
  @ApiPropertyOptional({ default: 2, description: 'Grid units to offset the copy' })
  @IsOptional() @IsNumber()
  offsetX?: number;

  @ApiPropertyOptional({ default: 2 })
  @IsOptional() @IsNumber()
  offsetY?: number;

  @ApiPropertyOptional({ default: false, description: 'Copy the whole subtree' })
  @IsOptional() @IsBoolean()
  includeChildren?: boolean;
}
