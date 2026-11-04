import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { WorkQueueService } from './work-queue.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { scopedWarehouseIds, warehouseFilter } from '../common/warehouse-scope';
import {
  ControlTowerService, DASHBOARD_GRANULARITIES, DASHBOARD_RANGES,
  type DashboardGranularity, type DashboardRange,
} from './control-tower.service';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly workQueue: WorkQueueService,
    private readonly controlTower: ControlTowerService,
  ) {}

  // Operations Control Tower — one read-only payload for the redesigned dashboard
  // (KPIs, inventory, trend, warehouse comparison, low stock, control counts).
  @Get('overview')
  @ApiOperation({ summary: 'Control Tower — KPIs, trend, warehouse comparison and alerts (read-only)' })
  getOverview(
    @Query('warehouseId') warehouseId?: string,
    @Query('range') range: string = '30d',
    @Query('granularity') granularity: string = 'day',
    @Query('tz') tz?: string,
    @CurrentUser() user?: any,
  ) {
    if (!DASHBOARD_RANGES.includes(range as DashboardRange)) throw new BadRequestException(`range must be one of ${DASHBOARD_RANGES.join(', ')}`);
    if (!DASHBOARD_GRANULARITIES.includes(granularity as DashboardGranularity)) throw new BadRequestException(`granularity must be one of ${DASHBOARD_GRANULARITIES.join(', ')}`);
    return this.controlTower.overview({
      filter: warehouseFilter(user, warehouseId),
      scope: scopedWarehouseIds(user),
      range: range as DashboardRange,
      granularity: granularity as DashboardGranularity,
      tz,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get dashboard KPIs and stats (legacy V1 — unchanged)' })
  getStats(@Query('warehouseId') warehouseId?: string, @CurrentUser() user?: any) {
    return this.dashboardService.getStats(warehouseFilter(user, warehouseId));
  }

  // ── Dashboard V2 additive endpoints (UI cutover deferred to Phase 2) ────────
  @Get('kpis')
  @ApiOperation({ summary: 'V2 Section A — executive KPI cards' })
  getKpis(@Query('warehouseId') warehouseId?: string, @CurrentUser() user?: any) {
    return this.dashboardService.getKpis(warehouseFilter(user, warehouseId));
  }

  @Get('inventory-health')
  @ApiOperation({ summary: 'V2 Section B — inventory health by status' })
  getInventoryHealth(@Query('warehouseId') warehouseId?: string, @CurrentUser() user?: any) {
    return this.dashboardService.getInventoryHealth(warehouseFilter(user, warehouseId));
  }

  // Phase 4: open work with next action, responsible person and waiting time (warehouse-scoped).
  @Get('work-queue')
  @ApiOperation({ summary: 'Work Queue — next action, owner and waiting time for every open item' })
  getWorkQueue(@Query('warehouseId') warehouseId?: string, @CurrentUser() user?: any) {
    return this.workQueue.list(warehouseFilter(user, warehouseId));
  }

  @Get('activity')
  @ApiOperation({ summary: 'V2 — operational activity feed (receiving/putaway/approval/shipment/RMA)' })
  getActivity(@Query('limit') limit?: string) {
    return this.dashboardService.getActivity(limit ? Number(limit) : 15);
  }
}
