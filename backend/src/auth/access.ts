import { UserRole } from '@prisma/client';

/**
 * Access rules for warehouse write operations.
 *
 * The DB permission matrix (Role → Permission) is canonical: a user who holds
 * any DB role (User.roleId or a UserRoleAssignment) is authorised by permission
 * codes only. Users that have not been migrated to DB roles yet fall back to the
 * legacy `User.role` enum list, which mirrors what those endpoints (or the
 * sidebar, for endpoints that had no guard) allowed before.
 */
export interface AccessRule {
  /** Any one of these DB permission codes grants access. */
  permissions: readonly string[];
  /** Legacy roles allowed for users without a DB role; 'ANY' = any authenticated user. */
  legacyRoles: readonly UserRole[] | 'ANY';
}

export interface AccessPrincipal {
  id?: string;
  role?: string;
  roleKey?: string | null;
  permissions?: string[];
  rbacAssigned?: boolean;
}

export function hasAccess(user: AccessPrincipal | null | undefined, rule: AccessRule): boolean {
  if (!user) return false;
  if (user.roleKey === 'SUPER_ADMIN') return true;
  if (user.rbacAssigned) {
    const granted = user.permissions ?? [];
    return rule.permissions.some((code) => granted.includes(code));
  }
  if (rule.legacyRoles === 'ANY') return true;
  return !!user.role && (rule.legacyRoles as readonly string[]).includes(user.role);
}

const { SYSTEM_ADMIN, WAREHOUSE_MANAGER, WAREHOUSE_SUPERVISOR, WAREHOUSE_STAFF, DEPT_APPROVER, RMA_TEAM, RTV_OFFICER, AUDITOR } = UserRole;

const OPERATORS = [SYSTEM_ADMIN, WAREHOUSE_MANAGER, WAREHOUSE_SUPERVISOR, WAREHOUSE_STAFF] as const;
const SUPERVISORS = [SYSTEM_ADMIN, WAREHOUSE_MANAGER, WAREHOUSE_SUPERVISOR] as const;
const APPROVERS = [SYSTEM_ADMIN, WAREHOUSE_MANAGER, DEPT_APPROVER] as const;

export const ACCESS = {
  receiving:        { permissions: ['receiving.manage'], legacyRoles: OPERATORS },
  putaway:          { permissions: ['putaway.manage'], legacyRoles: OPERATORS },
  fulfillment:      { permissions: ['fulfillment.manage'], legacyRoles: OPERATORS },
  stockCreate:      { permissions: ['inventory.create'], legacyRoles: OPERATORS },
  stockStatus:      { permissions: ['inventory.adjust'], legacyRoles: OPERATORS },
  stockRelocate:    { permissions: ['inventory.transfer'], legacyRoles: SUPERVISORS },
  /** Releasing a reservation whose request/task is finished — data repair, not a workflow step. */
  reservationRelease:{ permissions: ['inventory.adjust'], legacyRoles: SUPERVISORS },
  transfer:         { permissions: ['inventory.transfer'], legacyRoles: OPERATORS },
  adjustment:       { permissions: ['inventory.adjust'], legacyRoles: SUPERVISORS },
  cycleCount:       { permissions: ['inventory.adjust', 'putaway.manage'], legacyRoles: OPERATORS },
  cycleCountApprove:{ permissions: ['inventory.adjust'], legacyRoles: SUPERVISORS },
  returnsInbound:   { permissions: ['receiving.manage'], legacyRoles: OPERATORS },
  doa:              { permissions: ['rtv.manage'], legacyRoles: [SYSTEM_ADMIN, WAREHOUSE_MANAGER, RTV_OFFICER, RMA_TEAM] },
  rtv:              { permissions: ['rtv.manage'], legacyRoles: [SYSTEM_ADMIN, WAREHOUSE_MANAGER, RTV_OFFICER] },
  scrap:            { permissions: ['rtv.manage'], legacyRoles: [SYSTEM_ADMIN, WAREHOUSE_MANAGER, WAREHOUSE_SUPERVISOR, RTV_OFFICER] },
  rmaUsage:         { permissions: ['rma.manage'], legacyRoles: 'ANY' },
  /** Confirming usage for someone else's request (the requester may always confirm their own). */
  rmaUsageOnBehalf: { permissions: ['request.approve', 'fulfillment.manage'], legacyRoles: [SYSTEM_ADMIN, WAREHOUSE_MANAGER, WAREHOUSE_SUPERVISOR, RMA_TEAM] },
  requestApprove:   { permissions: ['request.approve'], legacyRoles: APPROVERS },
  /** Cancelling someone else's request (the requester may always cancel their own). */
  requestCancelAny: { permissions: ['request.approve'], legacyRoles: APPROVERS },
  productImport:    { permissions: ['product.manage'], legacyRoles: SUPERVISORS },
  dataImport:       { permissions: ['dataio.manage'], legacyRoles: SUPERVISORS },
  auditExport:      { permissions: ['audit.read'], legacyRoles: [SYSTEM_ADMIN, WAREHOUSE_MANAGER, AUDITOR] },
  approvalRules:    { permissions: ['settings.manage'], legacyRoles: [SYSTEM_ADMIN] },
  approvalDecide:   { permissions: ['request.approve'], legacyRoles: APPROVERS },
} satisfies Record<string, AccessRule>;
