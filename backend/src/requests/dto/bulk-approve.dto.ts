import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Hard cap on one bulk decision (P4 4.4). Also enforced in the service. */
export const BULK_APPROVE_MAX = 100;

export class BulkApproveDto {
  @ApiProperty({ type: [String], maxItems: BULK_APPROVE_MAX })
  @IsArray()
  @ArrayMinSize(1, { message: 'at least one request is required' })
  @ArrayMaxSize(BULK_APPROVE_MAX, { message: `at most ${BULK_APPROVE_MAX} requests per bulk decision` })
  @IsString({ each: true })
  ids: string[];

  /** true = approve all, false = reject all (reason required). */
  @ApiProperty()
  @IsBoolean()
  approve: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export interface BulkApproveResult {
  id: string;
  refNumber: string | null;
  ok: boolean;
  /** Request status after the decision (PENDING_APPROVAL when a multi-step rule still waits). */
  status?: string;
  error?: string;
}
