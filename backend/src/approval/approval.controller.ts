import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ApprovalService } from './approval.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Approval Engine')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('approvals')
export class ApprovalController {
  constructor(private readonly svc: ApprovalService) {}

  @Get('rules') findRules() { return this.svc.findRules(); }

  @Post('rules')
  @ApiOperation({ summary: 'Create approval rule with steps' })
  createRule(@Body() dto: any, @CurrentUser('id') userId: string) { return this.svc.createRule(dto, userId); }

  @Get() findAll(@Query('entityType') entityType?: string) { return this.svc.findAll(entityType); }

  @Get(':entityType/:entityId')
  getByEntity(@Param('entityType') entityType: string, @Param('entityId') entityId: string) {
    return this.svc.getByEntity(entityType, entityId);
  }

  @Post('start')
  @ApiOperation({ summary: 'Start approval chain for an entity' })
  start(@Body() dto: { entityType: string; entityId: string }, @CurrentUser('id') userId: string) {
    return this.svc.startApproval(dto.entityType, dto.entityId, userId);
  }

  @Patch(':instanceId/step/:stepOrder/decide')
  @ApiOperation({ summary: 'Approve or reject a step' })
  decide(
    @Param('instanceId') instanceId: string,
    @Param('stepOrder') stepOrder: string,
    @Body() body: { approved: boolean; notes?: string },
    @CurrentUser('id') userId: string,
  ) {
    return this.svc.decide(instanceId, Number(stepOrder), userId, body.approved, body.notes);
  }
}
