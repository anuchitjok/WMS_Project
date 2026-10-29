import { IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const SCOPES = ['SERIAL', 'PRODUCT', 'PRODUCT_MODEL', 'CATEGORY', 'BRAND', 'VENDOR', 'PRODUCT_TYPE'];
const BASES = ['RECEIPT_DATE', 'GOODS_ISSUE_DATE', 'INVOICE_DATE', 'INSTALLATION_DATE', 'ACTIVATION_DATE'];

export class CreateWarrantyRuleDto {
  @ApiProperty() @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{1,39}$/, { message: 'ruleCode: 2–40 characters, A–Z, 0–9, _ or -' }) ruleCode: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(60) warrantyType: string;
  @ApiProperty({ enum: SCOPES }) @IsIn(SCOPES) scopeType: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120) scopeValue: string;
  @ApiProperty({ enum: BASES }) @IsIn(BASES) startBasis: string;
  @ApiProperty() @IsInt() @Min(1) @Max(36500) durationValue: number;
  @ApiProperty({ enum: ['DAYS', 'MONTHS', 'YEARS'] }) @IsIn(['DAYS', 'MONTHS', 'YEARS']) durationUnit: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) terms?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(-1000) @Max(1000) priority?: number;
  @ApiProperty() @IsDateString() effectiveFrom: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveTo?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) changeNote?: string;
}

export class UpdateWarrantyRuleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) warrantyType?: string;
  @ApiPropertyOptional({ enum: SCOPES }) @IsOptional() @IsIn(SCOPES) scopeType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) scopeValue?: string;
  @ApiPropertyOptional({ enum: BASES }) @IsOptional() @IsIn(BASES) startBasis?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(36500) durationValue?: number;
  @ApiPropertyOptional() @IsOptional() @IsIn(['DAYS', 'MONTHS', 'YEARS']) durationUnit?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) terms?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(-1000) @Max(1000) priority?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveTo?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) changeNote?: string;
}

export class WarrantyDateDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120) serialNumber: string;
  @ApiProperty({ enum: ['INVOICE_DATE', 'INSTALLATION_DATE', 'ACTIVATION_DATE'] }) @IsIn(['INVOICE_DATE', 'INSTALLATION_DATE', 'ACTIVATION_DATE']) dateType: string;
  @ApiProperty() @IsDateString() date: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) source?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export const WARRANTY_CONTEXTS = ['LOOKUP', 'RTV', 'DOA', 'RECEIVING', 'RMA'];
