import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Require one or more permission codes (e.g. 'inventory.adjust').
 * Used with PermissionsGuard. SUPER_ADMIN bypasses all checks.
 */
export const RequirePermissions = (...codes: string[]) => SetMetadata(PERMISSIONS_KEY, codes);
