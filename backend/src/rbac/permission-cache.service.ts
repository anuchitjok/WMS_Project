import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface CacheEntry { codes: string[]; key: string; isActive: boolean; exp: number }

/**
 * In-memory cache of role → permission codes (+ role key/active flag).
 * Avoids a DB round-trip per request. Invalidated on any role/permission change.
 */
@Injectable()
export class PermissionCacheService {
  private cache = new Map<string, CacheEntry>();
  private readonly TTL = 60_000; // 60s

  constructor(private prisma: PrismaService) {}

  /** Aggregate distinct permission codes across multiple roles (active only). */
  async codesForRoles(roleIds: string[]): Promise<{ codes: string[]; roleKeys: string[] }> {
    const codes = new Set<string>();
    const roleKeys = new Set<string>();
    for (const id of roleIds) {
      const entry = await this.getRole(id);
      if (!entry || !entry.isActive) continue;
      roleKeys.add(entry.key);
      entry.codes.forEach((c) => codes.add(c));
    }
    return { codes: [...codes], roleKeys: [...roleKeys] };
  }

  private async getRole(roleId: string): Promise<CacheEntry | null> {
    const cached = this.cache.get(roleId);
    if (cached && cached.exp > Date.now()) return cached;

    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      select: { key: true, isActive: true, permissions: { select: { permission: { select: { code: true } } } } },
    });
    if (!role) return null;
    const entry: CacheEntry = {
      key: role.key,
      isActive: role.isActive,
      codes: role.permissions.map((p) => p.permission.code),
      exp: Date.now() + this.TTL,
    };
    this.cache.set(roleId, entry);
    return entry;
  }

  /** Clear cache (call after any role/permission mutation). */
  invalidate(roleId?: string) {
    if (roleId) this.cache.delete(roleId);
    else this.cache.clear();
  }
}
