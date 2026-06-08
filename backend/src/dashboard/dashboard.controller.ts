import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get dashboard KPIs and stats (legacy V1 — unchanged)' })
  getStats() {
    return this.dashboardService.getStats();
  }

  // ── Dashboard V2 additive endpoints (UI cutover deferred to Phase 2) ────────
  @Get('kpis')
  @ApiOperation({ summary: 'V2 Section A — executive KPI cards' })
  getKpis(@Query('warehouseId') warehouseId?: string) {
    return this.dashboardService.getKpis(warehouseId);
  }

  @Get('inventory-health')
  @ApiOperation({ summary: 'V2 Section B — inventory health by status' })
  getInventoryHealth(@Query('warehouseId') warehouseId?: string) {
    return this.dashboardService.getInventoryHealth(warehouseId);
  }

  @Get('activity')
  @ApiOperation({ summary: 'V2 — operational activity feed (receiving/putaway/approval/shipment/RMA)' })
  getActivity(@Query('limit') limit?: string) {
    return this.dashboardService.getActivity(limit ? Number(limit) : 15);
  }
}
