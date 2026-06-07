import { Controller, Get, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { RmaService } from './rma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('RMA Usage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('rma')
export class RmaController {
  constructor(private readonly service: RmaService) {}

  @Get('pending-usage')
  pendingUsage() {
    return this.service.pendingUsage();
  }

  @Patch(':requestId/usage')
  confirmUsage(
    @Param('requestId') requestId: string,
    @Body() body: { usage: 'USED' | 'DOA' | 'DEFECTIVE' | 'WRONG_ITEM' | 'UNUSED'; notes?: string },
    @CurrentUser('id') userId: string,
  ) {
    return this.service.confirmUsage(requestId, body.usage, body.notes, userId);
  }
}
