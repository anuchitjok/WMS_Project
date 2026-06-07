import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_SETTINGS = [
  { key: 'approval.workflow', label: 'Approval workflow by role and department', value: 'enabled', category: 'workflow' },
  { key: 'stock.reservation', label: 'Stock reservation and release rule', value: 'auto', category: 'workflow' },
  { key: 'serial.duplicate', label: 'Serial number duplicate control', value: 'strict', category: 'validation' },
  { key: 'stock.lowThreshold', label: 'Low stock threshold', value: '5', category: 'inventory' },
  { key: 'rtv.agingSla', label: 'RTV aging SLA (days)', value: '7', category: 'sla' },
  { key: 'notification.template', label: 'Notification template', value: 'default', category: 'notification' },
  { key: 'warehouse.capacityRule', label: 'Warehouse capacity rule', value: 'enabled', category: 'inventory' },
  { key: 'audit.retention', label: 'Audit log retention (days)', value: '365', category: 'validation' },
  { key: 'cycleCount.frequency', label: 'Cycle count frequency', value: 'monthly', category: 'inventory' },
];

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    let settings = await this.prisma.setting.findMany({ orderBy: { category: 'asc' } });
    if (settings.length === 0) {
      // seed defaults on first access
      await this.prisma.setting.createMany({ data: DEFAULT_SETTINGS });
      settings = await this.prisma.setting.findMany({ orderBy: { category: 'asc' } });
    }
    return settings;
  }

  async update(key: string, value: string, userId: string) {
    const setting = await this.prisma.setting.update({ where: { key }, data: { value } });
    await this.prisma.auditLog.create({
      data: { userId, action: 'SETTING_UPDATED', entityType: 'Setting', entityId: setting.id, detail: `${key} = ${value}` },
    });
    return setting;
  }
}
