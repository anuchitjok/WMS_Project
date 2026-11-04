import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionCacheService } from '../rbac/permission-cache.service';
import { diffFields, type ChangeSet } from '../common/audit-diff';

interface Actor { id: string; roleKey?: string; permissions?: string[] }

@Injectable()
export class RolesService {
  constructor(
    private prisma: PrismaService,
    private cache: PermissionCacheService,
  ) {}

  private isSuper(actor: Actor) {
    return actor.roleKey === 'SUPER_ADMIN';
  }

  // Prevent privilege escalation: a non-super actor may only grant codes they hold
  private assertCanGrant(actor: Actor, codes: string[]) {
    if (this.isSuper(actor)) return;
    const held = new Set(actor.permissions ?? []);
    const escalating = codes.filter((c) => !held.has(c));
    if (escalating.length) {
      throw new ForbiddenException(`Cannot grant permissions you do not hold: ${escalating.join(', ')}`);
    }
  }

  // ── Roles ─────────────────────────────────────────────────────────────────
  listRoles() {
    return this.prisma.role.findMany({
      include: { _count: { select: { permissions: true, users: true, assignments: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getRole(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    return { ...role, permissionCodes: role.permissions.map((p) => p.permission.code) };
  }

  listPermissions() {
    return this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { action: 'asc' }] });
  }

  async matrix() {
    const [roles, permissions] = await Promise.all([
      this.prisma.role.findMany({
        include: { permissions: { select: { permissionId: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { action: 'asc' }] }),
    ]);
    return {
      permissions,
      roles: roles.map((r) => ({
        id: r.id, key: r.key, name: r.name, isSystem: r.isSystem, isActive: r.isActive,
        permissionIds: r.permissions.map((p) => p.permissionId),
      })),
    };
  }

  async create(dto: { key: string; name: string; description?: string; permissionCodes?: string[] }, actor: Actor) {
    const key = dto.key.trim().toUpperCase().replace(/\s+/g, '_');
    if (key === 'SUPER_ADMIN') throw new ForbiddenException('SUPER_ADMIN is reserved');
    if (await this.prisma.role.findUnique({ where: { key } })) throw new ConflictException(`Role key already exists: ${key}`);

    const codes = dto.permissionCodes ?? [];
    this.assertCanGrant(actor, codes);
    const perms = codes.length ? await this.prisma.permission.findMany({ where: { code: { in: codes } } }) : [];

    const role = await this.prisma.role.create({
      data: { key, name: dto.name, description: dto.description, isSystem: false,
        permissions: { create: perms.map((p) => ({ permissionId: p.id })) } },
    });
    await this.audit(actor.id, 'ROLE_CREATED', role.id, role.key);
    this.cache.invalidate();
    return role;
  }

  // Clone an existing role (with its permission set)
  async clone(id: string, newName: string, actor: Actor) {
    const src = await this.getRole(id);
    this.assertCanGrant(actor, src.permissionCodes);
    const baseKey = (newName || `${src.key}_COPY`).trim().toUpperCase().replace(/\s+/g, '_');
    let key = baseKey;
    let n = 1;
    while (await this.prisma.role.findUnique({ where: { key } })) key = `${baseKey}_${n++}`;

    const perms = await this.prisma.permission.findMany({ where: { code: { in: src.permissionCodes } } });
    const role = await this.prisma.role.create({
      data: { key, name: newName || `${src.name} (Copy)`, description: src.description, isSystem: false,
        permissions: { create: perms.map((p) => ({ permissionId: p.id })) } },
    });
    await this.audit(actor.id, 'ROLE_CLONED', role.id, `${src.key} → ${key}`);
    this.cache.invalidate();
    return role;
  }

  async toggleActive(id: string, actor: Actor) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.key === 'SUPER_ADMIN') throw new ForbiddenException('SUPER_ADMIN cannot be disabled');
    const updated = await this.prisma.role.update({ where: { id }, data: { isActive: !role.isActive } });
    await this.audit(actor.id, updated.isActive ? 'ROLE_ENABLED' : 'ROLE_DISABLED', id, role.key, { isActive: { from: role.isActive, to: updated.isActive } });
    this.cache.invalidate(id);
    return updated;
  }

  async setPermissions(id: string, permissionCodes: string[], actor: Actor) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.key === 'SUPER_ADMIN') throw new ForbiddenException('SUPER_ADMIN permissions are immutable');
    this.assertCanGrant(actor, permissionCodes);

    const perms = await this.prisma.permission.findMany({ where: { code: { in: permissionCodes } } });
    const current = await this.prisma.rolePermission.findMany({ where: { roleId: id }, select: { permission: { select: { code: true } } } });
    const beforeCodes = new Set(current.map((c) => c.permission.code));
    const afterCodes = new Set(perms.map((p) => p.code));
    const added = [...afterCodes].filter((c) => !beforeCodes.has(c)).sort();
    const removed = [...beforeCodes].filter((c) => !afterCodes.has(c)).sort();
    const detail = `${role.key}: ${beforeCodes.size} → ${afterCodes.size} permissions`
      + (added.length ? `; added ${added.join(', ')}` : '') + (removed.length ? `; removed ${removed.join(', ')}` : '');
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      this.prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: id, permissionId: p.id })), skipDuplicates: true }),
      this.prisma.auditLog.create({
        data: {
          userId: actor.id, action: 'ROLE_PERMISSIONS_UPDATED', entityType: 'Role', entityId: id,
          detail: detail.length > 1000 ? `${detail.slice(0, 997)}...` : detail,
          changes: { permissions: { added, removed }, count: { from: beforeCodes.size, to: afterCodes.size } } as any,
        },
      }),
    ]);
    this.cache.invalidate(id);
    return this.getRole(id);
  }

  async remove(id: string, actor: Actor) {
    const role = await this.prisma.role.findUnique({ where: { id }, include: { _count: { select: { users: true, assignments: true } } } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) throw new BadRequestException('System roles cannot be deleted');
    if (role._count.users > 0 || role._count.assignments > 0) throw new BadRequestException('Cannot delete role with assigned users');
    await this.prisma.role.delete({ where: { id } });
    await this.audit(actor.id, 'ROLE_DELETED', id, role.key);
    this.cache.invalidate(id);
    return { deleted: true };
  }

  // ── Permissions (dynamic catalogue) ────────────────────────────────────────
  async createPermission(dto: { code: string; module: string; action: string; description?: string }, actor: Actor) {
    const code = dto.code?.trim() || `${dto.module}.${dto.action}`;
    if (await this.prisma.permission.findUnique({ where: { code } })) throw new ConflictException(`Permission exists: ${code}`);
    const p = await this.prisma.permission.create({
      data: { code, module: dto.module.trim(), action: dto.action.trim(), description: dto.description },
    });
    await this.audit(actor.id, 'PERMISSION_CREATED', p.id, code);
    this.cache.invalidate();
    return p;
  }

  async updatePermission(id: string, dto: { description?: string; module?: string; action?: string }, actor: Actor) {
    const p = await this.prisma.permission.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Permission not found');
    const updated = await this.prisma.permission.update({ where: { id }, data: { description: dto.description, module: dto.module, action: dto.action } });
    await this.audit(actor.id, 'PERMISSION_UPDATED', id, p.code, diffFields(p, updated, ['description', 'module', 'action']));
    this.cache.invalidate();
    return updated;
  }

  async deletePermission(id: string, actor: Actor) {
    const p = await this.prisma.permission.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Permission not found');
    await this.prisma.permission.delete({ where: { id } }); // cascades RolePermission
    await this.audit(actor.id, 'PERMISSION_DELETED', id, p.code);
    this.cache.invalidate();
    return { deleted: true };
  }

  private audit(userId: string, action: string, entityId: string, detail?: string, changes?: ChangeSet) {
    return this.prisma.auditLog.create({
      data: { userId, action, entityType: 'Role', entityId, detail, changes: changes && Object.keys(changes).length ? (changes as any) : undefined },
    });
  }
}
