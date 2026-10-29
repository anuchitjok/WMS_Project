import { Body, Controller, Get, Param, Patch, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS } from '../auth/access';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { parseSpreadsheet } from '../common/spreadsheet';
import { MrpService } from './mrp.service';
import type { Principal } from './mrp.service';
import { MrpMasterService, SUPPLY_COLUMNS } from './mrp-master.service';
import {
  DecideOverrideDto, ForecastOverrideDto, MrpConfigDto, PlanningParamDto, RunMrpDto, SupplierDto, UpdatePlanningParamDto, UpdateSupplierDto,
} from './dto';

const UPLOAD_OPTS = { limits: { fileSize: 10 * 1024 * 1024 } };

/**
 * Material requirements planning. Every endpoint needs at least mrp.read;
 * writes need their own permission. Costs are stripped from every response
 * unless the caller has mrp.cost. Nothing here creates or changes purchasing
 * transactions — PO lines are imported for planning visibility only.
 */
@ApiTags('MRP')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Access(ACCESS.mrpView)
@Controller('mrp')
export class MrpController {
  constructor(
    private readonly mrp: MrpService,
    private readonly master: MrpMasterService,
  ) {}

  // Dashboard & runs
  @Get('dashboard') dashboard(@CurrentUser() u: Principal) { return this.mrp.dashboard(u); }

  @Post('runs')
  @Access(ACCESS.mrpRun)
  @ApiOperation({ summary: 'Run MRP now (stored with its inputs for comparison and reproduction)' })
  run(@CurrentUser() u: Principal, @Body() dto: RunMrpDto) { return this.mrp.run(u, dto); }

  @Get('runs') runs(@CurrentUser() u: Principal) { return this.mrp.listRuns(u); }
  @Get('runs/latest') latest(@CurrentUser() u: Principal) { return this.mrp.latestRun(u); }
  @Get('runs/compare') compare(@CurrentUser() u: Principal, @Query('base') base: string, @Query('target') target: string) { return this.mrp.compare(u, base, target); }
  @Get('runs/:id') getRun(@CurrentUser() u: Principal, @Param('id') id: string) { return this.mrp.getRun(u, id); }
  @Get('runs/:id/lines') lines(@CurrentUser() u: Principal, @Param('id') id: string, @Query() q: Record<string, string>) { return this.mrp.lines(u, id, q); }
  @Get('runs/:id/lines/:lineId') line(@CurrentUser() u: Principal, @Param('id') id: string, @Param('lineId') lineId: string) { return this.mrp.line(u, id, lineId); }
  @Get('runs/:id/verify') @ApiOperation({ summary: 'Recalculate the run from its stored inputs and report any difference' })
  verify(@CurrentUser() u: Principal, @Param('id') id: string) { return this.mrp.verify(u, id); }

