import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS } from '../auth/access';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuditRetentionService } from './audit-retention.service';

@ApiTags('Audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Access(ACCESS.settings)
@Controller('audit/retention')
export class AuditRetentionController {
  constructor(private readonly svc: AuditRetentionService) {}

  @Get('preview')
  @ApiOperation({
    summary:
      'Dry run: how many operational audit entries the retention setting would archive',
  })
  preview() {
    return this.svc.preview();
  }

  @Post('archive')
  @ApiOperation({
    summary:
      'Move eligible entries to AuditLogArchive (requires { confirm: true }); idempotent',
  })
  archive(
    @Body('confirm') confirm: boolean,
    @CurrentUser('id') userId: string,
  ) {
    return this.svc.archive(userId, { confirm: confirm === true });
  }
}
