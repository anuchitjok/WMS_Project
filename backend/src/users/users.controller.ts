import { Controller, Get, Post, Param, Patch, Delete, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { UserRole } from '@prisma/client';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('user.manage')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get() findAll(@Query('role') role?: UserRole) { return this.usersService.findAll(role); }
  @Get(':id') findOne(@Param('id') id: string) { return this.usersService.findOne(id); }
  @Get(':id/login-history') loginHistory(@Param('id') id: string) { return this.usersService.loginHistory(id); }

  @Post()
  @ApiOperation({ summary: 'Create user' })
  create(@Body() dto: CreateUserDto, @CurrentUser('id') actor: string) { return this.usersService.create(dto, actor); }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit user' })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser('id') actor: string) {
    return this.usersService.update(id, dto, actor);
  }

  @Patch(':id/toggle') toggle(@Param('id') id: string, @CurrentUser('id') actor: string) { return this.usersService.toggleActive(id, actor); }

  @Post(':id/reset-password')
  @ApiOperation({ summary: 'Reset password (returns temp password, forces change)' })
  resetPassword(@Param('id') id: string, @CurrentUser('id') actor: string) { return this.usersService.resetPassword(id, actor); }

  @Patch(':id/force-change') forceChange(@Param('id') id: string, @CurrentUser('id') actor: string) { return this.usersService.forceChange(id, actor); }

  @Patch(':id/warehouses')
  @ApiOperation({ summary: 'Set assigned warehouses' })
  setWarehouses(@Param('id') id: string, @Body('warehouseIds') ids: string[], @CurrentUser('id') actor: string) {
    return this.usersService.setWarehouses(id, ids, actor);
  }

  @Patch(':id/role')
  @ApiOperation({ summary: 'Assign dynamic RBAC role' })
  setRole(@Param('id') id: string, @Body('roleId') roleId: string | null, @CurrentUser('id') actor: string) {
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

  @Delete(':id') softDelete(@Param('id') id: string, @CurrentUser('id') actor: string) { return this.usersService.softDelete(id, actor); }
}
