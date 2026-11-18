import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_HIDDEN_MODULES,
  HIDDEN_MODULES_KEY,
  SETTING_BY_KEY,
  hiddenModulesFrom,
  parseSetting,
} from './setting-definitions';
import { SettingsService } from './settings.service';
import { SystemSettingsService } from './system-settings.service';

const def = SETTING_BY_KEY.get(HIDDEN_MODULES_KEY)!;

describe('ui.hiddenModules setting', () => {
  it('is defined, enforced and seeded with warranty and mrp hidden (floorPlan2d shipped in Phase 3)', () => {
    expect(def).toBeDefined();
    expect(def.effect).toBe('enforced');
    expect(def.seed).toBe('warranty,mrp');
    expect(DEFAULT_HIDDEN_MODULES).toEqual(['warranty', 'mrp']);
    // floorPlan2d is deliberately NOT here: the 2D editor ships on from Phase 3.
    // Re-adding it would hide RQ8-RQ12 and RQ27 from every new installation.
    expect(DEFAULT_HIDDEN_MODULES).not.toContain('floorPlan2d');
  });

  it('accepts known module keys, trimmed, de-duplicated and in catalogue order', () => {
    expect(parseSetting(def, ' mrp , warranty,mrp ')).toEqual({ state: 'configured', value: 'warranty,mrp' });
    expect(parseSetting(def, 'floorPlan2d')).toEqual({ state: 'configured', value: 'floorPlan2d' });
  });

  it('accepts an empty value as "show every module"', () => {
    expect(parseSetting(def, '')).toEqual({ state: 'configured', value: '' });
    expect(parseSetting(def, ' , ')).toEqual({ state: 'configured', value: '' });
  });

  it('rejects unknown module keys (nothing is silently dropped)', () => {
    const r = parseSetting(def, 'warranty,planning');
    expect(r.state).toBe('invalid');
    expect((r as any).reason).toContain('planning');
    expect(parseSetting(def, 'WARRANTY').state).toBe('invalid');
    expect(parseSetting(def, 'warranty;mrp').state).toBe('invalid');
  });

  it('cannot be "disabled"', () => {
    expect(parseSetting(def, 'disabled').state).toBe('invalid');
  });

  it('falls back to the built-in default when missing or invalid', () => {
    expect(hiddenModulesFrom({ state: 'missing' })).toEqual(['warranty', 'mrp']);
    expect(hiddenModulesFrom({ state: 'invalid', raw: 'x', reason: 'x' })).toEqual(['warranty', 'mrp']);
    expect(hiddenModulesFrom({ state: 'configured', value: '' })).toEqual([]);
    expect(hiddenModulesFrom({ state: 'configured', value: 'mrp' })).toEqual(['mrp']);
  });

  it('does not change how existing settings parse', () => {
    expect(parseSetting(SETTING_BY_KEY.get('stock.lowThreshold')!, '10')).toEqual({ state: 'configured', value: 10 });
    expect(parseSetting(SETTING_BY_KEY.get('cycleCount.frequency')!, 'weekly')).toEqual({ state: 'configured', value: 'weekly' });
  });
});

describe('SettingsService.update — ui.hiddenModules', () => {
  function make() {
    const prisma: any = {
      setting: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }: any) => Promise.resolve({ id: 's1', ...create })),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    return { prisma, svc: new SettingsService(prisma) };
  }

  it('stores the normalised list and audits the change', async () => {
    const { prisma, svc } = make();
    await svc.update(HIDDEN_MODULES_KEY, 'mrp, warranty', 'admin');
    expect(prisma.setting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { value: 'warranty,mrp', isActive: true },
    }));
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it('refuses an unknown module key without writing', async () => {
    const { prisma, svc } = make();
    await expect(svc.update(HIDDEN_MODULES_KEY, 'warranty,reports', 'admin')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
  });
});

describe('SystemSettingsService.moduleVisibility', () => {
  const make = (row: any) => new SystemSettingsService({ setting: { findUnique: jest.fn().mockResolvedValue(row) } } as any);

  it('hides warranty and mrp while no row exists, and shows the 2D floor plan', async () => {
    await expect(make(null).moduleVisibility()).resolves.toEqual({
      hidden: ['warranty', 'mrp'],
      visible: { warranty: false, mrp: false, floorPlan2d: true },
      source: 'default',
    });
  });

  it('applies a configured list', async () => {
    await expect(make({ value: 'floorPlan2d', isActive: true }).moduleVisibility()).resolves.toEqual({
      hidden: ['floorPlan2d'],
      visible: { warranty: true, mrp: true, floorPlan2d: false },
      source: 'configured',
    });
  });

  it('uses the default for an invalid stored value', async () => {
    const r = await make({ value: 'bogus', isActive: true }).moduleVisibility();
    expect(r.source).toBe('default');
    expect(r.hidden).toEqual(['warranty', 'mrp']);
  });
});
