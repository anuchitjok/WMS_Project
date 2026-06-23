import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '@prisma/client';

const USER_SELECT = {
  id: true, username: true, fullName: true, email: true, role: true, roleId: true,
  department: true, phone: true, isActive: true, forcePasswordChange: true,
  lastLoginAt: true, createdAt: true,
  rbacRole: { select: { id: true, key: true, name: true } },
  warehouses: { select: { warehouse: { select: { id: true, code: true, name: true } } } },
  roleAssignments: {
    select: {
      id: true, roleId: true, warehouseId: true, department: true, expiresAt: true,
      role: { select: { key: true, name: true } },
    },
  },
};

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  findAll(role?: UserRole) {
    return this.prisma.user.findMany({
      where: { deletedAt: null, ...(role ? { role } : {}) },
      select: USER_SELECT,
      orderBy: { fullName: 'asc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id, deletedAt: null }, select: USER_SELECT });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(dto: any, actorId: string) {
    const exists = await this.prisma.user.findFirst({
      where: { OR: [{ username: dto.username }, ...(dto.email ? [{ email: dto.email }] : [])] },
    });
    if (exists) throw new ConflictException('Username or email already exists');

    const hash = await bcrypt.hash(dto.password || 'Welcome@123', 12);
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        fullName: dto.fullName,
        email: dto.email || null,
        role: (dto.role as UserRole) || UserRole.REQUESTER,
        roleId: dto.roleId || null,
        department: dto.department || null,
        passwordHash: hash,
        forcePasswordChange: dto.password ? false : true, // temp password must be changed
        passwordChangedAt: new Date(),
      },
      select: USER_SELECT,
    });
    if (Array.isArray(dto.warehouseIds) && dto.warehouseIds.length) {
      await this.prisma.userWarehouse.createMany({
        data: dto.warehouseIds.map((w: string) => ({ userId: user.id, warehouseId: w })),
        skipDuplicates: true,
      });
    }
    await this.audit(actorId, 'USER_CREATED', user.id, dto.username);
    return user;
  }

  async update(id: string, dto: any, actorId: string) {
    await this.findOne(id);

    // Username must stay unique across (non-deleted) users
    if (dto.username) {
      const clash = await this.prisma.user.findFirst({
        where: { username: dto.username, NOT: { id } },
        select: { id: true },
      });
      if (clash) throw new ConflictException('Username already exists');
    }

    const data: any = {
      fullName: dto.fullName,
      email: dto.email,
      department: dto.department,
      phone: dto.phone,
      role: dto.role as UserRole | undefined,
      roleId: dto.roleId,
    };
    if (dto.username) data.username = dto.username;
    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 12);
      data.passwordChangedAt = new Date();
      data.forcePasswordChange = false; // admin set an explicit password
      data.failedLoginCount = 0;
      data.lockedUntil = null;
    }

    const user = await this.prisma.user.update({ where: { id }, data, select: USER_SELECT });
    await this.audit(actorId, 'USER_UPDATED', id);
    if (dto.password) await this.audit(actorId, 'PASSWORD_SET_BY_ADMIN', id);
    return user;
  }

  async toggleActive(id: string, actorId: string) {
    const user = await this.findOne(id);
    const updated = await this.prisma.user.update({
      where: { id }, data: { isActive: !user.isActive }, select: { id: true, isActive: true },
    });
    await this.audit(actorId, updated.isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', id);
    return updated;
  }

  async resetPassword(id: string, actorId: string) {
    await this.findOne(id);
    const temp = 'Temp@' + Math.random().toString(36).slice(2, 8);
    const hash = await bcrypt.hash(temp, 12);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: hash, forcePasswordChange: true, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
    await this.audit(actorId, 'PASSWORD_RESET', id);
    return { tempPassword: temp, forcePasswordChange: true };
  }

  async forceChange(id: string, actorId: string) {
    await this.findOne(id);
    await this.prisma.user.update({ where: { id }, data: { forcePasswordChange: true } });
    await this.audit(actorId, 'FORCE_PASSWORD_CHANGE', id);
    return { forcePasswordChange: true };
  }

  loginHistory(id: string) {
    return this.prisma.loginHistory.findMany({
      where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 50,
    });
  }

  async setWarehouses(id: string, warehouseIds: string[], actorId: string) {
    await this.findOne(id);
    await this.prisma.$transaction([
      this.prisma.userWarehouse.deleteMany({ where: { userId: id } }),
      this.prisma.userWarehouse.createMany({
        data: (warehouseIds ?? []).map((w) => ({ userId: id, warehouseId: w })),
        skipDuplicates: true,
      }),
    ]);
    await this.audit(actorId, 'USER_WAREHOUSES_SET', id, `${warehouseIds?.length ?? 0} warehouses`);
    return this.findOne(id);
  }

  async setRole(id: string, roleId: string | null, actorId: string) {
    await this.findOne(id);
    const user = await this.prisma.user.update({ where: { id }, data: { roleId }, select: USER_SELECT });
    await this.audit(actorId, 'USER_ROLE_ASSIGNED', id, roleId ?? 'none');
    return user;
  }

  async softDelete(id: string, actorId: string) {
    await this.findOne(id);
    const r = await this.prisma.user.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await this.audit(actorId, 'USER_DELETED', id);
    return r;
  }

  // ── Multi-role assignment (scope + expiry) ─────────────────────────────────
  listRoleAssignments(userId: string) {
    return this.prisma.userRoleAssignment.findMany({
      where: { userId },
      include: { role: { select: { key: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async assignRole(
    userId: string,
    dto: { roleId: string; warehouseId?: string; department?: string; expiresAt?: string },
    actor: { id: string; roleKey?: string },
  ) {
    await this.findOne(userId);
    const role = await this.prisma.role.findUnique({ where: { id: dto.roleId } });
    if (!role) throw new NotFoundException('Role not found');
    // Privilege escalation guard: only SUPER_ADMIN can grant SUPER_ADMIN
    if (role.key === 'SUPER_ADMIN' && actor.roleKey !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only SUPER_ADMIN can assign the SUPER_ADMIN role');
    }
    const data = {
      department: dto.department ?? null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      assignedById: actor.id,
    };
    const existing = await this.prisma.userRoleAssignment.findFirst({
      where: { userId, roleId: dto.roleId, warehouseId: dto.warehouseId ?? null },
    });
    const assignment = existing
      ? await this.prisma.userRoleAssignment.update({ where: { id: existing.id }, data })
      : await this.prisma.userRoleAssignment.create({
          data: { userId, roleId: dto.roleId, warehouseId: dto.warehouseId ?? null, ...data },
        });
    await this.audit(actor.id, 'USER_ROLE_GRANTED', userId, `${role.key}${dto.expiresAt ? ' (temp)' : ''}`);
    return assignment;
  }

  async unassignRole(userId: string, assignmentId: string, actor: { id: string; roleKey?: string }) {
    const a = await this.prisma.userRoleAssignment.findUnique({ where: { id: assignmentId }, include: { role: true } });
    if (!a || a.userId !== userId) throw new NotFoundException('Assignment not found');
    if (a.role.key === 'SUPER_ADMIN' && actor.roleKey !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only SUPER_ADMIN can revoke the SUPER_ADMIN role');
    }
    await this.prisma.userRoleAssignment.delete({ where: { id: assignmentId } });
    await this.audit(actor.id, 'USER_ROLE_REVOKED', userId, a.role.key);
    return { revoked: true };
  }

  private audit(userId: string, action: string, entityId: string, detail?: string) {
    return this.prisma.auditLog.create({ data: { userId, action, entityType: 'User', entityId, detail } });
  }
}
