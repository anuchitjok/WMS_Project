import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionCacheService } from '../../rbac/permission-cache.service';
import { TokenBlocklistService } from '../token-blocklist.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
    private permCache: PermissionCacheService,
    private blocklist: TokenBlocklistService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') as string,
    });
  }

  async validate(payload: { sub: string; username: string; role: string; jti?: string }) {
    // Check token blocklist (revocation for logout / password change)
    if (payload.jti && await this.blocklist.isRevoked(payload.jti)) {
      throw new (await import('@nestjs/common').then((m) => m.UnauthorizedException))('Token has been revoked');
    }
    const now = new Date();
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub, deletedAt: null },
      select: {
        id: true, username: true, fullName: true, role: true, isActive: true, roleId: true,
        roleAssignments: {
          where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          select: { roleId: true, warehouseId: true, department: true, expiresAt: true },
        },
        warehouses: { select: { warehouseId: true } },
      },
    });
    if (!user || !user.isActive) throw new UnauthorizedException();

    // Collect all active role ids: legacy primary roleId + non-expired assignments
    const roleIds = new Set<string>();
    if (user.roleId) roleIds.add(user.roleId);
    user.roleAssignments.forEach((a) => roleIds.add(a.roleId));

    // Aggregate permissions across all roles (cached)
    const { codes, roleKeys } = await this.permCache.codesForRoles([...roleIds]);

    // warehouse scope = explicit UserWarehouse rows + any warehouse-scoped role assignments
    const scopedWh = user.roleAssignments.map((a) => a.warehouseId).filter((w): w is string => !!w);
    const warehouseIds = [...new Set([...user.warehouses.map((w) => w.warehouseId), ...scopedWh])];

    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role, // legacy enum (for @Roles guards)
      roleKey: roleKeys.includes('SUPER_ADMIN') ? 'SUPER_ADMIN' : (roleKeys[0] ?? null),
      roleKeys,
      permissions: codes,
      warehouseIds,
    };
  }
}
