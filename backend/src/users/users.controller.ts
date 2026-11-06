import { Controller, Get, Post, Param, Patch, Delete, Body, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { UserRole } from '@prisma/client';
import { UserWarehouseAccessGuard } from './user-access.guard';
import { usersCapabilities } from './user-access';
import { ACCESS, hasAccess } from '../auth/access';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('user.manage')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // P1 1.7: list, export and warehouse assignment are also open to Warehouse Managers.
  // `@RequirePermissions()` (no codes) lifts the class-level user.manage requirement
  // for that one route; UserWarehouseAccessGuard then applies the narrower rule.
  @Get()
  @RequirePermissions()
  @UseGuards(UserWarehouseAccessGuard)
  findAll(@Query('role') role?: UserRole) { return this.usersService.findAll(role); }

  /** What the caller may do on the Users screen (any signed-in user; their own flags only). */
  @Get('capabilities')
  @RequirePermissions()
  capabilities(@CurrentUser() actor: any) {
    return usersCapabilities(actor, hasAccess(actor, ACCESS.dataImport));
  }

  /** P7 7.2: users as .xlsx/.csv — never passwords, hashes or tokens. */
  @Get('export')
  @RequirePermissions()
  @UseGuards(UserWarehouseAccessGuard)
  @ApiOperation({ summary: 'Export users (.xlsx or .csv) — no passwords' })
  async export(@Query('format') format: string, @Res() res: Response) {
    const fmt = format === 'csv' ? 'csv' : 'xlsx';
    const buf = await this.usersService.exportUsers(fmt);
    res.set({
      'Content-Type': fmt === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="users-${new Date().toISOString().slice(0, 10)}.${fmt}"`,
    });
    res.send(buf);
  }

  @Get(':id') findOne(@Param('id') id: string) { return this.usersService.findOne(id); }
  @Get(':id/login-history') loginHistory(@Param('id') id: string) { return this.usersService.loginHistory(id); }

  @Post()
  @ApiOperation({ summary: 'Create user' })
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: any) { return this.usersService.create(dto, actor); }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit user' })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: any) {
    return this.usersService.update(id, dto, actor);
  }

  @Patch(':id/toggle') toggle(@Param('id') id: string, @CurrentUser() actor: any) { return this.usersService.toggleActive(id, actor); }

  @Post(':id/reset-password')
  @ApiOperation({ summary: 'Reset password (returns temp password, forces change)' })
  resetPassword(@Param('id') id: string, @CurrentUser() actor: any) { return this.usersService.resetPassword(id, actor); }

  @Patch(':id/force-change') forceChange(@Param('id') id: string, @CurrentUser() actor: any) { return this.usersService.forceChange(id, actor); }

  @Patch(':id/warehouses')
  @RequirePermissions()
  @UseGuards(UserWarehouseAccessGuard)
  @ApiOperation({ summary: 'Set assigned warehouses' })
  setWarehouses(@Param('id') id: string, @Body('warehouseIds') ids: string[], @CurrentUser() actor: any) {
    return this.usersService.setWarehouses(id, ids, actor);
  }

  @Patch(':id/role')
  @ApiOperation({ summary: 'Assign dynamic RBAC role' })
  setRole(@Param('id') id: string, @Body('roleId') roleId: string | null, @CurrentUser() actor: any) {
    return this.usersService.setRole(id, roleId, actor);
  }

  @Get(':id/role-assignments') roleAssignments(@Param('id') id: string) { return this.usersService.listRoleAssignments(id); }

  @Post(':id/role-assignments')
  @ApiOperation({ summary: 'Assign role (multi-role + optional warehouse/department scope + expiry)' })
  assignRole(@Param('id') id: string, @Body() dto: any, @CurrentUser() actor: any) {
    return this.usersService.assignRole(id, dto, actor);
  }

  @Delete(':id/role-assignments/:assignmentId')
  unassignRole(@Param('id') id: string, @Param('assignmentId') aid: string, @CurrentUser() actor: any) {
    return this.usersService.unassignRole(id, aid, actor);
  }

  @Delete(':id') softDelete(@Param('id') id: string, @CurrentUser() actor: any) { return this.usersService.softDelete(id, actor); }
}
