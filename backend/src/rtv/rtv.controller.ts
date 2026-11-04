import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { RtvService } from './rtv.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS } from '../auth/access';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RTVStatus } from '@prisma/client';

/** U04: the vendor's replacement unit, received against the RTV case. */
class ReceiveReplacementDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) serialNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) batchNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

@ApiTags('RTV')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Access(ACCESS.rtv)
@Controller('rtv')
export class RtvController {
  constructor(private readonly rtvService: RtvService) {}

  @Get()
  findAll(@Query('status') status: RTVStatus | undefined, @Query('page') page: number | undefined, @Query('limit') limit: number | undefined, @Query('overdue') overdue: string | undefined, @CurrentUser() user: any) {
    return this.rtvService.findAll({ status, page, limit, overdue: overdue === 'true' }, user);
  }

  @Get(':id') findOne(@Param('id') id: string, @CurrentUser() user: any) { return this.rtvService.findOne(id, user); }

  @Post()
  create(
    @Body() body: { stockItemId: string; reason: string; description?: string; vendorId?: string },
    @CurrentUser() user: any,
  ) {
    return this.rtvService.create(body, user.id, user);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: RTVStatus,
    @Body('creditNoteRef') creditNoteRef: string | undefined,
    @CurrentUser() user: any,
  ) {
    return this.rtvService.updateStatus(id, status, user.id, user, { creditNoteRef: typeof creditNoteRef === 'string' ? creditNoteRef.slice(0, 100) : undefined });
  }

  @Post(':id/replacement')
  receiveReplacement(@Param('id') id: string, @Body() body: ReceiveReplacementDto, @CurrentUser() user: any) {
    return this.rtvService.receiveReplacement(id, body, user.id, user);
  }
}
