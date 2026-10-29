import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS } from '../auth/access';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PlanningService } from './planning.service';
import { PlanningTemplatesService } from './planning-templates.service';
import type { Principal } from './planning.service';
import {
  CreateProjectDto,
  CreateScenarioDto,
  CreateTemplateDto,
  DecisionDto,
  TemplateDecisionDto,
  UpdateTemplateDto,
  SubmitPlanDto,
  UpdateProjectDto,
  UpdateScenarioDto,
} from './dto/planning.dto';

/**
 * Project Planning & Resource Calculator — PLANNING ONLY.
 * No endpoint here reserves stock, creates purchase orders or posts warehouse
 * transactions. Every endpoint is warehouse-scoped (see common/warehouse-scope).
 */
@ApiTags('Project Planning')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Access(ACCESS.planningRead)
@Controller('planning')
export class PlanningController {
  constructor(
    private readonly svc: PlanningService,
    private readonly tpl: PlanningTemplatesService,
  ) {}

  // ── company templates (confirmed standard values; never costs) ──────────
  @Get('company-templates')
  listTemplates(@CurrentUser() u: Principal, @Query('status') status?: string) {
    return this.tpl.list(
      u,
      ['DRAFT', 'CONFIRMED', 'RETIRED'].includes(status ?? '') ? status : undefined,
    );
  }

  @Get('company-templates/:id')
  template(@Param('id') id: string) {
    return this.tpl.detail(id);
  }

  @Post('company-templates')
  @Access(ACCESS.planningManage)
  @ApiOperation({ summary: 'Save a calculated run as a draft company template' })
  createTemplate(@Body() dto: CreateTemplateDto, @CurrentUser() u: Principal) {
    return this.tpl.create(dto, u);
  }

