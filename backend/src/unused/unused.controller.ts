import { Body, Controller, Get, Patch, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';
import { UnusedService } from './unused.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS, hasAccess } from '../auth/access';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

/** Optional: process only these units of the request (partial return). */
class ReturnUnitsDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true })
  stockItemIds?: string[];
}

@ApiTags('Unused Return')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('unused')
export class UnusedController {
  constructor(private readonly service: UnusedService) {}

  @Get('pending')
  pending(@CurrentUser() user: any) {
    // Warehouse (returns inbound) sees every return; anyone else only their own requests.
    return this.service.pending(hasAccess(user, ACCESS.returnsInbound) ? undefined : user.id);
  }

  @Access(ACCESS.returnsInbound)
  @Patch(':requestId/return')
  returnToStock(@Param('requestId') requestId: string, @Body() body: ReturnUnitsDto, @CurrentUser('id') userId: string) {
    return this.service.returnToStock(requestId, userId, body?.stockItemIds);
  }

  @Access(ACCESS.returnsInbound)
  @Patch(':requestId/doa')
  markDoa(@Param('requestId') requestId: string, @Body() body: ReturnUnitsDto, @CurrentUser('id') userId: string) {
    return this.service.markDoa(requestId, userId, body?.stockItemIds);
  }
}
