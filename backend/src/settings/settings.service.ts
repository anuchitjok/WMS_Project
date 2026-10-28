import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DISABLED, SETTING_BY_KEY, SETTING_DEFINITIONS, parseSetting } from './setting-definitions';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  /** Every setting with its definition and parsed state, so the UI can show what is really in force. */
  async findAll() {
    let settings = await this.prisma.setting.findMany({ orderBy: { category: 'asc' } });
    if (settings.length === 0) {
      // seed defaults on first access (unchanged behaviour)
      await this.prisma.setting.createMany({
        data: SETTING_DEFINITIONS.map((d) => ({ key: d.key, label: d.label, value: d.seed, category: d.category })),
        skipDuplicates: true,
      });
      settings = await this.prisma.setting.findMany({ orderBy: { category: 'asc' } });
    }
    const rows = settings.map((s) => {
      const def = SETTING_BY_KEY.get(s.key);
      const parsed = def ? parseSetting(def, s.isActive === false ? DISABLED : s.value) : null;
      return {
        ...s,
        effect: def?.effect ?? 'informational',
        editable: def?.effect === 'enforced' && !(def.options?.length === 1 && !def.canDisable),
        accepts: def?.accepts ?? null,
        description: def?.description ?? s.description,
        options: def?.options ?? null,
        min: def?.min ?? null,
        max: def?.max ?? null,
        canDisable: def?.canDisable ?? false,
        state: parsed?.state ?? 'unknown',
        problem: parsed?.state === 'invalid' ? parsed.reason : null,
      };
    });
    // Defined settings with no row yet show as "missing" (built-in behaviour applies).
    for (const d of SETTING_DEFINITIONS) {
      if (!rows.some((r) => r.key === d.key)) {
        rows.push({
          id: '', key: d.key, label: d.label, value: '', category: d.category, description: d.description, isActive: true,
          updatedAt: null as unknown as Date, effect: d.effect, editable: d.effect === 'enforced', accepts: d.accepts,
          options: d.options ?? null, min: d.min ?? null, max: d.max ?? null, canDisable: d.canDisable ?? false,
          state: 'missing', problem: null,
        });
      }
    }
    return rows;
  }

  async update(key: string, value: string, userId: string) {
    const def = SETTING_BY_KEY.get(key);
    if (!def) throw new NotFoundException(`Unknown setting: ${key}`);
    if (def.effect !== 'enforced') {
      throw new BadRequestException(`${def.label} is not configurable here: ${def.accepts}`);
    }
    if (typeof value !== 'string') throw new BadRequestException('value must be a string');
    const parsed = parseSetting(def, value);
    if (parsed.state === 'invalid' || parsed.state === 'missing') {
      throw new BadRequestException(`${def.label}: ${parsed.state === 'invalid' ? parsed.reason : 'a value is required'} (accepts ${def.accepts})`);
    }
    const stored = parsed.state === 'disabled' ? DISABLED : String(parsed.value);
    const before = await this.prisma.setting.findUnique({ where: { key } });
    const setting = await this.prisma.setting.upsert({
      where: { key },
      update: { value: stored, isActive: true },
      create: { key, label: def.label, category: def.category, value: stored },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'SETTING_UPDATED', entityType: 'Setting', entityId: setting.id, detail: `${key}: ${before?.value ?? '(missing)'} → ${stored}` },
    });
    return setting;
  }
}
