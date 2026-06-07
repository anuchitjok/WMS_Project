import {
  Controller, Get, Post, Param, Query, UploadedFile, UseInterceptors, UseGuards, Res, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { DataioService } from './dataio.service';
import { ImportService } from './import.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { ImportType, ExportType, IMPORT_SCHEMAS } from './import-schemas';

const UPLOAD_OPTS = { limits: { fileSize: 10 * 1024 * 1024 } }; // 10 MB cap

@ApiTags('Data Import/Export')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('io')
export class DataioController {
  constructor(
    private readonly dataio: DataioService,
    private readonly importer: ImportService,
  ) {}

  private assertImportType(type: string): ImportType {
    if (!(type in IMPORT_SCHEMAS)) throw new BadRequestException(`Unknown import type: ${type}`);
    return type as ImportType;
  }

  @Get('template/:type')
  @ApiOperation({ summary: 'Download import template (.xlsx)' })
  async template(@Param('type') type: string, @Res() res: Response) {
    const t = this.assertImportType(type);
    const buf = await this.dataio.template(t);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="template-${t}.xlsx"`,
    });
    res.send(buf);
  }

  @Post('import/:type/preview')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE_SUPERVISOR)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTS))
  @ApiOperation({ summary: 'Parse + validate upload, return preview (no save)' })
  async preview(@Param('type') type: string, @UploadedFile() file: Express.Multer.File) {
    return this.importer.preview(this.assertImportType(type), file);
  }

  @Post('import/:type/commit')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE_SUPERVISOR)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTS))
  @ApiOperation({ summary: 'Import valid rows (partial), rollback on critical failure' })
  async commit(
    @Param('type') type: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
  ) {
    return this.importer.commit(this.assertImportType(type), file, userId);
  }

  @Get('export/:type')
  @ApiOperation({ summary: 'Export data as .xlsx or .csv' })
  async export(
    @Param('type') type: string,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    const valid: ExportType[] = ['inventory', 'audit', 'requests', 'reports'];
    if (!valid.includes(type as ExportType)) throw new BadRequestException(`Unknown export type: ${type}`);
    const fmt = format === 'csv' ? 'csv' : 'xlsx';
    const buf = await this.dataio.export(type as ExportType, fmt);
    const mime = fmt === 'csv'
      ? 'text/csv'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    res.set({
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${type}-${new Date().toISOString().slice(0, 10)}.${fmt}"`,
    });
    res.send(buf);
  }
}
