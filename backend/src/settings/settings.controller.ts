import { Controller, Get, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { SetupChecklistService } from './setup-checklist.service';
import { SystemSettingsService } from './system-settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS } from '../auth/access';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly service: SettingsService,
    private readonly setup: SetupChecklistService,
    private readonly system: SystemSettingsService,
  ) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  /** Phase 6: what is set up, what is missing, and where to fix it (read-only). */
  @Get('setup-checklist')
  @UseGuards(AccessGuard)
  @Access(ACCESS.masterData)
  setupChecklist() {
    return this.setup.checklist();
  }

  /** P7 7.1: which optional modules the web app shows (any signed-in user; read-only, no values beyond on/off). */
  @Get('modules')
  modules() {
    return this.system.moduleVisibility();
  }

  @Patch(':key')
  @UseGuards(AccessGuard)
  @Access(ACCESS.settings)
  update(@Param('key') key: string, @Body('value') value: string, @CurrentUser('id') userId: string) {
    return this.service.update(key, value, userId);
  }
}
