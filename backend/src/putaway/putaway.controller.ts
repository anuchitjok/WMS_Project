import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PutawayService } from './putaway.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Putaway')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('putaway')
export class PutawayController {
  constructor(private readonly service: PutawayService) {}

  @Get('pending')
  pending() {
    return this.service.pending();
  }

  @Post('fit-check')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE_SUPERVISOR, UserRole.WAREHOUSE_STAFF)
  fitCheck(@Body() body: { slotId: string; length: number; width: number; height: number }) {
    return this.service.checkFit(body.slotId, { length: body.length, width: body.width, height: body.height });
  }

  @Patch(':stockItemId/confirm')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE_SUPERVISOR, UserRole.WAREHOUSE_STAFF)
  confirm(
    @Param('stockItemId') stockItemId: string,
    @Body() location: { warehouseId?: string; rackId?: string; slotId?: string },
    @CurrentUser('id') userId: string,
  ) {
    return this.service.confirm(stockItemId, location, userId);
  }
}
