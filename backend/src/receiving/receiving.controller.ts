import {
  Controller, Get, Post, Patch, Body, Param, Query, Res, UseGuards,
  UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import type { Response } from 'express';
import { ReceivingService } from './receiving.service';
import { ReceivingImportService } from './receiving-import.service';
import type { ReceivingImportHeader } from './receiving-import.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS } from '../auth/access';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateReceivingDto } from './dto/create-receiving.dto';
import { InspectReceivingDto } from './dto/inspect-receiving.dto';

const UPLOAD_OPTS = { limits: { fileSize: 10 * 1024 * 1024 } }; // 10 MB cap

@ApiTags('Receiving')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('receiving')
export class ReceivingController {
  constructor(
    private readonly service: ReceivingService,
    private readonly importer: ReceivingImportService,
  ) {}

  @Get()
  findAll(@Query('status') status: string | undefined, @CurrentUser() user: any) {
    return this.service.findAll(status, user);
  }

  // ── Bulk import (one file = one goods receipt) ───────────────────────────
  @Get('import/template')
  @ApiOperation({ summary: 'Download Goods Receiving import template (.xlsx)' })
  async importTemplate(@Res() res: Response) {
    const buf = await this.importer.template();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="template-receiving.xlsx"',
    });
    res.send(buf);
  }

  @Post('import/preview')
  @UseGuards(AccessGuard)
  @Access(ACCESS.receiving)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTS))
  @ApiOperation({ summary: 'Parse + validate receiving file, return preview (no save)' })
  importPreview(@UploadedFile() file: Express.Multer.File) {
    return this.importer.preview(file);
  }

  @Post('import/commit')
  @UseGuards(AccessGuard)
  @Access(ACCESS.receiving)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTS))
  @ApiOperation({ summary: 'Create one Goods Receiving from valid file rows' })
  importCommit(
    @UploadedFile() file: Express.Multer.File,
    @Body() header: ReceivingImportHeader,
    @CurrentUser() user: any,
  ) {
    return this.importer.commit(header, file, user.id, user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findOne(id, user);
  }

  @Post()
  @UseGuards(AccessGuard)
  @Access(ACCESS.receiving)
  create(@Body() dto: CreateReceivingDto, @CurrentUser() user: any) {
    return this.service.create(dto, user.id, user);
  }

  @Patch(':id/inspect')
  @UseGuards(AccessGuard)
  @Access(ACCESS.receiving)
  @ApiOperation({ summary: 'Submit per-item inspection outcomes — drives final stock routing' })
  inspect(@Param('id') id: string, @Body() dto: InspectReceivingDto, @CurrentUser() user: any) {
    return this.service.inspect(id, dto, user.id, user);
  }

  @Patch(':id/verify')
  @UseGuards(AccessGuard)
  @Access(ACCESS.receiving)
  @ApiOperation({ summary: 'Legacy single-click verify (backward compat)' })
  verify(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.verify(id, user.id, user);
  }
}
