import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ApprovalService, APPROVAL_ENTITY_TYPES } from './approval.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS } from '../auth/access';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Approval Engine')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('approvals')
export class ApprovalController {
  constructor(private readonly svc: ApprovalService) {}

  @Get('rules') findRules() { return this.svc.findRules(); }

  @Post('rules')
  @Access(ACCESS.approvalRules)
  @ApiOperation({ summary: 'Create approval rule with steps' })
  createRule(@Body() dto: any, @CurrentUser('id') userId: string) { return this.svc.createRule(dto, userId); }

  @Get('rules/meta')
  @ApiOperation({ summary: 'Entity types a rule can target' })
  rulesMeta() { return { entityTypes: APPROVAL_ENTITY_TYPES }; }

  @Patch('rules/:id')
  @Access(ACCESS.approvalRules)
  @ApiOperation({ summary: 'Replace an approval rule (in-flight approvals keep their steps)' })
  updateRule(@Param('id') id: string, @Body() dto: any, @CurrentUser('id') userId: string) { return this.svc.updateRule(id, dto, userId); }

  @Patch('rules/:id/active')
  @Access(ACCESS.approvalRules)
  @ApiOperation({ summary: 'Enable or disable an approval rule' })
  setRuleActive(@Param('id') id: string, @Body('isActive') isActive: boolean, @CurrentUser('id') userId: string) {
    return this.svc.setRuleActive(id, isActive === true, userId);
  }

  @Get() findAll(@Query('entityType') entityType?: string) { return this.svc.findAll(entityType); }

  @Get(':entityType/:entityId')
  getByEntity(@Param('entityType') entityType: string, @Param('entityId') entityId: string) {
    return this.svc.getByEntity(entityType, entityId);
  }

  @Post('start')
  @Access(ACCESS.approvalDecide)
  @ApiOperation({ summary: 'Start approval chain for an entity' })
  start(@Body() dto: { entityType: string; entityId: string }, @CurrentUser('id') userId: string) {
    return this.svc.startApproval(dto.entityType, dto.entityId, userId);
  }

  @Patch(':instanceId/step/:stepOrder/decide')
  @Access(ACCESS.approvalDecide)
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
