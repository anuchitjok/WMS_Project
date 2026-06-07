import { Controller, Get, Patch, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UnusedService } from './unused.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Unused Return')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('unused')
export class UnusedController {
  constructor(private readonly service: UnusedService) {}

  @Get('pending')
  pending() {
    return this.service.pending();
  }

  @Patch(':requestId/return')
  returnToStock(@Param('requestId') requestId: string, @CurrentUser('id') userId: string) {
    return this.service.returnToStock(requestId, userId);
  }

  @Patch(':requestId/doa')
  markDoa(@Param('requestId') requestId: string, @CurrentUser('id') userId: string) {
    return this.service.markDoa(requestId, userId);
  }
}
