import { Controller, Get, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { RmaService } from './rma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS } from '../auth/access';
import { ConfirmUsageDto } from './dto/confirm-usage.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('RMA Usage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('rma')
export class RmaController {
  constructor(private readonly service: RmaService) {}

  @Get('pending-usage')
  pendingUsage() {
    return this.service.pendingUsage();
  }

  @Patch(':requestId/usage')
  @Access(ACCESS.rmaUsage)
  confirmUsage(
    @Param('requestId') requestId: string,
    @Body() body: ConfirmUsageDto,
    @CurrentUser() user: any,
  ) {
    return this.service.confirmUsage(requestId, body.usage, body.notes, user);
  }
}
