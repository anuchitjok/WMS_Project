import { Body, Controller, Delete, Get, Patch, Param, Put, Query, UseGuards } from '@nestjs/common';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS } from '../auth/access';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  @SkipThrottle({ default: true, ip: true })
  @ApiOperation({ summary: 'Get my notifications' })
  mine(@CurrentUser('id') userId: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.svc.getUserNotifications(userId, Number(page ?? 1), Number(limit ?? 20));
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark notification as read' })
  markRead(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.svc.markRead(id, userId);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllRead(@CurrentUser('id') userId: string) {
    return this.svc.markAllRead(userId);
  }

  // ── Template administration (settings.manage) ─────────────────────────────
  @Get('templates')
  @Access(ACCESS.notificationTemplates)
  @ApiOperation({ summary: 'Notification templates: defaults, overrides and allowed variables' })
  templates() { return this.svc.listTemplates(); }

  @Put('templates/:type')
  @Access(ACCESS.notificationTemplates)
  @ApiOperation({ summary: 'Save a template override (validated variables)' })
  saveTemplate(@Param('type') type: string, @Body() dto: any, @CurrentUser('id') userId: string) {
    return this.svc.saveTemplate(type, dto, userId);
  }

  @Delete('templates/:type')
  @Access(ACCESS.notificationTemplates)
  @ApiOperation({ summary: 'Remove the override (back to the built-in default)' })
  resetTemplate(@Param('type') type: string, @CurrentUser('id') userId: string) {
    return this.svc.resetTemplate(type, userId);
  }

  @Get('delivery-status')
  @Access(ACCESS.notificationTemplates)
  @ApiOperation({ summary: 'Whether email delivery is configured (names missing settings, never values)' })
  deliveryStatus() { return this.svc.deliveryStatus(); }
}