  @Get('runs/:id/export')
  @Access(ACCESS.mrpExport)
  async export(@CurrentUser() u: Principal, @Param('id') id: string, @Res() res: Response) {
    const { filename, csv } = await this.mrp.exportCsv(u, id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(`﻿${csv}`);
  }

  // Analysis
  @Get('usage/:productId') usage(@CurrentUser() u: Principal, @Param('productId') id: string, @Query() q: { warehouseId?: string; granularity?: string; periods?: string }) { return this.mrp.usage(u, id, q); }
  @Get('forecast/:productId') forecast(@CurrentUser() u: Principal, @Param('productId') id: string, @Query('warehouseId') wh?: string) { return this.mrp.forecastWorkbench(u, id, wh); }
  @Get('preview/:productId') preview(@CurrentUser() u: Principal, @Param('productId') id: string, @Query('warehouseId') wh?: string) { return this.mrp.preview(u, id, wh); }
  @Get('cost/:productId') @Access(ACCESS.mrpCost) cost(@Param('productId') id: string) { return this.master.costHistory(id); }

  // Configuration
  @Get('config') config() { return this.master.getConfig(); }
  @Put('config') @Access(ACCESS.mrpConfig) updateConfig(@CurrentUser() u: Principal, @Body() dto: MrpConfigDto) { return this.master.updateConfig(u, dto.config); }

  // Planning parameters
  @Get('parameters') params(@CurrentUser() u: Principal, @Query() q: { search?: string; missing?: string; page?: string; pageSize?: string }) { return this.master.listParams(u, q); }
  @Get('parameters/:productId') paramHistory(@CurrentUser() u: Principal, @Param('productId') id: string) { return this.master.paramHistory(u, id); }
  @Post('parameters') @Access(ACCESS.mrpParameters) createParam(@CurrentUser() u: Principal, @Body() dto: PlanningParamDto) { return this.master.createParam(u, dto); }
  @Patch('parameters/:id') @Access(ACCESS.mrpParameters) updateParam(@CurrentUser() u: Principal, @Param('id') id: string, @Body() dto: UpdatePlanningParamDto) { return this.master.updateParam(u, id, dto); }

  // Approved suppliers
  @Get('suppliers') suppliers(@CurrentUser() u: Principal, @Query('productId') productId: string) { return this.master.listSuppliers(u, productId); }
  @Post('suppliers') @Access(ACCESS.mrpParameters) createSupplier(@CurrentUser() u: Principal, @Body() dto: SupplierDto) { return this.master.createSupplier(u, dto); }
  @Patch('suppliers/:id') @Access(ACCESS.mrpParameters) updateSupplier(@CurrentUser() u: Principal, @Param('id') id: string, @Body() dto: UpdateSupplierDto) { return this.master.updateSupplier(u, id, dto); }

  // Inbound supply (imported PO lines)
  @Get('supply') supply(@CurrentUser() u: Principal, @Query() q: Record<string, string>) { return this.master.listSupply(u, q); }
  @Get('supply/performance') performance(@CurrentUser() u: Principal) { return this.master.leadTimePerformance(u); }
  @Get('supply/template')
  template(@Res() res: Response) {
    const example = ['PO-1001', '1', 'SKU-CODE', 'VENDOR-CODE', 'WH-CODE', '100', '0', '0', 'unit', '12.50', 'THB', '2026-10-01', '2026-11-15', 'Y', 'OPEN', '', ''];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="po-lines-template.csv"');
    res.send(`﻿${SUPPLY_COLUMNS.join(',')}\n${example.join(',')}\n`);
  }
  @Post('supply/import/preview') @Access(ACCESS.mrpSupply) @ApiConsumes('multipart/form-data') @UseInterceptors(FileInterceptor('file', UPLOAD_OPTS))
  async importPreview(@CurrentUser() u: Principal, @UploadedFile() file: Express.Multer.File) { return this.master.previewSupplyImport(u, await parseSpreadsheet(file)); }
  @Post('supply/import/commit') @Access(ACCESS.mrpSupply) @ApiConsumes('multipart/form-data') @UseInterceptors(FileInterceptor('file', UPLOAD_OPTS))
  async importCommit(@CurrentUser() u: Principal, @UploadedFile() file: Express.Multer.File) { return this.master.commitSupplyImport(u, await parseSpreadsheet(file)); }

  // Forecast adjustments
  @Get('overrides') overrides(@CurrentUser() u: Principal, @Query() q: { status?: string; productId?: string }) { return this.master.listOverrides(u, q); }
  @Post('overrides') @Access(ACCESS.mrpForecast) createOverride(@CurrentUser() u: Principal, @Body() dto: ForecastOverrideDto) { return this.master.createOverride(u, dto); }
  @Patch('overrides/:id/decide') @Access(ACCESS.mrpForecastApprove) decide(@CurrentUser() u: Principal, @Param('id') id: string, @Body() dto: DecideOverrideDto) { return this.master.decideOverride(u, id, dto.approve, dto.note); }
  @Patch('overrides/:id/cancel') @Access(ACCESS.mrpForecast) cancel(@CurrentUser() u: Principal, @Param('id') id: string) { return this.master.cancelOverride(u, id); }
}
