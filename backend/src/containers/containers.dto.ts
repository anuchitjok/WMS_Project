import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ContainerStatus, ContainerType } from '@prisma/client';

// RQ17 / RQ18. The code is never accepted from a caller — the API generates it
// (BOX-000123) so no two boxes can carry the same sticker.

export class CreateContainerDto {
  @ApiPropertyOptional({ description: 'A human label, e.g. "Spares for line 3"' })
  @IsOptional() @IsString() @MaxLength(120) name?: string;

  @ApiPropertyOptional({ enum: ContainerType })
  @IsOptional() @IsEnum(ContainerType) type?: ContainerType;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;

  @ApiPropertyOptional({ description: 'Where the box stands. Leave empty for a box not yet put anywhere.' })
  @IsOptional() @IsString() slotId?: string;

  @ApiPropertyOptional({ description: 'The box this one is packed inside (a carton on a pallet).' })
  @IsOptional() @IsString() parentContainerId?: string;
}

export class UpdateContainerDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiPropertyOptional({ enum: ContainerType }) @IsOptional() @IsEnum(ContainerType) type?: ContainerType;
  @ApiPropertyOptional({ enum: ContainerStatus, description: 'CLOSED seals the box: no packing or unpacking until it is opened.' })
  @IsOptional() @IsEnum(ContainerStatus) status?: ContainerStatus;
}

export class MoveContainerDto {
  @ApiPropertyOptional({ description: 'The slot to move it to. Null or empty takes the box out of the racking.' })
  @IsOptional() @IsString() slotId?: string;
}

export class PackItemsDto {
  @ApiProperty({ type: [String], description: 'Stock rows to pack into, or take out of, the box' })
  @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) stockItemIds: string[];
}

export class SplitContainerDto {
  @ApiProperty({ type: [String], description: 'Stock rows that move into the new box' })
  @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) stockItemIds: string[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional({ enum: ContainerType }) @IsOptional() @IsEnum(ContainerType) type?: ContainerType;

  @ApiPropertyOptional({ description: 'Allow the split to leave the original box empty' })
  @IsOptional() @IsBoolean() allowEmptySource?: boolean;
}

export class MergeContainerDto {
  @ApiProperty({ description: 'The box whose contents move into this one' })
  @IsString() fromContainerId: string;

  @ApiPropertyOptional({
    description: 'Retire the other box once it is empty, so no empty box is left behind. Its code and history stay on file.',
  })
  @IsOptional() @IsBoolean() retireSource?: boolean;
}
