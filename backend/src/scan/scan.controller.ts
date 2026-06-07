import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ScanService } from './scan.service';
import { BarcodeParserService } from './barcode-parser.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Scan')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class ScanController {
  constructor(
    private readonly scan: ScanService,
    private readonly parser: BarcodeParserService,
  ) {}

  @Post('scan')
  @ApiOperation({ summary: 'Execute a scan in a workflow context (transactional, idempotent)' })
  doScan(@Body() dto: any, @CurrentUser() user: any) {
    return this.scan.scan(dto, user);
  }

  @Post('scan/validate')
  @ApiOperation({ summary: 'Dry-run: parse + resolve, no state change' })
  validate(@Body('rawValue') rawValue: string) {
    return this.scan.validate(rawValue);
  }

  @Post('scan/batch')
  @ApiOperation({ summary: 'Offline replay: array of scans, idempotent' })
  batch(@Body('scans') scans: any[], @CurrentUser() user: any) {
    return this.scan.batch(scans ?? [], user);
  }

  @Get('scan/history')
  history(
    @Query('entityId') entityId?: string,
    @Query('serial') serial?: string,
    @Query('workflow') workflow?: string,
    @Query('limit') limit?: string,
  ) {
    return this.scan.history({ entityId, serial, workflow, limit: limit ? Number(limit) : undefined });
  }

  @Get('barcode/resolve/:raw')
  @ApiOperation({ summary: 'Parse + resolve a barcode to its entity' })
  resolve(@Param('raw') raw: string) {
    return this.scan.validate(decodeURIComponent(raw));
  }
}
