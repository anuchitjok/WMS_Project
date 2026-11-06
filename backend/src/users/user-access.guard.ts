import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { canAssignWarehouses } from './user-access';

/**
 * P1 1.7: lets a Warehouse Manager reach the user list, the users export and the
 * warehouse-assignment action (users with `user.manage` keep full access).
 */
@Injectable()
export class UserWarehouseAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('Not authenticated');
    if (!canAssignWarehouses(user)) throw new ForbiddenException('Insufficient permissions');
    return true;
  }
}
