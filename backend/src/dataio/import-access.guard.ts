import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ACCESS, hasAccess } from '../auth/access';
import { PRODUCT_WRITE_ACCESS } from '../products/product-access';

/**
 * Who may import, checked before the upload is read. Product Master rows follow
 * the product write rule (plan 1.7: SYSTEM_ADMIN + WAREHOUSE_MANAGER, or the
 * product.manage permission); every other import type keeps the Data Import rule.
 */
export function importRuleFor(type: string) {
  return type === 'products' ? PRODUCT_WRITE_ACCESS : ACCESS.dataImport;
}

@Injectable()
export class ImportAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!req.user) throw new ForbiddenException('Not authenticated');
    if (!hasAccess(req.user, importRuleFor(String(req.params?.type ?? '')))) throw new ForbiddenException('Insufficient permissions');
    return true;
  }
}
