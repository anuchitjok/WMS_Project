import { Controller, Get, Query, Param, Res, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { ReportsService, ReportFilters, ReportType } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { warehouseFilter } from '../common/warehouse-scope';

const REPORTS: ReportType[] = ['master-data', 'balance', 'receive'];

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('summary')
  summary(@Query('warehouseId') warehouseId: string | undefined, @CurrentUser() user: any) {
    return this.service.summary(warehouseFilter(user, warehouseId));
  }

  /** Warehouse filter is always narrowed to the caller's scope (reads and exports alike). */
  private filters(q: Record<string, string>, user: any): ReportFilters {
    return { from: q.from, to: q.to, warehouseId: warehouseFilter(user, q.warehouseId), q: q.q };
  }

  private assertReport(report: string): ReportType {
    if (!REPORTS.includes(report as ReportType)) throw new BadRequestException(`Unknown report: ${report}`);
    return report as ReportType;
  }

  @Get('master-data')
  @ApiOperation({ summary: 'Master data report rows + column schema' })
  async masterData(@Query() q: Record<string, string>, @CurrentUser() user: any) {
    const f = this.filters(q, user);
    return { columns: this.service.schema('master-data'), rows: await this.service.masterData(f) };
  }

  @Get('balance')
  @ApiOperation({ summary: 'Balance report rows + column schema' })
  async balance(@Query() q: Record<string, string>, @CurrentUser() user: any) {
    const f = this.filters(q, user);
    return { columns: this.service.schema('balance'), rows: await this.service.balance(f) };
  }

  @Get('receive')
  @ApiOperation({ summary: 'Receive report rows + column schema' })
  async receive(@Query() q: Record<string, string>, @CurrentUser() user: any) {
    const f = this.filters(q, user);
    return { columns: this.service.schema('receive'), rows: await this.service.receive(f) };
  }

  @Get(':report/export')
  @ApiOperation({ summary: 'Export a report as .xlsx or .csv' })
  async export(@Param('report') report: string, @Query() q: Record<string, string>, @CurrentUser() user: any, @Res() res: Response) {
    const r = this.assertReport(report);
    const fmt = q.format === 'csv' ? 'csv' : 'xlsx';
    const buf = await this.service.export(r, fmt, this.filters(q, user));
    const mime = fmt === 'csv'
      ? 'text/csv'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    res.set({
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${r}-${new Date().toISOString().slice(0, 10)}.${fmt}"`,
    });
    res.send(buf);
  }
}
