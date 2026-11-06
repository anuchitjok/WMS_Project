import { UserRole } from '@prisma/client';
import type { AccessRule } from '../auth/access';

/**
 * Plan item 1.7: Product Master is managed by SYSTEM_ADMIN and WAREHOUSE_MANAGER
 * (create, edit, status change, import). Every other role reads only.
 * WAREHOUSE_SUPERVISOR could write before this change.
 */
export const PRODUCT_WRITE_ROLES = [UserRole.SYSTEM_ADMIN, UserRole.WAREHOUSE_MANAGER] as const;

/** Same rule for permission-based (DB role) users: the product.manage code. */
export const PRODUCT_WRITE_ACCESS: AccessRule = { permissions: ['product.manage'], legacyRoles: PRODUCT_WRITE_ROLES };
