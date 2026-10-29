import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS } from '../auth/access';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateWarrantyRuleDto, UpdateWarrantyRuleDto, WarrantyDateDto } from './dto';
import { WarrantyService } from './warranty.service';

@ApiTags('Warranty')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Access(ACCESS.warrantyView)
@Controller('warranty')
export class WarrantyController {
  constructor(private readonly svc: WarrantyService) {}

  @Get('lookup')
  @ApiOperation({ summary: 'Warranty status of a serial number or stock item (logged with the matched rule)' })
  lookup(@CurrentUser() u: any, @Query() q: { serial?: string; stockItemId?: string; asOf?: string; context?: string; ref?: string }) {
    return this.svc.lookup(u, q);
  }

  @Get('history') history(@CurrentUser() u: any, @Query() q: { serial?: string; stockItemId?: string; take?: string }) { return this.svc.history(u, q); }

  @Get('rules') rules(@Query() q: { status?: string; search?: string }) { return this.svc.listRules(q); }
  @Get('rules/:ruleCode/versions') versions(@Param('ruleCode') code: string) { return this.svc.ruleVersions(code); }
  @Post('rules') @Access(ACCESS.warrantyManage) create(@CurrentUser() u: any, @Body() dto: CreateWarrantyRuleDto) { return this.svc.createRule(u, dto); }
  @Patch('rules/:id') @Access(ACCESS.warrantyManage) update(@CurrentUser() u: any, @Param('id') id: string, @Body() dto: UpdateWarrantyRuleDto) { return this.svc.updateDraft(u, id, dto); }
  @Post('rules/:id/new-version') @Access(ACCESS.warrantyManage) newVersion(@CurrentUser() u: any, @Param('id') id: string) { return this.svc.newVersion(u, id); }
  @Patch('rules/:id/activate') @Access(ACCESS.warrantyManage) activate(@CurrentUser() u: any, @Param('id') id: string) { return this.svc.activate(u, id); }
  @Patch('rules/:id/deactivate') @Access(ACCESS.warrantyManage) deactivate(@CurrentUser() u: any, @Param('id') id: string) { return this.svc.deactivate(u, id); }

  @Get('dates') dates(@Query('serial') serial: string) { return this.svc.listDates(serial ?? ''); }
  @Put('dates') @Access(ACCESS.warrantyManage) recordDate(@CurrentUser() u: any, @Body() dto: WarrantyDateDto) { return this.svc.recordDate(u, dto); }
}
