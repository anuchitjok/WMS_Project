import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Roles & Permissions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('role.manage')
@Controller('roles')
export class RolesController {
  constructor(private readonly service: RolesService) {}

  // literal routes first (avoid clashing with :id)
  @Get() list() { return this.service.listRoles(); }
  @Get('permissions') permissions() { return this.service.listPermissions(); }
  @Get('matrix') matrix() { return this.service.matrix(); }

  @Post('permissions')
  @ApiOperation({ summary: 'Create permission' })
  createPermission(@Body() dto: any, @CurrentUser() actor: any) { return this.service.createPermission(dto, actor); }

  @Patch('permissions/:permId')
  updatePermission(@Param('permId') permId: string, @Body() dto: any, @CurrentUser() actor: any) {
    return this.service.updatePermission(permId, dto, actor);
  }

  @Delete('permissions/:permId')
  deletePermission(@Param('permId') permId: string, @CurrentUser() actor: any) {
    return this.service.deletePermission(permId, actor);
  }

  @Post() create(@Body() dto: any, @CurrentUser() actor: any) { return this.service.create(dto, actor); }

  // role :id routes
  @Get(':id') get(@Param('id') id: string) { return this.service.getRole(id); }

  @Post(':id/clone')
  @ApiOperation({ summary: 'Clone role with its permissions' })
  clone(@Param('id') id: string, @Body('name') name: string, @CurrentUser() actor: any) {
    return this.service.clone(id, name, actor);
  }

  @Patch(':id/toggle')
  @ApiOperation({ summary: 'Enable/disable role' })
  toggle(@Param('id') id: string, @CurrentUser() actor: any) { return this.service.toggleActive(id, actor); }

  @Patch(':id/permissions')
  setPermissions(@Param('id') id: string, @Body('permissionCodes') codes: string[], @CurrentUser() actor: any) {
    return this.service.setPermissions(id, codes ?? [], actor);
  }

  @Delete(':id') remove(@Param('id') id: string, @CurrentUser() actor: any) { return this.service.remove(id, actor); }
}
