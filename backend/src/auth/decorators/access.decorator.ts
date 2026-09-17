import { SetMetadata } from '@nestjs/common';
import type { AccessRule } from '../access';

export const ACCESS_KEY = 'access';

/** Require an access rule (see auth/access.ts). Used with AccessGuard. */
export const Access = (rule: AccessRule) => SetMetadata(ACCESS_KEY, rule);
