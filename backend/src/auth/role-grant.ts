import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

/**
 * Server-side guard rails for handing out roles.
 *
 * "Privileged" means full system control: the DB role SUPER_ADMIN, or — for a
 * user not yet migrated to DB roles — the legacy enum SYSTEM_ADMIN (legacy
 * @Roles guards still honour that enum). Only a privileged actor may create,
 * promote, edit or reset a privileged account. Everyone else may only grant DB
 * roles whose permissions they already hold themselves (same rule as
 * RolesService.assertCanGrant for editing a role's permission matrix).
 */
export interface GrantActor {
  id: string;
  role?: string | null;
  roleKey?: string | null;
  rbacAssigned?: boolean;
  permissions?: string[];
}

export const PRIVILEGED_DB_ROLE = 'SUPER_ADMIN';
export const PRIVILEGED_LEGACY_ROLE: UserRole = UserRole.SYSTEM_ADMIN;

export function isPrivilegedActor(
  actor: GrantActor | null | undefined,
): boolean {
  if (!actor) return false;
  if (actor.roleKey === PRIVILEGED_DB_ROLE) return true;
  return !actor.rbacAssigned && actor.role === PRIVILEGED_LEGACY_ROLE;
}

/** Legacy enum role on User.role. */
export function assertCanGrantLegacyRole(
  actor: GrantActor,
  role: string | null | undefined,
) {
  if (!role) return;
  if (!(Object.values(UserRole) as string[]).includes(role)) {
    throw new ForbiddenException(`Unknown role: ${role}`);
  }
  if (role === PRIVILEGED_LEGACY_ROLE && !isPrivilegedActor(actor)) {
    throw new ForbiddenException(
      'Only a system administrator can grant the SYSTEM_ADMIN role',
    );
  }
}

/** DB role (User.roleId or a UserRoleAssignment). */
export function assertCanGrantDbRole(
  actor: GrantActor,
  role: { key: string; permissions: { permission: { code: string } }[] },
) {
  if (isPrivilegedActor(actor)) return;
  if (role.key === PRIVILEGED_DB_ROLE) {
    throw new ForbiddenException(
      'Only SUPER_ADMIN can assign the SUPER_ADMIN role',
    );
  }
  const held = new Set(actor.permissions ?? []);
  const missing = role.permissions
    .map((p) => p.permission.code)
    .filter((c) => !held.has(c));
  if (missing.length) {
    throw new ForbiddenException(
      `Cannot assign a role with permissions you do not hold: ${missing.join(', ')}`,
    );
  }
}

/** A target account is privileged if any of its roles is. */
export function isPrivilegedTarget(target: {
  role?: string | null;
  rbacRole?: { key: string } | null;
  roleAssignments?: { role: { key: string } }[];
}): boolean {
  if (target.role === PRIVILEGED_LEGACY_ROLE) return true;
  if (target.rbacRole?.key === PRIVILEGED_DB_ROLE) return true;
  return (target.roleAssignments ?? []).some(
    (a) => a.role.key === PRIVILEGED_DB_ROLE,
  );
}

export function assertCanManageTarget(
  actor: GrantActor,
  target: Parameters<typeof isPrivilegedTarget>[0],
) {
  if (isPrivilegedTarget(target) && !isPrivilegedActor(actor)) {
    throw new ForbiddenException(
      'Only a system administrator can change a system administrator account',
    );
  }
}
