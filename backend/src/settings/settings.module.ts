import { Global, Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { SystemSettingsService } from './system-settings.service';
import { SetupChecklistService } from './setup-checklist.service';

/** Global so any business module can read typed settings via SystemSettingsService. */
@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsService, SystemSettingsService, SetupChecklistService],
  exports: [SystemSettingsService],
})
export class SettingsModule {}
