import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { GrantActor, isPrivilegedActor } from '../auth/role-grant';
import { scopedWarehouseIds } from '../common/warehouse-scope';

/**
 * Who may do what on the Users screen.
 *
 *  - Full user management (create, edit, roles, passwords, delete) needs the
 *    `user.manage` permission (unchanged — class-level guard on UsersController).
 *  - P1 1.7 (Q1: Admin = WAREHOUSE_MANAGER): a Warehouse Manager may also see the
 *    user list and set which warehouses a user can work in. Nothing else: no role
 *    changes, no new accounts, and never a system administrator's account (see
 *    assertCanManageTarget). Recognised by the DB role key WAREHOUSE_MANAGER or —
 *    like the sidebar — the legacy enum role WAREHOUSE_MANAGER.
 */
export interface UsersActor extends GrantActor {
  roleKeys?: string[];
  warehouseIds?: string[];
}

export const USER_MANAGE = 'user.manage';
export const WAREHOUSE_MANAGER_KEY = 'WAREHOUSE_MANAGER';

export function canManageUsers(actor: UsersActor | null | undefined): boolean {
  if (!actor) return false;
  if (actor.roleKey === 'SUPER_ADMIN') return true;
  return (actor.permissions ?? []).includes(USER_MANAGE);
}

export function isWarehouseManager(actor: UsersActor | null | undefined): boolean {
  if (!actor) return false;
  if (actor.roleKey === WAREHOUSE_MANAGER_KEY) return true;
  if ((actor.roleKeys ?? []).includes(WAREHOUSE_MANAGER_KEY)) return true;
  return actor.role === UserRole.WAREHOUSE_MANAGER;
}

/** May list users, export them and set their warehouses. */
export function canAssignWarehouses(actor: UsersActor | null | undefined): boolean {
  return canManageUsers(actor) || isPrivilegedActor(actor) || isWarehouseManager(actor);
}

/**
 * A warehouse manager (without user.manage) who is limited to some warehouses
 * may only add or remove those warehouses, and may not clear the list — an
 * empty list means "every warehouse", which would widen access beyond their own.
 */
export function assertWarehouseAssignmentScope(
  actor: UsersActor,
  before: string[],
  after: string[],
) {
  if (canManageUsers(actor) || isPrivilegedActor(actor)) return;
  if (!isWarehouseManager(actor)) {
    throw new ForbiddenException('Insufficient permissions');
  }
  const scope = scopedWarehouseIds(actor);
  if (!scope) return; // unrestricted manager
  if (after.length === 0) {
    throw new ForbiddenException(
      'You can only limit users to your own warehouses — at least one warehouse must stay selected',
    );
  }
  const b = new Set(before);
  const a = new Set(after);
  const changed = [...after.filter((w) => !b.has(w)), ...before.filter((w) => !a.has(w))];
  const outside = changed.filter((w) => !scope.includes(w));
  if (outside.length) {
    throw new ForbiddenException('You can only add or remove warehouses you have access to');
  }
}

/** What the signed-in user may do on the Users screen (drives which buttons the web app shows). */
export function usersCapabilities(actor: UsersActor | null | undefined, canImport: boolean) {
  const manage = canManageUsers(actor);
  return {
    manageUsers: manage,
    assignWarehouses: canAssignWarehouses(actor),
    exportUsers: canAssignWarehouses(actor),
    importUsers: manage && canImport,
  };
}

// ── Export ─────────────────────────────────────────────────────────────────

/**
 * Export columns — an explicit allow-list. Passwords, password hashes, tokens,
 * failed-login counters and lock state are never selected or written.
 * Headers are API/file values and are not translated.
 */
export const USER_EXPORT_COLUMNS = [
  { header: 'username', key: 'username', width: 18 },
  { header: 'fullName', key: 'fullName', width: 28 },
  { header: 'email', key: 'email', width: 30 },
  { header: 'role', key: 'role', width: 22 },
  { header: 'rbacRoles', key: 'rbacRoles', width: 34 },
  { header: 'department', key: 'department', width: 20 },
  { header: 'warehouses', key: 'warehouses', width: 26 },
  { header: 'active', key: 'active', width: 8 },
  { header: 'lastLoginAt', key: 'lastLoginAt', width: 22 },
] as const;

export type UserExportRow = Record<(typeof USER_EXPORT_COLUMNS)[number]['key'], string>;

/** Prisma select for the export — only the fields the export needs. */
export const USER_EXPORT_SELECT = {
  username: true,
  fullName: true,
  email: true,
  role: true,
  department: true,
  isActive: true,
  lastLoginAt: true,
  rbacRole: { select: { name: true } },
  roleAssignments: { select: { expiresAt: true, role: { select: { name: true } } } },
  warehouses: { select: { warehouse: { select: { code: true } } } },
} as const;

interface ExportSource {
  username: string;
  fullName: string;
  email?: string | null;
  role?: string | null;
  department?: string | null;
  isActive: boolean;
  lastLoginAt?: Date | string | null;
  rbacRole?: { name: string } | null;
  roleAssignments?: { expiresAt?: Date | string | null; role: { name: string } }[];
  warehouses?: { warehouse: { code: string } }[];
}

/** One export row. Builds a fresh object from allowed keys only, whatever the input carries. */
export function toUserExportRow(u: ExportSource, now = new Date()): UserExportRow {
  const roleNames = new Set<string>();
  if (u.rbacRole?.name) roleNames.add(u.rbacRole.name);
  for (const a of u.roleAssignments ?? []) {
    const exp = a.expiresAt ? new Date(a.expiresAt) : null;
    if (!exp || exp > now) roleNames.add(a.role.name);
  }
  const last = u.lastLoginAt ? new Date(u.lastLoginAt) : null;
  return {
    username: u.username,
    fullName: u.fullName,
    email: u.email ?? '',
    role: u.role ?? '',
    rbacRoles: [...roleNames].join(', '),
    department: u.department ?? '',
    warehouses: (u.warehouses ?? []).map((w) => w.warehouse.code).sort().join(', '),
    active: u.isActive ? 'true' : 'false',
    lastLoginAt: last ? last.toISOString() : '',
  };
}
