import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  HIDDEN_MODULES_KEY,
  MODULE_KEYS,
  ModuleKey,
  SETTING_BY_KEY,
  SettingValue,
  hiddenModulesFrom,
  parseSetting,
} from './setting-definitions';

/**
 * Typed, read-only access to system settings for business services.
 * Reads the DB on each call (one indexed row) so a change made on the
 * Settings page applies on the next operation, on every instance.
 */
@Injectable()
export class SystemSettingsService {
  constructor(private prisma: PrismaService) {}

  async get(key: string): Promise<SettingValue<string | number>> {
    const def = SETTING_BY_KEY.get(key);
    if (!def) throw new Error(`Unknown setting ${key}`);
    const row = await this.prisma.setting.findUnique({
      where: { key },
      select: { value: true, isActive: true },
    });
    if (!row) return { state: 'missing' };
    // An inactive row is an explicit "off" switch.
    if (row.isActive === false)
      return def.canDisable ? { state: 'disabled' } : { state: 'missing' };
    return parseSetting(def, row.value);
  }

  private async number(key: string): Promise<number | null> {
    const v = await this.get(key);
    return v.state === 'configured' && typeof v.value === 'number'
      ? v.value
      : null;
  }

  /** Default low-stock threshold, or null when missing / disabled / invalid (then only Product.minStock applies). */
  lowStockThreshold() {
    return this.number('stock.lowThreshold');
  }

  /** RTV aging SLA in days, or null when not in force. */
  rtvAgingSlaDays() {
    return this.number('rtv.agingSla');
  }

  /** Audit retention in days, or null when not in force (archiving refused). */
  auditRetentionDays() {
    return this.number('audit.retention');
  }

  /** Cycle-count period, or null when not in force. */
  async cycleCountFrequency(): Promise<
    'weekly' | 'monthly' | 'quarterly' | null
  > {
    const v = await this.get('cycleCount.frequency');
    return v.state === 'configured'
      ? (v.value as 'weekly' | 'monthly' | 'quarterly')
      : null;
  }

  /**
   * Optional modules hidden from the web app (P7 7.1). Falls back to the
   * built-in default (all hidden) while the setting is missing or invalid.
   */
  async moduleVisibility(): Promise<{
    hidden: ModuleKey[];
    visible: Record<ModuleKey, boolean>;
    source: 'configured' | 'default';
  }> {
    const parsed = await this.get(HIDDEN_MODULES_KEY);
    const hidden = hiddenModulesFrom(parsed);
    const visible = Object.fromEntries(
      MODULE_KEYS.map((k) => [k, !hidden.includes(k)]),
    ) as Record<ModuleKey, boolean>;
    return {
      hidden,
      visible,
      source: parsed.state === 'configured' ? 'configured' : 'default',
    };
  }
}