  @Patch('company-templates/:id')
  @Access(ACCESS.planningManage)
  updateTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
    @CurrentUser() u: Principal,
  ) {
    return this.tpl.update(id, dto, u);
  }

  @Post('company-templates/:id/confirm')
  @Access(ACCESS.planningApprove)
  @ApiOperation({ summary: 'Confirm a draft template (second person; basis required)' })
  confirmTemplate(
    @Param('id') id: string,
    @Body() dto: TemplateDecisionDto,
    @CurrentUser() u: Principal,
  ) {
    return this.tpl.confirm(id, dto, u);
  }

  @Post('company-templates/:id/retire')
  @Access(ACCESS.planningApprove)
  retireTemplate(
    @Param('id') id: string,
    @Body() dto: TemplateDecisionDto,
    @CurrentUser() u: Principal,
  ) {
    return this.tpl.retire(id, dto, u);
  }

  @Delete('company-templates/:id')
  @Access(ACCESS.planningManage)
  deleteTemplate(@Param('id') id: string, @CurrentUser() u: Principal) {
    return this.tpl.remove(id, u);
  }

  @Get('templates')
  @ApiOperation({
    summary:
      'Workflow templates (stage structure only — no productivity values)',
  })
  templates() {
    return this.svc.templates();
  }

  @Get('owners')
  owners(@CurrentUser() u: Principal) {
    return this.svc.owners(u);
  }

  @Get('projects')
  list(
    @CurrentUser() u: Principal,
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('purpose') purpose?: string,
  ) {
    return this.svc.listProjects(u, {
      warehouseId,
      status,
      search,
      purpose: purpose === 'SALES' || purpose === 'OPERATIONAL' ? purpose : undefined,
    });
  }

  @Post('projects')
  @Access(ACCESS.planningManage)
  create(@Body() dto: CreateProjectDto, @CurrentUser() u: Principal) {
    return this.svc.createProject(dto, u);
  }

  @Get('projects/:id')
  get(@Param('id') id: string, @CurrentUser() u: Principal) {
    return this.svc.getProject(id, u);
  }

  @Patch('projects/:id')
  @Access(ACCESS.planningManage)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() u: Principal,
  ) {
    return this.svc.updateProject(id, dto, u);
  }

  @Post('projects/:id/scenarios')
  @Access(ACCESS.planningManage)
  createScenario(
    @Param('id') id: string,
    @Body() dto: CreateScenarioDto,
    @CurrentUser() u: Principal,
  ) {
    return this.svc.createScenario(id, dto, u);
  }

  @Patch('projects/:id/scenarios/:scenarioId')
  @Access(ACCESS.planningManage)
  updateScenario(
    @Param('id') id: string,
    @Param('scenarioId') sid: string,
    @Body() dto: UpdateScenarioDto,
    @CurrentUser() u: Principal,
  ) {
    return this.svc.updateScenario(id, sid, dto, u);
  }

  @Delete('projects/:id/scenarios/:scenarioId')
  @Access(ACCESS.planningManage)
  deleteScenario(
    @Param('id') id: string,
    @Param('scenarioId') sid: string,
    @CurrentUser() u: Principal,
  ) {
    return this.svc.deleteScenario(id, sid, u);
  }

  @Post('projects/:id/scenarios/:scenarioId/calculate')
  @Access(ACCESS.planningManage)
  @ApiOperation({
    summary:
      'Calculate the plan and store a traceable run (reads WMS data; writes nothing operational)',
  })
  calculate(
    @Param('id') id: string,
    @Param('scenarioId') sid: string,
    @CurrentUser() u: Principal,
  ) {
    return this.svc.calculate(id, sid, u);
  }

  @Get('projects/:id/runs/:runId')
  run(
    @Param('id') id: string,
    @Param('runId') runId: string,
    @CurrentUser() u: Principal,
  ) {
    return this.svc.getRun(id, runId, u);
  }

  @Get('projects/:id/runs/:runId/customer-summary')
  @ApiOperation({
    summary:
      'Customer-facing one-page summary of a run (whitelisted: no costs, rates, stock or internal risks)',
  })
  customerSummary(
    @Param('id') id: string,
    @Param('runId') runId: string,
    @CurrentUser() u: Principal,
  ) {
    return this.svc.customerSummary(id, runId, u);
  }

  @Post('projects/:id/runs/:runId/verify')
  @ApiOperation({
    summary:
      'Recalculate a stored run from its own snapshot and confirm the result is identical',
  })
  verify(
    @Param('id') id: string,
    @Param('runId') runId: string,
    @CurrentUser() u: Principal,
  ) {
    return this.svc.verifyRun(id, runId, u);
  }

  @Get('projects/:id/compare')
  compare(
    @Param('id') id: string,
    @Query('runIds') runIds: string,
    @CurrentUser() u: Principal,
  ) {
    return this.svc.compare(
      id,
      (runIds ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      u,
    );
  }

  @Post('projects/:id/submit')
  @Access(ACCESS.planningManage)
  submit(
    @Param('id') id: string,
    @Body() dto: SubmitPlanDto,
    @CurrentUser() u: Principal,
  ) {
    return this.svc.submit(id, dto.runId, dto.note, u);
  }

  @Post('projects/:id/approve')
  @Access(ACCESS.planningApprove)
  @ApiOperation({
    summary:
      'Approve the submitted plan for planning (not an execution release; maker ≠ checker)',
  })
  approve(
    @Param('id') id: string,
    @Body() dto: DecisionDto,
    @CurrentUser() u: Principal,
  ) {
    return this.svc.decide(id, true, dto.note, u);
  }

  @Post('projects/:id/reject')
  @Access(ACCESS.planningApprove)
  reject(
    @Param('id') id: string,
    @Body() dto: DecisionDto,
    @CurrentUser() u: Principal,
  ) {
    return this.svc.decide(id, false, dto.note, u);
  }

  @Post('projects/:id/reopen')
  @Access(ACCESS.planningManage)
  reopen(@Param('id') id: string, @CurrentUser() u: Principal) {
    return this.svc.reopen(id, u);
  }

  @Post('projects/:id/archive')
  @Access(ACCESS.planningManage)
  archive(@Param('id') id: string, @CurrentUser() u: Principal) {
    return this.svc.archive(id, u);
  }
}
