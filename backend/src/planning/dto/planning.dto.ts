import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Priority } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PROJECT_TYPES, WORKFLOW_TEMPLATES } from '../templates';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

export class CreateProjectDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @ApiProperty({ enum: PROJECT_TYPES })
  @IsIn(PROJECT_TYPES)
  projectType!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  customer?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  department?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() productId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  scope?: string;
  @ApiProperty() @IsString() @IsNotEmpty() warehouseId!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  workLocation?: string;
  @ApiPropertyOptional({ enum: Priority })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;
  @ApiPropertyOptional() @IsOptional() @IsString() ownerId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  teams?: string;
  @ApiProperty({ example: '2026-11-02' })
  @Matches(DAY, { message: 'plannedStart must be YYYY-MM-DD' })
  plannedStart!: string;
  @ApiProperty({ example: '2026-11-30' })
  @Matches(DAY, { message: 'targetEnd must be YYYY-MM-DD' })
  targetEnd!: string;
  @ApiPropertyOptional({ example: 'THB' })
  @IsOptional()
  @Matches(CURRENCY, { message: 'currency must be a 3-letter ISO code' })
  currency?: string;
  @ApiProperty() @IsInt() @Min(1) quantity!: number;
  @ApiPropertyOptional({ enum: WORKFLOW_TEMPLATES.map((t) => t.key) })
  @IsOptional()
  @IsIn(WORKFLOW_TEMPLATES.map((t) => t.key))
  templateKey?: string;
}

export class UpdateProjectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(PROJECT_TYPES)
  projectType?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  customer?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  department?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() productId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  scope?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  warehouseId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  workLocation?: string;
  @ApiPropertyOptional({ enum: Priority })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;
  @ApiPropertyOptional() @IsOptional() @IsString() ownerId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  teams?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DAY) plannedStart?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DAY) targetEnd?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(CURRENCY) currency?: string;
  @ApiProperty({ description: 'Version read by the client (optimistic lock)' })
  @IsInt()
  version!: number;
}

export class CreateScenarioDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
  @ApiPropertyOptional({ description: 'Copy inputs from this scenario' })
  @IsOptional()
  @IsString()
  cloneFromId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateScenarioDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isBaseline?: boolean;
  @ApiPropertyOptional({
    description: 'Scenario inputs (validated by the planning engine)',
  })
  @IsOptional()
  @IsObject()
  inputs?: Record<string, unknown>;
  @ApiProperty() @IsInt() version!: number;
}

export class SubmitPlanDto {
  @ApiProperty() @IsString() @IsNotEmpty() runId!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class DecisionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
