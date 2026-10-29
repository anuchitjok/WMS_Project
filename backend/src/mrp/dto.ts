import { Type } from 'class-transformer';
import {
  IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Payloads for /mrp. The global ValidationPipe rejects unknown properties.
// `null` clears an optional field (IsOptional accepts null).

export class RunMrpDto {
  @ApiPropertyOptional({ description: 'Plan a single warehouse; omit for all warehouses in your scope' })
  @IsOptional() @IsString() warehouseId?: string;
  @ApiPropertyOptional({ description: 'As-of date/time (ISO). Defaults to now.' })
  @IsOptional() @IsDateString() asOf?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class PlanningParamDto {
  @ApiProperty() @IsString() @IsNotEmpty() productId: string;
  @ApiPropertyOptional({ description: 'null = all warehouses' }) @IsOptional() @IsString() warehouseId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() planningEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsIn(['PURCHASE', 'TRANSFER', 'NONE']) replenishmentMethod?: 'PURCHASE' | 'TRANSFER' | 'NONE';
  @ApiPropertyOptional() @IsOptional() @IsIn(['LOT_FOR_LOT', 'MIN_MAX']) lotSizing?: 'LOT_FOR_LOT' | 'MIN_MAX';
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(3650) leadTimeDays?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(3650) leadTimeVariabilityDays?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) moq?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) orderMultiple?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) minStock?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) maxStock?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) safetyStock?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) reorderPoint?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(3650) targetDaysOfSupply?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) unitCost?: number | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) costBasis?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsIn(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']) criticality?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsIn(['SMA', 'FMA', 'WMA', 'LINEAR']) forecastMethod?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveTo?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
}

export class UpdatePlanningParamDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() planningEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsIn(['PURCHASE', 'TRANSFER', 'NONE']) replenishmentMethod?: 'PURCHASE' | 'TRANSFER' | 'NONE';
  @ApiPropertyOptional() @IsOptional() @IsIn(['LOT_FOR_LOT', 'MIN_MAX']) lotSizing?: 'LOT_FOR_LOT' | 'MIN_MAX';
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(3650) leadTimeDays?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(3650) leadTimeVariabilityDays?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) moq?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) orderMultiple?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) minStock?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) maxStock?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) safetyStock?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) reorderPoint?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(3650) targetDaysOfSupply?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) unitCost?: number | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) costBasis?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsIn(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']) criticality?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsIn(['SMA', 'FMA', 'WMA', 'LINEAR']) forecastMethod?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveTo?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
}

export class SupplierDto {
  @ApiProperty() @IsString() @IsNotEmpty() productId: string;
  @ApiProperty() @IsString() @IsNotEmpty() vendorId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) supplierPartNumber?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPreferred?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isApproved?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(3650) leadTimeDays?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) moq?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) orderMultiple?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) unitPrice?: number | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsIn(['QUOTE', 'CONTRACT', 'PRICE_LIST']) priceSource?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() priceValidFrom?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() priceValidTo?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) purchaseUom?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) uomConversion?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
}

export class UpdateSupplierDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) supplierPartNumber?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPreferred?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isApproved?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(3650) leadTimeDays?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) moq?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) orderMultiple?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) unitPrice?: number | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsIn(['QUOTE', 'CONTRACT', 'PRICE_LIST']) priceSource?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() priceValidFrom?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() priceValidTo?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) purchaseUom?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) uomConversion?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
}

export class ForecastOverrideDto {
  @ApiProperty() @IsString() @IsNotEmpty() productId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() warehouseId?: string | null;
  @ApiProperty({ description: 'First day of the period (YYYY-MM-DD); must be a period start' }) @IsDateString() periodStart: string;
  @ApiProperty() @IsIn(['REPLACE', 'ADD']) mode: 'REPLACE' | 'ADD';
  @ApiProperty() @Type(() => Number) @IsNumber() quantity: number;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(500) reason: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['PROJECT', 'LAUNCH', 'PHASE_OUT', 'CAMPAIGN', 'OTHER']) category?: string;
}

export class DecideOverrideDto {
  @ApiProperty() @IsBoolean() approve: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class MrpConfigDto {
  @ApiProperty({ description: 'Full or partial configuration; merged over the current one' }) @IsObject() config: Record<string, unknown>;
}
