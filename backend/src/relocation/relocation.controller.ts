import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RelocationStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS } from '../auth/access';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RelocationService } from './relocation.service';
import type { CreateRelocationInput } from './relocation.service';

/** PR7 Location Relocation Request. Stock moves only on POST :id/complete. */
@ApiTags('Relocation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('relocations')
export class RelocationController {
  constructor(private readonly relocation: RelocationService) {}

  @Get()
  @Access(ACCESS.relocationRead)
  @ApiOperation({ summary: 'List relocation requests' })
  findAll(
    @Query('status') status: RelocationStatus | undefined,
    @Query('warehouseId') warehouseId: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: any,
  ) {
    return this.relocation.findAll(
      {
        status: status || undefined,
        warehouseId: warehouseId || undefined,
        page: page ? +page : 1,
        limit: limit ? +limit : 20,
      },
      user,
    );
  }

  @Get('movable')
  @Access(ACCESS.relocationRequest)
  @ApiOperation({
    summary: 'Stock rows in a slot that a relocation request may move',
  })
  movable(
    @Query('warehouseId') warehouseId: string,
    @Query('slotId') slotId: string,
    @CurrentUser() user: any,
  ) {
    return this.relocation.movable(warehouseId, slotId, user);
  }

  @Get(':id')
  @Access(ACCESS.relocationRead)
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.relocation.findOne(id, user);
  }

  @Post()
  @Access(ACCESS.relocationRequest)
  @ApiOperation({ summary: 'Create a relocation request (no stock moves yet)' })
  create(@Body() body: CreateRelocationInput, @CurrentUser() user: any) {
    return this.relocation.create(body, user);
  }

  @Post(':id/approve')
  @Access(ACCESS.relocationApprove)
  approve(@Param('id') id: string, @CurrentUser() user: any) {
    return this.relocation.approve(id, user);
  }

  @Post(':id/reject')
  @Access(ACCESS.relocationApprove)
  reject(
    @Param('id') id: string,
    @Body('reason') reason: string | undefined,
    @CurrentUser() user: any,
  ) {
    return this.relocation.reject(id, reason, user);
  }

  @Post(':id/cancel')
  @Access(ACCESS.relocationMove)
  cancel(@Param('id') id: string, @CurrentUser() user: any) {
    return this.relocation.cancel(id, user);
  }

  @Post(':id/complete')
  @Access(ACCESS.relocationMove)
  @ApiOperation({
    summary: 'Confirm the goods were moved — changes the stock location',
  })
  complete(@Param('id') id: string, @CurrentUser() user: any) {
    return this.relocation.complete(id, user);
  }
}
