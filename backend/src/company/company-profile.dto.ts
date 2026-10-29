import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Empty string clears a field. */
export class UpdateCompanyProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) legalName?: string;
  @ApiPropertyOptional({ description: 'Short trading name shown as the document heading' })
  @IsOptional() @IsString() @MaxLength(120) displayName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) website?: string;
  @ApiPropertyOptional({ description: 'Tax ID / company registration number' })
  @IsOptional() @IsString() @MaxLength(40) taxId?: string;
  @ApiPropertyOptional({ description: 'Default commercial terms, one per line' })
  @IsOptional() @IsString() @MaxLength(4000) defaultTerms?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) version?: number;
}
